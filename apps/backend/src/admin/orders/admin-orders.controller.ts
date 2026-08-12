import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { RequirePage } from '../../permissions/require-page.decorator';
import { PagePermissionGuard } from '../../permissions/page-permission.guard';
import { canSeeCostProfit } from '../../permissions/capability.util';
import type { RequestUser } from '../../auth/jwt.strategy';
import { AuditService } from '../../audit/audit.service';
import { AdminOrdersService } from './admin-orders.service';
import { AdminOrderQueryDto } from './dto/admin-order-query.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { BulkUpdateOrdersDto } from './dto/bulk-update.dto';

type AdminReq = Request & { user: RequestUser };

/**
 * Maliyet/kâr görünürlüğü artık "⚙ Yetki — Maliyet & Kâr Görebilir"
 * anahtarına bağlı (izin matrisinden açılır). OWNER daima, ADMIN varsayılan
 * açık; çalışana patron isterse verir.
 */
function canSeeCost(req: AdminReq): boolean {
  return canSeeCostProfit(req);
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Beklemede',
  awaiting_payment: 'Ödeme bekleniyor',
  paid: 'Ödendi',
  preparing: 'Hazırlanıyor',
  shipped: 'Kargoya Verildi',
  cancelled: 'İptal edildi',
  refunded: 'İade edildi',
  completed: 'Tamamlandı',
};

function statusLabel(status?: string | null): string | null {
  if (!status) return null;
  return STATUS_LABELS[status] ?? status;
}

@UseGuards(JwtAuthGuard, RolesGuard, PagePermissionGuard)
@RequirePage('orders')
@Roles('OWNER', 'ADMIN', 'MEMBER')
@Controller('admin/orders')
export class AdminOrdersController {
  constructor(
    private readonly service: AdminOrdersService,
    private readonly audit: AuditService,
  ) {}

  private actor(req: AdminReq) {
    return {
      type: 'admin' as const,
      id: req.user.id,
      email: req.user.email,
      name: req.user.email,
      tenantId: req.user.tenantId,
    };
  }

  @Get()
  list(@Query() query: AdminOrderQueryDto, @Req() req: AdminReq) {
    return this.service.list(req.user.tenantId, query, canSeeCost(req));
  }

  /**
   * Kaydetmeden önce: girilen kargo barkodunun bu tenant'ta başka bir
   * siparişte zaten kullanılıp kullanılmadığını döner. Eşleşme varsa
   * admin UI onay penceresi açıp manuel karara bırakır.
   * `:id` route'undan ÖNCE tanımlanmalı, yoksa NestJS bunu id sanır.
   */
  @Get('check-cargo-barcode')
  checkCargoBarcode(
    @Query('barcode') barcode: string,
    @Query('excludeOrderId') excludeOrderId: string | undefined,
    @Req() req: AdminReq,
  ) {
    const value = typeof barcode === 'string' ? barcode : '';
    return this.service
      .findCargoBarcodeDuplicates(req.user.tenantId, value, excludeOrderId ?? null)
      .then((matches) => ({ matches }));
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: AdminReq) {
    return this.service.findOne(req.user.tenantId, id, canSeeCost(req));
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateOrderDto,
    @Req() req: AdminReq,
  ) {
    const { notify, ...rest } = dto;
    const before = await this.service
      .findOne(req.user.tenantId, id)
      .catch(() => null);
    const result = await this.service.updateOrder(
      req.user.tenantId,
      id,
      rest,
      { id: req.user.id, tenantId: req.user.tenantId },
      { notify },
    );

    const orderNo =
      (before as { humanOrderNo?: string } | null)?.humanOrderNo ?? id;
    const statusChanged =
      dto.status !== undefined &&
      (before as { status?: string } | null)?.status !== dto.status;

    let summary: string;
    if (statusChanged) {
      const fromLabel =
        statusLabel((before as { status?: string } | null)?.status) ?? '—';
      const toLabel = statusLabel(dto.status) ?? dto.status ?? '—';
      summary = `${req.user.email} '${orderNo}' siparişini ${fromLabel} → ${toLabel} olarak güncelledi`;
    } else if (dto.trackingNumber || dto.cargoBarcode || dto.cargoCompany) {
      summary = `${req.user.email} '${orderNo}' siparişine kargo bilgilerini girdi`;
    } else {
      summary = `${req.user.email} '${orderNo}' siparişini güncelledi`;
    }

    await this.audit.record({
      action: 'ORDER_UPDATE',
      summary,
      actor: this.actor(req),
      target: { id, type: 'order', label: orderNo },
      before: before
        ? {
            status: (before as { status?: string }).status,
            trackingNumber: (before as { trackingNumber?: string | null })
              .trackingNumber,
            cargoBarcode: (before as { cargoBarcode?: string | null })
              .cargoBarcode,
            cargoCompany: (before as { cargoCompany?: string | null })
              .cargoCompany,
          }
        : null,
      after: rest as unknown as Record<string, unknown>,
      req,
    });

    return result;
  }

  /**
   * Toplu sipariş statü güncelleme — max 200 sipariş/işlem.
   * Üç mod: 'selected' | 'filtered' | 'transition'. Detaylar için
   * `dto/bulk-update.dto.ts`'in JSDoc'una bakın.
   */
  @Post('bulk-update')
  @HttpCode(200)
  async bulkUpdate(@Body() dto: BulkUpdateOrdersDto, @Req() req: AdminReq) {
    const result = await this.service.bulkUpdate(req.user.tenantId, dto, {
      id: req.user.id,
      tenantId: req.user.tenantId,
    });

    const toLabel = statusLabel(dto.toStatus) ?? dto.toStatus;
    const data = (result as { data?: { succeeded?: number; failed?: unknown[]; requested?: number } })
      .data;
    const succeeded = data?.succeeded ?? 0;
    const failed = Array.isArray(data?.failed) ? data!.failed!.length : 0;

    await this.audit.record({
      action: 'ORDER_BULK_UPDATE',
      summary: `${req.user.email} ${succeeded} siparişi '${toLabel}' durumuna aldı${
        failed > 0 ? ` (${failed} başarısız)` : ''
      }`,
      actor: this.actor(req),
      target: { type: 'order-bulk', label: toLabel },
      extra: {
        mode: dto.mode,
        toStatus: dto.toStatus,
        fromStatus: dto.fromStatus,
        requested: data?.requested ?? 0,
        succeeded,
        failed,
      },
      req,
    });

    return result;
  }

  /**
   * Sipariş kalemleri için "aynı isimli ürünü daha ucuza şu tedarikçiden
   * alabilirsiniz" ipuçları. Sadece admin görür.
   */
  @Get(':id/supplier-alternatives')
  @RequirePage('orders', 'yetki_maliyet_kar')
  supplierAlternatives(@Param('id') id: string, @Req() req: AdminReq) {
    return this.service.getSupplierAlternatives(req.user.tenantId, id);
  }

  /**
   * Belirli bir sipariş kalemi için seçilebilir tedarikçiler — yalnızca
   * o ürünü aktif olarak stoklayan tedarikçiler döner.
   */
  // Yanıt ham ALIŞ MALİYETİ taşır → "Maliyet & Kâr" yetkisi gerekir.
  @Get(':id/items/:itemId/eligible-suppliers')
  @RequirePage('orders', 'yetki_maliyet_kar')
  itemEligibleSuppliers(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Req() req: AdminReq,
  ) {
    return this.service.getItemEligibleSuppliers(req.user.tenantId, id, itemId);
  }

  /**
   * Bayinin gerçekte alım yaptığı tedarikçiyi günceller. supplierId=null
   * gönderilirse override sıfırlanır (orijinal tedarikçiye dön).
   */
  // Tedarikçi kaydırma = alım maliyetini değiştiren karar.
  @Patch(':id/items/:itemId/supplier')
  @RequirePage('orders', 'yetki_maliyet_kar')
  async setItemSupplier(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() body: { supplierId: string | null },
    @Req() req: AdminReq,
  ) {
    const before = await this.service
      .findOne(req.user.tenantId, id)
      .catch(() => null);
    const result = await this.service.setItemSupplierOverride(
      req.user.tenantId,
      id,
      itemId,
      body?.supplierId ?? null,
    );
    const orderNo =
      (before as { humanOrderNo?: string } | null)?.humanOrderNo ?? id;
    await this.audit.record({
      action: 'ORDER_ITEM_SUPPLIER_OVERRIDE',
      summary: `${req.user.email} '${orderNo}' siparişinde kalem tedarikçisini güncelledi`,
      actor: this.actor(req),
      target: { id: itemId, type: 'order-item', label: orderNo },
      after: { supplierId: body?.supplierId ?? null },
      req,
    });
    return result;
  }

  /**
   * SİPARİŞ-SEVİYESİ seçilebilir tedarikçiler — yalnızca siparişin TÜM
   * kalemlerini stoklayan tedarikçiler (toplam maliyetle). Admin tüm siparişi
   * tek tıkla bir tedarikçiye kaydırmak için bunu kullanır (ürün-ürün değil).
   */
  // Toplam alış maliyeti döner — bkz. itemEligibleSuppliers gerekçesi.
  @Get(':id/order-eligible-suppliers')
  @RequirePage('orders', 'yetki_maliyet_kar')
  orderEligibleSuppliers(@Param('id') id: string, @Req() req: AdminReq) {
    return this.service.getOrderEligibleSuppliers(req.user.tenantId, id);
  }

  /**
   * Tüm siparişi TEK tedarikçiye kaydırır (tüm kalemler). supplierId=null →
   * tüm override'ları sıfırla (canonical/display'e dön). Bir sipariş = tek tedarikçi.
   */
  @Patch(':id/order-supplier')
  @RequirePage('orders', 'yetki_maliyet_kar')
  async setOrderSupplier(
    @Param('id') id: string,
    @Body() body: { supplierId: string | null },
    @Req() req: AdminReq,
  ) {
    const before = await this.service
      .findOne(req.user.tenantId, id)
      .catch(() => null);
    const result = await this.service.setOrderSupplier(
      req.user.tenantId,
      id,
      body?.supplierId ?? null,
    );
    const orderNo =
      (before as { humanOrderNo?: string } | null)?.humanOrderNo ?? id;
    await this.audit.record({
      action: 'ORDER_SUPPLIER_OVERRIDE',
      summary: `${req.user.email} '${orderNo}' siparişinin TAMAMINI tek tedarikçiye kaydırdı`,
      actor: this.actor(req),
      target: { id, type: 'order', label: orderNo },
      after: { supplierId: body?.supplierId ?? null },
      req,
    });
    return result;
  }

  /**
   * Tedarikçinin bayiye verdiği sipariş numarasını kaydeder.
   * İlk kez set edildiğinde sipariş "paid" ise otomatik "preparing"e geçer.
   */
  @Patch(':id/items/:itemId/supplier-order-no')
  async setItemSupplierOrderNo(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() body: { supplierOrderNo: string | null },
    @Req() req: AdminReq,
  ) {
    const before = await this.service
      .findOne(req.user.tenantId, id)
      .catch(() => null);
    const result = await this.service.setItemSupplierOrderNo(
      req.user.tenantId,
      id,
      itemId,
      body?.supplierOrderNo ?? null,
    );
    const orderNo =
      (before as { humanOrderNo?: string } | null)?.humanOrderNo ?? id;
    await this.audit.record({
      action: 'ORDER_ITEM_SUPPLIER_ORDER_NO',
      summary: `${req.user.email} '${orderNo}' siparişinde tedarikçi sipariş numarasını güncelledi`,
      actor: this.actor(req),
      target: { id: itemId, type: 'order-item', label: orderNo },
      after: { supplierOrderNo: body?.supplierOrderNo ?? null },
      req,
    });
    return result;
  }

  /**
   * Sipariş bazında tedarikçi sipariş numarası — tek input, tüm kalemleri
   * kapsar. İlk kez set edildiğinde "paid" → "preparing" otomatik geçiş.
   */
  @Patch(':id/supplier-order-no')
  async setOrderSupplierOrderNo(
    @Param('id') id: string,
    @Body() body: { supplierOrderNo: string | null },
    @Req() req: AdminReq,
  ) {
    const before = await this.service
      .findOne(req.user.tenantId, id)
      .catch(() => null);
    const result = await this.service.setOrderSupplierOrderNo(
      req.user.tenantId,
      id,
      body?.supplierOrderNo ?? null,
    );
    const orderNo =
      (before as { humanOrderNo?: string } | null)?.humanOrderNo ?? id;
    await this.audit.record({
      action: 'ORDER_SUPPLIER_ORDER_NO',
      summary: `${req.user.email} '${orderNo}' siparişine tedarikçi sipariş numarasını girdi`,
      actor: this.actor(req),
      target: { id, type: 'order', label: orderNo },
      after: { supplierOrderNo: body?.supplierOrderNo ?? null },
      req,
    });
    return result;
  }

  @Delete(':id')
  @HttpCode(200)
  async remove(@Param('id') id: string, @Req() req: AdminReq) {
    const before = await this.service
      .findOne(req.user.tenantId, id)
      .catch(() => null);
    const orderNo =
      (before as { humanOrderNo?: string } | null)?.humanOrderNo ?? id;
    const result = await this.service.deleteOrder(req.user.tenantId, id);
    await this.audit.record({
      action: 'ORDER_DELETE',
      summary: `${req.user.email} '${orderNo}' siparişini sildi`,
      actor: this.actor(req),
      target: { id, type: 'order', label: orderNo },
      before: before
        ? {
            status: (before as { status?: string }).status,
            total: (before as { total?: unknown }).total,
            customerEmail: (before as { customerEmail?: string | null })
              .customerEmail,
          }
        : null,
      req,
    });
    return result;
  }
}

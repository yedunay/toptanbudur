import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ZodError, type ZodSchema } from 'zod';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import type { RequestUser } from '../auth/jwt.strategy';
import { HouseStockService } from './house-stock.service';
import { upsertHouseStockItemSchema } from './dto/upsert-item.dto';
import { updateHouseStockSettingsSchema } from './dto/update-settings.dto';
import { houseStockOrdersTabSchema } from './dto/orders-query.dto';

interface RequestWithUser {
  user: RequestUser;
}

function zParse<T>(schema: ZodSchema<T>, input: unknown): T {
  try {
    return schema.parse(input);
  } catch (err) {
    if (err instanceof ZodError) {
      const msg = err.issues.map((i) => i.message).join('; ');
      throw new BadRequestException(msg || 'Geçersiz veri');
    }
    throw err;
  }
}

/**
 * Depo — OWNER paneli arka uç.
 *
 * Tüm route'lar OWNER rolü gerektirir. Bir OWNER, aynı tenant'taki diğer
 * OWNER'ların depo verisini sekme sekme görebilir (OWNER başına bir sekme +
 * Toplam).
 * Customer endpoint'i YOKTUR: müşteri tarafı bu mekanizmanın varlığından
 * haberdar olmaz.
 */
@Controller('admin/house-stock')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER')
export class HouseStockController {
  constructor(private readonly service: HouseStockService) {}

  // ───────────────────── Owners ─────────────────────

  @Get('owners')
  listOwners(@Req() req: RequestWithUser) {
    return this.service.listOwners(req.user.tenantId);
  }

  // ───────────────────── Items ──────────────────────

  @Get('items')
  listItems(@Req() req: RequestWithUser, @Query('ownerId') ownerId?: string) {
    if (!ownerId) throw new BadRequestException('ownerId zorunlu');
    return this.service.listItems(ownerId, req.user.tenantId);
  }

  @Post('items')
  upsertItem(
    @Req() req: RequestWithUser,
    @Query('ownerId') ownerId: string | undefined,
    @Body() body: unknown,
  ) {
    if (!ownerId) throw new BadRequestException('ownerId zorunlu');
    if (ownerId !== req.user.id) {
      throw new BadRequestException(
        'OWNER yalnızca kendi deposunu düzenleyebilir',
      );
    }
    const dto = zParse(upsertHouseStockItemSchema, body);
    return this.service.upsertItem(ownerId, req.user.tenantId, dto);
  }

  @Delete('items/:id')
  deleteItem(
    @Req() req: RequestWithUser,
    @Param('id') id: string,
    @Query('ownerId') ownerId?: string,
  ) {
    if (!ownerId) throw new BadRequestException('ownerId zorunlu');
    if (ownerId !== req.user.id) {
      throw new BadRequestException(
        'OWNER yalnızca kendi deposunu düzenleyebilir',
      );
    }
    return this.service.deleteItem(id, ownerId, req.user.tenantId);
  }

  // ───────────────────── Settings ───────────────────

  @Get('settings')
  getSettings(@Req() req: RequestWithUser, @Query('ownerId') ownerId?: string) {
    if (!ownerId) throw new BadRequestException('ownerId zorunlu');
    return this.service.getSettings(ownerId, req.user.tenantId);
  }

  @Put('settings')
  updateSettings(
    @Req() req: RequestWithUser,
    @Query('ownerId') ownerId: string | undefined,
    @Body() body: unknown,
  ) {
    if (!ownerId) throw new BadRequestException('ownerId zorunlu');
    if (ownerId !== req.user.id) {
      throw new BadRequestException(
        'OWNER yalnızca kendi tatil ayarını değiştirebilir',
      );
    }
    const dto = zParse(updateHouseStockSettingsSchema, body);
    return this.service.updateSettings(ownerId, req.user.tenantId, dto);
  }

  // Compat for clients sending PATCH instead of PUT.
  @Patch('settings')
  patchSettings(
    @Req() req: RequestWithUser,
    @Query('ownerId') ownerId: string | undefined,
    @Body() body: unknown,
  ) {
    return this.updateSettings(req, ownerId, body);
  }

  // ───────────────────── Orders (3 sub-tabs) ────────

  @Get('orders')
  listOrders(
    @Req() req: RequestWithUser,
    @Query('ownerId') ownerId?: string,
    @Query('tab') tab?: string,
  ) {
    if (!ownerId) throw new BadRequestException('ownerId zorunlu');
    const parsedTab = zParse(houseStockOrdersTabSchema, tab);
    return this.service.listOrdersByTab(ownerId, req.user.tenantId, parsedTab);
  }

  // ───────────────────── Order-level actions ────────

  /**
   * "Depodan Gönder" (Bekleyen sekmesi) — OWNER siparişin TÜM Depo
   * kalemlerini evindeki stoktan göndermeyi onaylar (geri alınamaz). Stok
   * düşümü + sales log + OrderItem dispatch alanları + Order.supplierOrderNo
   * ("Depo {ad}") + paid→preparing geçişi tek transaction'da yapılır.
   * Sipariş "Kargoya Verilecek" sekmesine geçer.
   */
  @Post('orders/:id/dispatch')
  dispatchOrderFromDepot(@Req() req: RequestWithUser, @Param('id') id: string) {
    return this.service.dispatchOrderFromDepot(id, {
      id: req.user.id,
      tenantId: req.user.tenantId,
    });
  }

  /**
   * "Tedarikçiye Devret" (Bekleyen sekmesi) — OWNER siparişi evden
   * gönderemeyeceğini bildirir. Rezervasyonlar serbest bırakılır, sipariş
   * Depo'dan çıkar; bot normal tedarikçi rotasından temin eder. Sipariş
   * statüsü değişmez (paid kalır).
   */
  @Post('orders/:id/transfer-to-supplier')
  transferOrderToSupplier(
    @Req() req: RequestWithUser,
    @Param('id') id: string,
  ) {
    return this.service.transferOrderToSupplier(id, {
      id: req.user.id,
      tenantId: req.user.tenantId,
    });
  }

  /**
   * "Kargoya Verdim" (Kargoya Verilecek sekmesi) — OWNER ürünü fiziksel olarak
   * kargoya teslim etti. Statü 'preparing' → 'shipped' (nihai aşama).
   */
  @Post('orders/:id/mark-shipped')
  markOrderShipped(@Req() req: RequestWithUser, @Param('id') id: string) {
    return this.service.markOrderShipped(id, {
      id: req.user.id,
      tenantId: req.user.tenantId,
    });
  }

  /**
   * "Gönderimi Sağlayamayacağım Tedarikçiye Devret" (Kargoya Verilecek
   * sekmesi) — OWNER depodan gönderdi ama kargoya veremiyor. Sipariş tedarikçiye
   * devredilir, statü 'preparing' → 'paid' düşer ve düşülen stok geri eklenir.
   */
  @Post('orders/:id/revert-to-supplier')
  revertOrderToSupplier(@Req() req: RequestWithUser, @Param('id') id: string) {
    return this.service.revertOrderToSupplier(id, {
      id: req.user.id,
      tenantId: req.user.tenantId,
    });
  }

  // ───────────────────── Sales / badge ──────────────

  @Get('sales-summary')
  getSalesSummary(@Req() req: RequestWithUser, @Query('ownerId') ownerId?: string) {
    if (!ownerId) throw new BadRequestException('ownerId zorunlu');
    return this.service.getSalesSummary(ownerId, req.user.tenantId);
  }

  /**
   * Hesabım menüsündeki kırmızı badge için kendi OWNER'ının ve (varsa) diğer
   * OWNER'ların Bekleyen sayısı. Frontend tek çağrıda hem kendi sekme
   * badge'ini hem üst nav badge'ini doldurabilsin diye toplam da döndürülür.
   */
  @Get('badge')
  async getBadge(@Req() req: RequestWithUser) {
    const owners = await this.service.listOwners(req.user.tenantId);
    const counts = await Promise.all(
      owners.map(async (o) => ({
        ownerId: o.id,
        ownerName: o.name,
        pendingCount: await this.service.countPendingForOwner(
          o.id,
          req.user.tenantId,
        ),
      })),
    );
    const myCount = counts.find((c) => c.ownerId === req.user.id)?.pendingCount ?? 0;
    const totalCount = counts.reduce((sum, c) => sum + c.pendingCount, 0);
    return { myCount, totalCount, byOwner: counts };
  }
}

import { Controller, Get, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { PagePermissionGuard } from '../../permissions/page-permission.guard';
import { RequirePage } from '../../permissions/require-page.decorator';
import type { RequestUser } from '../../auth/jwt.strategy';
import { AuditService } from '../../audit/audit.service';
import { AdminNotifierService } from '../../mail/admin-notifier.service';
import { renderAdminOrdersExported } from '../../mail/admin-templates';
import { AdminExportsService } from './admin-exports.service';
import { ProductsExportQueryDto } from './dto/products-export-query.dto';
import { OrdersExportQueryDto } from './dto/orders-export-query.dto';
import { AuditExportQueryDto } from './dto/audit-export-query.dto';

const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

type AdminReq = Request & { user: RequestUser };

// Her export ucu, verisini aldığı sayfanın izin anahtarıyla korunur (method
// seviyesinde @RequirePage) — sayfası izinli olan kullanıcı export da alabilir.
@UseGuards(JwtAuthGuard, RolesGuard, PagePermissionGuard)
@Roles('OWNER', 'ADMIN', 'MEMBER')
@Controller('admin/exports')
export class AdminExportsController {
  constructor(
    private readonly service: AdminExportsService,
    private readonly audit: AuditService,
    private readonly adminNotifier: AdminNotifierService,
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

  @Get('products')
  @RequirePage('products')
  async exportProducts(
    @Query() query: ProductsExportQueryDto,
    @Req() req: AdminReq,
    @Res() res: Response,
  ): Promise<void> {
    const { buffer, filename } = await this.service.exportProducts(
      req.user.tenantId,
      {
        supplierId: query.supplierId,
        from: query.from,
        to: query.to,
        category: query.category,
        inStock: query.inStock === 'true',
        minPrice: query.minPrice,
        maxPrice: query.maxPrice,
        q: query.q,
        brand: query.brand,
      },
      { id: req.user.id, email: req.user.email },
    );
    await this.audit.record({
      action: 'EXPORT_PRODUCTS',
      summary: `${req.user.email} ürün listesini Excel olarak indirdi`,
      actor: this.actor(req),
      target: { type: 'export', label: filename },
      extra: { filename, filters: query as unknown as Record<string, unknown> },
      req,
    });
    res.setHeader('Content-Type', XLSX_CONTENT_TYPE);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"`,
    );
    res.status(200).send(buffer);
  }

  /**
   * Sipariş dökümü (cari hesap) Excel. Dosya maliyet/kâr bilgisi içerdiğinden
   * yalnızca OWNER rolü erişebilir — method seviyesindeki @Roles, sınıf
   * seviyesindeki ('OWNER','ADMIN') metadata'sını override eder.
   */
  @Get('orders')
  @Roles('OWNER')
  @RequirePage('orders', 'yetki_maliyet_kar')
  async exportOrders(
    @Query() query: OrdersExportQueryDto,
    @Req() req: AdminReq,
    @Res() res: Response,
  ): Promise<void> {
    const { buffer, filename, count } = await this.service.exportOrders(
      req.user.tenantId,
      {
        from: query.from,
        to: query.to,
        status: query.status,
        customerId: query.customerId,
        supplierId: query.supplierId,
        customer: query.customer,
      },
      { id: req.user.id, email: req.user.email },
    );
    await this.audit.record({
      action: 'EXPORT_ORDERS',
      summary: `${req.user.email} sipariş dökümünü (cari hesap) Excel olarak indirdi`,
      actor: this.actor(req),
      target: { type: 'export', label: filename },
      extra: { filename, filters: query as unknown as Record<string, unknown> },
      req,
    });

    // Maliyet/kâr içeren hassas dosya — her dışa aktarımda tüm OWNER'lara
    // bilgilendirme gönderilir (yetkisiz/şüpheli aktarım görünür olsun).
    const exportFilters: { label: string; value: string }[] = [];
    if (query.from)
      exportFilters.push({ label: 'Başlangıç tarihi', value: query.from });
    if (query.to)
      exportFilters.push({ label: 'Bitiş tarihi', value: query.to });
    if (query.status)
      exportFilters.push({ label: 'Durum', value: query.status });
    if (query.customer)
      exportFilters.push({ label: 'Bayi araması', value: query.customer });
    if (query.customerId)
      exportFilters.push({ label: 'Bayi ID', value: query.customerId });
    if (query.supplierId)
      exportFilters.push({ label: 'Tedarikçi ID', value: query.supplierId });
    void this.adminNotifier.notifyAdmins({
      tenantId: req.user.tenantId,
      roles: ['OWNER'],
      account: 'info',
      context: 'orders-export',
      subject: `Sipariş dökümü dışa aktarıldı — ${filename}`,
      html: renderAdminOrdersExported({
        actorEmail: req.user.email,
        filename,
        count,
        filters: exportFilters,
      }),
    });

    res.setHeader('Content-Type', XLSX_CONTENT_TYPE);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"`,
    );
    res.status(200).send(buffer);
  }

  /**
   * Detaylı müşteri Excel'i — bayi kazanımı / pazarlama için segment sekmeleri
   * (Sipariş vermeyen, XML kullanmayan, uyuyan, pasif). Cost/kâr içermez;
   * sınıf seviyesindeki ('OWNER','ADMIN') erişimi geçerlidir.
   */
  // Excel'de 'Kâr İnd. %' ve cari bakiye kolonları var → sayfa izninin
  // yanında "Maliyet & Kâr" yetkisi de gerekir (JSON maskesiyle tutarlı).
  @Get('customers')
  @RequirePage('customers', 'yetki_maliyet_kar')
  async exportCustomers(
    @Req() req: AdminReq,
    @Res() res: Response,
  ): Promise<void> {
    const { buffer, filename } = await this.service.exportCustomers(
      req.user.tenantId,
      { id: req.user.id, email: req.user.email },
    );
    await this.audit.record({
      action: 'EXPORT_CUSTOMERS',
      summary: `${req.user.email} müşteri analizini Excel olarak indirdi`,
      actor: this.actor(req),
      target: { type: 'export', label: filename },
      extra: { filename },
      req,
    });
    res.setHeader('Content-Type', XLSX_CONTENT_TYPE);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(buffer);
  }

  @Get('audit-logs')
  @RequirePage('loglar')
  async exportAuditLogs(
    @Query() query: AuditExportQueryDto,
    @Req() req: AdminReq,
    @Res() res: Response,
  ): Promise<void> {
    const { buffer, filename } = await this.service.exportAuditLogs(
      req.user.tenantId,
      {
        from: query.from,
        to: query.to,
        actorId: query.actorId,
        action: query.action,
        audience: query.audience,
        q: query.q,
      },
      { id: req.user.id, email: req.user.email },
    );
    await this.audit.record({
      action: 'EXPORT_AUDIT_LOGS',
      summary: `${req.user.email} sistem loglarını Excel olarak indirdi`,
      actor: this.actor(req),
      target: { type: 'export', label: filename },
      extra: { filename, filters: query as unknown as Record<string, unknown> },
      req,
    });
    res.setHeader('Content-Type', XLSX_CONTENT_TYPE);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"`,
    );
    res.status(200).send(buffer);
  }
}

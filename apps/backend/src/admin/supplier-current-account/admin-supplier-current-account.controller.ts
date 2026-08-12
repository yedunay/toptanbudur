import { Controller, Get, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import type { RequestUser } from '../../auth/jwt.strategy';
import { RequirePage } from '../../permissions/require-page.decorator';
import { PagePermissionGuard } from '../../permissions/page-permission.guard';
import { AuditService } from '../../audit/audit.service';
import { AdminSupplierCurrentAccountService } from './admin-supplier-current-account.service';
import { TedarikciCariQueryDto } from './dto/tedarikci-cari-query.dto';

const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

type AdminReq = Request & { user: RequestUser };

@UseGuards(JwtAuthGuard, RolesGuard, PagePermissionGuard)
@RequirePage('cari')
@Roles('OWNER', 'ADMIN', 'MEMBER')
@Controller('admin/tedarikci-cari')
export class AdminSupplierCurrentAccountController {
  constructor(
    private readonly service: AdminSupplierCurrentAccountService,
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

  @Get('report')
  getReport(@Query() q: TedarikciCariQueryDto, @Req() req: AdminReq) {
    return this.service.getReport(req.user.tenantId, q);
  }

  @Get('export')
  async exportReport(
    @Query() q: TedarikciCariQueryDto,
    @Req() req: AdminReq,
    @Res() res: Response,
  ): Promise<void> {
    const { buffer, filename } = await this.service.exportReport(
      req.user.tenantId,
      q,
    );
    await this.audit.record({
      action: 'EXPORT_TEDARIKCI_CARI',
      summary: `${req.user.email} tedarikçi cari hareketlerini Excel olarak indirdi`,
      actor: this.actor(req),
      target: { type: 'export', label: filename },
      extra: { filename, filters: q as unknown as Record<string, unknown> },
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

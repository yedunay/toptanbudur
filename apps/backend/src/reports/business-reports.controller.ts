/**
 * Faz 4 — İş raporları HTTP arayüzü.
 *
 * `GET /admin/reports/preview` — JSON summary (frontend önizleme paneli için).
 * `GET /admin/reports/download` — XLSX (veya PDF fallback) binary indirme.
 *
 * Hedef kullanım: Frontend Raporlar sayfası önce preview ile satır sayısı/ciro
 * toplamını gösterir, kullanıcı "İndir" derse aynı parametrelerle download'a
 * gider. ReportSchedule CRUD ayrı bir controller'da.
 */
import {
  BadRequestException,
  Controller,
  Get,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { PagePermissionGuard } from '../permissions/page-permission.guard';
import { RequirePage } from '../permissions/require-page.decorator';
import type { RequestUser } from '../auth/jwt.strategy';
import { AuditService } from '../audit/audit.service';
import {
  BusinessReportFormat,
  BusinessReportType,
  BusinessReportsBuilder,
} from './business-reports.builder';

type AdminReq = Request & { user: RequestUser };

const REPORT_TYPES = new Set<BusinessReportType>([
  'monthly_sales',
  'dealer_performance',
  'inventory_value',
  'supplier_profit',
]);

const FORMATS = new Set<BusinessReportFormat>(['xlsx', 'pdf']);

function parseType(value: string | undefined): BusinessReportType {
  if (!value || !REPORT_TYPES.has(value as BusinessReportType)) {
    throw new BadRequestException(
      `type parametresi zorunlu — ${Array.from(REPORT_TYPES).join(', ')}`,
    );
  }
  return value as BusinessReportType;
}

function parseFormat(value: string | undefined): BusinessReportFormat {
  if (!value) return 'xlsx';
  if (!FORMATS.has(value as BusinessReportFormat)) {
    throw new BadRequestException(`format geçersiz: ${value}`);
  }
  return value as BusinessReportFormat;
}

// supplier_profit / ciro içerir — 'ayarlar_raporlar' sayfa izni şart.
// Patron bu sayfayı istediği kullanıcıya matristen açabilir.
@UseGuards(JwtAuthGuard, RolesGuard, PagePermissionGuard)
@RequirePage('ayarlar_raporlar')
@Roles('OWNER', 'ADMIN', 'MEMBER')
@Controller('admin/reports')
export class BusinessReportsController {
  constructor(
    private readonly builder: BusinessReportsBuilder,
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

  /**
   * Detaylı önizleme — summary + columns + rows + totals döner.
   * Frontend bu veriyi tablo halinde gösterir, kullanıcı isterse "İndir" der.
   */
  @Get('preview')
  async preview(
    @Query('type') type: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('period') period?: string,
    @Query('supplierId') supplierId?: string,
  ) {
    const reportType = parseType(type);
    const preview = await this.builder.buildPreview(reportType, {
      from,
      to,
      period,
      supplierId,
    });
    return {
      success: true,
      data: preview,
    };
  }

  @Get('download')
  async download(
    @Query('type') type: string,
    @Query('format') format: string | undefined,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('period') period: string | undefined,
    @Query('supplierId') supplierId: string | undefined,
    @Req() req: AdminReq,
    @Res() res: Response,
  ): Promise<void> {
    const reportType = parseType(type);
    const reportFormat = parseFormat(format);
    const report = await this.builder.build(reportType, reportFormat, {
      from,
      to,
      period,
      supplierId,
    });

    await this.audit.record({
      action: 'REPORT_DOWNLOADED',
      summary: `${req.user.email} ${reportType} raporunu indirdi (${report.summary.rowCount} satır)`,
      actor: this.actor(req),
      target: { type: 'report', label: report.filename },
      extra: {
        type: reportType,
        format: reportFormat,
        rowCount: report.summary.rowCount,
        totalAmount: report.summary.totalAmount,
        rangeFrom: report.summary.rangeFrom,
        rangeTo: report.summary.rangeTo,
      },
      req,
    });

    res.setHeader('Content-Type', report.contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${report.filename}"`,
    );
    res.status(200).send(report.buffer);
  }
}

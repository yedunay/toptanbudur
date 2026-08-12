import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AdminFinanceService } from './finance.service';
import { FinanceExportService } from './finance-export.service';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { RequirePage } from '../../permissions/require-page.decorator';
import { PagePermissionGuard } from '../../permissions/page-permission.guard';
import type { RequestUser } from '../../auth/jwt.strategy';
import {
  CreateExpenseDto,
  CreateExpenseTemplateDto,
  CreateIntegrationEntryDto,
  CreatePartnerAdvanceDto,
  UpdateExpenseDto,
  UpdateExpenseTemplateDto,
  UpdateIntegrationEntryDto,
  UpdatePartnerAdvanceDto,
  UpdatePartnerDto,
} from './dto/finance.dto';

const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function toInt(v: unknown, fallback: number): number {
  const n = parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Aylık Finans ve Ortak Dağılım Paneli uçları.
 * Tüm uçlar `muhasebe_kar_dagilimi` sayfa yetkisini ister (ADMIN/OWNER).
 */
@Controller('admin/finance')
@UseGuards(JwtAuthGuard, RolesGuard, PagePermissionGuard)
@Roles('ADMIN', 'OWNER', 'MEMBER')
@RequirePage('muhasebe_kar_dagilimi')
export class AdminFinanceController {
  constructor(
    private readonly svc: AdminFinanceService,
    private readonly exporter: FinanceExportService,
  ) {}

  private actor(req: Request & { user: RequestUser }) {
    return { id: req.user.id, email: req.user.email };
  }

  // ── Aylık panel ──────────────────────────────────────────────────────────────
  @Get('monthly')
  getMonthly(
    @Req() req: Request & { user: RequestUser },
    @Query('month') month: string,
    @Query('trendMonths') trendMonths?: string,
  ) {
    // trendMonths'u makul aralığa sıkıştır: aksi halde uydurma büyük bir değer
    // buildTrend'de N adet getRangeTotals fan-out'u + devasa IN sorgusu üretip
    // bağlantı havuzunu tüketebilir (DoS). 1..36 ay yeter.
    const tm = Math.min(36, Math.max(1, toInt(trendMonths, 12)));
    return this.svc.getMonthlyPanel(req.user.tenantId, month, tm);
  }

  @Get('monthly/export.xlsx')
  async exportXlsx(
    @Req() req: Request & { user: RequestUser },
    @Query('month') month: string,
    @Res() res: Response,
  ) {
    const panel = await this.svc.getMonthlyPanel(req.user.tenantId, month);
    const buffer = await this.exporter.buildExcel(panel);
    const filename = `aylik-finans-${panel.month}.xlsx`;
    res.setHeader('Content-Type', XLSX_MIME);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', String(buffer.length));
    res.end(buffer);
  }

  @Get('monthly/export.pdf')
  async exportPdf(
    @Req() req: Request & { user: RequestUser },
    @Query('month') month: string,
    @Res() res: Response,
  ) {
    const panel = await this.svc.getMonthlyPanel(req.user.tenantId, month);
    const buffer = await this.exporter.buildPdf(panel);
    const filename = `aylik-finans-${panel.month}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', String(buffer.length));
    res.end(buffer);
  }

  // ── Ortaklar ───────────────────────────────────────────────────────────────
  @Get('partners')
  listPartners(@Req() req: Request & { user: RequestUser }) {
    return this.svc.listPartners(req.user.tenantId);
  }

  @Patch('partners/:id')
  updatePartner(
    @Req() req: Request & { user: RequestUser },
    @Param('id') id: string,
    @Body() dto: UpdatePartnerDto,
  ) {
    return this.svc.updatePartner(req.user.tenantId, id, dto, this.actor(req));
  }

  // ── Manuel gelir/gider satırları ─────────────────────────────────────────────
  @Get('integration-entries')
  listEntries(
    @Req() req: Request & { user: RequestUser },
    @Query('month') month: string,
  ) {
    return this.svc.listIntegrationEntries(req.user.tenantId, month);
  }

  @Post('integration-entries')
  createEntry(
    @Req() req: Request & { user: RequestUser },
    @Body() dto: CreateIntegrationEntryDto,
  ) {
    return this.svc.createIntegrationEntry(req.user.tenantId, dto, this.actor(req));
  }

  @Patch('integration-entries/:id')
  updateEntry(
    @Req() req: Request & { user: RequestUser },
    @Param('id') id: string,
    @Body() dto: UpdateIntegrationEntryDto,
  ) {
    return this.svc.updateIntegrationEntry(
      req.user.tenantId,
      id,
      dto,
      this.actor(req),
    );
  }

  @Delete('integration-entries/:id')
  deleteEntry(
    @Req() req: Request & { user: RequestUser },
    @Param('id') id: string,
  ) {
    return this.svc.deleteIntegrationEntry(req.user.tenantId, id, this.actor(req));
  }

  // ── Sürekli gider tanımları ──────────────────────────────────────────────────
  @Get('expense-templates')
  listTemplates(@Req() req: Request & { user: RequestUser }) {
    return this.svc.listTemplates(req.user.tenantId);
  }

  @Post('expense-templates')
  createTemplate(
    @Req() req: Request & { user: RequestUser },
    @Body() dto: CreateExpenseTemplateDto,
  ) {
    return this.svc.createTemplate(req.user.tenantId, dto, this.actor(req));
  }

  @Patch('expense-templates/:id')
  updateTemplate(
    @Req() req: Request & { user: RequestUser },
    @Param('id') id: string,
    @Body() dto: UpdateExpenseTemplateDto,
  ) {
    return this.svc.updateTemplate(req.user.tenantId, id, dto, this.actor(req));
  }

  @Delete('expense-templates/:id')
  deleteTemplate(
    @Req() req: Request & { user: RequestUser },
    @Param('id') id: string,
  ) {
    return this.svc.deleteTemplate(req.user.tenantId, id, this.actor(req));
  }

  // ── Aya düşen gider satırları ────────────────────────────────────────────────
  @Post('expenses')
  createExpense(
    @Req() req: Request & { user: RequestUser },
    @Body() dto: CreateExpenseDto,
  ) {
    return this.svc.createExpense(req.user.tenantId, dto, this.actor(req));
  }

  @Patch('expenses/:id')
  updateExpense(
    @Req() req: Request & { user: RequestUser },
    @Param('id') id: string,
    @Body() dto: UpdateExpenseDto,
  ) {
    return this.svc.updateExpense(req.user.tenantId, id, dto, this.actor(req));
  }

  @Delete('expenses/:id')
  deleteExpense(
    @Req() req: Request & { user: RequestUser },
    @Param('id') id: string,
  ) {
    return this.svc.deleteExpense(req.user.tenantId, id, this.actor(req));
  }

  // ── Kâr Avansı (ortak cari çekimi) ───────────────────────────────────────────
  @Get('advances')
  listAdvances(
    @Req() req: Request & { user: RequestUser },
    @Query('month') month?: string,
  ) {
    return this.svc.listAdvances(req.user.tenantId, month);
  }

  @Post('advances')
  createAdvance(
    @Req() req: Request & { user: RequestUser },
    @Body() dto: CreatePartnerAdvanceDto,
  ) {
    return this.svc.createAdvance(req.user.tenantId, dto, this.actor(req));
  }

  @Patch('advances/:id')
  updateAdvance(
    @Req() req: Request & { user: RequestUser },
    @Param('id') id: string,
    @Body() dto: UpdatePartnerAdvanceDto,
  ) {
    return this.svc.updateAdvance(req.user.tenantId, id, dto, this.actor(req));
  }

  @Delete('advances/:id')
  deleteAdvance(
    @Req() req: Request & { user: RequestUser },
    @Param('id') id: string,
  ) {
    return this.svc.deleteAdvance(req.user.tenantId, id, this.actor(req));
  }
}

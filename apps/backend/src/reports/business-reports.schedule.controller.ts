/**
 * Faz 4 — Zamanlanmış rapor CRUD HTTP arayüzü.
 *
 * `/admin/reports/schedules` altında list/create/update/delete + manuel `:id/run`.
 * Auth: OWNER veya ADMIN. Tüm yazma operasyonları audit'lenir.
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { PagePermissionGuard } from '../permissions/page-permission.guard';
import { RequirePage } from '../permissions/require-page.decorator';
import type { RequestUser } from '../auth/jwt.strategy';
import { AuditService } from '../audit/audit.service';
import {
  BusinessReportFormat,
  BusinessReportParams,
  BusinessReportType,
} from './business-reports.builder';
import { BusinessReportsScheduleService } from './business-reports.schedule.service';

type AdminReq = Request & { user: RequestUser };

interface ScheduleCreateBody {
  name: string;
  reportType: BusinessReportType;
  format?: BusinessReportFormat;
  cron: string;
  recipients: string[];
  enabled?: boolean;
  params?: BusinessReportParams | null;
}

type ScheduleUpdateBody = Partial<ScheduleCreateBody>;

@UseGuards(JwtAuthGuard, RolesGuard, PagePermissionGuard)
@RequirePage('ayarlar_raporlar')
@Roles('OWNER', 'ADMIN', 'MEMBER')
@Controller('admin/reports/schedules')
export class BusinessReportsScheduleController {
  constructor(
    private readonly schedules: BusinessReportsScheduleService,
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
  async list() {
    const items = await this.schedules.list();
    return { success: true, data: items };
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    const item = await this.schedules.get(id);
    return { success: true, data: item };
  }

  @Post()
  async create(@Body() body: ScheduleCreateBody, @Req() req: AdminReq) {
    const created = await this.schedules.create({
      ...body,
      createdBy: req.user.email,
    });
    await this.audit.record({
      action: 'REPORT_SCHEDULE_CREATED',
      summary: `${req.user.email} "${created.name}" rapor planı oluşturdu`,
      actor: this.actor(req),
      target: { type: 'report_schedule', id: created.id, label: created.name },
      extra: {
        reportType: created.reportType,
        cron: created.cron,
        recipients: created.recipients,
      },
      req,
    });
    return { success: true, data: created };
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: ScheduleUpdateBody,
    @Req() req: AdminReq,
  ) {
    const before = await this.schedules.get(id);
    const updated = await this.schedules.update(id, body);
    await this.audit.record({
      action: 'REPORT_SCHEDULE_UPDATED',
      summary: `${req.user.email} "${updated.name}" rapor planını güncelledi`,
      actor: this.actor(req),
      target: { type: 'report_schedule', id: updated.id, label: updated.name },
      before: {
        name: before.name,
        cron: before.cron,
        enabled: before.enabled,
      },
      after: {
        name: updated.name,
        cron: updated.cron,
        enabled: updated.enabled,
      },
      req,
    });
    return { success: true, data: updated };
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string, @Req() req: AdminReq): Promise<void> {
    const before = await this.schedules.get(id);
    await this.schedules.remove(id);
    await this.audit.record({
      action: 'REPORT_SCHEDULE_DELETED',
      summary: `${req.user.email} "${before.name}" rapor planını sildi`,
      actor: this.actor(req),
      target: { type: 'report_schedule', id: before.id, label: before.name },
      extra: { reportType: before.reportType, cron: before.cron },
      req,
    });
  }

  @Post(':id/run')
  async runNow(@Param('id') id: string, @Req() req: AdminReq) {
    const row = await this.schedules.get(id);
    const result = await this.schedules.runNow(id);
    await this.audit.record({
      action: 'REPORT_SCHEDULE_RUN',
      summary: `${req.user.email} "${row.name}" rapor planını manuel tetikledi (${result.status})`,
      actor: this.actor(req),
      target: { type: 'report_schedule', id: row.id, label: row.name },
      extra: { status: result.status, error: result.error ?? null },
      req,
    });
    return { success: true, data: result };
  }
}

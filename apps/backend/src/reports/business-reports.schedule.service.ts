/**
 * Faz 4 — Zamanlanmış rapor CRUD + dinamik scheduler.
 *
 * `ReportSchedule` tablosundaki her enabled kayıt için @nestjs/schedule
 * SchedulerRegistry üzerinden CronJob kaydeder. CRUD çağrıları registry'yi
 * reload eder. Job fire ettiğinde:
 *   1. BusinessReportsBuilder ile dosya üret
 *   2. Recipients'a mail at (XLSX attachment)
 *   3. lastRunAt / lastStatus / lastError güncelle
 *
 * Cron formatı: 5 veya 6 alanlı standart pattern (saniye opsiyonel).
 * Geçersiz pattern'lerde job kaydedilmez ve log yazılır.
 */
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { Prisma, ReportSchedule } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import {
  BusinessReportFormat,
  BusinessReportParams,
  BusinessReportType,
  BusinessReportsBuilder,
} from './business-reports.builder';

interface ScheduleInput {
  name: string;
  reportType: BusinessReportType;
  format?: BusinessReportFormat;
  cron: string;
  recipients: string[];
  enabled?: boolean;
  params?: BusinessReportParams | null;
  createdBy?: string | null;
}

const VALID_TYPES: BusinessReportType[] = [
  'monthly_sales',
  'dealer_performance',
  'inventory_value',
  'supplier_profit',
];

const VALID_FORMATS: BusinessReportFormat[] = ['xlsx', 'pdf'];

const JOB_PREFIX = 'report-schedule:';

function jobName(id: string): string {
  return `${JOB_PREFIX}${id}`;
}

function validateCron(pattern: string): boolean {
  try {
    new CronJob(pattern, () => undefined, null, false, 'Europe/Istanbul');
    return true;
  } catch {
    return false;
  }
}

@Injectable()
export class BusinessReportsScheduleService implements OnModuleInit {
  private readonly logger = new Logger(BusinessReportsScheduleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly builder: BusinessReportsBuilder,
    private readonly mail: MailService,
    private readonly registry: SchedulerRegistry,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.reloadAll();
  }

  // ───────────────────────── CRUD ─────────────────────────

  async list(): Promise<ReportSchedule[]> {
    return this.prisma.reportSchedule.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(id: string): Promise<ReportSchedule> {
    const row = await this.prisma.reportSchedule.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Rapor planı bulunamadı');
    return row;
  }

  async create(input: ScheduleInput): Promise<ReportSchedule> {
    this.validate(input);
    const created = await this.prisma.reportSchedule.create({
      data: {
        name: input.name,
        reportType: input.reportType,
        format: input.format ?? 'xlsx',
        cron: input.cron,
        recipients: input.recipients,
        enabled: input.enabled ?? true,
        params: (input.params ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        createdBy: input.createdBy ?? null,
      },
    });
    this.scheduleOne(created);
    return created;
  }

  async update(
    id: string,
    input: Partial<ScheduleInput>,
  ): Promise<ReportSchedule> {
    const existing = await this.get(id);
    const merged: ScheduleInput = {
      name: input.name ?? existing.name,
      reportType: (input.reportType ?? existing.reportType) as BusinessReportType,
      format: (input.format ?? existing.format) as BusinessReportFormat,
      cron: input.cron ?? existing.cron,
      recipients: input.recipients ?? existing.recipients,
      enabled: input.enabled ?? existing.enabled,
      params: input.params ?? (existing.params as BusinessReportParams | null),
    };
    this.validate(merged);
    const updated = await this.prisma.reportSchedule.update({
      where: { id },
      data: {
        name: merged.name,
        reportType: merged.reportType,
        format: merged.format,
        cron: merged.cron,
        recipients: merged.recipients,
        enabled: merged.enabled,
        params: (merged.params ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      },
    });
    this.unscheduleOne(id);
    this.scheduleOne(updated);
    return updated;
  }

  async remove(id: string): Promise<void> {
    await this.get(id);
    this.unscheduleOne(id);
    await this.prisma.reportSchedule.delete({ where: { id } });
  }

  /** Bir kaydı manuel tetikle (test/preview). */
  async runNow(
    id: string,
  ): Promise<{ status: 'success' | 'failed'; error?: string }> {
    const row = await this.get(id);
    return this.runSchedule(row);
  }

  // ───────────────────────── Scheduler ─────────────────────────

  private async reloadAll(): Promise<void> {
    const existing = this.registry.getCronJobs();
    for (const [name, job] of existing) {
      if (name.startsWith(JOB_PREFIX)) {
        job.stop();
        this.registry.deleteCronJob(name);
      }
    }
    const rows = await this.prisma.reportSchedule.findMany({
      where: { enabled: true },
    });
    for (const row of rows) this.scheduleOne(row);
    this.logger.log(`Rapor scheduler başlatıldı — ${rows.length} aktif plan`);
  }

  private scheduleOne(row: ReportSchedule): void {
    if (!row.enabled) return;
    if (!validateCron(row.cron)) {
      this.logger.warn(
        `Geçersiz cron pattern — id=${row.id} cron="${row.cron}"`,
      );
      return;
    }
    const name = jobName(row.id);
    const job = new CronJob(
      row.cron,
      () => {
        void this.runSchedule(row);
      },
      null,
      false,
      'Europe/Istanbul',
    );
    this.registry.addCronJob(name, job as unknown as CronJob);
    job.start();
    this.logger.log(
      `Plan kaydedildi — ${row.name} (${row.reportType}) cron="${row.cron}"`,
    );
  }

  private unscheduleOne(id: string): void {
    const name = jobName(id);
    try {
      const job = this.registry.getCronJob(name);
      job.stop();
      this.registry.deleteCronJob(name);
    } catch {
      // Job yoksa sessizce geç.
    }
  }

  private async runSchedule(
    row: ReportSchedule,
  ): Promise<{ status: 'success' | 'failed'; error?: string }> {
    const startedAt = new Date();
    try {
      const params = (row.params ?? {}) as BusinessReportParams;
      const report = await this.builder.build(
        row.reportType as BusinessReportType,
        row.format as BusinessReportFormat,
        params,
      );
      if (row.recipients.length > 0) {
        await this.mail.sendHtml({
          account: 'info',
          to: row.recipients,
          subject: `[Toptan Budur] ${row.name}`,
          html: this.renderEmailBody(row, report.summary),
          attachments: [
            {
              filename: report.filename,
              content: report.buffer,
              contentType: report.contentType,
            },
          ],
        });
      }
      await this.prisma.reportSchedule.update({
        where: { id: row.id },
        data: {
          lastRunAt: startedAt,
          lastStatus: 'success',
          lastError: null,
        },
      });
      this.logger.log(
        `Plan çalıştı — ${row.name} rows=${report.summary.rowCount}`,
      );
      return { status: 'success' };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'bilinmeyen hata';
      await this.prisma.reportSchedule.update({
        where: { id: row.id },
        data: {
          lastRunAt: startedAt,
          lastStatus: 'failed',
          lastError: message,
        },
      });
      this.logger.error(`Plan başarısız — ${row.name}: ${message}`);
      return { status: 'failed', error: message };
    }
  }

  private renderEmailBody(
    row: ReportSchedule,
    summary: {
      rowCount: number;
      rangeFrom: string;
      rangeTo: string;
      totalAmount?: number;
    },
  ): string {
    const formattedTotal =
      summary.totalAmount !== undefined
        ? new Intl.NumberFormat('tr-TR', {
            style: 'currency',
            currency: 'TRY',
          }).format(summary.totalAmount)
        : null;
    return `
<!DOCTYPE html>
<html lang="tr"><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,sans-serif;color:#111827;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.08);">
        <tr><td style="background:#4f46e5;padding:24px 32px;">
          <div style="color:#ffffff;font-size:18px;font-weight:700;">Toptan Budur — Otomatik Rapor</div>
          <div style="color:#c7d2fe;font-size:13px;margin-top:4px;">${escapeHtml(row.name)}</div>
        </td></tr>
        <tr><td style="padding:28px 32px;">
          <p style="margin:0 0 16px;">Zamanlanmış raporunuz hazır — ekte bulabilirsiniz.</p>
          <table cellpadding="6" cellspacing="0" style="font-size:14px;border-collapse:collapse;width:100%;">
            <tr><td style="color:#6b7280;">Rapor Tipi</td><td style="font-weight:600;">${escapeHtml(row.reportType)}</td></tr>
            <tr><td style="color:#6b7280;">Dönem</td><td>${escapeHtml(summary.rangeFrom.slice(0, 10))} → ${escapeHtml(summary.rangeTo.slice(0, 10))}</td></tr>
            <tr><td style="color:#6b7280;">Satır Sayısı</td><td>${summary.rowCount}</td></tr>
            ${formattedTotal ? `<tr><td style="color:#6b7280;">Toplam</td><td style="font-weight:600;color:#059669;">${escapeHtml(formattedTotal)}</td></tr>` : ''}
          </table>
        </td></tr>
        <tr><td style="background:#f9fafb;padding:16px 32px;border-top:1px solid #e5e7eb;">
          <p style="margin:0;font-size:12px;color:#9ca3af;">Bu e-posta otomatik gönderilmiştir.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
  }

  private validate(input: ScheduleInput): void {
    if (!input.name?.trim()) {
      throw new BadRequestException('name zorunlu');
    }
    if (!VALID_TYPES.includes(input.reportType)) {
      throw new BadRequestException(
        `reportType geçersiz — ${VALID_TYPES.join(', ')}`,
      );
    }
    if (input.format && !VALID_FORMATS.includes(input.format)) {
      throw new BadRequestException('format geçersiz');
    }
    if (!input.cron?.trim() || !validateCron(input.cron)) {
      throw new BadRequestException('cron pattern geçersiz');
    }
    if (!Array.isArray(input.recipients) || input.recipients.length === 0) {
      throw new BadRequestException('En az bir alıcı zorunlu');
    }
  }
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

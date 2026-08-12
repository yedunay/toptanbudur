/**
 * Z raporu — admin manuel tetikleme endpoint'i.
 *
 * `POST /admin/reports/z-report/run` — dünün Z raporunu yeniden gönderir.
 * Varsayılan: işi kuyruğa ekler (hızlı yanıt). `?sync=true` ile yalnız
 * istek sahibinin tenant'ı için senkron çalıştırılıp sonuç döner —
 * test/doğrulama amaçlıdır.
 */
import {
  Controller,
  Logger,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { RequirePage } from '../permissions/require-page.decorator';
import { PagePermissionGuard } from '../permissions/page-permission.guard';
import type { RequestUser } from '../auth/jwt.strategy';
import { Z_REPORT_JOB, Z_REPORT_QUEUE } from './z-report.constants';
import { ZReportService } from './z-report.service';

@Controller('admin/reports/z-report')
@UseGuards(JwtAuthGuard, RolesGuard, PagePermissionGuard)
@RequirePage('ayarlar_raporlar')
@Roles('ADMIN', 'OWNER', 'MEMBER')
export class ZReportController {
  private readonly logger = new Logger(ZReportController.name);

  constructor(
    @InjectQueue(Z_REPORT_QUEUE)
    private readonly queue: Queue,
    private readonly zReport: ZReportService,
  ) {}

  @Post('run')
  async run(
    @Req() req: Request & { user: RequestUser },
    @Query('sync') sync?: string,
  ) {
    const user = req.user;

    // Senkron mod — yalnız istek sahibinin tenant'ı, sonuç hemen döner.
    if (sync === 'true') {
      this.logger.log(
        `Z raporu manuel (senkron) — tenant=${user.tenantId} by ${user.email}`,
      );
      const result = await this.zReport.runForTenant(user.tenantId);
      return {
        mode: 'sync',
        tenantId: result.tenantId,
        period: result.period.label,
        recipientCount: result.recipientCount,
        orderCount: result.orderCount,
        totalRevenue: result.totalRevenue,
        skipped: result.skipped,
      };
    }

    // Varsayılan — kuyruğa eklenir, tüm tenant'lar için çalışır.
    const job = await this.queue.add(
      Z_REPORT_JOB,
      {},
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5 * 60_000 },
        removeOnComplete: 30,
        removeOnFail: 30,
      },
    );
    this.logger.log(
      `Z raporu manuel (kuyruk) — jobId=${job.id} by ${user.email}`,
    );
    return { mode: 'queued', jobId: job.id };
  }
}

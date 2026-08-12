/**
 * Raporlar modülü.
 *
 * Şimdilik tek özellik: günlük Z raporu (gece 00:00 mail + manuel tetikleme).
 * Z raporu kuyruğunu BullMQ'ya kaydeder; bağlantı `QueueModule`'deki
 * `BullModule.forRootAsync` üzerinden gelir (global root config).
 */
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { MailModule } from '../mail/mail.module';
import { CariBalanceModule } from '../cari-balance/cari-balance.module';
import { ProfitabilitySharedModule } from '../profitability/profitability-shared.module';
import { Z_REPORT_QUEUE } from './z-report.constants';
import { ZReportBuilder } from './z-report.builder';
import { ZReportController } from './z-report.controller';
import { ZReportProcessor } from './z-report.processor';
import { ZReportScheduler } from './z-report.scheduler';
import { ZReportService } from './z-report.service';
import { BusinessReportsBuilder } from './business-reports.builder';
import { BusinessReportsController } from './business-reports.controller';
import { BusinessReportsScheduleController } from './business-reports.schedule.controller';
import { BusinessReportsScheduleService } from './business-reports.schedule.service';

@Module({
  imports: [
    ConfigModule,
    MailModule,
    CariBalanceModule,
    ProfitabilitySharedModule,
    BullModule.registerQueue({ name: Z_REPORT_QUEUE }),
  ],
  controllers: [
    ZReportController,
    BusinessReportsController,
    BusinessReportsScheduleController,
  ],
  providers: [
    ZReportService,
    ZReportBuilder,
    ZReportProcessor,
    ZReportScheduler,
    BusinessReportsBuilder,
    BusinessReportsScheduleService,
  ],
  exports: [ZReportService, BusinessReportsBuilder],
})
export class ReportsModule {}

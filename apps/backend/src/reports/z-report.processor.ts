/**
 * Z raporu — BullMQ worker.
 *
 * Repeatable job (her gece 00:00) ve manuel tetikleme aynı işi kuyruğa
 * ekler; bu worker her ikisini de işler.
 */
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { Z_REPORT_QUEUE } from './z-report.constants';
import { ZReportRunResult, ZReportService } from './z-report.service';

/** Job payload — boş; worker her zaman "dünün tüm tenant raporu"nu üretir. */
export type ZReportJobData = Record<string, never>;

export interface ZReportJobResult {
  tenantCount: number;
  sentCount: number;
  skippedCount: number;
}

@Processor(Z_REPORT_QUEUE)
export class ZReportProcessor extends WorkerHost {
  private readonly logger = new Logger(ZReportProcessor.name);

  constructor(private readonly zReport: ZReportService) {
    super();
  }

  async process(job: Job<ZReportJobData>): Promise<ZReportJobResult> {
    this.logger.log(`Z raporu job başladı: ${job.name} (${job.id})`);

    const results: ZReportRunResult[] =
      await this.zReport.runForAllTenants();

    const summary: ZReportJobResult = {
      tenantCount: results.length,
      sentCount: results.filter((r) => !r.skipped).length,
      skippedCount: results.filter((r) => r.skipped).length,
    };

    this.logger.log(`Z raporu job bitti: ${JSON.stringify(summary)}`);
    return summary;
  }
}

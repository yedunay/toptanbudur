/**
 * Z raporu — repeatable job kaydı.
 *
 * Uygulama açılışında "her gece 00:00 (Europe/Istanbul)" tekrarlı job'ını
 * kuyruğa ekler. `Z_REPORT_ENABLED=false` ise kayıt atlanır (ve varsa
 * eski tekrarlı kayıt temizlenir). Redis erişilemezse sessizce loglar —
 * uygulama yine ayağa kalkar.
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import {
  Z_REPORT_DEFAULT_CRON,
  Z_REPORT_JOB,
  Z_REPORT_QUEUE,
  Z_REPORT_REPEAT_JOB_ID,
  Z_REPORT_TIMEZONE,
} from './z-report.constants';

@Injectable()
export class ZReportScheduler implements OnModuleInit {
  private readonly logger = new Logger(ZReportScheduler.name);

  constructor(
    @InjectQueue(Z_REPORT_QUEUE)
    private readonly queue: Queue,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const enabled =
      this.config.get<string>('Z_REPORT_ENABLED', 'true') !== 'false';
    const cron = this.config.get<string>(
      'Z_REPORT_CRON',
      Z_REPORT_DEFAULT_CRON,
    );

    try {
      // Eski tekrarlı kaydı her durumda temizle — cron/zaman dilimi
      // değiştiyse çift kayıt birikmesin.
      await this.removeExistingRepeatable();

      if (!enabled) {
        this.logger.log('Z raporu zamanlayıcı devre dışı (Z_REPORT_ENABLED=false)');
        return;
      }

      await this.queue.add(
        Z_REPORT_JOB,
        {},
        {
          repeat: { pattern: cron, tz: Z_REPORT_TIMEZONE },
          jobId: Z_REPORT_REPEAT_JOB_ID,
          // Mail/DB geçici hatasında sessiz kayıp olmasın: 3 deneme,
          // 5dk → 10dk exponential backoff.
          attempts: 3,
          backoff: { type: 'exponential', delay: 5 * 60_000 },
          removeOnComplete: 30,
          removeOnFail: 30,
        },
      );
      this.logger.log(
        `Z raporu zamanlandı — cron="${cron}" tz=${Z_REPORT_TIMEZONE}`,
      );
    } catch (err) {
      this.logger.warn(
        `Z raporu zamanlayıcı atlandı (Redis erişilemiyor?): ${
          (err as Error).message
        }`,
      );
    }
  }

  /** Daha önce kaydedilmiş tekrarlı Z raporu job'ını (varsa) kaldırır. */
  private async removeExistingRepeatable(): Promise<void> {
    const repeatables = await this.queue.getRepeatableJobs();
    for (const job of repeatables) {
      if (job.name === Z_REPORT_JOB) {
        await this.queue.removeRepeatableByKey(job.key);
      }
    }
  }
}

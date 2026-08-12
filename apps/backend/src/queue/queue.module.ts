import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { FeedSyncProcessor } from './feed-sync.processor';
import { FeedSyncScheduler } from './feed-sync.scheduler';
import { IngestModule } from '../ingest/ingest.module';

export const FEED_SYNC_QUEUE = 'feed-sync';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 6379),
          password: config.get<string>('REDIS_PASSWORD') || undefined,
        },
      }),
    }),
    BullModule.registerQueue({
      name: FEED_SYNC_QUEUE,
      // H-32: Daha önce defaultJobOptions yoktu; transient SMTP/HTTP hatasında
      // tek deneme sonrası job düşüyordu. Exponential backoff ile 3 retry
      // veriyoruz. removeOnComplete/Fail Redis'i şişirmesin diye sınırlı.
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: { age: 24 * 3600, count: 1_000 },
        removeOnFail: { age: 7 * 24 * 3600, count: 500 },
      },
    }),
    forwardRef(() => IngestModule),
  ],
  providers: [FeedSyncProcessor, FeedSyncScheduler],
  exports: [BullModule],
})
export class QueueModule {}

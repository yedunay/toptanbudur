import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageRetentionService } from './storage-retention.service';

/**
 * 30 günlük R2 saklama temizliği. Cron @Cron('0 15 4 * * *') ile her gün
 * 04:15'te çalışır; ScheduleModule.forRoot() app.module.ts'de zaten kayıtlı.
 * STORAGE_SERVICE @Global StorageModule'dan gelir.
 */
@Module({
  imports: [PrismaModule],
  providers: [StorageRetentionService],
  exports: [StorageRetentionService],
})
export class StorageRetentionModule {}

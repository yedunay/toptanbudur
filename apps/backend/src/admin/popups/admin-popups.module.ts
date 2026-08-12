import { Module } from '@nestjs/common';
import { AdminPopupsController } from './admin-popups.controller';
import { AdminPopupsService } from './admin-popups.service';
import { PopupMediaRetentionService } from './popup-media-retention.service';

/**
 * Admin pop-up / duyuru yönetimi. PrismaModule, AuditModule ve StorageModule
 * @Global olduğundan burada import edilmez. Auth/permission guard'ları controller
 * seviyesinde uygulanır. PopupMediaRetentionService süresi dolan pop-up'ların
 * medyasını her gün storage'dan temizler (ScheduleModule.forRoot app.module'de).
 */
@Module({
  controllers: [AdminPopupsController],
  providers: [AdminPopupsService, PopupMediaRetentionService],
})
export class AdminPopupsModule {}

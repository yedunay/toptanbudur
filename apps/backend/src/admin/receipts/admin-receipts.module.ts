import { Module } from '@nestjs/common';
import { ReceiptsModule } from '../../receipts/receipts.module';
import { AdminReceiptsController } from './admin-receipts.controller';

/**
 * Admin "Makbuzlar" sayfasının controller'ı. İş mantığı tamamen
 * `ReceiptsService`'te yaşar (tek doğruluk kaynağı); bu modül yalnızca
 * `ReceiptsModule`'ü import edip controller'ı kayıtlar.
 */
@Module({
  imports: [ReceiptsModule],
  controllers: [AdminReceiptsController],
})
export class AdminReceiptsModule {}

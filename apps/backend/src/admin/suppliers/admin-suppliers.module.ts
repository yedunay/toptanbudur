import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { FEED_SYNC_QUEUE } from '../../queue/queue.module';
import { AdminSuppliersService } from './admin-suppliers.service';
import { AdminSuppliersController } from './admin-suppliers.controller';
import { MailModule } from '../../mail/mail.module';
import { ProductCoreModule } from '../../product-core/product-core.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: FEED_SYNC_QUEUE }),
    MailModule,
    ProductCoreModule,
  ],
  controllers: [AdminSuppliersController],
  providers: [AdminSuppliersService],
})
export class AdminSuppliersModule {}

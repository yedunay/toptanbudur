import { Module } from '@nestjs/common';
import { AdminOrdersService } from './admin-orders.service';
import { AdminOrdersController } from './admin-orders.controller';
import { CariBalanceModule } from '../../cari-balance/cari-balance.module';
import { MailModule } from '../../mail/mail.module';
import { SupplierAccountModule } from '../../supplier-account/supplier-account.module';

@Module({
  imports: [CariBalanceModule, MailModule, SupplierAccountModule],
  controllers: [AdminOrdersController],
  providers: [AdminOrdersService],
  exports: [AdminOrdersService],
})
export class AdminOrdersModule {}

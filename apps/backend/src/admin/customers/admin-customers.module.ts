import { Module } from '@nestjs/common';
import { AdminCustomersService } from './admin-customers.service';
import { AdminCustomersController } from './admin-customers.controller';
import { AdminCustomerTagsService } from './admin-customer-tags.service';
import { AdminCustomerTagsController } from './admin-customer-tags.controller';
import { MailModule } from '../../mail/mail.module';
import { DealerModule } from '../../dealer/dealer.module';
import { CariBalanceModule } from '../../cari-balance/cari-balance.module';
import { BayiNumberService } from '../../receipts/bayi-number.service';

@Module({
  imports: [MailModule, DealerModule, CariBalanceModule],
  controllers: [AdminCustomersController, AdminCustomerTagsController],
  // BayiNumberService stateless'tir (yalnız `bayi_no_seq` çağırır); doğrudan
  // sağlanır (DealerModule'deki desenle aynı; aynı sequence üzerinde çalışır).
  providers: [AdminCustomersService, BayiNumberService, AdminCustomerTagsService],
})
export class AdminCustomersModule {}

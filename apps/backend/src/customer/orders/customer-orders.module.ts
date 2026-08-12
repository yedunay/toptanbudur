import { Module } from '@nestjs/common';
import { CustomerAuthModule } from '../../customer-auth/customer-auth.module';
import { CariBalanceModule } from '../../cari-balance/cari-balance.module';
import { ReceiptsModule } from '../../receipts/receipts.module';
import { CustomerOrdersController } from './customer-orders.controller';
import { CustomerOrdersExportService } from './customer-orders-export.service';
import { CustomerOrdersService } from './customer-orders.service';

@Module({
  imports: [CustomerAuthModule, CariBalanceModule, ReceiptsModule],
  controllers: [CustomerOrdersController],
  providers: [CustomerOrdersService, CustomerOrdersExportService],
})
export class CustomerOrdersModule {}

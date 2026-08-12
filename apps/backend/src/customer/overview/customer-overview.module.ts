import { Module } from '@nestjs/common';
import { CustomerAuthModule } from '../../customer-auth/customer-auth.module';
import { CustomerOverviewController } from './customer-overview.controller';
import { CustomerOverviewService } from './customer-overview.service';

@Module({
  imports: [CustomerAuthModule],
  controllers: [CustomerOverviewController],
  providers: [CustomerOverviewService],
})
export class CustomerOverviewModule {}

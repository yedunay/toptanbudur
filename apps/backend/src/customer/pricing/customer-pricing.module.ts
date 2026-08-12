import { Module } from '@nestjs/common';
import { CustomerAuthModule } from '../../customer-auth/customer-auth.module';
import { CustomerPricingController } from './customer-pricing.controller';
import { CustomerPricingService } from './customer-pricing.service';

@Module({
  imports: [CustomerAuthModule],
  controllers: [CustomerPricingController],
  providers: [CustomerPricingService],
})
export class CustomerPricingModule {}

import { Module } from '@nestjs/common';
import { AdminProfitabilityController } from './admin-profitability.controller';
import { AdminProfitabilityService } from './admin-profitability.service';

@Module({
  controllers: [AdminProfitabilityController],
  providers: [AdminProfitabilityService],
  exports: [AdminProfitabilityService],
})
export class AdminProfitabilityModule {}

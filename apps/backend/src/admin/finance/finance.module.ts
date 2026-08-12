import { Module } from '@nestjs/common';
import { AdminFinanceController } from './finance.controller';
import { AdminFinanceService } from './finance.service';
import { FinanceExportService } from './finance-export.service';
import { AdminProfitabilityModule } from '../profitability/admin-profitability.module';

@Module({
  imports: [AdminProfitabilityModule],
  controllers: [AdminFinanceController],
  providers: [AdminFinanceService, FinanceExportService],
  exports: [AdminFinanceService],
})
export class AdminFinanceModule {}

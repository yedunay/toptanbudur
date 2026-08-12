import { Module } from '@nestjs/common';
import { ProfitCalculatorService } from './profit-calculator.service';

/**
 * Paylaşılan karlılık motoru.
 *
 * `ProfitCalculatorService`'i hem admin karlılık analizi hem de Z raporu
 * kullanır. PrismaModule global olduğu için ekstra import gerekmez.
 */
@Module({
  providers: [ProfitCalculatorService],
  exports: [ProfitCalculatorService],
})
export class ProfitabilitySharedModule {}

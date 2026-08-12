import { Module } from '@nestjs/common';
import { AdminExchangeRateController } from './admin-exchange-rate.controller';

/**
 * AdminExchangeRateModule — TCMB döviz kuru endpoint'ini admin paneline
 * expose eder. ExchangeRateService global module'den geldiği için burada
 * tekrar provider tanımlamaya gerek yok.
 */
@Module({
  controllers: [AdminExchangeRateController],
})
export class AdminExchangeRateModule {}

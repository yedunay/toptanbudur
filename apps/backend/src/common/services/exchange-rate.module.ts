import { Global, Module } from '@nestjs/common';
import { ExchangeRateService } from './exchange-rate.service';

/**
 * ExchangeRateModule — TCMB döviz kuru servisini global olarak provide eder.
 * IngestService ve admin controller'larında DI üzerinden kullanılır.
 *
 * @Global() ile işaretlendiği için her yerde tek bir instance paylaşılır
 * (in-memory cache singleton kalır).
 */
@Global()
@Module({
  providers: [ExchangeRateService],
  exports: [ExchangeRateService],
})
export class ExchangeRateModule {}

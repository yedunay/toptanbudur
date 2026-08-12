import { Module } from '@nestjs/common';
import { BirfaturaController } from './birfatura.controller';
import { BirfaturaService } from './birfatura.service';
import { BirfaturaTokenGuard } from './birfatura-token.guard';
import { FreezeService } from './consolidation/freeze.service';
import { PreviewService } from './consolidation/preview.service';
import { ExchangeRateModule } from '../common/services/exchange-rate.module';

@Module({
  imports: [ExchangeRateModule],
  controllers: [BirfaturaController],
  // FreezeService + PreviewService Faz 7 admin tetikleri/önizleme için export edilir.
  providers: [BirfaturaService, BirfaturaTokenGuard, FreezeService, PreviewService],
  exports: [FreezeService, PreviewService],
})
export class BirfaturaModule {}

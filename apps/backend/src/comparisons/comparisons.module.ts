import { Module } from '@nestjs/common';
import { ComparisonsController } from './comparisons.controller';
import { ComparisonsService } from './comparisons.service';
import { ComparisonIngestService } from './comparison-ingest.service';
import { ComparisonMatchService } from './comparison-match.service';

/**
 * Karşılaştırmalar modülü — rakip/tedarikçi XML fiyat karşılaştırma + ürün
 * eşleştirme. PrismaModule @Global olduğu için ayrıca import edilmez.
 * Mevcut hiçbir modüle bağımlı değildir → izole.
 */
@Module({
  controllers: [ComparisonsController],
  providers: [ComparisonsService, ComparisonIngestService, ComparisonMatchService],
})
export class ComparisonsModule {}

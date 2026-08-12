import { Module } from '@nestjs/common';
import { IngestModule } from '../ingest/ingest.module';
import { ProductCoreModule } from '../product-core/product-core.module';
import { StockReconcileService } from './stock-reconcile.service';
import { StockReconcileScheduler } from './stock-reconcile.scheduler';

/**
 * Stok mutabakatı modülü — tedarikçi feed'lerinde artık bulunmayan
 * ürünlerin stoğunu periyodik olarak 0'a çeken servis + cron.
 *
 * IngestModule'den `XmlParserService`'i (feed XML parse), ProductCoreModule'den
 * `ProductDedupService`'i (sıfırlama sonrası hedefli canonical recompute)
 * kullanır. Prisma global, ScheduleModule app.module'de forRoot ile kayıtlı.
 */
@Module({
  imports: [IngestModule, ProductCoreModule],
  providers: [StockReconcileService, StockReconcileScheduler],
  exports: [StockReconcileService],
})
export class StockReconcileModule {}

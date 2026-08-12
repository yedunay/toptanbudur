import { Module, forwardRef } from '@nestjs/common';
import { IngestService } from './ingest.service';
import { XmlParserService } from './xml-parser.service';
import { ShopifyFeedService } from './shopify-feed.service';
import { IngestController } from './ingest.controller';
import { NormalizationBootstrapService } from './normalization-bootstrap.service';
import { QueueModule } from '../queue/queue.module';
import { ProductCoreModule } from '../product-core/product-core.module';
import { ProductMatchModule } from '../product-match/product-match.module';

@Module({
  imports: [forwardRef(() => QueueModule), ProductCoreModule, ProductMatchModule],
  providers: [
    IngestService,
    XmlParserService,
    ShopifyFeedService,
    NormalizationBootstrapService,
  ],
  controllers: [IngestController],
  exports: [IngestService, XmlParserService],
})
export class IngestModule {}

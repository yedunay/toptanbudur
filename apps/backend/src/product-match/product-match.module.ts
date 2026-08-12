import { Module } from '@nestjs/common';
import { ProductMatchService } from './product-match.service';
import { ProductMatchAiService } from './product-match-ai.service';

/**
 * Vitrin/Satın-Alma çapraz-tedarikçi eşleştirme modülü. PrismaModule ve
 * AppSettingsModule @Global olduğundan ayrıca import edilmez.
 */
@Module({
  providers: [ProductMatchService, ProductMatchAiService],
  exports: [ProductMatchService],
})
export class ProductMatchModule {}

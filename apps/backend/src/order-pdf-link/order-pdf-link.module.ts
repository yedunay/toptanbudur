import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { OrderPdfLinkService } from './order-pdf-link.service';
import { OrderPdfPublicController } from './order-pdf-public.controller';

/**
 * Kalıcı, token-korumalı sipariş-PDF linki altyapısı.
 *
 *  - OrderPdfLinkService: link üret + token doğrula. API tedarikçi botları
 *    (ör. API tedarikçi orchestrator'ı) bunu inject edip note alanına link koyar.
 *  - OrderPdfPublicController: /api/order-pdf/<orderId>/<token> — streaming.
 *
 * STORAGE_SERVICE StorageModule (@Global) üzerinden gelir; ayrıca import
 * gerekmez. Service export edilir ki tedarikçi modülleri kullanabilsin.
 */
@Module({
  imports: [ConfigModule, PrismaModule],
  controllers: [OrderPdfPublicController],
  providers: [OrderPdfLinkService],
  exports: [OrderPdfLinkService],
})
export class OrderPdfLinkModule {}

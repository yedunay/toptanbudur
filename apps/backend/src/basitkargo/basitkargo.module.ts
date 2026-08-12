import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MailModule } from '../mail/mail.module';
import { HouseStockModule } from '../house-stock/house-stock.module';
import { BasitKargoConfigService } from './basitkargo.config.service';
import { BasitKargoClient } from './basitkargo.client';
import { BasitKargoService } from './basitkargo.service';
import { BasitKargoController } from './basitkargo.controller';
import { BasitKargoRetryScheduler } from './basitkargo-retry.scheduler';

/**
 * Basit Kargo entegrasyonu. PrismaService + AppSettingsService @Global olduğu
 * için ayrıca import edilmez. HouseStock: self siparişleri barkod hazır olunca
 * depo rezervi akışına sokmak için (OrdersModule ile aynı bağımlılıklar;
 * döngü yok — bu modül OrdersModule'e bağlı değildir).
 */
@Module({
  imports: [ConfigModule, MailModule, HouseStockModule],
  controllers: [BasitKargoController],
  providers: [
    BasitKargoConfigService,
    BasitKargoClient,
    BasitKargoService,
    BasitKargoRetryScheduler,
  ],
  exports: [BasitKargoService],
})
export class BasitKargoModule {}

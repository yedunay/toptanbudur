import { Controller, Get } from '@nestjs/common';
import { AppSettingsService } from './app-settings.service';

/**
 * Public — tüm istemcilerin (sepet/ödeme sayfası) okuyabileceği fiyat
 * parametreleri. Bayi-spesifik fiyat YOK; herkese aynı paketleme/KDV oranı.
 *
 * Sabit yerine settings tablosundan okunur — admin runtime'da güncelleyebilir.
 */
@Controller('public/pricing')
export class PublicPricingController {
  constructor(private readonly settings: AppSettingsService) {}

  @Get()
  async get(): Promise<{
    success: true;
    data: { packagingUnitFee: string; kdvRate: number };
  }> {
    const packagingUnitFee = await this.settings.getDecimal(
      'pricing.packagingUnitFee',
      4.8,
    );
    const kdvRate = await this.settings.getNumber('pricing.kdvRate', 20);
    return {
      success: true,
      data: {
        packagingUnitFee: packagingUnitFee.toFixed(2),
        kdvRate,
      },
    };
  }
}

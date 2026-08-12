import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { HouseStockService } from './house-stock.service';

/**
 * Depo — 03:00 OTO-DEVİR cron'u.
 *
 * Gece 03:00'te (TR saati), gün boyu hiçbir OWNER tarafından aksiyon
 * alınmamış ve hâlâ "Bekleyen" sekmesinde duran siparişler otomatik olarak
 * tedarikçiye devredilir. Böylece müşteri siparişi belirsiz süre depoda
 * asılı kalmaz; OWNER unutsa/uyusa bile bot ertesi tick'te ürünü tedarikten
 * temin eder.
 *
 * KRİTİK GÜVENLİK: Yalnızca TAM olarak "Bekleyen" siparişlere dokunur
 * (status='paid' + reservedQty>0 + dispatchedAt=null). "Kargoya Verilecek"
 * (dispatch edilmiş) siparişlere ASLA dokunmaz → fiziksel gönderilen ürün
 * tekrar satın alınmaz. Detaylar:
 * {@link HouseStockService.autoTransferStalePendingToSupplier}
 *
 * RLS: tenant filtreleme bu seviyede yapılmaz — sistem cron'u tüm tenant'lar
 * için global çalışır. ScheduleModule.forRoot() app.module.ts'de kayıtlı.
 */
@Injectable()
export class HouseStockScheduler {
  private readonly logger = new Logger(HouseStockScheduler.name);

  constructor(private readonly houseStock: HouseStockService) {}

  // sn=0 dk=0 saat=3 — her gün 03:00 (Europe/Istanbul; container TZ=UTC olsa da).
  @Cron('0 0 3 * * *', {
    name: 'house-stock-auto-transfer-pending',
    timeZone: 'Europe/Istanbul',
  })
  async autoTransferPendingToSupplier(): Promise<void> {
    this.logger.log('Depo 03:00 oto-devir cron başladı');
    try {
      const res = await this.houseStock.autoTransferStalePendingToSupplier();
      this.logger.log(
        `Depo 03:00 oto-devir tamam: orders=${res.orders} releasedQty=${res.releasedQty}`,
      );
    } catch (err) {
      this.logger.error(
        `Depo 03:00 oto-devir başarısız: ${(err as Error).message}`,
      );
    }
  }
}

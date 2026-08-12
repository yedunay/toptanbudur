import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { StockReconcileService } from './stock-reconcile.service';

/**
 * Stok mutabakatı zamanlayıcı.
 *
 * Her 3 saatte bir (dakika 45'te — feed senkronlarıyla çakışmasın diye)
 * tüm tedarikçi feed'lerini tarar ve feed'de artık bulunmayan ürünlerin
 * stoğunu 0'a çeker. Böylece tedarikçi bir ürünü çıkardığında ya da
 * stoğunu sıfırladığında mağaza + bayi XML en geç 3 saat içinde uyum sağlar
 * ve "hayalet ürün" satışı engellenir.
 *
 * `running` bayrağı uzun süren bir tur varken üst üste binmeyi önler.
 */
@Injectable()
export class StockReconcileScheduler {
  private readonly logger = new Logger(StockReconcileScheduler.name);
  private running = false;

  constructor(private readonly service: StockReconcileService) {}

  @Cron('0 45 */3 * * *', {
    name: 'stock-reconcile',
    timeZone: 'Europe/Istanbul',
  })
  async tick(): Promise<void> {
    if (this.running) {
      this.logger.warn('stock-reconcile atlandı: önceki tur hâlâ sürüyor');
      return;
    }
    this.running = true;
    try {
      const r = await this.service.reconcileAll();
      const skipped = r.suppliers.filter((s) => s.skippedReason).length;
      this.logger.log(
        `stock-reconcile tick: ${r.totalZeroed} ürün stock=0, ` +
          `${skipped} tedarikçi atlandı, ${r.durationMs}ms`,
      );
      // 0'a düşen ürünlere zaman damgası bas / stoğa dönenlerde temizle.
      await this.service.maintainOutOfStockSince();
      // 3+ gündür 0 stoklu ürünleri PASİFE al (SİLME YOK — tbdr/kayıt korunur;
      // stok gelince ingest yeniden aktif eder). Manuel ürünler muaf.
      const purged = await this.service.purgeZeroStockProducts();
      if (purged.deactivated > 0) {
        this.logger.log(
          `zero-stock deactivate tick: ${purged.deactivated} ürün pasife alındı`,
        );
      }
    } catch (err) {
      this.logger.error(
        `stock-reconcile tick hatası: ${(err as Error).message}`,
      );
    } finally {
      this.running = false;
    }
  }

  /**
   * Haftalık ölü-yetim temizliği — her Pazartesi 05:00.
   *
   * Bir haftadır `stock=0` + `feedId=NULL` kalan ürünleri tamamen pasifler
   * (active=false): mağaza vitrininden, bayi XML'inden ve pazaryerinden
   * komple kalkarlar. Tedarikçide karşılığı olmayan, geri dönmeyen ölü
   * ürünler katalogu şişirmesin.
   */
  @Cron('0 0 5 * * 1', {
    name: 'stock-dead-orphan-purge',
    timeZone: 'Europe/Istanbul',
  })
  async weeklyPurge(): Promise<void> {
    try {
      const r = await this.service.purgeDeadOrphans();
      this.logger.log(
        `dead-orphan purge tick: ${r.deactivated} ürün pasiflendi`,
      );
    } catch (err) {
      this.logger.error(
        `dead-orphan purge tick hatası: ${(err as Error).message}`,
      );
    }
  }
}

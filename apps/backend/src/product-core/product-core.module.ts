import { Module } from '@nestjs/common';
import { XmlSlotService } from './xml-slot.service';
import { ProductDedupService } from './product-dedup.service';

/**
 * Çekirdek katalog altyapısı — tedarikçiler-arası ürün tekilleştirme
 * (`ProductDedupService`) ve ürün parça/slot dağıtımı (`XmlSlotService`).
 *
 * Bayi-yüzlü XML feed modülünden ayrıştırıldı: bu iki servis feed'e değil,
 * katalog senkronunun kendisine (ingest, stok mutabakatı, ürün yönetimi,
 * tedarikçi yönetimi) hizmet eder.
 */
@Module({
  providers: [XmlSlotService, ProductDedupService],
  exports: [XmlSlotService, ProductDedupService],
})
export class ProductCoreModule {}

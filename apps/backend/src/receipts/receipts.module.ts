import { Module } from '@nestjs/common';
import { ReceiptsService } from './receipts.service';
import { ReceiptPdfService } from './receipt-pdf.service';
import { ReceiptNumberService } from './receipt-number.service';
import { BayiNumberService } from './bayi-number.service';
import { CariTopupNumberService } from '../cari-balance/cari-topup-number.service';

/**
 * Kredi Kartı Tahsilat Makbuzu modülü.
 *
 * `ReceiptsService` dışa açılır; `OrdersModule` ve `CariBalanceModule` bunu
 * import edip kart ödemesi onaylanınca makbuz üretir (Faz 3). Bu modül onları
 * import ETMEZ — döngüsel bağımlılık olmaması için `CariTopupNumberService`
 * doğrudan burada da sağlanır (yalnızca sequence çağrısı yapan stateless
 * servis; ikinci bir örnek aynı `cari_topup_human_no_seq` üzerinde çalışır).
 *
 * PrismaModule ve StorageModule @Global olduğundan ayrıca import edilmez;
 * `PrismaService` ve `STORAGE_SERVICE` token'ı her yerden erişilebilir.
 */
@Module({
  providers: [
    ReceiptsService,
    ReceiptPdfService,
    ReceiptNumberService,
    BayiNumberService,
    CariTopupNumberService,
  ],
  exports: [ReceiptsService, ReceiptPdfService],
})
export class ReceiptsModule {}

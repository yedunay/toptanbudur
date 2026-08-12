import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * KALICI (süresiz) sipariş-PDF linki üretici + doğrulayıcı.
 *
 * NEDEN VAR:
 *   Bazı API tedarikçileri (ör. bazı API tedarikçileri) sipariş oluştururken sipariş PDF'ini
 *   `note` alanında LİNK olarak istiyor. Ama sipariş PDF'leri gizli veri taşır
 *   (müşteri/fatura bilgisi) ve bu yüzden StoragePublicController whitelist'ine
 *   BİLEREK alınmamıştır ([[storage-public.controller]] güvenlik notu). Normal
 *   `getSignedUrl()` de kısa ömürlüdür (R2 SigV4 max 7 gün) — linki tedarikçiye
 *   verince "bir süre sonra bozulur" ([[manual-product-image-url-expiry-fix]]
 *   KESKİN KURAL: DB'ye/dışarıya süreli imzalı URL yazma).
 *
 * ÇÖZÜM (bu servis + OrderPdfPublicController):
 *   Linkte S3 imzası / `exp` YOKTUR — bunun yerine orderId üzerinden STABİL bir
 *   HMAC token taşınır. Token süresiz olduğu için link HİÇ bozulmaz; tahmin
 *   edilemez olduğu için başka siparişlerin PDF'i ENUMERATE edilemez. Controller
 *   token'ı doğrulayıp objeyi stream eder. Tek gerçek ömür sınırı objenin
 *   kendisidir: sipariş PDF'i R2'de 30 gün saklanır (Order.pdfPurgedAt), dropship
 *   siparişi günler içinde kargolandığı için pratikte hep erişilebilir.
 *
 * "imzasız" derken kastedilen budur: süreli S3 imzası yok → link kalıcı. Token,
 * süreli bir imza DEĞİL; sadece erişim anahtarı (asla eskimez).
 */
@Injectable()
export class OrderPdfLinkService {
  private readonly logger = new Logger(OrderPdfLinkService.name);

  /// Token imzası için stabil sunucu sırrı. LocalStorageService ile AYNI zincir
  /// kullanılır ([[local-storage.service]]) — yeni bir env sırrı icat etmiyoruz
  /// ki prod'da tanımsız kalıp linkler sessizce bozulmasın. Rotasyon isteyen
  /// operatör STORAGE_HMAC_SECRET verir; yoksa JWT_SECRET'e düşer (her zaman set).
  private readonly secret: string;

  /// Tedarikçi (Ulu) sunucusu linki KENDİ tarafından çeker → MUTLAK origin şart.
  /// STORAGE_PUBLIC_BASE_URL boşsa relative URL tedarikçi için işe yaramaz; o
  /// durumda buildUrl null döner ve orchestrator note'a link EKLEMEZ (bozuk link
  /// göndermektense hiç göndermemek daha doğru).
  private readonly publicBaseUrl: string;

  constructor(config: ConfigService) {
    this.secret =
      config.get<string>('STORAGE_HMAC_SECRET') ??
      config.get<string>('JWT_SECRET') ??
      'dev-storage-secret-change-me';
    this.publicBaseUrl = (config.get<string>('STORAGE_PUBLIC_BASE_URL') ?? '')
      .trim()
      .replace(/\/+$/, '');
  }

  /// orderId için stabil (süresiz) HMAC token. Aynı orderId → hep aynı token.
  tokenFor(orderId: string): string {
    return createHmac('sha256', this.secret)
      .update(`order-pdf:${orderId}`)
      .digest('base64url');
  }

  /// Tedarikçiye verilecek MUTLAK kalıcı link. Base URL yoksa null (bkz. yukarı).
  buildUrl(orderId: string): string | null {
    if (!orderId || !orderId.trim()) return null;
    if (!this.publicBaseUrl) {
      this.logger.error(
        'STORAGE_PUBLIC_BASE_URL boş — kalıcı sipariş-PDF linki üretilemedi ' +
          '(tedarikçiye mutlak URL şart). Note alanına link eklenmeyecek.',
      );
      return null;
    }
    const token = this.tokenFor(orderId);
    return `${this.publicBaseUrl}/api/order-pdf/${encodeURIComponent(orderId)}/${token}`;
  }

  /// Controller doğrulaması. Constant-time karşılaştırma (timing oracle önler).
  /// Token başka bir orderId için üretildiyse veya bozuksa false.
  verify(orderId: string, token: string): boolean {
    if (!orderId || !token) return false;
    const expected = this.tokenFor(orderId);
    const a = Buffer.from(token);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }
}

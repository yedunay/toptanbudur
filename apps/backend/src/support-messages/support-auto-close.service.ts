import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SupportMessagesService } from './support-messages.service';

/**
 * Destek talebi oto-kapanma zamanlayıcısı.
 *
 * KULLANICI KARARI (2026-07-30): ZAMAN-BAZLI oto-kapanma KALDIRILDI. Talepler
 * hareketsiz kalınca (eski davranış: 2 gün → ARCHIVED) OTOMATİK KAPANMAZ —
 * yalnız admin elle kapatınca kapanır. Bu yüzden eski `support-auto-close-stale`
 * cron'u (autoCloseStaleTickets'ı çağırırdı) tamamen kaldırıldı. Metot
 * (SupportMessagesService.autoCloseStaleTickets) elle/ileride kullanım için
 * duruyor ama ARTIK hiçbir cron onu tetiklemiyor.
 *
 * Kalan tek oto-kapanma OLAY bazlı (zaman değil): siparişi İPTAL edilen "iptal"
 * talepleri (aşağıda) — bu, çözülmüş talebin listede takılmaması içindir.
 *
 * ScheduleModule.forRoot() app.module'de global olduğundan ek import gerekmez.
 */
@Injectable()
export class SupportAutoCloseService {
  private readonly logger = new Logger(SupportAutoCloseService.name);

  constructor(private readonly support: SupportMessagesService) {}

  /**
   * Her dakika: "Cevaplandı" yapılmış ve siparişi iptal olan "iptal" talepleri
   * (oto-onay akışı) ~5 dk sonra kapatılır. 2 günlük durağan-kapatmadan ayrı ve
   * çok daha sık çalışır ki bu çözülmüş talepler kısa sürede listeden düşsün.
   */
  @Cron('0 * * * * *', { name: 'support-auto-close-resolved-cancel' })
  async runResolvedCancelClose(): Promise<void> {
    try {
      await this.support.autoCloseResolvedCancellationTickets();
    } catch (err) {
      this.logger.error(
        `resolved-cancellation auto-close failed: ${err instanceof Error ? err.message : 'unknown'}`,
      );
    }
  }
}

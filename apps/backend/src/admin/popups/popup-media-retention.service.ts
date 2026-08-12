import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { STORAGE_SERVICE } from '../../storage/storage.constants';
import type { IFileStorage } from '../../storage/storage.interface';
import { collectContentMediaKeys, type PopupBlock } from './popup-content';

/**
 * Süresi dolmuş pop-up'ların medyasını storage'dan otomatik temizleyen cron.
 *
 * NEDEN: süresi biten bir pop-up bir daha asla render edilmez (müşteri sorgusu
 * `endsAt >= now` filtreler), ama görsel/video dosyaları R2'de yer işgal etmeye
 * devam eder. Bu cron her gün, bitiş tarihinden GRACE_DAYS gün geçmiş ve henüz
 * temizlenmemiş kayıtların TÜM medyasını siler; kayıt + istatistik + metin
 * kalır, yalnız medya anahtarları/legacy görsel kolonları boşaltılır ve
 * `mediaPurgedAt` damgalanır. (Kayıt silinince ise medya anında silinir —
 * AdminPopupsService.remove.)
 *
 * GRACE_DAYS: admin bitiş tarihini uzatıp yeniden yayınlayabilsin diye kısa bir
 * tampon. Geçince medya kalıcı silinir.
 */
const GRACE_DAYS = 2;
const BATCH = 200;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
/** Yetim medya süpürmesi için boşta-kalma toleransı: çok-aşamalı kaydetme
 *  (oluştur → medya yükle → tam kaydet) yarıda kalırsa, son güncellemeden bu
 *  kadar saat geçmiş kayıtların içerikte REFERANS EDİLMEYEN medya anahtarları
 *  silinir. In-flight kaydetmeyi yanlışlıkla silmemek için geniş tutulur. */
const ORPHAN_IDLE_HOURS = 24;

@Injectable()
export class PopupMediaRetentionService {
  private readonly logger = new Logger(PopupMediaRetentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    @Inject(STORAGE_SERVICE)
    private readonly storage?: IFileStorage,
  ) {}

  @Cron('0 30 4 * * *', {
    name: 'popup-media-retention-purge',
    timeZone: 'Europe/Istanbul',
  })
  async run(): Promise<number> {
    if (!this.storage) {
      this.logger.warn(
        'STORAGE_SERVICE not available — skipping popup media purge',
      );
      return 0;
    }
    const cutoff = new Date(Date.now() - GRACE_DAYS * DAY_MS);

    const rows = await this.prisma.popup.findMany({
      where: {
        mediaPurgedAt: null,
        endsAt: { not: null, lt: cutoff },
        OR: [{ imageKey: { not: null } }, { mediaKeys: { isEmpty: false } }],
      },
      select: { id: true, imageKey: true, mediaKeys: true, title: true },
      take: BATCH,
      orderBy: { endsAt: 'asc' },
    });

    const now = new Date();
    let deleted = 0;
    for (const row of rows) {
      const keys = new Set<string>();
      for (const k of row.mediaKeys ?? []) if (k) keys.add(k);
      if (row.imageKey) keys.add(row.imageKey);

      for (const key of keys) {
        if (await this.safeDelete(key, row.id)) deleted += 1;
      }

      await this.prisma.popup.update({
        where: { id: row.id },
        data: {
          mediaKeys: { set: [] },
          imageUrl: null,
          imageKey: null,
          mediaPurgedAt: now,
        },
      });
    }

    const orphans = await this.purgeOrphanMediaKeys();

    this.logger.log(
      `Popup media purge: ${rows.length} expired popup(s), ${deleted} expired object(s) + ${orphans} orphan object(s) removed`,
    );
    return deleted + orphans;
  }

  /**
   * Yetim medya süpürmesi: çok-aşamalı kaydetme yarıda kalır ya da fazladan
   * yüklenen medya hiçbir bloğa konmazsa, anahtar `mediaKeys`'te kalır ama
   * içerikte REFERANS EDİLMEZ. Burada, son güncellemeden ORPHAN_IDLE_HOURS saat
   * geçmiş kayıtların referans edilmeyen mediaKeys anahtarları storage'dan
   * silinir ve mediaKeys = referans edilenler olarak normalize edilir. Süresi
   * dolma şartı YOK — bitiş tarihi olmayan (süresiz) pop-up'lar da temizlenir.
   * Referans edilen medya ASLA silinmez; legacy görsel (mediaKeys boş) kapsam dışı.
   */
  private async purgeOrphanMediaKeys(): Promise<number> {
    if (!this.storage) return 0;
    const cutoff = new Date(Date.now() - ORPHAN_IDLE_HOURS * HOUR_MS);
    const rows = await this.prisma.popup.findMany({
      where: { mediaKeys: { isEmpty: false }, updatedAt: { lt: cutoff } },
      select: { id: true, mediaKeys: true, content: true },
      take: BATCH,
      orderBy: { updatedAt: 'asc' },
    });
    if (rows.length === 0) return 0;

    let deleted = 0;
    for (const row of rows) {
      const blocks = Array.isArray(row.content)
        ? (row.content as unknown as PopupBlock[])
        : null;
      const referenced = collectContentMediaKeys(blocks);
      const orphans = (row.mediaKeys ?? []).filter(
        (k) => k && !referenced.includes(k),
      );
      if (orphans.length === 0) continue;

      for (const key of orphans) {
        if (await this.safeDelete(key, row.id)) deleted += 1;
      }
      await this.prisma.popup.update({
        where: { id: row.id },
        data: { mediaKeys: { set: referenced } },
      });
    }
    return deleted;
  }

  /** popups/ namespace doğrulamalı, hata yutan tekil silme. */
  private async safeDelete(key: string, popupId: string): Promise<boolean> {
    if (!this.storage) return false;
    if (!key.startsWith('popups/') || key.includes('..')) {
      this.logger.warn(`Geçersiz pop-up medya anahtarı atlandı id=${popupId} key=${key}`);
      return false;
    }
    try {
      await this.storage.delete(key);
      return true;
    } catch (err) {
      this.logger.warn(
        `popup ${popupId} media delete failed key=${key}: ${getErrorMessage(err)}`,
      );
      return false;
    }
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';

const FEED_SYNC_QUEUE = 'feed-sync';

/**
 * Bir feed'in tekrarlı sync cron'u — feed'i 30-dk döngü içinde STAGGER'lar.
 *
 * ESKİ DAVRANIŞ (site donması): tüm feed'ler tek ortak cron ile her :00 ve :30'da
 * AYNI ANDA sync olup tek-thread backend'i ~2.5dk %100 CPU'da kilitliyordu
 * (thundering herd → site donuyordu). YENİ: her feed yine 30dk'da bir sync olur
 * ama 1'er dakika OFSETLE → aynı anda yalnız 1 feed parse eder, CPU spike yok.
 *
 * Feed'ler yarım saatlik pencereye EŞİT yayılır: dakika = floor(i*30/count) (0..29);
 * her feed `dk,dk+30` ile saatte iki kez (30dk arayla) sync olur. count>30 ise
 * ofsetler sarmalar (en fazla birkaç feed aynı dakikada; concurrency=2 kaldırır).
 */
function feedSyncPattern(index: number, count: number): string {
  const slot = Math.floor((index * 30) / Math.max(count, 1)) % 30;
  return `0 ${slot},${slot + 30} * * * *`;
}

@Injectable()
export class FeedSyncScheduler implements OnModuleInit {
  private readonly logger = new Logger(FeedSyncScheduler.name);

  constructor(
    @InjectQueue(FEED_SYNC_QUEUE)
    private readonly queue: Queue,
    private readonly prisma: PrismaService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      const feeds = await this.prisma.supplierFeed.findMany({
        where: { active: true, supplier: { active: true } },
        select: { id: true, tenantId: true, name: true, lastSyncedAt: true },
      });

      // TÜM eski 'sync' tekrarlı job'larını temizle: hem yetim (zombi) feed'ler
      // hem de eski ortak herd cron'u kalkar. Pattern değiştiği için sadece
      // yetimleri silmek YETMEZ — eski pattern'li repeatable'lar kalıp YENİleriyle
      // birlikte çift sync'e yol açardı. Hepsini sil, aşağıda STAGGER'lı kur.
      // syncStaleFeeds (her 5dk) güvenlik ağı → kısa boşlukta feed kaybı olmaz.
      await this.clearSyncRepeatables();

      if (feeds.length === 0) {
        this.logger.log('No active feeds found for scheduled feed sync');
        return;
      }

      // Stable sıra (id'ye göre) → her açılışta her feed AYNI dakika ofsetini alır;
      // ofsetler restart'lar arası kaymaz, herd geri gelmez.
      const ordered = [...feeds].sort((a, b) => a.id.localeCompare(b.id));
      for (let i = 0; i < ordered.length; i++) {
        const feed = ordered[i];
        const pattern = feedSyncPattern(i, ordered.length);
        const jobId = `feed-sync:${feed.id}`;
        await this.queue.add(
          'sync',
          { feedId: feed.id, tenantId: feed.tenantId },
          {
            repeat: { pattern },
            jobId,
            removeOnComplete: 50,
            removeOnFail: 50,
          },
        );
        this.logger.log(
          `Scheduled feed-sync for feed="${feed.name}" (${feed.id}) every 30min @ "${pattern}"`,
        );

        if (!feed.lastSyncedAt) {
          await this.queue.add(
            'sync',
            { feedId: feed.id, tenantId: feed.tenantId },
            {
              jobId: `feed-sync-bootstrap:${feed.id}:${Date.now()}`,
              removeOnComplete: 50,
              removeOnFail: 100,
            },
          );
          this.logger.log(
            `Bootstrap sync enqueued for never-synced feed="${feed.name}"`,
          );
        }
      }
    } catch (err) {
      this.logger.warn(
        `Skipping feed-sync scheduler (Redis/DB unavailable?): ${(err as Error).message}`,
      );
    }
  }

  /**
   * Bu scheduler'ın ürettiği TÜM 'sync' tekrarlı job'larını Redis'ten siler.
   * Her açılışta çağrılır: hem yetim (silinmiş/pasif feed) repeatable'ları hem de
   * pattern'i değişmiş eski repeatable'ları (ör. eski ortak herd cron'u) temizler ki
   * onModuleInit STAGGER'lı pattern'lerle TEK ve temiz bir set kursun. Ardından
   * tüm AKTİF feed'ler yeniden eklendiği için aktif feed'ler boşta kalmaz; yetim
   * feed'ler ise yeniden eklenmediğinden tamamen düşer.
   */
  private async clearSyncRepeatables(): Promise<void> {
    const repeatables = await this.queue.getRepeatableJobs();
    let removed = 0;
    for (const job of repeatables) {
      // Sadece bu scheduler'ın ürettiği 'sync' tekrarlı job'larını ele al.
      if (job.name !== 'sync') continue;
      try {
        await this.queue.removeRepeatableByKey(job.key);
        removed++;
      } catch (e) {
        this.logger.warn(
          `Failed to remove repeatable key=${job.key}: ${(e as Error).message}`,
        );
      }
    }
    if (removed > 0) {
      this.logger.log(`feed-sync repeatable reset: removed ${removed} old repeatable(s)`);
    }
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async syncStaleFeeds(): Promise<void> {
    try {
      const cutoff = new Date(Date.now() - 30 * 60 * 1000);
      const stale = await this.prisma.supplierFeed.findMany({
        where: {
          active: true,
          supplier: { active: true },
          OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: cutoff } }],
        },
        select: { id: true, tenantId: true, name: true },
        take: 50,
      });
      if (stale.length === 0) return;

      for (const feed of stale) {
        await this.queue.add(
          'sync',
          { feedId: feed.id, tenantId: feed.tenantId },
          {
            // Sabit jobId (Date.now YOK, ":" YOK) → BullMQ dedup: bir feed için
            // stale sync zaten kuyrukta/çalışıyorken yeni tick AYNI id'yi eklemez.
            // Büyük feed'lerde (ör. toptanbudur ~25K, tek import 5dk'dan uzun)
            // eski davranış her 5dk yeni job ekleyip worker'ı yığıyordu (tüm
            // slotları dolduruyor, diğer feed'leri bekletiyordu). removeOnComplete/
            // Fail=true → tamamlanınca id serbest kalır, sonraki tick ekleyebilir.
            jobId: `feed-sync-stale-${feed.id}`,
            removeOnComplete: true,
            removeOnFail: true,
          },
        );
      }
      this.logger.log(`stale feed sync enqueued for ${stale.length} feeds`);
    } catch (err) {
      this.logger.warn(
        `syncStaleFeeds skipped: ${(err as Error).message}`,
      );
    }
  }
}

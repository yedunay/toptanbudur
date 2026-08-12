import { Injectable, Logger, Inject, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { STORAGE_SERVICE } from '../storage/storage.constants';
import type { IFileStorage } from '../storage/storage.interface';

// 30 gün KESİN. Çağrı sahibi konfigüre edemez — KVKK/güvenlik amaçlı
// sabit tutuluyor (env override yok).
const RETENTION_DAYS = 30;
const BATCH = 200;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * R2 saklama politikası: 30 günü geçen iade/destek ekleri ve sipariş PDF'leri
 * her gün 04:15'te R2'den silinir; satır kalır, `purgedAt` damgalanır.
 * Signed URL üretimi `purgedAt IS NOT NULL` kayıtlar için durdurulur.
 *
 * Hariç tutulanlar: yeniden satış 4 fotoğrafı, kargo etiketi, chat ekleri
 * (aktif satış kanıtı — saklama döngüsünün dışında).
 */
@Injectable()
export class StorageRetentionService {
  private readonly logger = new Logger(StorageRetentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    @Inject(STORAGE_SERVICE)
    private readonly storage?: IFileStorage,
  ) {}

  @Cron('0 15 4 * * *', {
    name: 'storage-retention-purge',
    timeZone: 'Europe/Istanbul',
  })
  async run(): Promise<void> {
    if (!this.storage) {
      this.logger.warn(
        'STORAGE_SERVICE not available — skipping retention purge',
      );
      return;
    }
    const cutoff = new Date(Date.now() - RETENTION_DAYS * DAY_MS);
    this.logger.log(
      `Storage retention purge started (cutoff=${cutoff.toISOString()})`,
    );
    const support = await this.purgeSupportAttachments(cutoff);
    const pdf = await this.purgeOrderPdfs(cutoff);
    this.logger.log(
      `Storage retention purge done: support=${support}, pdf=${pdf}`,
    );
  }

  private async purgeSupportAttachments(cutoff: Date): Promise<number> {
    if (!this.storage) return 0;
    const rows = await this.prisma.supportMessageAttachment.findMany({
      where: { purgedAt: null, createdAt: { lt: cutoff } },
      select: { id: true, storageKey: true },
      take: BATCH,
      orderBy: { createdAt: 'asc' },
    });
    if (rows.length === 0) return 0;
    const now = new Date();
    for (const row of rows) {
      try {
        await this.storage.delete(row.storageKey);
      } catch (err) {
        this.logger.warn(
          `supportMessageAttachment ${row.id} R2 delete failed: ${getErrorMessage(err)}`,
        );
      }
      await this.prisma.supportMessageAttachment.update({
        where: { id: row.id },
        data: { purgedAt: now },
      });
    }
    return rows.length;
  }

  private async purgeOrderPdfs(cutoff: Date): Promise<number> {
    if (!this.storage) return 0;
    const rows = await this.prisma.order.findMany({
      where: {
        pdfPurgedAt: null,
        pdfKey: { not: null },
        createdAt: { lt: cutoff },
      },
      select: { id: true, pdfKey: true },
      take: BATCH,
      orderBy: { createdAt: 'asc' },
    });
    if (rows.length === 0) return 0;
    const now = new Date();
    for (const row of rows) {
      if (!row.pdfKey) continue;
      try {
        await this.storage.delete(row.pdfKey);
      } catch (err) {
        this.logger.warn(
          `order ${row.id} PDF R2 delete failed: ${getErrorMessage(err)}`,
        );
      }
      await this.prisma.order.update({
        where: { id: row.id },
        data: { pdfPurgedAt: now },
      });
    }
    return rows.length;
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  IngestService,
  RecomputeTextResult,
  SyncResult,
} from '../ingest/ingest.service';

export interface FeedSyncJobData {
  feedId: string;
  tenantId: string;
}

// Tedarikçi metin kuralları değişince mevcut ürünlere geriye dönük uygulanır.
export interface RecomputeTextJobData {
  supplierId: string;
  tenantId: string;
}

export const RECOMPUTE_TEXT_JOB = 'recompute-text';

// lockDuration: Büyük + YENİ feed'lerde (ör. toptanbudur ~25K ürün, hepsi
// CREATE) ilk import tek job'da uzun sürer. Varsayılan 30sn'lik kilit aşılınca
// job "stalled" sayılıp yarıda kesilir, sürekli baştan başlar ve hiç tamamlanmaz
// (lastSyncedAt set olmaz). Kilidi 2 saate çıkarmak ilk toplu import'un tek
// seferde bitmesini sağlar; steady-state sync'ler zaten hızlı (çoğu skip).
// concurrency: 1 iken tek dev feed tüm worker'ı kilitler, diğer feed'ler bekler.
// 2 yaparak büyük bir feed import edilirken bir başkası da senkronlanır AMA
// aynı anda en fazla 2 büyük XML parse'ı CPU'yu çakar (3 yerine) — web trafiğiyle
// rekabet azalır. İlk toplu import'lar bittiği için steady-state'te 2 yeterli.
@Processor('feed-sync', { lockDuration: 7_200_000, concurrency: 2 })
export class FeedSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(FeedSyncProcessor.name);

  constructor(private readonly ingest: IngestService) {
    super();
  }

  async process(
    job: Job<FeedSyncJobData | RecomputeTextJobData>,
  ): Promise<SyncResult | RecomputeTextResult> {
    // Tedarikçi metin kuralları recompute job'u — feed-sync ile aynı queue,
    // ayrı job tipi. supplierId/tenantId ile mevcut ürünleri yeniden türetir.
    if (job.name === RECOMPUTE_TEXT_JOB) {
      const data = job.data as RecomputeTextJobData;
      this.logger.log(`recompute-text start: supplier=${data.supplierId}`);
      const result = await this.ingest.recomputeTextRulesForSupplier(
        data.supplierId,
        data.tenantId,
      );
      this.logger.log(`recompute-text done: ${JSON.stringify(result)}`);
      return result;
    }

    const data = job.data as FeedSyncJobData;
    this.logger.log(`feed-sync start: feed=${data.feedId}`);
    const result = await this.ingest.syncFeed(data.feedId, data.tenantId);
    this.logger.log(`feed-sync done: ${JSON.stringify(result)}`);
    return result;
  }
}

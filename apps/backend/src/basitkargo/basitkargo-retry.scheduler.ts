import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { BasitKargoConfigService } from './basitkargo.config.service';
import { BasitKargoService } from './basitkargo.service';
import { BASITKARGO_PENDING_STATUSES } from './basitkargo.constants';

/**
 * "Kendim İçin" siparişlerde Basit Kargo barkodu paid-hook'ta üretilemezse
 * (API hatası / geçici kesinti) bu cron periyodik olarak yeniden dener ve
 * başarılıysa tedarikçi oto-alım akışını tetikler.
 *
 * Poison guard: yalnız son 3 günün siparişleri toplanır — kalıcı bozuk kayıt
 * (ör. geçersiz adres) sonsuza dek denenmez. inFlight guard: tick üst üste binmez.
 */
@Injectable()
export class BasitKargoRetryScheduler {
  private readonly logger = new Logger(BasitKargoRetryScheduler.name);
  private inFlight = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: BasitKargoConfigService,
    private readonly service: BasitKargoService,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async tick(): Promise<void> {
    if (this.inFlight) return;
    if (!(await this.config.isEnabled())) return;
    this.inFlight = true;
    try {
      const now = Date.now();
      const since = new Date(now - 3 * 24 * 60 * 60 * 1000);
      // Min yaş guard'ı (race önler — tedarikçi scheduler'ıyla aynı desen):
      // paid-hook barkodu ÖDEME ANINDA üretmeye başlar; cron yalnızca ≥2 dk önce
      // ödenmiş siparişleri toplar. Böylece paid-hook'un devam eden POST'u ile
      // cron aynı siparişe aynı anda POST atıp ÇİFT etiket üretemez.
      const maxPaidAt = new Date(now - 2 * 60 * 1000);
      const orders = await this.prisma.order.findMany({
        where: {
          marketplace: 'self',
          status: 'paid',
          cargoBarcode: null,
          createdAt: { gte: since },
          paidAt: { lte: maxPaidAt },
          OR: [
            { basitKargoStatus: { in: [...BASITKARGO_PENDING_STATUSES] } },
            { basitKargoStatus: null },
          ],
        },
        select: { id: true, tenantId: true, humanOrderNo: true },
        orderBy: { createdAt: 'asc' },
        take: 25,
      });
      if (orders.length === 0) return;
      this.logger.log(
        `BasitKargo retry: ${orders.length} bekleyen self sipariş`,
      );
      for (const o of orders) {
        // notify=false: bildirim yalnız İLK denemede (paid-hook) gider; cron
        // aynı poison sipariş için mail yağmuru YAPMAZ.
        await this.service
          .fulfillSelfOrder(o.id, o.tenantId, false)
          .catch((e) =>
            this.logger.warn(
              `retry failed order=${o.humanOrderNo}: ${(e as Error).message}`,
            ),
          );
      }
    } catch (e) {
      this.logger.error(`retry tick failed: ${(e as Error).message}`);
    } finally {
      this.inFlight = false;
    }
  }
}

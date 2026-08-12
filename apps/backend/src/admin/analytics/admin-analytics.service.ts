import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { PrismaService } from '../../prisma/prisma.service';
import { CariBalanceService } from '../../cari-balance/cari-balance.service';
import { trStartOfDay } from '../../common/utils/tr-time';

const CACHE_TTL_SECONDS = 300;

@Injectable()
export class AdminAnalyticsService {
  private readonly logger = new Logger(AdminAnalyticsService.name);
  private readonly redis: Redis;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly cariBalance: CariBalanceService,
  ) {
    this.redis = new Redis({
      host: this.config.get<string>('REDIS_HOST', 'localhost'),
      port: this.config.get<number>('REDIS_PORT', 6379),
      lazyConnect: true,
      // Redis kısa süreli düşerse `get/setex` saatlerce kuyrukta birikmesin —
      // hızlıca cache miss'e düş ve Postgres'ten oku.
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      // Yumuşak backoff ile sürekli yeniden bağlan — Redis kısa süre düşüp
      // gelirse otomatik toparlansın. (Default 50ms*times agresif, log spam'i
      // yapıyordu; yukarıdaki `error` listener'ı 30 sn dedupe ile sessizleştiriyor.)
      retryStrategy: (times: number) => Math.min(times * 500, 5000),
    });
    // Aynı hatayı saniyede onlarca kez yazmasın — 30 sn'lik dedupe penceresi.
    let lastErrorAt = 0;
    let lastErrorMessage = '';
    this.redis.on('error', (err: Error) => {
      const now = Date.now();
      if (err.message === lastErrorMessage && now - lastErrorAt < 30_000) return;
      lastErrorAt = now;
      lastErrorMessage = err.message;
      this.logger.warn(`Redis error: ${err.message}`);
    });
  }

  async summary(tenantId: string) {
    const cacheKey = `analytics:summary:${tenantId}`;

    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        return { success: true, data: JSON.parse(cached) as unknown };
      }
    } catch (err) {
      this.logger.warn(`Redis read failed: ${(err as Error).message}`);
    }

    const data = await this.computeSummary(tenantId);

    try {
      await this.redis.setex(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(data));
    } catch (err) {
      this.logger.warn(`Redis write failed: ${(err as Error).message}`);
    }

    return { success: true, data };
  }

  private async computeSummary(tenantId: string) {
    // Gün başı TR takvimine göre (sunucu UTC olsa bile). sevenDaysAgo zaten
    // mutlak bir "şimdi − 7 gün" anı olduğundan TZ'den bağımsız.
    const todayStart = trStartOfDay(new Date());

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [
      todayOrdersAgg,
      todayRefund,
      newDealers7d,
      topProductsRaw,
      totalProducts,
      categoryCount,
      lastFeed,
    ] = await Promise.all([
      // Bugünkü ciro/sipariş — iptal/iade ve ödemesi alınmamış kart
      // siparişleri (awaiting_payment) hariç (gerçek satış).
      this.prisma.order.aggregate({
        where: {
          tenantId,
          createdAt: { gte: todayStart },
          status: { notIn: ['cancelled', 'refunded', 'awaiting_payment'] },
        },
        _count: { id: true },
        _sum: { total: true },
      }),
      // Bugün oluşturulan siparişlerdeki kısmi iadeler (REFUND ledger) —
      // NET ciro = max(0, brüt − iade).
      this.cariBalance.refundTotalInWindow({
        tenantId,
        orderCreatedFrom: todayStart,
      }),
      this.prisma.dealer.count({
        where: { tenantId, createdAt: { gte: sevenDaysAgo } },
      }),
      this.prisma.orderItem.groupBy({
        by: ['productId', 'productName'],
        where: { order: { tenantId } },
        _sum: { qty: true, unitPrice: true },
        orderBy: { _sum: { qty: 'desc' } },
        take: 1,
      }),
      this.prisma.product.count({ where: { tenantId, active: true } }),
      this.prisma.category.count({ where: { tenantId } }),
      this.prisma.supplierFeed.findFirst({
        where: { tenantId, lastSyncedAt: { not: null } },
        orderBy: { lastSyncedAt: 'desc' },
        select: { lastSyncedAt: true, lastSyncError: true },
      }),
    ]);

    const topRaw = topProductsRaw[0] ?? null;
    const topProduct = topRaw
      ? {
          id: topRaw.productId,
          name: topRaw.productName,
          quantity: topRaw._sum.qty ?? 0,
          revenue: Number(topRaw._sum.unitPrice ?? 0) * (topRaw._sum.qty ?? 0),
        }
      : null;

    return {
      todayOrders: todayOrdersAgg._count.id,
      todayRevenue: Math.max(
        0,
        Number(todayOrdersAgg._sum.total ?? 0) - todayRefund,
      ),
      newDealers7d,
      topProduct,
      totalProducts,
      categoryCount,
      lastSyncedAt: lastFeed?.lastSyncedAt?.toISOString() ?? null,
      lastSyncError: lastFeed?.lastSyncError ?? null,
    };
  }
}

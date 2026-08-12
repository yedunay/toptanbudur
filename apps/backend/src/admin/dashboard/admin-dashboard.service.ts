import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { PrismaService } from '../../prisma/prisma.service';
import { CariBalanceService } from '../../cari-balance/cari-balance.service';

const CACHE_TTL_SECONDS = 20;
const TREND_DAYS = 30;
const LOW_STOCK_THRESHOLD = 5;

export interface DashboardOverview {
  generatedAt: string;
  today: {
    orders: number;
    revenue: number;
    avgBasket: number;
    refundRate: number;
    deltaOrdersPct: number | null;
    deltaRevenuePct: number | null;
  };
  trend30d: Array<{ date: string; orders: number; revenue: number }>;
  catalog: {
    activeProducts: number;
    totalProducts: number;
    categories: number;
    lastSyncedAt: string | null;
    lastSyncError: string | null;
  };
  dealers: {
    newDealers7d: number;
    activeDealers: number;
    totalDealers: number;
    pendingApplications: number;
  };
  alerts: {
    pendingOrders: number;
    lowStockSkus: number;
    failedFeeds: number;
  };
  top: {
    products7d: Array<{ id: string; name: string; qty: number; revenue: number }>;
    dealers30d: Array<{
      id: string;
      name: string;
      orders: number;
      revenue: number;
    }>;
    categories30d: Array<{ id: string; name: string; revenue: number }>;
  };
  systemHealth: {
    feeds: Array<{
      supplierId: string;
      supplierName: string;
      feedName: string;
      lastSyncedAt: string | null;
      status: 'ok' | 'warn' | 'fail';
      error: string | null;
    }>;
  };
}

@Injectable()
export class AdminDashboardService {
  private readonly logger = new Logger(AdminDashboardService.name);
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
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      retryStrategy: (times: number) => Math.min(times * 500, 5000),
    });
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

  async overview(
    tenantId: string,
    options: { fresh?: boolean; debug?: boolean } = {},
  ): Promise<{ success: true; data: DashboardOverview }> {
    const cacheKey = `dashboard:overview:${tenantId}`;

    if (!options.fresh) {
      try {
        const cached = await this.redis.get(cacheKey);
        if (cached) {
          return { success: true, data: JSON.parse(cached) as DashboardOverview };
        }
      } catch (err) {
        this.logger.warn(`Redis read failed: ${(err as Error).message}`);
      }
    }

    const data = await this.compute(tenantId);

    if (options.debug) {
      const globalPending = await this.prisma.dealerApplication.count({
        where: { status: 'PENDING' },
      });
      const tenantDealersAny = await this.prisma.dealer.findFirst({
        where: { tenantId },
        select: { id: true, tenantId: true },
      });
      this.logger.log(
        `[dashboard.debug] tenantId=${tenantId} dealers=${JSON.stringify(data.dealers)} globalPending=${globalPending} sampleTenantDealer=${JSON.stringify(tenantDealersAny)}`,
      );
    }

    try {
      await this.redis.setex(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(data));
    } catch (err) {
      this.logger.warn(`Redis write failed: ${(err as Error).message}`);
    }

    return { success: true, data };
  }

  /** Allow other services to bust dashboard cache after mutations. */
  async invalidate(tenantId: string): Promise<void> {
    try {
      await this.redis.del(`dashboard:overview:${tenantId}`);
    } catch (err) {
      this.logger.warn(`Redis invalidate failed: ${(err as Error).message}`);
    }
  }

  private async compute(tenantId: string): Promise<DashboardOverview> {
    const now = new Date();
    const todayStart = startOfDayIstanbul(now);
    const yesterdayStart = addDays(todayStart, -1);
    const sevenDaysAgo = addDays(todayStart, -7);
    const thirtyDaysAgo = addDays(todayStart, -TREND_DAYS + 1);

    const [
      todayAgg,
      yesterdayAgg,
      todayRefundsCount,
      trendRowsRaw,
      trendRefundRowsRaw,
      activeProducts,
      totalProducts,
      categoryCount,
      lastFeed,
      newDealers7d,
      activeDealers,
      totalDealers,
      pendingApplications,
      pendingOrders,
      lowStockSkus,
      failedFeeds,
      topProducts7dRaw,
      topDealers30dRaw,
      topCategories30dRaw,
      feedsHealth,
    ] = await Promise.all([
      // Bugün/dün "ciro + sipariş" kartları gerçek işi yansıtır: iptal/iade
      // edilen siparişler sayılmaz (para geri gitti, satış gerçekleşmedi).
      this.prisma.order.aggregate({
        where: {
          tenantId,
          createdAt: { gte: todayStart },
          status: { notIn: ['cancelled', 'refunded', 'awaiting_payment'] },
        },
        _count: { id: true },
        _sum: { total: true },
      }),
      this.prisma.order.aggregate({
        where: {
          tenantId,
          createdAt: { gte: yesterdayStart, lt: todayStart },
          status: { notIn: ['cancelled', 'refunded', 'awaiting_payment'] },
        },
        _count: { id: true },
        _sum: { total: true },
      }),
      // İADE oranı: bugün iade edilen sipariş / bugünkü net sipariş.
      // İade sinyali Order.status='refunded' (admin iade akışı + cari iadesi).
      this.prisma.order.count({
        where: {
          tenantId,
          status: 'refunded',
          createdAt: { gte: todayStart },
        },
      }),
      this.prisma.$queryRawUnsafe<
        Array<{ day: string; orders: bigint; revenue: string | null }>
      >(
        `SELECT to_char(date_trunc('day', "createdAt" AT TIME ZONE 'Europe/Istanbul'), 'YYYY-MM-DD') AS day,
                COUNT(*)::bigint AS orders,
                COALESCE(SUM(total), 0)::text AS revenue
         FROM "Order"
         WHERE "tenantId" = $1 AND "createdAt" >= $2
           AND status NOT IN ('cancelled', 'refunded', 'awaiting_payment')
         GROUP BY day
         ORDER BY day ASC`,
        tenantId,
        thirtyDaysAgo,
      ),
      // 30 günlük trend için gün-bazlı İADE toplamı (CariLedger REFUND),
      // siparişin oluşturulma gününe (Order.createdAt) göre attribütlenir.
      this.prisma.$queryRawUnsafe<Array<{ day: string; refund: string | null }>>(
        `SELECT to_char(date_trunc('day', o."createdAt" AT TIME ZONE 'Europe/Istanbul'), 'YYYY-MM-DD') AS day,
                COALESCE(SUM(cl.amount), 0)::text AS refund
         FROM "CariLedger" cl
         JOIN "Order" o ON o.id = cl."orderId"
         WHERE cl.type = 'REFUND'
           AND o."tenantId" = $1
           AND o."createdAt" >= $2
           AND o.status NOT IN ('cancelled', 'refunded', 'awaiting_payment')
         GROUP BY day`,
        tenantId,
        thirtyDaysAgo,
      ),
      this.prisma.product.count({ where: { tenantId, active: true } }),
      this.prisma.product.count({ where: { tenantId } }),
      this.prisma.category.count({ where: { tenantId } }),
      this.prisma.supplierFeed.findFirst({
        where: { tenantId, lastSyncedAt: { not: null } },
        orderBy: { lastSyncedAt: 'desc' },
        select: { lastSyncedAt: true, lastSyncError: true },
      }),
      this.prisma.customer.count({
        where: { createdAt: { gte: sevenDaysAgo } },
      }),
      this.prisma.customer.count({ where: { isActive: true } }),
      this.prisma.customer.count(),
      this.prisma.dealerApplication.count({
        where: { status: { in: ['PENDING', 'PRE_REGISTERED'] } },
      }),
      this.prisma.order.count({
        where: { tenantId, status: 'paid' },
      }),
      this.prisma.product.count({
        where: {
          tenantId,
          active: true,
          stock: { gt: 0, lte: LOW_STOCK_THRESHOLD },
        },
      }),
      this.prisma.supplierFeed.count({
        where: { tenantId, active: true, lastSyncError: { not: null } },
      }),
      // Çok-satan ürünler: adet sıralaması korunur ama ciro SUM(unitPrice*qty)
      // ile satır-bazlı doğru hesaplanır. groupBy'ın _sum.unitPrice * _sum.qty
      // çapraz çarpımı YANLIŞ ciro üretiyordu (#11).
      this.prisma.$queryRawUnsafe<
        Array<{
          productId: string | null;
          productName: string;
          qty: bigint;
          revenue: string;
        }>
      >(
        `SELECT oi."productId",
                MAX(oi."productName") AS "productName",
                COALESCE(SUM(oi.qty), 0)::bigint AS qty,
                COALESCE(SUM(oi."unitPrice" * oi.qty), 0)::text AS revenue
         FROM "OrderItem" oi
         JOIN "Order" o ON o.id = oi."orderId"
         WHERE o."tenantId" = $1
           AND o."createdAt" >= $2
           AND o.status NOT IN ('cancelled', 'refunded', 'awaiting_payment')
         GROUP BY oi."productId"
         ORDER BY COALESCE(SUM(oi.qty), 0) DESC NULLS LAST
         LIMIT 5`,
        tenantId,
        sevenDaysAgo,
      ),
      this.prisma.$queryRawUnsafe<
        Array<{
          customerId: string | null;
          customerName: string;
          orders: bigint;
          revenue: string;
        }>
      >(
        // Gross top-50 aday; İADE düşülüp NET'e göre yeniden sıralanır (P0a).
        // status filtresi iptal/iade siparişleri gross'tan çıkarır.
        `SELECT "customerId",
                MAX("customerName") AS "customerName",
                COUNT(*)::bigint AS orders,
                COALESCE(SUM(total), 0)::text AS revenue
         FROM "Order"
         WHERE "tenantId" = $1
           AND "createdAt" >= $2
           AND "customerId" IS NOT NULL
           AND status NOT IN ('cancelled', 'refunded', 'awaiting_payment')
         GROUP BY "customerId"
         ORDER BY COALESCE(SUM(total), 0) DESC NULLS LAST
         LIMIT 50`,
        tenantId,
        addDays(todayStart, -30),
      ),
      this.prisma.$queryRawUnsafe<
        Array<{ categoryId: string | null; categoryName: string; revenue: string }>
      >(
        `SELECT c.id AS "categoryId",
                c.name AS "categoryName",
                COALESCE(SUM(oi."unitPrice" * oi.qty), 0)::text AS revenue
         FROM "OrderItem" oi
         JOIN "Order" o ON o.id = oi."orderId"
         LEFT JOIN "Product" p ON p.id = oi."productId"
         LEFT JOIN "Category" c ON c.id = p."categoryId"
         WHERE o."tenantId" = $1
           AND o."createdAt" >= $2
           AND c.id IS NOT NULL
           AND o.status NOT IN ('cancelled', 'refunded', 'awaiting_payment')
         GROUP BY c.id, c.name
         ORDER BY COALESCE(SUM(oi."unitPrice" * oi.qty), 0) DESC NULLS LAST
         LIMIT 5`,
        tenantId,
        addDays(todayStart, -30),
      ),
      this.prisma.supplierFeed.findMany({
        where: { tenantId, active: true },
        select: {
          id: true,
          name: true,
          lastSyncedAt: true,
          lastSyncError: true,
          refreshIntervalHours: true,
          supplier: { select: { id: true, name: true } },
        },
        orderBy: { updatedAt: 'desc' },
        take: 12,
      }),
    ]);

    // Gün-bazlı İADE haritası: bugün, dün ve 30g trend NET'i için tek kaynak.
    const refundByDay = new Map<string, number>();
    for (const r of trendRefundRowsRaw) {
      refundByDay.set(r.day, Number(r.refund ?? 0) || 0);
    }
    const todayKey = istanbulDateKey(todayStart);
    const yesterdayKey = istanbulDateKey(yesterdayStart);

    // NET = max(0, gross − o güne ait iade).
    const todayOrders = todayAgg._count.id;
    const todayRevenue = Math.max(
      0,
      Number(todayAgg._sum.total ?? 0) - (refundByDay.get(todayKey) ?? 0),
    );
    const yOrders = yesterdayAgg._count.id;
    const yRevenue = Math.max(
      0,
      Number(yesterdayAgg._sum.total ?? 0) - (refundByDay.get(yesterdayKey) ?? 0),
    );

    // Trend: gün-bazlı gross − iade (NET).
    const trend30d = buildTrendSeries(trendRowsRaw, thirtyDaysAgo, TREND_DAYS).map(
      (pt) => ({
        ...pt,
        revenue: Math.max(0, pt.revenue - (refundByDay.get(pt.date) ?? 0)),
      }),
    );

    // Bayi liderlik tablosu: gross adaylardan müşteri-başı İADE düşülüp NET'e
    // göre yeniden sıralanır, ilk 5 alınır (P0a).
    const dealerCandidateIds = topDealers30dRaw
      .map((r) => r.customerId)
      .filter((id): id is string => !!id);
    const dealerRefundMap = await this.cariBalance.refundTotalsByCustomer({
      tenantId,
      customerIds: dealerCandidateIds,
      orderCreatedFrom: addDays(todayStart, -30),
    });
    const dealers30dNet = topDealers30dRaw
      .map((row) => {
        const id = row.customerId ?? '';
        const gross = Number(row.revenue);
        const refund = id ? dealerRefundMap.get(id) ?? 0 : 0;
        return {
          id,
          name: row.customerName,
          orders: Number(row.orders),
          revenue: Math.max(0, gross - refund),
        };
      })
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);

    return {
      generatedAt: now.toISOString(),
      today: {
        orders: todayOrders,
        revenue: todayRevenue,
        avgBasket: todayOrders > 0 ? todayRevenue / todayOrders : 0,
        refundRate: todayOrders > 0 ? todayRefundsCount / todayOrders : 0,
        deltaOrdersPct: pctDelta(todayOrders, yOrders),
        deltaRevenuePct: pctDelta(todayRevenue, yRevenue),
      },
      trend30d,
      catalog: {
        activeProducts,
        totalProducts,
        categories: categoryCount,
        lastSyncedAt: lastFeed?.lastSyncedAt?.toISOString() ?? null,
        lastSyncError: lastFeed?.lastSyncError ?? null,
      },
      dealers: {
        newDealers7d,
        activeDealers,
        totalDealers,
        pendingApplications,
      },
      alerts: {
        pendingOrders,
        lowStockSkus,
        failedFeeds,
      },
      top: {
        products7d: topProducts7dRaw
          .filter((row): row is typeof row & { productId: string } => row.productId !== null)
          .map((row) => ({
            id: row.productId,
            name: row.productName,
            qty: Number(row.qty),
            revenue: Number(row.revenue),
          })),
        dealers30d: dealers30dNet,
        categories30d: topCategories30dRaw.map((row) => ({
          id: row.categoryId ?? '',
          name: row.categoryName,
          revenue: Number(row.revenue),
        })),
      },
      systemHealth: {
        feeds: feedsHealth.map((f) => ({
          supplierId: f.supplier.id,
          supplierName: f.supplier.name,
          feedName: f.name,
          lastSyncedAt: f.lastSyncedAt?.toISOString() ?? null,
          status: feedStatus(f.lastSyncedAt, f.lastSyncError, f.refreshIntervalHours),
          error: f.lastSyncError,
        })),
      },
    };
  }
}

const ISTANBUL_TZ = 'Europe/Istanbul';
const istanbulPartsFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: ISTANBUL_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

function istanbulParts(d: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const parts = istanbulPartsFormatter.formatToParts(d);
  const out: Record<string, number> = {};
  for (const p of parts) {
    if (p.type === 'literal') continue;
    out[p.type] = Number(p.value);
  }
  return {
    year: out.year,
    month: out.month,
    day: out.day,
    hour: out.hour === 24 ? 0 : out.hour,
    minute: out.minute,
    second: out.second,
  };
}

/**
 * Returns the UTC instant corresponding to 00:00:00 in Europe/Istanbul on the
 * civil date that contains `d`. Turkey has been on UTC+3 with no DST since 2016,
 * but we compute the offset from `Intl` so this stays correct if rules change.
 */
function startOfDayIstanbul(d: Date): Date {
  const { year, month, day, hour, minute, second } = istanbulParts(d);
  const offsetMs = Date.UTC(year, month - 1, day, hour, minute, second) - d.getTime();
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0) - offsetMs);
}

function startOfDay(d: Date): Date {
  return startOfDayIstanbul(d);
}

function addDays(d: Date, days: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

function pctDelta(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}

function istanbulDateKey(d: Date): string {
  const { year, month, day } = istanbulParts(d);
  return `${year.toString().padStart(4, '0')}-${month
    .toString()
    .padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
}

function buildTrendSeries(
  rows: Array<{ day: string; orders: bigint; revenue: string | null }>,
  startInclusive: Date,
  days: number,
): Array<{ date: string; orders: number; revenue: number }> {
  const byDay = new Map<string, { orders: number; revenue: number }>();
  for (const r of rows) {
    byDay.set(r.day, {
      orders: Number(r.orders),
      revenue: Number(r.revenue ?? 0),
    });
  }
  const series: Array<{ date: string; orders: number; revenue: number }> = [];
  for (let i = 0; i < days; i += 1) {
    const d = addDays(startInclusive, i);
    const key = istanbulDateKey(d);
    const v = byDay.get(key) ?? { orders: 0, revenue: 0 };
    series.push({ date: key, orders: v.orders, revenue: v.revenue });
  }
  return series;
}

function feedStatus(
  lastSyncedAt: Date | null,
  lastError: string | null,
  refreshIntervalHours: number,
): 'ok' | 'warn' | 'fail' {
  if (lastError) return 'fail';
  if (!lastSyncedAt) return 'warn';
  const ageMs = Date.now() - lastSyncedAt.getTime();
  const intervalMs = refreshIntervalHours * 3600 * 1000;
  if (ageMs > intervalMs * 2) return 'fail';
  if (ageMs > intervalMs) return 'warn';
  return 'ok';
}

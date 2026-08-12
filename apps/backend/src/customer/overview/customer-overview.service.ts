import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { trStartOfDay, trAddDays } from '../../common/utils/tr-time';

const RECENT_LIMIT = 5;
const ROLLING_WINDOW_DAYS = 30;
// `shipped` artık terminal teslimat statüsü; "açık akıştaki" siparişler sadece
// `paid` ve `preparing` olur. (delivered enum'dan kaldırıldı.)
const PENDING_STATUSES = ['paid', 'preparing'] as const;
const SPARKLINE_DAYS = 7;

@Injectable()
export class CustomerOverviewService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(customerId: string) {
    const now = new Date();
    const since = new Date();
    since.setDate(since.getDate() - ROLLING_WINDOW_DAYS);

    const dayWindows = buildDailyWindows(now, SPARKLINE_DAYS);
    // awaiting_payment (ödemesi alınmamış kart siparişi) hiçbir metriğe ve
    // listeye girmez — müşteri için sipariş ancak ödeme alınınca var olur.
    const visibleStatus = { not: 'awaiting_payment' as const };
    const dailyCountQueries = dayWindows.map((w) =>
      this.prisma.order.count({
        where: {
          customerId,
          status: visibleStatus,
          createdAt: { gte: w.start, lt: w.end },
        },
      }),
    );

    const [
      customer,
      orderGroups,
      last30Count,
      recentOrders,
      ledgerEntries,
      ...dailyCounts
    ] = await this.prisma.$transaction([
      this.prisma.customer.findUnique({
        where: { id: customerId },
        select: {
          id: true,
          name: true,
          email: true,
          xmlToken: true,
          cariBalance: true,
        },
      }),
      this.prisma.order.groupBy({
        by: ['status'],
        where: { customerId, status: visibleStatus },
        orderBy: { status: 'asc' },
        _count: true,
      }),
      this.prisma.order.count({
        where: { customerId, status: visibleStatus, createdAt: { gte: since } },
      }),
      this.prisma.order.findMany({
        where: { customerId, status: visibleStatus },
        orderBy: { createdAt: 'desc' },
        take: RECENT_LIMIT,
        select: {
          id: true,
          humanOrderNo: true,
          status: true,
          total: true,
          currency: true,
          createdAt: true,
        },
      }),
      this.prisma.cariLedger.findMany({
        where: { customerId },
        orderBy: { createdAt: 'desc' },
        take: RECENT_LIMIT,
        select: {
          id: true,
          type: true,
          amount: true,
          balanceAfter: true,
          description: true,
          createdAt: true,
        },
      }),
      ...dailyCountQueries,
    ]);

    const last7DaysOrderCounts = (dailyCounts as number[]).map((n) => n ?? 0);

    const counts = orderGroups.reduce<Record<string, number>>((acc, g) => {
      acc[g.status] = countOf(g._count);
      return acc;
    }, {});

    const totalOrders = orderGroups.reduce(
      (acc, g) => acc + countOf(g._count),
      0,
    );
    const pendingOrders = PENDING_STATUSES.reduce(
      (acc, s) => acc + (counts[s] ?? 0),
      0,
    );
    const shippedOrders = counts['shipped'] ?? 0;
    const cancelledOrders = counts['cancelled'] ?? 0;

    const refundedOrders = counts['refunded'] ?? 0;

    return {
      success: true,
      data: {
        customer: {
          id: customer?.id ?? customerId,
          name: customer?.name ?? '',
          email: customer?.email ?? '',
          xmlToken: customer?.xmlToken ?? null,
          cariBalance: customer ? Number(customer.cariBalance) : 0,
        },
        metrics: {
          cariBalance: customer ? Number(customer.cariBalance) : 0,
          last30DaysOrderCount: last30Count,
          pendingOrderCount: pendingOrders,
          shippedOrderCount: shippedOrders,
          cancelledOrderCount: cancelledOrders,
          refundedOrderCount: refundedOrders,
          totalOrderCount: totalOrders,
        },
        orderFlow: {
          // Akış: paid → preparing → shipped. `delivered` enum'dan kaldırıldı —
          // biz tedarikçiyiz, kargoya teslim sonrası akışla ilgilenmiyoruz.
          received: counts['paid'] ?? 0,
          preparing: counts['preparing'] ?? 0,
          shipped: shippedOrders,
          cancelled: cancelledOrders,
          refunded: refundedOrders,
        },
        recentOrders: recentOrders.map(serializeOrder),
        balanceMovements: ledgerEntries.map(serializeLedger),
        last7DaysOrderCounts,
      },
    };
  }
}

function countOf(value: unknown): number {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object' && '_all' in value) {
    const inner = (value as { _all?: number })._all;
    return typeof inner === 'number' ? inner : 0;
  }
  return 0;
}

function buildDailyWindows(now: Date, days: number) {
  // Günlük pencereler TR takvim günlerine göre (sunucu UTC olsa bile):
  // her pencere [TR gün başı, ertesi TR gün başı).
  const windows: { start: Date; end: Date }[] = [];
  const todayStart = trStartOfDay(now);
  for (let i = days - 1; i >= 0; i -= 1) {
    const start = trAddDays(todayStart, -i);
    const end = trAddDays(start, 1);
    windows.push({ start, end });
  }
  return windows;
}

function serializeOrder(o: {
  id: string;
  humanOrderNo: string | null;
  status: string;
  total: Prisma.Decimal;
  currency: string;
  createdAt: Date;
}) {
  return {
    id: o.id,
    humanOrderNo: o.humanOrderNo,
    status: o.status,
    total: Number(o.total),
    currency: o.currency,
    createdAt: o.createdAt,
  };
}

function serializeLedger(l: {
  id: string;
  type: string;
  amount: Prisma.Decimal;
  balanceAfter: Prisma.Decimal;
  description: string | null;
  createdAt: Date;
}) {
  const amount = Number(l.amount);
  return {
    id: l.id,
    type: l.type,
    amount,
    direction: amount >= 0 ? ('positive' as const) : ('negative' as const),
    balanceAfter: Number(l.balanceAfter),
    description: l.description,
    createdAt: l.createdAt,
  };
}

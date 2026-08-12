import type { PrismaService } from '../../prisma/prisma.service';
import { trParts, trStartOfDay } from '../../common/utils/tr-time';

/**
 * Bu ayın (Europe/Istanbul ay başı → şimdi) en çok satış yapan ilk `limit`
 * bayisi. Satış = Order.total toplamı, iptal/iade hariç (buildTotalSpentMap ile
 * AYNI statü kuralı; brüt aylık — motivasyon sıralaması için yeterli).
 * Döner: Map<customerId, sıra(1..limit)>. Yalnız satışı > 0 olanlar sıralanır.
 *
 * TEK KAYNAK: hem admin-customers hem admin-orders bunu kullanır → "ayın en çok
 * satanı" metriği iki ekranda tutarlı kalır (drift yok).
 */
export async function getMonthlyTopSellers(
  prisma: PrismaService,
  tenantId: string,
  limit = 5,
): Promise<Map<string, number>> {
  const p = trParts(new Date());
  const monthStart = trStartOfDay(
    new Date(Date.UTC(p.year, p.month - 1, 1, 12, 0, 0)),
  );
  const rows = await prisma.order.groupBy({
    by: ['customerId'],
    where: {
      tenantId,
      status: { notIn: ['cancelled', 'refunded'] },
      createdAt: { gte: monthStart },
      customerId: { not: null },
    },
    _sum: { total: true },
    orderBy: { _sum: { total: 'desc' } },
    take: limit,
  });
  const map = new Map<string, number>();
  rows.forEach((r, i) => {
    if (r.customerId && Number(r._sum.total ?? 0) > 0) {
      map.set(r.customerId, i + 1);
    }
  });
  return map;
}

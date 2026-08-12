import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CustomerOverviewService } from './customer-overview.service';

function dec(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

function makePrisma(overrides: {
  findUnique?: jest.Mock;
  groupBy?: jest.Mock;
  orderCount?: jest.Mock;
  orderFindMany?: jest.Mock;
  ledgerFindMany?: jest.Mock;
  transaction?: jest.Mock;
} = {}) {
  const findUnique =
    overrides.findUnique ??
    jest.fn().mockResolvedValue({
      id: 'c1',
      name: 'Test Müşteri',
      email: 'test@example.com',
      xmlToken: 'tok-1',
      cariBalance: dec(1500),
    });
  const groupBy = overrides.groupBy ?? jest.fn().mockResolvedValue([]);
  const orderCount = overrides.orderCount ?? jest.fn().mockResolvedValue(0);
  const orderFindMany =
    overrides.orderFindMany ?? jest.fn().mockResolvedValue([]);
  const ledgerFindMany =
    overrides.ledgerFindMany ?? jest.fn().mockResolvedValue([]);
  const $transaction =
    overrides.transaction ??
    jest
      .fn()
      .mockImplementation(async (calls: Promise<unknown>[]) =>
        Promise.all(calls),
      );

  return {
    customer: { findUnique },
    order: { groupBy, count: orderCount, findMany: orderFindMany },
    cariLedger: { findMany: ledgerFindMany },
    $transaction,
  } as unknown as PrismaService & {
    customer: { findUnique: jest.Mock };
    order: { groupBy: jest.Mock; count: jest.Mock; findMany: jest.Mock };
    cariLedger: { findMany: jest.Mock };
    $transaction: jest.Mock;
  };
}

describe('CustomerOverviewService', () => {
  describe('overview', () => {
    it('returns customer profile with cari balance as a number', async () => {
      const prisma = makePrisma();
      const svc = new CustomerOverviewService(prisma);

      const result = await svc.overview('c1');

      expect(result.success).toBe(true);
      expect(result.data.customer).toEqual({
        id: 'c1',
        name: 'Test Müşteri',
        email: 'test@example.com',
        xmlToken: 'tok-1',
        cariBalance: 1500,
      });
      expect(typeof result.data.customer.cariBalance).toBe('number');
    });

    it('aggregates order status counts into metrics and orderFlow', async () => {
      const groupBy = jest.fn().mockResolvedValue([
        // `shipped` artık terminal teslimat statüsü; PENDING_STATUSES sadece
        // paid + preparing'i kapsar. (delivered/returned enum'dan kaldırıldı.)
        { status: 'paid', _count: { _all: 2 } },
        { status: 'preparing', _count: { _all: 1 } },
        { status: 'shipped', _count: { _all: 5 } },
        { status: 'cancelled', _count: { _all: 1 } },
        { status: 'refunded', _count: { _all: 2 } },
      ]);
      const prisma = makePrisma({ groupBy });
      const svc = new CustomerOverviewService(prisma);

      const result = await svc.overview('c1');

      expect(result.data.metrics.totalOrderCount).toBe(11);
      // paid + preparing (PENDING_STATUSES)
      expect(result.data.metrics.pendingOrderCount).toBe(3);
      expect(result.data.metrics.shippedOrderCount).toBe(5);
      expect(result.data.metrics.cancelledOrderCount).toBe(1);
      // counts['refunded'] (2)
      expect(result.data.metrics.refundedOrderCount).toBe(2);
      expect(result.data.orderFlow).toEqual({
        received: 2,
        preparing: 1,
        shipped: 5,
        cancelled: 1,
        refunded: 2,
      });
    });

    it('uses a 30-day rolling window for the recent order count', async () => {
      const orderCount = jest.fn().mockResolvedValue(7);
      const prisma = makePrisma({ orderCount });
      const svc = new CustomerOverviewService(prisma);

      const result = await svc.overview('c1');

      expect(result.data.metrics.last30DaysOrderCount).toBe(7);
      // Daily-window calls fire before the singleton 30-day count (which is
      // built inside the $transaction([...]) literal after dayWindows.map(...)).
      const callArg = orderCount.mock.calls.at(-1)![0];
      expect(callArg.where.customerId).toBe('c1');
      expect(callArg.where.createdAt.gte).toBeInstanceOf(Date);
      const windowStart = callArg.where.createdAt.gte as Date;
      const diffDays =
        (Date.now() - windowStart.getTime()) / (1000 * 60 * 60 * 24);
      // Allow a tiny clock drift but assert the window is ~30 days back.
      expect(diffDays).toBeGreaterThan(29.9);
      expect(diffDays).toBeLessThan(30.1);
    });

    it('serializes recent orders with Decimal totals as numbers', async () => {
      const orderFindMany = jest.fn().mockResolvedValue([
        {
          id: 'o1',
          humanOrderNo: 'AB-001',
          status: 'shipped',
          total: dec(1234.5),
          currency: 'TRY',
          createdAt: new Date('2026-04-01'),
        },
      ]);
      const prisma = makePrisma({ orderFindMany });
      const svc = new CustomerOverviewService(prisma);

      const result = await svc.overview('c1');

      expect(result.data.recentOrders).toHaveLength(1);
      const row = result.data.recentOrders[0];
      expect(row.total).toBe(1234.5);
      expect(typeof row.total).toBe('number');
      expect(row.humanOrderNo).toBe('AB-001');
    });

    it('marks ledger direction by signed amount', async () => {
      const ledgerFindMany = jest.fn().mockResolvedValue([
        {
          id: 'l1',
          type: 'TOPUP',
          amount: dec(500),
          balanceAfter: dec(2000),
          description: 'Bakiye yükleme',
          createdAt: new Date('2026-04-02'),
        },
        {
          id: 'l2',
          type: 'ORDER_PAYMENT',
          amount: dec(-250),
          balanceAfter: dec(1750),
          description: 'Sipariş ödemesi',
          createdAt: new Date('2026-04-03'),
        },
      ]);
      const prisma = makePrisma({ ledgerFindMany });
      const svc = new CustomerOverviewService(prisma);

      const result = await svc.overview('c1');

      expect(result.data.balanceMovements).toHaveLength(2);
      expect(result.data.balanceMovements[0]).toEqual(
        expect.objectContaining({
          id: 'l1',
          amount: 500,
          balanceAfter: 2000,
          direction: 'positive',
        }),
      );
      expect(result.data.balanceMovements[1]).toEqual(
        expect.objectContaining({
          id: 'l2',
          amount: -250,
          balanceAfter: 1750,
          direction: 'negative',
        }),
      );
    });

    it('falls back to safe defaults when customer record is missing', async () => {
      const findUnique = jest.fn().mockResolvedValue(null);
      const prisma = makePrisma({ findUnique });
      const svc = new CustomerOverviewService(prisma);

      const result = await svc.overview('c-missing');

      expect(result.data.customer.id).toBe('c-missing');
      expect(result.data.customer.name).toBe('');
      expect(result.data.customer.email).toBe('');
      expect(result.data.customer.xmlToken).toBeNull();
      expect(result.data.customer.cariBalance).toBe(0);
      expect(result.data.metrics.cariBalance).toBe(0);
    });

    it('returns a 7-element last7DaysOrderCounts series with zeros for empty days', async () => {
      // dayWindows.map(...) fires count() seven times BEFORE the
      // $transaction([...]) literal builds the singleton 30-day count, so the
      // daily values are the first 7 mocks and the 30-day value is the 8th.
      const orderCount = jest
        .fn()
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(3)
        .mockResolvedValueOnce(4)
        .mockResolvedValueOnce(99);
      const prisma = makePrisma({ orderCount });
      const svc = new CustomerOverviewService(prisma);

      const result = await svc.overview('c1');

      expect(result.data.metrics.last30DaysOrderCount).toBe(99);
      expect(result.data.last7DaysOrderCounts).toEqual([0, 1, 0, 2, 0, 3, 4]);
      expect(result.data.last7DaysOrderCounts).toHaveLength(7);
    });

    it('emits seven daily windows ending at today (descending offsets 6..0)', async () => {
      const orderCount = jest.fn().mockResolvedValue(0);
      const prisma = makePrisma({ orderCount });
      const svc = new CustomerOverviewService(prisma);

      await svc.overview('c1');

      // Calls 0..6 = daily windows oldest -> newest (fired by dayWindows.map),
      // call 7 = the 30-day window built inside the $transaction literal.
      const dailyCalls = orderCount.mock.calls.slice(0, 7);
      expect(dailyCalls).toHaveLength(7);

      // Gün pencereleri Europe/Istanbul takvim günlerine göredir (tr-time):
      // her pencere [TR gün başı, ertesi TR gün başı) — test UTC container'da
      // koşsa bile. Bağımsız türetme: anın TR takvim tarihini Intl ile bul,
      // o günün 00:00 TR anını UTC olarak hesapla (Türkiye 2016'dan beri
      // sabit UTC+3, DST yok → gün uzunluğu daima 24 saat).
      const DAY_MS = 86_400_000;
      const TR_OFFSET_MS = 3 * 3_600_000;
      const trFmt = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Istanbul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
      const [y, m, d] = trFmt.format(new Date()).split('-').map(Number);
      const todayStartTr = Date.UTC(y, m - 1, d) - TR_OFFSET_MS;

      dailyCalls.forEach((call, idx) => {
        const arg = call[0];
        expect(arg.where.customerId).toBe('c1');
        const start = arg.where.createdAt.gte as Date;
        const end = arg.where.createdAt.lt as Date;
        const expectedStart = todayStartTr - (6 - idx) * DAY_MS;
        expect(start.getTime()).toBe(expectedStart);
        expect(end.getTime()).toBe(expectedStart + DAY_MS);
      });
    });

    it('scopes every query by customerId', async () => {
      const groupBy = jest.fn().mockResolvedValue([]);
      const orderCount = jest.fn().mockResolvedValue(0);
      const orderFindMany = jest.fn().mockResolvedValue([]);
      const ledgerFindMany = jest.fn().mockResolvedValue([]);
      const findUnique = jest.fn().mockResolvedValue({
        id: 'c1',
        name: 'X',
        email: 'x@y.z',
        xmlToken: null,
        cariBalance: dec(0),
      });
      const prisma = makePrisma({
        findUnique,
        groupBy,
        orderCount,
        orderFindMany,
        ledgerFindMany,
      });
      const svc = new CustomerOverviewService(prisma);

      await svc.overview('c1');

      expect(findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'c1' } }),
      );
      // Sipariş sorguları customerId + awaiting_payment hariç filtresiyle
      // scope'lanır (ödemesi alınmamış kart siparişi metriklere/listeye girmez).
      expect(groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { customerId: 'c1', status: { not: 'awaiting_payment' } },
        }),
      );
      expect(orderFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { customerId: 'c1', status: { not: 'awaiting_payment' } },
        }),
      );
      expect(ledgerFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { customerId: 'c1' } }),
      );
    });
  });
});

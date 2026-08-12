import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CariBalanceService } from '../../cari-balance/cari-balance.service';
import { ReceiptsService } from '../../receipts/receipts.service';
import { trParts, trStartOfMonth } from '../../common/utils/tr-time';
import { CustomerOrdersService } from './customer-orders.service';

// İade toplamları için CariBalanceService mock'u — testler brüt = net senaryosu
// kurduğundan (refund yok) refundTotalsByCustomer boş Map döner.
function makeCariBalance(): CariBalanceService {
  return {
    refundTotalsByCustomer: jest.fn().mockResolvedValue(new Map<string, number>()),
    refundTotalInWindow: jest.fn().mockResolvedValue(0),
  } as unknown as CariBalanceService;
}

// Makbuz ikonu için ReceiptsService mock'u — varsayılan olarak hiçbir siparişin
// makbuzu yok (boş Set), böylece hasReceipt=false beklenir.
function makeReceipts(): ReceiptsService {
  return {
    orderIdsWithReceipt: jest.fn().mockResolvedValue(new Set<string>()),
  } as unknown as ReceiptsService;
}

type OrderRow = {
  id: string;
  humanOrderNo: string | null;
  status: string;
  total: Prisma.Decimal;
  subtotal: Prisma.Decimal | null;
  kdvAmount: Prisma.Decimal | null;
  currency: string;
  marketplace: string | null;
  cargoCompany: string | null;
  cargoBarcode: string | null;
  trackingNumber: string | null;
  createdAt: Date;
  updatedAt: Date;
  items: Array<{
    id: string;
    productSlug: string;
    productName: string;
    qty: number;
    unitPrice: Prisma.Decimal;
    product: { images: Array<{ url: string }> } | null;
  }>;
};

function dec(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

function makePrisma(overrides: {
  findMany?: jest.Mock;
  count?: jest.Mock;
  groupBy?: jest.Mock;
  findFirst?: jest.Mock;
  aggregate?: jest.Mock;
  itemGroupBy?: jest.Mock;
  transaction?: jest.Mock;
} = {}) {
  const findMany = overrides.findMany ?? jest.fn().mockResolvedValue([]);
  const count = overrides.count ?? jest.fn().mockResolvedValue(0);
  const groupBy = overrides.groupBy ?? jest.fn().mockResolvedValue([]);
  const findFirst = overrides.findFirst ?? jest.fn().mockResolvedValue(null);
  const aggregate =
    overrides.aggregate ??
    jest.fn().mockResolvedValue({ _sum: { total: null } });
  const itemGroupBy =
    overrides.itemGroupBy ?? jest.fn().mockResolvedValue([]);
  const $transaction =
    overrides.transaction ??
    jest
      .fn()
      .mockImplementation(async (calls: Promise<unknown>[]) =>
        Promise.all(calls),
      );

  return {
    order: { findMany, count, groupBy, findFirst, aggregate },
    orderItem: { groupBy: itemGroupBy },
    $transaction,
  } as unknown as PrismaService & {
    order: {
      findMany: jest.Mock;
      count: jest.Mock;
      groupBy: jest.Mock;
      findFirst: jest.Mock;
      aggregate: jest.Mock;
    };
    orderItem: { groupBy: jest.Mock };
    $transaction: jest.Mock;
  };
}

function makeOrderRow(partial: Partial<OrderRow> = {}): OrderRow {
  return {
    id: 'o1',
    humanOrderNo: 'AB-001',
    status: 'pending',
    total: dec(120),
    subtotal: dec(100),
    kdvAmount: dec(20),
    currency: 'TRY',
    marketplace: null,
    cargoCompany: null,
    cargoBarcode: null,
    trackingNumber: null,
    createdAt: new Date('2026-04-01'),
    updatedAt: new Date('2026-04-02'),
    items: [
      {
        id: 'i1',
        productSlug: 'kalem',
        productName: 'Kalem',
        qty: 2,
        unitPrice: dec(50),
        product: { images: [{ url: 'https://cdn.example/kalem.jpg' }] },
      },
    ],
    ...partial,
  };
}

describe('CustomerOrdersService', () => {
  describe('list', () => {
    it('applies default pagination (page=1 limit=20) and customerId scope', async () => {
      const findMany = jest.fn().mockResolvedValue([makeOrderRow()]);
      const count = jest.fn().mockResolvedValue(1);
      const prisma = makePrisma({ findMany, count });
      const svc = new CustomerOrdersService(prisma, makeCariBalance(), makeReceipts());

      const result = await svc.list('c1', {});

      expect(result.success).toBe(true);
      expect(result.meta).toEqual({
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
      });
      // Liste sorgusu bayi iadelerini (dealer_return), ödemesi alınmamış kart
      // siparişlerini (awaiting_payment) ve hiç ödenmemiş iptal denemelerini
      // (cancelled & paidAt=null) dışarıda bırakır; aynı `where` hem findMany
      // hem count için kullanılır.
      const visibleWhere = {
        customerId: 'c1',
        items: { none: { fulfillmentSource: 'dealer_return' } },
        status: { not: 'awaiting_payment' },
        AND: [{ NOT: { status: 'cancelled', paidAt: null } }],
      };
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: visibleWhere,
          skip: 0,
          take: 20,
          orderBy: { createdAt: 'desc' },
        }),
      );
      expect(count).toHaveBeenCalledWith({ where: visibleWhere });
    });

    it('honors page/limit and computes correct skip', async () => {
      const findMany = jest.fn().mockResolvedValue([]);
      const prisma = makePrisma({ findMany });
      const svc = new CustomerOrdersService(prisma, makeCariBalance(), makeReceipts());

      await svc.list('c1', { page: 3, limit: 5 });

      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10, take: 5 }),
      );
    });

    it('filters by status when provided', async () => {
      const findMany = jest.fn().mockResolvedValue([]);
      const prisma = makePrisma({ findMany });
      const svc = new CustomerOrdersService(prisma, makeCariBalance(), makeReceipts());

      await svc.list('c1', { status: 'shipped' });

      // Açık status verildiğinde awaiting_payment filtresi yerine o status
      // uygulanır; dealer_return hariç tutma ve hiç ödenmemiş iptal denemelerini
      // (cancelled & paidAt=null) ele alma her durumda kalır.
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            customerId: 'c1',
            items: { none: { fulfillmentSource: 'dealer_return' } },
            status: 'shipped',
            AND: [{ NOT: { status: 'cancelled', paidAt: null } }],
          },
        }),
      );
    });

    it('builds OR clause across order no / tracking / cargo / item name on search', async () => {
      const findMany = jest.fn().mockResolvedValue([]);
      const prisma = makePrisma({ findMany });
      const svc = new CustomerOrdersService(prisma, makeCariBalance(), makeReceipts());

      await svc.list('c1', { search: 'AB-001' });

      const call = findMany.mock.calls[0][0];
      expect(call.where.customerId).toBe('c1');
      expect(call.where.OR).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            humanOrderNo: { contains: 'AB-001', mode: 'insensitive' },
          }),
          expect.objectContaining({
            trackingNumber: { contains: 'AB-001', mode: 'insensitive' },
          }),
          expect.objectContaining({
            cargoBarcode: { contains: 'AB-001', mode: 'insensitive' },
          }),
          expect.objectContaining({
            items: {
              some: {
                productName: { contains: 'AB-001', mode: 'insensitive' },
              },
            },
          }),
        ]),
      );
    });

    it('translates sort string to Prisma orderBy object', async () => {
      const findMany = jest.fn().mockResolvedValue([]);
      const prisma = makePrisma({ findMany });
      const svc = new CustomerOrdersService(prisma, makeCariBalance(), makeReceipts());

      await svc.list('c1', { sort: 'total:asc' });

      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { total: 'asc' } }),
      );
    });

    it('serializes Decimal values to plain numbers for the wire', async () => {
      const findMany = jest.fn().mockResolvedValue([makeOrderRow()]);
      const count = jest.fn().mockResolvedValue(1);
      const prisma = makePrisma({ findMany, count });
      const svc = new CustomerOrdersService(prisma, makeCariBalance(), makeReceipts());

      const result = await svc.list('c1', {});

      expect(result.data).toHaveLength(1);
      const row = result.data[0];
      expect(typeof row.total).toBe('number');
      expect(row.total).toBe(120);
      expect(row.kdvAmount).toBe(20);
      expect(row.items[0].unitPrice).toBe(50);
    });
  });

  describe('summary', () => {
    it('aggregates counts by status and sums totals across groups', async () => {
      const groupBy = jest.fn().mockResolvedValue([
        // `shipped` artık terminal teslimat statüsü — biz tedarikçiyiz, kargoya
        // teslim sonrası akışla ilgilenmiyoruz. (delivered enum'dan kaldırıldı.)
        { status: 'shipped', _count: { _all: 3 }, _sum: { total: dec(300) } },
        { status: 'paid', _count: { _all: 2 }, _sum: { total: dec(80) } },
        { status: 'preparing', _count: { _all: 1 }, _sum: { total: dec(40) } },
        { status: 'cancelled', _count: { _all: 1 }, _sum: { total: null } },
      ]);
      const prisma = makePrisma({ groupBy });
      const svc = new CustomerOrdersService(prisma, makeCariBalance(), makeReceipts());

      const result = await svc.summary('c1');

      expect(result.success).toBe(true);
      expect(result.data.totalOrders).toBe(7);
      expect(result.data.shippedOrders).toBe(3);
      // paid + preparing — açık akıştaki siparişler.
      expect(result.data.pendingOrders).toBe(3);
      expect(result.data.cancelledOrders).toBe(1);
      expect(result.data.refundedOrders).toBe(0);
      expect(result.data.totalAmount).toBe(420);
    });

    it('returns zero totals when customer has no orders', async () => {
      const prisma = makePrisma({ groupBy: jest.fn().mockResolvedValue([]) });
      const svc = new CustomerOrdersService(prisma, makeCariBalance(), makeReceipts());

      const result = await svc.summary('c1');

      expect(result.data).toEqual({
        totalOrders: 0,
        shippedOrders: 0,
        pendingOrders: 0,
        cancelledOrders: 0,
        refundedOrders: 0,
        totalAmount: 0,
      });
    });
  });

  describe('dashboard', () => {
    it('builds marketplace distribution with percentages and skips null marketplaces', async () => {
      const groupBy = jest.fn().mockResolvedValue([
        { marketplace: 'other', _count: { _all: 6 } },
        { marketplace: 'self', _count: { _all: 4 } },
      ]);
      const prisma = makePrisma({ groupBy });
      const svc = new CustomerOrdersService(prisma, makeCariBalance(), makeReceipts());

      const result = await svc.dashboard('c1');

      expect(result.success).toBe(true);
      expect(result.data.marketplaceDistribution).toEqual([
        { marketplace: 'other', count: 6, percentage: 60 },
        { marketplace: 'self', count: 4, percentage: 40 },
      ]);
      // Marketplace groupBy must filter out null and scope to customerId.
      expect(groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          by: ['marketplace'],
          where: {
            customerId: 'c1',
            items: { none: { fulfillmentSource: 'dealer_return' } },
            marketplace: { not: null },
            status: { not: 'awaiting_payment' },
          },
        }),
      );
    });

    it('returns top products ranked by qty desc with limit', async () => {
      const itemGroupBy = jest.fn().mockResolvedValue([
        {
          productSlug: 'kalem',
          productName: 'Kalem',
          _sum: { qty: 12 },
        },
        {
          productSlug: 'silgi',
          productName: 'Silgi',
          _sum: { qty: 7 },
        },
        {
          productSlug: 'defter',
          productName: 'Defter',
          _sum: { qty: 3 },
        },
      ]);
      const prisma = makePrisma({ itemGroupBy });
      const svc = new CustomerOrdersService(prisma, makeCariBalance(), makeReceipts());

      const result = await svc.dashboard('c1');

      expect(result.data.topProducts).toEqual([
        { rank: 1, productSlug: 'kalem', productName: 'Kalem', qty: 12 },
        { rank: 2, productSlug: 'silgi', productName: 'Silgi', qty: 7 },
        { rank: 3, productSlug: 'defter', productName: 'Defter', qty: 3 },
      ]);
      expect(itemGroupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          by: ['productSlug', 'productName'],
          where: {
            fulfillmentSource: { not: 'dealer_return' },
            order: {
              customerId: 'c1',
              items: { none: { fulfillmentSource: 'dealer_return' } },
              status: { not: 'awaiting_payment' },
            },
          },
          orderBy: { _sum: { qty: 'desc' } },
          take: 3,
        }),
      );
    });

    it('lists most recently updated orders (limit 3) ordered by updatedAt desc', async () => {
      const findMany = jest.fn().mockResolvedValue([
        {
          id: 'o3',
          humanOrderNo: 'AB-003',
          status: 'shipped',
          updatedAt: new Date('2026-04-05'),
        },
        {
          id: 'o2',
          humanOrderNo: 'AB-002',
          status: 'preparing',
          updatedAt: new Date('2026-04-04'),
        },
        {
          id: 'o1',
          humanOrderNo: 'AB-001',
          status: 'shipped',
          updatedAt: new Date('2026-04-03'),
        },
      ]);
      const prisma = makePrisma({ findMany });
      const svc = new CustomerOrdersService(prisma, makeCariBalance(), makeReceipts());

      const result = await svc.dashboard('c1');

      expect(result.data.recentUpdates).toHaveLength(3);
      expect(result.data.recentUpdates[0]).toEqual({
        id: 'o3',
        humanOrderNo: 'AB-003',
        status: 'shipped',
        updatedAt: new Date('2026-04-05'),
      });
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            customerId: 'c1',
            items: { none: { fulfillmentSource: 'dealer_return' } },
            status: { not: 'awaiting_payment' },
          },
          orderBy: { updatedAt: 'desc' },
          take: 3,
        }),
      );
    });

    it('aggregates monthly sales from start of current month and serializes to number', async () => {
      // dayWindows.map fires the 7 daily-sales aggregate calls before the
      // $transaction array is constructed, so monthly is the 8th aggregate.
      const aggregate = jest
        .fn()
        .mockResolvedValueOnce({ _sum: { total: null } })
        .mockResolvedValueOnce({ _sum: { total: null } })
        .mockResolvedValueOnce({ _sum: { total: null } })
        .mockResolvedValueOnce({ _sum: { total: null } })
        .mockResolvedValueOnce({ _sum: { total: null } })
        .mockResolvedValueOnce({ _sum: { total: null } })
        .mockResolvedValueOnce({ _sum: { total: null } })
        .mockResolvedValueOnce({ _sum: { total: dec(2500) } });
      const prisma = makePrisma({ aggregate });
      const svc = new CustomerOrdersService(prisma, makeCariBalance(), makeReceipts());

      const result = await svc.dashboard('c1');

      expect(result.data.monthlySalesAmount).toBe(2500);
      const monthlyCall = aggregate.mock.calls.at(-1)![0];
      expect(monthlyCall.where.customerId).toBe('c1');
      expect(monthlyCall.where.createdAt.gte).toBeInstanceOf(Date);
      const startOfMonth = monthlyCall.where.createdAt.gte as Date;
      // Ay başı Europe/Istanbul takvimine göredir (servis trStartOfMonth
      // kullanır): UTC container'da naif getMonth()/getHours() bir önceki
      // günü gösterir (TR 1 Temmuz 00:00 = UTC 30 Haziran 21:00). Bu yüzden
      // beklentiler TR duvar-saati parçalarıyla (trParts) doğrulanır.
      const nowTr = trParts(new Date());
      const startTr = trParts(startOfMonth);
      expect(startTr.year).toBe(nowTr.year);
      expect(startTr.month).toBe(nowTr.month);
      expect(startTr.day).toBe(1);
      expect(startTr.hour).toBe(0);
      expect(startTr.minute).toBe(0);
      expect(startTr.second).toBe(0);
      // An eşitliği: gte tam olarak içinde bulunulan TR ayının başı olmalı.
      expect(startOfMonth.getTime()).toBe(
        trStartOfMonth(new Date()).getTime(),
      );
    });

    it('returns 7-day sparkline series for orders and sales (zeros where empty)', async () => {
      // 7 daily count calls in oldest→newest order.
      const count = jest
        .fn()
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(3)
        .mockResolvedValueOnce(4)
        .mockResolvedValueOnce(5)
        .mockResolvedValueOnce(6);
      // 7 daily-sales aggregates fire first, then the monthly aggregate (#8).
      const aggregate = jest
        .fn()
        .mockResolvedValueOnce({ _sum: { total: dec(10) } })
        .mockResolvedValueOnce({ _sum: { total: null } })
        .mockResolvedValueOnce({ _sum: { total: dec(30) } })
        .mockResolvedValueOnce({ _sum: { total: null } })
        .mockResolvedValueOnce({ _sum: { total: dec(50) } })
        .mockResolvedValueOnce({ _sum: { total: null } })
        .mockResolvedValueOnce({ _sum: { total: dec(70) } })
        .mockResolvedValueOnce({ _sum: { total: null } });
      const prisma = makePrisma({ count, aggregate });
      const svc = new CustomerOrdersService(prisma, makeCariBalance(), makeReceipts());

      const result = await svc.dashboard('c1');

      expect(result.data.dailyOrderCounts).toEqual([0, 1, 2, 3, 4, 5, 6]);
      expect(result.data.dailyOrderCounts).toHaveLength(7);
      expect(result.data.dailySalesAmounts).toEqual([10, 0, 30, 0, 50, 0, 70]);
      expect(result.data.dailySalesAmounts).toHaveLength(7);
    });

    it('returns empty arrays/zeros when customer has no orders', async () => {
      const prisma = makePrisma();
      const svc = new CustomerOrdersService(prisma, makeCariBalance(), makeReceipts());

      const result = await svc.dashboard('c1');

      expect(result.data.marketplaceDistribution).toEqual([]);
      expect(result.data.topProducts).toEqual([]);
      expect(result.data.recentUpdates).toEqual([]);
      expect(result.data.monthlySalesAmount).toBe(0);
      expect(result.data.dailyOrderCounts).toEqual([0, 0, 0, 0, 0, 0, 0]);
      expect(result.data.dailySalesAmounts).toEqual([0, 0, 0, 0, 0, 0, 0]);
    });
  });

  describe('detail', () => {
    it('throws NotFoundException when order does not belong to customer', async () => {
      const prisma = makePrisma({
        findFirst: jest.fn().mockResolvedValue(null),
      });
      const svc = new CustomerOrdersService(prisma, makeCariBalance(), makeReceipts());

      await expect(svc.detail('c1', 'order-of-c2')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      // Ownership scope: where must filter by both id and customerId.
      expect(prisma.order.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'order-of-c2', customerId: 'c1' },
        }),
      );
    });

    it('returns serialized order with timeline when found', async () => {
      const findFirst = jest.fn().mockResolvedValue({
        id: 'o1',
        humanOrderNo: 'AB-001',
        status: 'shipped',
        total: dec(150),
        subtotal: dec(125),
        kdvAmount: dec(25),
        kdvRate: 20,
        currency: 'TRY',
        marketplace: null,
        cargoCompany: 'Aras',
        cargoBarcode: '123',
        trackingNumber: 'TRK-1',
        createdAt: new Date('2026-04-01'),
        updatedAt: new Date('2026-04-02'),
        items: [
          {
            id: 'i1',
            productSlug: 'kalem',
            productName: 'Kalem',
            unitPrice: dec(50),
            unitPriceOriginal: dec(60),
            discountPercent: 16,
            qty: 3,
          },
        ],
        trackingEvents: [
          {
            id: 't1',
            status: 'shipped',
            description: 'Kargoda',
            location: 'İstanbul',
            occurredAt: new Date('2026-04-02'),
          },
        ],
      });
      const prisma = makePrisma({ findFirst });
      const svc = new CustomerOrdersService(prisma, makeCariBalance(), makeReceipts());

      const result = await svc.detail('c1', 'o1');

      expect(result.success).toBe(true);
      expect(result.data.id).toBe('o1');
      expect(result.data.total).toBe(150);
      expect(result.data.kdvRate).toBe(20);
      expect(result.data.items[0].unitPrice).toBe(50);
      expect(result.data.items[0].unitPriceOriginal).toBe(60);
      expect(result.data.trackingEvents).toHaveLength(1);
    });
  });
});

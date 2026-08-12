import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { CariBalanceService } from '../cari-balance/cari-balance.service';
import { ProfitCalculatorService } from '../profitability/profit-calculator.service';
import { ProfitResult } from '../profitability/profit-calculator.types';
import { ZReportBuilder } from './z-report.builder';
import { ZReportService } from './z-report.service';
import { ReportPeriod } from './z-report.types';

const PERIOD: ReportPeriod = {
  from: new Date('2026-05-13T21:00:00.000Z'),
  to: new Date('2026-05-14T20:59:59.999Z'),
  label: '14.05.2026',
};

/** Boş ama geçerli bir ProfitResult. */
function emptyProfit(overrides: Partial<ProfitResult> = {}): ProfitResult {
  return {
    totalRevenue: 0,
    totalCost: 0,
    totalProfit: 0,
    margin: 0,
    orderCount: 0,
    itemCount: 0,
    zeroCostItemCount: 0,
    bySupplier: [],
    ...overrides,
  };
}

/** Order.findMany select şekline uygun tek sipariş satırı. */
function order(opts: {
  no: string;
  status: string;
  total: number;
  subtotal?: number;
  kdvAmount?: number;
  paymentType?: string | null;
  items?: number;
  customerName?: string;
}) {
  return {
    humanOrderNo: opts.no,
    createdAt: new Date('2026-05-14T07:00:00.000Z'),
    status: opts.status,
    customerName: opts.customerName ?? 'Müşteri',
    // `null` açıkça geçilmişse korunur; yalnız hiç verilmediğinde 'card'.
    paymentType: 'paymentType' in opts ? opts.paymentType : 'card',
    total: opts.total,
    subtotal: opts.subtotal ?? opts.total / 1.2,
    kdvAmount: opts.kdvAmount ?? opts.total - opts.total / 1.2,
    _count: { items: opts.items ?? 1 },
  };
}

interface PrismaMock {
  orderFindMany?: jest.Mock;
  orderAggregate?: jest.Mock;
  userFindMany?: jest.Mock;
  tenantFindMany?: jest.Mock;
}

const makePrisma = (m: PrismaMock) =>
  ({
    order: {
      findMany: m.orderFindMany ?? jest.fn().mockResolvedValue([]),
      // Trend/kıyas günleri — varsayılan boş gün.
      aggregate:
        m.orderAggregate ??
        jest
          .fn()
          .mockResolvedValue({ _sum: { total: 0 }, _count: { _all: 0 } }),
    },
    user: { findMany: m.userFindMany ?? jest.fn().mockResolvedValue([]) },
    tenant: { findMany: m.tenantFindMany ?? jest.fn().mockResolvedValue([]) },
  }) as unknown as PrismaService;

/** byOrder verilmezse boş sipariş kırılımıyla döner. */
const makeCalculator = (
  result: ProfitResult,
  byOrder: unknown[] = [],
) =>
  ({
    calculate: jest.fn().mockResolvedValue(result),
    calculateWithOrders: jest
      .fn()
      .mockResolvedValue({ ...result, byOrder }),
  }) as unknown as ProfitCalculatorService;

const makeMail = (sendZReport: jest.Mock) =>
  ({ sendZReport }) as unknown as MailService;

const makeConfig = (extra?: string, template?: string) =>
  ({
    get: jest.fn((key: string, def?: string) => {
      if (key === 'Z_REPORT_EXTRA_RECIPIENTS') return extra;
      if (key === 'Z_REPORT_TEMPLATE') return template ?? def;
      return undefined;
    }),
  }) as unknown as ConfigService;

// İade penceresi toplamı için CariBalanceService mock'u — testler brüt = net
// (refund yok) senaryosu kurduğundan refundTotalInWindow 0 döner.
const makeCariBalance = () =>
  ({
    refundTotalInWindow: jest.fn().mockResolvedValue(0),
    refundTotalsByCustomer: jest.fn().mockResolvedValue(new Map<string, number>()),
  }) as unknown as CariBalanceService;

describe('ZReportService.collect', () => {
  it('sums Order.total for included statuses only (paid in, cancelled out)', async () => {
    // Z_REPORT_STATUSES = paid/preparing/shipped.
    // Raw `pending` (= ödenmemiş) artık ciroya dahil DEĞİL.
    const orderFindMany = jest.fn().mockResolvedValue([
      order({ no: 'A1', status: 'shipped', total: 600, items: 2 }),
      order({ no: 'A2', status: 'paid', total: 300, items: 1 }),
      order({ no: 'A3', status: 'cancelled', total: 999, items: 1 }),
      order({ no: 'A4', status: 'refunded', total: 111, items: 1 }),
    ]);
    const svc = new ZReportService(
      makePrisma({ orderFindMany }),
      makeCalculator(emptyProfit({ totalCost: 200, itemCount: 3 })),
      new ZReportBuilder(),
      makeMail(jest.fn()),
      makeConfig(),
      makeCariBalance(),
    );

    const data = await svc.collect('t1', PERIOD);

    // 600 + 300 (paid dahil), 999 + 111 hariç.
    expect(data.totalRevenue).toBe(900);
    expect(data.orderCount).toBe(2);
    expect(data.cancelledCount).toBe(1);
    expect(data.refundedCount).toBe(1);
    // Maliyet karlılık motorundan; kâr = ciro - maliyet.
    expect(data.totalCost).toBe(200);
    expect(data.totalProfit).toBe(700);
  });

  it('builds a status breakdown that includes cancelled/refunded rows with zero revenue', async () => {
    const orderFindMany = jest.fn().mockResolvedValue([
      order({ no: 'A1', status: 'shipped', total: 600 }),
      order({ no: 'A2', status: 'cancelled', total: 999 }),
    ]);
    const svc = new ZReportService(
      makePrisma({ orderFindMany }),
      makeCalculator(emptyProfit()),
      new ZReportBuilder(),
      makeMail(jest.fn()),
      makeConfig(),
      makeCariBalance(),
    );

    const data = await svc.collect('t1', PERIOD);

    const cancelled = data.statusBreakdown.find(
      (r) => r.status === 'cancelled',
    );
    expect(cancelled).toEqual({
      status: 'cancelled',
      orderCount: 1,
      revenue: 0,
    });
    const shipped = data.statusBreakdown.find(
      (r) => r.status === 'shipped',
    );
    expect(shipped?.revenue).toBe(600);
  });

  it('builds a payment-type breakdown only from included orders', async () => {
    const orderFindMany = jest.fn().mockResolvedValue([
      order({ no: 'A1', status: 'shipped', total: 600, paymentType: 'card' }),
      order({ no: 'A2', status: 'paid', total: 400, paymentType: 'cari' }),
      order({
        no: 'A3',
        status: 'cancelled',
        total: 999,
        paymentType: 'card',
      }),
      // `paid` ciroya dahil + null paymentType → `unknown` kovasına düşmeli.
      order({ no: 'A4', status: 'paid', total: 100, paymentType: null }),
    ]);
    const svc = new ZReportService(
      makePrisma({ orderFindMany }),
      makeCalculator(emptyProfit()),
      new ZReportBuilder(),
      makeMail(jest.fn()),
      makeConfig(),
      makeCariBalance(),
    );

    const data = await svc.collect('t1', PERIOD);

    const card = data.paymentTypeBreakdown.find(
      (r) => r.paymentType === 'card',
    );
    // cancelled kart siparişi sayılmamalı → sadece A1.
    expect(card).toEqual({ paymentType: 'card', orderCount: 1, revenue: 600 });
    const unknown = data.paymentTypeBreakdown.find(
      (r) => r.paymentType === 'unknown',
    );
    expect(unknown?.revenue).toBe(100);
  });

  it('derives top customers, records, hourly and trend from the day data', async () => {
    const orderFindMany = jest.fn().mockResolvedValue([
      // 07:00 UTC = 10:00 Istanbul.
      order({ no: 'A1', status: 'shipped', total: 600, customerName: 'Bayi A' }),
      order({ no: 'A2', status: 'paid', total: 900, customerName: 'Bayi B' }),
      order({ no: 'A3', status: 'cancelled', total: 5000 }),
    ]);
    const byOrder = [
      {
        orderId: 'o1',
        humanOrderNo: 'A1',
        customerId: 'c1',
        customerName: 'Bayi A',
        revenue: 600,
        cost: 400,
        profit: 200,
        itemCount: 2,
      },
      {
        orderId: 'o2',
        humanOrderNo: 'A2',
        customerId: 'c2',
        customerName: 'Bayi B',
        revenue: 900,
        cost: 850,
        profit: 50,
        itemCount: 1,
      },
    ];
    const svc = new ZReportService(
      makePrisma({ orderFindMany }),
      makeCalculator(emptyProfit({ totalCost: 1250 }), byOrder),
      new ZReportBuilder(),
      makeMail(jest.fn()),
      makeConfig(),
      makeCariBalance(),
    );

    const data = await svc.collect('t1', PERIOD);

    // Bayi kırılımı ciroya göre sıralı; iptal sipariş dahil değil.
    expect(data.topCustomers.map((c) => c.customerName)).toEqual([
      'Bayi B',
      'Bayi A',
    ]);
    expect(data.topCustomers[0].profit).toBe(50);

    // Rekorlar: en yüksek tutar A2 (900), en kârlı A1 (200).
    expect(data.biggestOrder?.humanOrderNo).toBe('A2');
    expect(data.mostProfitableOrder?.humanOrderNo).toBe('A1');
    expect(data.mostProfitableOrder?.value).toBe(200);

    // Saatlik yoğunluk: iki dahil sipariş de 10:00 Istanbul kovasında.
    expect(data.hourly).toEqual([
      { hour: 10, orderCount: 2, revenue: 1500 },
    ]);

    // Trend: 7 önceki gün (mock'ta boş) + rapor günü.
    expect(data.trend).toHaveLength(8);
    expect(data.trend[7]).toMatchObject({
      isReportDay: true,
      revenue: 1500,
      orderCount: 2,
    });
    expect(data.avgOrderValue).toBe(750);

    // CSV kâr kolonu: dahil siparişlerde dolu, iptalde null.
    expect(data.orders.find((o) => o.humanOrderNo === 'A1')?.profit).toBe(200);
    expect(data.orders.find((o) => o.humanOrderNo === 'A3')?.profit).toBeNull();
  });

  it('includes every order in the CSV rows regardless of status', async () => {
    const orderFindMany = jest.fn().mockResolvedValue([
      order({ no: 'A1', status: 'shipped', total: 600 }),
      order({ no: 'A2', status: 'cancelled', total: 999 }),
    ]);
    const svc = new ZReportService(
      makePrisma({ orderFindMany }),
      makeCalculator(emptyProfit()),
      new ZReportBuilder(),
      makeMail(jest.fn()),
      makeConfig(),
      makeCariBalance(),
    );

    const data = await svc.collect('t1', PERIOD);
    expect(data.orders.map((o) => o.humanOrderNo)).toEqual(['A1', 'A2']);
  });
});

describe('ZReportService.runForTenant', () => {
  it('skips sending when the tenant has no OWNER/ADMIN recipients', async () => {
    const sendZReport = jest.fn();
    const svc = new ZReportService(
      makePrisma({
        orderFindMany: jest.fn().mockResolvedValue([]),
        userFindMany: jest.fn().mockResolvedValue([]),
      }),
      makeCalculator(emptyProfit()),
      new ZReportBuilder(),
      makeMail(sendZReport),
      makeConfig(),
      makeCariBalance(),
    );

    const result = await svc.runForTenant('t1', PERIOD);

    expect(result.skipped).toBe(true);
    expect(result.recipientCount).toBe(0);
    expect(sendZReport).not.toHaveBeenCalled();
  });

  it('sends to deduped, lowercased OWNER/ADMIN emails plus extra recipients', async () => {
    const sendZReport = jest.fn().mockResolvedValue(undefined);
    const svc = new ZReportService(
      makePrisma({
        orderFindMany: jest
          .fn()
          .mockResolvedValue([
            order({ no: 'A1', status: 'shipped', total: 600 }),
          ]),
        userFindMany: jest.fn().mockResolvedValue([
          { email: 'Owner@ornek.com' },
          { email: 'admin@ornek.com' },
        ]),
      }),
      makeCalculator(emptyProfit({ totalCost: 100 })),
      new ZReportBuilder(),
      makeMail(sendZReport),
      // Ekstra alıcı listesinde bir tekrar var → elenir.
      makeConfig('extra@ornek.com, owner@ornek.com'),
      makeCariBalance(),
    );

    const result = await svc.runForTenant('t1', PERIOD);

    expect(result.skipped).toBe(false);
    expect(result.recipientCount).toBe(3);
    expect(sendZReport).toHaveBeenCalledTimes(1);
    const sentTo = sendZReport.mock.calls[0][0].to as string[];
    expect([...sentTo].sort()).toEqual(
      ['admin@ornek.com', 'extra@ornek.com', 'owner@ornek.com'].sort(),
    );
    // Varsayılan şablon SADE (spam-güvenli) — konu lite biçimde.
    expect(sendZReport.mock.calls[0][0].subject).toBe(
      'Gunluk Satis Ozeti 14.05.2026 - Ciro 600 TL',
    );
  });

  it('uses the rich template when Z_REPORT_TEMPLATE=rich', async () => {
    const sendZReport = jest.fn().mockResolvedValue(undefined);
    const svc = new ZReportService(
      makePrisma({
        orderFindMany: jest
          .fn()
          .mockResolvedValue([
            order({ no: 'A1', status: 'shipped', total: 600 }),
          ]),
        userFindMany: jest
          .fn()
          .mockResolvedValue([{ email: 'owner@ornek.com' }]),
      }),
      makeCalculator(emptyProfit({ totalCost: 100 })),
      new ZReportBuilder(),
      makeMail(sendZReport),
      makeConfig(undefined, 'rich'),
      makeCariBalance(),
    );

    await svc.runForTenant('t1', PERIOD);

    expect(sendZReport.mock.calls[0][0].subject).toBe(
      'Z Raporu — 14.05.2026 · Ciro 600 ₺ · Kâr 500 ₺',
    );
  });
});

describe('ZReportService.runForAllTenants', () => {
  it('processes every tenant, then throws so the job retries when any tenant failed', async () => {
    const orderFindMany = jest
      .fn()
      // t1 → patlar, t2 → boş döner
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce([]);
    const svc = new ZReportService(
      makePrisma({
        orderFindMany,
        userFindMany: jest.fn().mockResolvedValue([]),
        tenantFindMany: jest
          .fn()
          .mockResolvedValue([
            { id: 't1', name: 'Tenant 1' },
            { id: 't2', name: 'Tenant 2' },
          ]),
      }),
      makeCalculator(emptyProfit()),
      new ZReportBuilder(),
      makeMail(jest.fn()),
      makeConfig(),
      makeCariBalance(),
    );

    // t1 hata verdi → tüm tenant'lar denendikten SONRA hata fırlar (sessiz
    // kayıp yerine job failed + BullMQ retry).
    await expect(
      svc.runForAllTenants(new Date('2026-05-15T09:00:00.000Z')),
    ).rejects.toThrow(/1\/2 tenant/);

    // t2 yine de işlendi — hata izolasyonu korunur.
    expect(orderFindMany).toHaveBeenCalledTimes(2);
  });

  it('resolves normally when every tenant succeeds', async () => {
    const svc = new ZReportService(
      makePrisma({
        orderFindMany: jest.fn().mockResolvedValue([]),
        userFindMany: jest.fn().mockResolvedValue([]),
        tenantFindMany: jest
          .fn()
          .mockResolvedValue([{ id: 't1', name: 'Tenant 1' }]),
      }),
      makeCalculator(emptyProfit()),
      new ZReportBuilder(),
      makeMail(jest.fn()),
      makeConfig(),
      makeCariBalance(),
    );

    const results = await svc.runForAllTenants(
      new Date('2026-05-15T09:00:00.000Z'),
    );
    expect(results).toHaveLength(1);
    expect(results[0].skipped).toBe(true);
  });
});

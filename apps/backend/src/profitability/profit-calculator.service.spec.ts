import { PrismaService } from '../prisma/prisma.service';
import {
  ProfitCalculatorService,
  toNum,
} from './profit-calculator.service';
import {
  DEFAULT_PROFIT_STATUSES,
  Z_REPORT_STATUSES,
} from './profit-calculator.types';

/**
 * Prisma stub — yalnız `ProfitCalculatorService`'in dokunduğu modeller.
 * TEK KAYNAK modelde alış KDV oranı `Supplier.purchaseVatRate`'ten okunur
 * (`supplier.findMany`); eski `profitabilityConfig` kaldırıldı.
 */
const makePrisma = (mock: {
  supplierFindMany?: jest.Mock;
  orderItemFindMany?: jest.Mock;
}) =>
  ({
    supplier: {
      findMany: mock.supplierFindMany ?? jest.fn().mockResolvedValue([]),
    },
    orderItem: {
      findMany: mock.orderItemFindMany ?? jest.fn().mockResolvedValue([]),
    },
  }) as unknown as PrismaService;

/** Tek bir orderItem satırı kurar (fetchOrderItems select şeklini taklit eder). */
function item(opts: {
  qty: number;
  unitPrice: number;
  costPriceSnapshot?: number | null;
  orderId?: string;
  kdvRate?: number | null;
  supplierId?: string;
  supplierName?: string;
  costPrice?: number;
  noProduct?: boolean;
  supplierIdOverride?: string | null;
  supplierIdSnapshot?: string | null;
  supplierNameSnapshot?: string | null;
}) {
  return {
    qty: opts.qty,
    unitPrice: opts.unitPrice,
    costPriceSnapshot: opts.costPriceSnapshot ?? null,
    supplierIdOverride: opts.supplierIdOverride ?? null,
    supplierIdSnapshot: opts.supplierIdSnapshot ?? null,
    supplierNameSnapshot: opts.supplierNameSnapshot ?? null,
    supplierOverride: null,
    order: { id: opts.orderId ?? 'o1', kdvRate: opts.kdvRate ?? 20 },
    product: opts.noProduct
      ? null
      : {
          supplierId: opts.supplierId ?? 's1',
          costPrice: opts.costPrice ?? 0,
          supplier: { name: opts.supplierName ?? 'Tedarikçi A' },
        },
  };
}

describe('toNum', () => {
  it('returns 0 for null and undefined', () => {
    expect(toNum(null)).toBe(0);
    expect(toNum(undefined)).toBe(0);
  });

  it('passes numbers through', () => {
    expect(toNum(42.5)).toBe(42.5);
  });

  it('parses numeric strings', () => {
    expect(toNum('19.99')).toBe(19.99);
  });

  it('parses Prisma Decimal-like objects via toString', () => {
    expect(toNum({ toString: () => '123.45' })).toBe(123.45);
  });

  it('returns 0 for unparseable strings', () => {
    expect(toNum('not-a-number')).toBe(0);
  });
});

describe('ProfitCalculatorService', () => {
  const FROM = new Date('2026-05-13T21:00:00.000Z');
  const TO = new Date('2026-05-14T20:59:59.999Z');

  it('aggregates revenue, cost and profit for a single supplier', async () => {
    // costPriceSnapshot 100, KDV %20 alış → birim maliyet 120; qty 2 → cost 240.
    // unitPrice 200, satış KDV %20, qty 2 → gelir 200*2*1.2 = 480.
    const orderItemFindMany = jest
      .fn()
      .mockResolvedValue([
        item({ qty: 2, unitPrice: 200, costPriceSnapshot: 100 }),
      ]);
    const svc = new ProfitCalculatorService(makePrisma({ orderItemFindMany }));

    const result = await svc.calculate('t1', FROM, TO);

    expect(result.totalRevenue).toBeCloseTo(480);
    expect(result.totalCost).toBeCloseTo(240);
    expect(result.totalProfit).toBeCloseTo(240);
    expect(result.margin).toBeCloseTo(50);
    expect(result.orderCount).toBe(1);
    expect(result.itemCount).toBe(2);
    expect(result.bySupplier).toHaveLength(1);
    expect(result.bySupplier[0].supplierName).toBe('Tedarikçi A');
  });

  it('counts zero-cost items when no snapshot or cost price exists', async () => {
    const orderItemFindMany = jest
      .fn()
      .mockResolvedValue([
        item({ qty: 3, unitPrice: 100, costPriceSnapshot: null, costPrice: 0 }),
      ]);
    const svc = new ProfitCalculatorService(makePrisma({ orderItemFindMany }));

    const result = await svc.calculate('t1', FROM, TO);

    expect(result.zeroCostItemCount).toBe(3);
    expect(result.totalCost).toBe(0);
  });

  it('defaults to DEFAULT_PROFIT_STATUSES when no statuses option is given', async () => {
    const orderItemFindMany = jest.fn().mockResolvedValue([]);
    const svc = new ProfitCalculatorService(makePrisma({ orderItemFindMany }));

    await svc.calculate('t1', FROM, TO);

    const whereArg = orderItemFindMany.mock.calls[0][0].where;
    expect(whereArg.order.status.in).toEqual([...DEFAULT_PROFIT_STATUSES]);
  });

  it('passes the supplied statuses through to the query (Z report case)', async () => {
    const orderItemFindMany = jest.fn().mockResolvedValue([]);
    const svc = new ProfitCalculatorService(makePrisma({ orderItemFindMany }));

    await svc.calculate('t1', FROM, TO, { statuses: Z_REPORT_STATUSES });

    const whereArg = orderItemFindMany.mock.calls[0][0].where;
    // pending OrderStatus kaldırıldıktan sonra Z raporu ve admin karlılığı
    // aynı statü listesini kullanır; bu test override mekanizmasının
    // çalıştığını doğrular (varsayılana fallback yapmaz).
    expect(whereArg.order.status.in).toEqual([...Z_REPORT_STATUSES]);
  });

  it('narrows to the supplier (honoring overrides) when supplierId is provided', async () => {
    const orderItemFindMany = jest.fn().mockResolvedValue([]);
    const svc = new ProfitCalculatorService(makePrisma({ orderItemFindMany }));

    await svc.calculate('t1', FROM, TO, { supplierId: 's9' });

    const whereArg = orderItemFindMany.mock.calls[0][0].where;
    // Çözümleme önceliği BİREBİR: override → snapshot → product. Silinmiş
    // ürünlü kalemler snapshot dalıyla yakalanır (supplier-attribution.util).
    expect(whereArg.OR).toEqual([
      { supplierIdOverride: 's9' },
      { supplierIdOverride: null, supplierIdSnapshot: 's9' },
      {
        supplierIdOverride: null,
        supplierIdSnapshot: null,
        product: { supplierId: 's9' },
      },
    ]);
  });

  it('attributes a hard-deleted product to its supplier via snapshot (not "Ürün Silinmiş")', async () => {
    // Ürün silinmiş (product null) ama supplierIdSnapshot dolu → kalem doğru
    // tedarikçiye atfedilir, costPriceSnapshot'tan maliyet hesaplanır.
    // costPriceSnapshot 100, tedarikçi 's7' alış KDV %10 → 100 × 1.1 = 110.
    const orderItemFindMany = jest.fn().mockResolvedValue([
      item({
        qty: 1,
        unitPrice: 200,
        costPriceSnapshot: 100,
        noProduct: true,
        supplierIdSnapshot: 's7',
        supplierNameSnapshot: 'Silinen Ürünün Tedarikçisi',
      }),
    ]);
    const supplierFindMany = jest
      .fn()
      .mockResolvedValue([{ id: 's7', purchaseVatRate: 10 }]);
    const svc = new ProfitCalculatorService(
      makePrisma({ orderItemFindMany, supplierFindMany }),
    );

    const result = await svc.calculate('t1', FROM, TO);

    expect(result.bySupplier).toHaveLength(1);
    expect(result.bySupplier[0].supplierId).toBe('s7');
    expect(result.bySupplier[0].supplierName).toBe(
      'Silinen Ürünün Tedarikçisi',
    );
    // Snapshot tedarikçisinin KDV oranı (%10) uygulandı, varsayılan %20 değil.
    expect(result.totalCost).toBeCloseTo(110);
    expect(result.zeroCostItemCount).toBe(0);
  });

  it('falls back to "Ürün Silinmiş" only when no supplier can be resolved', async () => {
    // Ürün silinmiş, override yok, snapshot yok → atıf tamamen kayıp. Maliyet
    // yine costPriceSnapshot'tan (varsayılan KDV %20): 100 × 1.2 = 120.
    const orderItemFindMany = jest.fn().mockResolvedValue([
      item({
        qty: 1,
        unitPrice: 200,
        costPriceSnapshot: 100,
        noProduct: true,
      }),
    ]);
    const svc = new ProfitCalculatorService(makePrisma({ orderItemFindMany }));

    const result = await svc.calculate('t1', FROM, TO);

    expect(result.bySupplier).toHaveLength(1);
    expect(result.bySupplier[0].supplierName).toBe('Ürün Silinmiş');
    expect(result.totalCost).toBeCloseTo(120);
  });

  it('groups multiple items across suppliers and sorts by profit desc', async () => {
    const orderItemFindMany = jest.fn().mockResolvedValue([
      // Tedarikçi A: gelir 120, maliyet 0 → kâr 120
      item({
        qty: 1,
        unitPrice: 100,
        costPriceSnapshot: 0,
        supplierId: 'sA',
        supplierName: 'A',
        orderId: 'o1',
      }),
      // Tedarikçi B: gelir 1200, maliyet 600 → kâr 600
      item({
        qty: 1,
        unitPrice: 1000,
        costPriceSnapshot: 500,
        supplierId: 'sB',
        supplierName: 'B',
        orderId: 'o2',
      }),
    ]);
    const svc = new ProfitCalculatorService(makePrisma({ orderItemFindMany }));

    const result = await svc.calculate('t1', FROM, TO, {
      statuses: Z_REPORT_STATUSES,
    });

    expect(result.bySupplier).toHaveLength(2);
    expect(result.bySupplier[0].supplierName).toBe('B'); // en yüksek kâr önce
    expect(result.bySupplier[1].supplierName).toBe('A');
    expect(result.orderCount).toBe(2);
  });

  it('applies the supplier purchase VAT rate from the config map', async () => {
    // TEK KAYNAK: indirim artık costPrice'a gömülü; config'de yalnız alış KDV
    // oranı var. costPriceSnapshot 100, tedarikçi alış KDV %10 → 100 × 1.1 = 110.
    const orderItemFindMany = jest
      .fn()
      .mockResolvedValue([
        item({ qty: 1, unitPrice: 200, costPriceSnapshot: 100 }),
      ]);
    const supplierFindMany = jest
      .fn()
      .mockResolvedValue([{ id: 's1', purchaseVatRate: 10 }]);
    const svc = new ProfitCalculatorService(
      makePrisma({ orderItemFindMany, supplierFindMany }),
    );

    const result = await svc.calculate('t1', FROM, TO);

    expect(result.totalCost).toBeCloseTo(110);
  });
});

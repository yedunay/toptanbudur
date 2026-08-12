import { Prisma } from '@prisma/client';
import {
  buildBillingSnapshot,
  FreezeService,
  normalizePaymentType,
} from './freeze.service';
import { computeBatchPricing } from './pricing.engine';
import { startOfDayIstanbul } from './trt-date';

/** Decimal → number kısayolu. */
const n = (d: Prisma.Decimal): number => Number(d.toString());

/** Mock InvoiceBatch.create çağrısının şekli. */
interface CreatedBatch {
  data: Record<string, unknown>;
}

/** Test harness — taze mock'lar + servis örneği. */
function setup() {
  let batchSeq = 0;
  const created: CreatedBatch[] = [];
  const updateManyCalls: Array<{ where: any; data: any }> = [];
  let existingBatch: { id: string } | null = null;

  const tx = {
    invoiceBatch: {
      findUnique: jest.fn(async () => existingBatch),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        batchSeq += 1;
        created.push({ data });
        return {
          id: `batch-${batchSeq}`,
          birfaturaOrderId: BigInt(9_000_000_000 + batchSeq),
        };
      }),
    },
    order: {
      updateMany: jest.fn(async ({ where, data }: { where: any; data: any }) => {
        updateManyCalls.push({ where, data });
        return { count: where.id.in.length };
      }),
    },
  };

  const prisma = {
    order: { findMany: jest.fn(async (_args: { where: any }) => [] as unknown[]) },
    $transaction: jest.fn(async (cb: (t: typeof tx) => Promise<void>) => cb(tx)),
  };

  const settings = {
    getBoolean: jest.fn(async () => true),
    getNumber: jest.fn(async () => 25),
    getString: jest.fn(async () => '4.8'),
  };

  const audit = { log: jest.fn(async () => undefined) };

  const service = new FreezeService(
    prisma as never,
    settings as never,
    audit as never,
  );

  return {
    service,
    prisma,
    settings,
    audit,
    tx,
    created,
    updateManyCalls,
    setExistingBatch: (b: { id: string } | null) => {
      existingBatch = b;
    },
  };
}

type OrderOverrides = Partial<Record<string, unknown>>;

/** Uygun (kargolanmış-faturalanmamış) sipariş mock'u. */
function makeOrder(overrides: OrderOverrides = {}): Record<string, unknown> {
  const merged: Record<string, unknown> = {
    id: 'o1',
    tenantId: 'tenant-1',
    customerId: 'cust-1',
    paymentType: 'cari',
    humanOrderNo: 'AB-61000001',
    status: 'shipped',
    shippedAt: new Date('2026-06-01T08:00:00.000Z'),
    invoiceBatchId: null,
    items: [{ unitPrice: new Prisma.Decimal('80'), qty: 1 }],
    billingName: null,
    billingCompanyTitle: null,
    billingVergiNo: null,
    billingVergiDairesi: null,
    billingTcNo: null,
    billingEmail: null,
    billingPhone: null,
    billingMobilePhone: null,
    billingAddressLine: null,
    billingDistrict: null,
    billingCity: null,
    billingPostal: null,
    customer: {
      name: 'Test Bayi',
      companyTitle: null,
      vergiNo: null,
      vergiDairesi: null,
      tcKimlik: null,
      email: 'bayi@example.com',
      phone: null,
      contactPhone: null,
      contactEmail: null,
      companyAddress: null,
      invoicingEnabled: true,
    },
    ...overrides,
  };
  // Paketleme = 4.80 × adet (KDV hariç düz). Override yoksa final items'tan hesapla
  // → freeze fatura toplamı = bayinin ödediği; testte flat 4.80 ile birebir tutar.
  if (merged.packagingCost === undefined) {
    const totalQty = (merged.items as Array<{ qty: number }>).reduce(
      (a, it) => a + it.qty,
      0,
    );
    merged.packagingCost = new Prisma.Decimal((4.8 * totalQty).toFixed(2));
  }
  return merged;
}

/** Sabit tetik anı: 2026-06-25 11:00 TRT (= 08:00Z). */
const NOW = new Date('2026-06-25T08:00:00.000Z');

describe('normalizePaymentType (§6.2)', () => {
  it("'card' aynen kalır", () => {
    expect(normalizePaymentType('card')).toBe('card');
  });
  it("null/undefined/'cari'/bilinmeyen → 'cari'", () => {
    expect(normalizePaymentType(null)).toBe('cari');
    expect(normalizePaymentType(undefined)).toBe('cari');
    expect(normalizePaymentType('cari')).toBe('cari');
    expect(normalizePaymentType('eft')).toBe('cari');
  });
});

describe('buildBillingSnapshot (§5)', () => {
  const baseCustomer = {
    name: 'Ahmet Yılmaz',
    companyTitle: null,
    vergiNo: null,
    vergiDairesi: null,
    tcKimlik: null,
    email: 'ahmet@example.com',
    phone: '5550001122',
    contactPhone: null,
    contactEmail: null,
    companyAddress: 'Merkez Mah. No:1 İstanbul',
  };
  const emptyOrder = {
    billingName: null,
    billingCompanyTitle: null,
    billingVergiNo: null,
    billingVergiDairesi: null,
    billingTcNo: null,
    billingEmail: null,
    billingPhone: null,
    billingMobilePhone: null,
    billingAddressLine: null,
    billingDistrict: null,
    billingCity: null,
    billingPostal: null,
  };

  it('order snapshot doluysa öncelik order alanlarındadır', () => {
    const snap = buildBillingSnapshot(baseCustomer, {
      ...emptyOrder,
      billingName: 'Sipariş Üstü Ad',
      billingCity: 'Ankara',
      billingAddressLine: 'Sipariş adresi',
    });
    expect(snap.billingName).toBe('Sipariş Üstü Ad');
    expect(snap.billingCity).toBe('Ankara');
    expect(snap.billingAddressLine).toBe('Sipariş adresi');
  });

  it('order boşsa bireysel müşteride name fallback olur', () => {
    const snap = buildBillingSnapshot(baseCustomer, emptyOrder);
    expect(snap.billingName).toBe('Ahmet Yılmaz');
    expect(snap.billingAddressLine).toBe('Merkez Mah. No:1 İstanbul');
    expect(snap.billingPhone).toBe('5550001122');
  });

  it('kurumsal müşteride (vergiNo var) companyTitle fallback olur', () => {
    const snap = buildBillingSnapshot(
      {
        ...baseCustomer,
        companyTitle: 'ACME Ltd. Şti.',
        vergiNo: '1234567890',
        vergiDairesi: 'Kadıköy',
      },
      emptyOrder,
    );
    expect(snap.billingName).toBe('ACME Ltd. Şti.');
    expect(snap.billingVergiNo).toBe('1234567890');
    expect(snap.billingVergiDairesi).toBe('Kadıköy');
  });

  it('boş string ("") null\'a normalize edilir', () => {
    const snap = buildBillingSnapshot(
      { ...baseCustomer, companyAddress: '   ' },
      { ...emptyOrder, billingName: '  ', billingCity: '' },
    );
    expect(snap.billingCity).toBeNull();
    // billingName order boş → bireysel fallback (name).
    expect(snap.billingName).toBe('Ahmet Yılmaz');
    // companyAddress de boş → adres null.
    expect(snap.billingAddressLine).toBeNull();
  });
});

describe('FreezeService.runScheduledFreeze — cron guard (§12.3)', () => {
  it('konsolidasyon kapalıysa hiç sorgu yapmadan null döner', async () => {
    const t = setup();
    t.settings.getBoolean.mockResolvedValueOnce(false);

    const result = await t.service.runScheduledFreeze(NOW);

    expect(result).toBeNull();
    expect(t.prisma.order.findMany).not.toHaveBeenCalled();
  });

  it('bugün kesim günü değilse null döner (her gün 00:30 koşar)', async () => {
    const t = setup();
    t.settings.getNumber.mockResolvedValueOnce(10); // kesim 10, bugün TRT 25
    const result = await t.service.runScheduledFreeze(NOW);
    expect(result).toBeNull();
    expect(t.prisma.order.findMany).not.toHaveBeenCalled();
  });

  it('kesim günü + açıksa dondurmayı çalıştırır', async () => {
    const t = setup();
    t.prisma.order.findMany.mockResolvedValueOnce([makeOrder()]);
    const result = await t.service.runScheduledFreeze(NOW);
    expect(result).not.toBeNull();
    expect(t.prisma.order.findMany).toHaveBeenCalledTimes(1);
    expect(result?.trigger).toBe('cron');
  });
});

describe('FreezeService.freeze — uygunluk sorgusu (§4)', () => {
  it('where: shipped + shippedAt<=cutoff + invoiceBatchId null + invoicingEnabled', async () => {
    const t = setup();
    await t.service.freeze({ now: NOW, trigger: 'manual_all', actorId: 'admin' });

    const where = t.prisma.order.findMany.mock.calls[0][0].where;
    expect(where.status).toBe('shipped');
    expect(where.shippedAt).toEqual({ not: null, lte: NOW });
    expect(where.invoiceBatchId).toBeNull();
    expect(where.customer).toEqual({ is: { invoicingEnabled: true } });
  });

  it('uygun sipariş yoksa batchCount 0 + EMPTY audit', async () => {
    const t = setup();
    const result = await t.service.freeze({
      now: NOW,
      trigger: 'manual_all',
      actorId: 'admin',
    });
    expect(result.batchCount).toBe(0);
    expect(result.orderCount).toBe(0);
    expect(t.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'BIRFATURA_CONSOLIDATION_FREEZE_EMPTY',
      }),
    );
  });
});

describe('FreezeService.freeze — gruplama (§5)', () => {
  it('aynı bayi card + cari → iki ayrı batch, doğru paymentType', async () => {
    const t = setup();
    t.prisma.order.findMany.mockResolvedValueOnce([
      makeOrder({ id: 'o1', humanOrderNo: 'AB-1', paymentType: 'card' }),
      makeOrder({ id: 'o2', humanOrderNo: 'AB-2', paymentType: 'cari' }),
    ]);

    const result = await t.service.freeze({
      now: NOW,
      trigger: 'manual_all',
      actorId: 'admin',
    });

    expect(result.batchCount).toBe(2);
    const types = t.created.map((c) => c.data.paymentType).sort();
    expect(types).toEqual(['card', 'cari']);
  });

  it('iki farklı bayi → iki ayrı batch', async () => {
    const t = setup();
    t.prisma.order.findMany.mockResolvedValueOnce([
      makeOrder({ id: 'o1', customerId: 'cust-A', humanOrderNo: 'AB-1' }),
      makeOrder({ id: 'o2', customerId: 'cust-B', humanOrderNo: 'AB-2' }),
    ]);
    const result = await t.service.freeze({
      now: NOW,
      trigger: 'manual_all',
      actorId: 'admin',
    });
    expect(result.batchCount).toBe(2);
    expect(t.created.map((c) => c.data.customerId).sort()).toEqual([
      'cust-A',
      'cust-B',
    ]);
  });

  it("paymentType null → batch 'cari' olur", async () => {
    const t = setup();
    t.prisma.order.findMany.mockResolvedValueOnce([
      makeOrder({ paymentType: null }),
    ]);
    await t.service.freeze({ now: NOW, trigger: 'manual_all', actorId: 'admin' });
    expect(t.created[0].data.paymentType).toBe('cari');
  });
});

describe('FreezeService.freeze — batch içeriği (§2/§5)', () => {
  it('tutarlar §2 motoruyla birebir hesaplanır (çok kalemli grup)', async () => {
    const t = setup();
    t.prisma.order.findMany.mockResolvedValueOnce([
      makeOrder({
        id: 'o1',
        humanOrderNo: 'AB-1',
        items: [{ unitPrice: new Prisma.Decimal('80'), qty: 3 }],
      }),
      makeOrder({
        id: 'o2',
        humanOrderNo: 'AB-2',
        items: [{ unitPrice: new Prisma.Decimal('100'), qty: 2 }],
      }),
    ]);

    await t.service.freeze({ now: NOW, trigger: 'manual_all', actorId: 'admin' });

    const expected = computeBatchPricing(
      [
        { unitPrice: '80', qty: 3 },
        { unitPrice: '100', qty: 2 },
      ],
      '4.8',
    );
    const data = t.created[0].data;
    expect(n(data.productsTotalTaxExcluding as Prisma.Decimal)).toBeCloseTo(
      n(expected.productsTotalTaxExcluding),
      4,
    );
    expect(n(data.productsTotalTaxIncluding as Prisma.Decimal)).toBeCloseTo(
      n(expected.productsTotalTaxIncluding),
      4,
    );
    expect(n(data.totalPaidTaxIncluding as Prisma.Decimal)).toBeCloseTo(
      n(expected.totalPaidTaxIncluding),
      4,
    );
  });

  it("orderCode üye humanOrderNo'ları ', ' ile birleşir", async () => {
    const t = setup();
    t.prisma.order.findMany.mockResolvedValueOnce([
      makeOrder({ id: 'o1', humanOrderNo: 'AB-61000042' }),
      makeOrder({ id: 'o2', humanOrderNo: 'AB-61000043' }),
    ]);
    await t.service.freeze({ now: NOW, trigger: 'manual_all', actorId: 'admin' });
    expect(t.created[0].data.orderCode).toBe('AB-61000042, AB-61000043');
  });

  it('üye Order.invoiceBatchId set edilir (yalnız hâlâ bağlanmamışlar)', async () => {
    const t = setup();
    t.prisma.order.findMany.mockResolvedValueOnce([
      makeOrder({ id: 'o1', humanOrderNo: 'AB-1' }),
      makeOrder({ id: 'o2', humanOrderNo: 'AB-2' }),
    ]);
    const result = await t.service.freeze({
      now: NOW,
      trigger: 'manual_all',
      actorId: 'admin',
    });
    expect(t.updateManyCalls).toHaveLength(1);
    expect(t.updateManyCalls[0].where).toEqual({
      id: { in: ['o1', 'o2'] },
      invoiceBatchId: null,
    });
    expect(result.orderCount).toBe(2);
  });

  it('batch alanları: tenantId, period, status frozen, frozenAt, birfaturaOrderId', async () => {
    const t = setup();
    t.prisma.order.findMany.mockResolvedValueOnce([makeOrder()]);
    const result = await t.service.freeze({
      now: NOW,
      trigger: 'manual_all',
      actorId: 'admin',
    });

    const data = t.created[0].data;
    expect(data.tenantId).toBe('tenant-1');
    expect(data.status).toBe('frozen');
    expect(data.frozenAt).toBe(NOW);
    expect((data.periodEnd as Date).toISOString()).toBe(
      startOfDayIstanbul(NOW).toISOString(),
    );
    expect(result.periodEnd.toISOString()).toBe(
      startOfDayIstanbul(NOW).toISOString(),
    );
    expect(result.batches[0].birfaturaOrderId).toBe('9000000001');
  });
});

describe('FreezeService.freeze — idempotency (§5)', () => {
  it('dönem için batch zaten varsa atlar (create yok, skippedGroups artar)', async () => {
    const t = setup();
    t.setExistingBatch({ id: 'existing-batch' });
    t.prisma.order.findMany.mockResolvedValueOnce([makeOrder()]);

    const result = await t.service.freeze({
      now: NOW,
      trigger: 'cron',
      actorId: 'birfatura',
    });

    expect(t.tx.invoiceBatch.create).not.toHaveBeenCalled();
    expect(t.tx.order.updateMany).not.toHaveBeenCalled();
    expect(result.batchCount).toBe(0);
    expect(result.skippedGroups).toBe(1);
  });
});

describe('FreezeService — manuel tetik filtreleri', () => {
  it('freezeSingle yalnız o bayiyi sorgular (where.customerId = id)', async () => {
    const t = setup();
    await t.service.freezeSingle('cust-XYZ', 'admin-1');
    const where = t.prisma.order.findMany.mock.calls[0][0].where;
    expect(where.customerId).toBe('cust-XYZ');
  });

  it('freezeAll customerId-null olmayan tüm siparişleri sorgular', async () => {
    const t = setup();
    await t.service.freezeAll('admin-1');
    const where = t.prisma.order.findMany.mock.calls[0][0].where;
    expect(where.customerId).toEqual({ not: null });
  });
});

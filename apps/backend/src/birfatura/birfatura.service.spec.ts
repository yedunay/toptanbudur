import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BirfaturaService } from './birfatura.service';
import type { OrdersRequestDto } from './dto/orders-request.dto';
import type { InvoiceLinkDto } from './dto/invoice-link.dto';
import type { CargoUpdateDto } from './dto/cargo-update.dto';

/**
 * Faz 4 — `/api/orders/` mod seçimi (kill-switch / konsolide / legacy) ve
 * `/api/invoiceLinkUpdate/` batch çözümü + idempotency (birfatura.md §6 #3/#5).
 * Mock-harness; DB yok. fetchConsolidatedOrders gerçek `mapBatchToBirfaturaOrder`
 * ile entegre çalışır (saf fonksiyon).
 */

const ORDERS_ENABLED_KEY = 'birfatura.ordersEnabled';
const CONSOLIDATION_ENABLED_KEY = 'birfatura.consolidationEnabled';

/** Konsolide modda örnek donmuş batch satırı (mapper'ın beklediği şekil). */
function makeBatchRow(overrides: Record<string, unknown> = {}) {
  return {
    birfaturaOrderId: BigInt(9_000_000_007),
    periodEnd: new Date('2026-06-25T17:59:59.000Z'),
    paymentType: 'cari',
    billingName: 'Bayi A.Ş.',
    billingCompanyTitle: 'Bayi Anonim Şirketi',
    billingVergiNo: '1234567890',
    billingVergiDairesi: 'Kadıköy V.D.',
    billingTcNo: null,
    billingEmail: 'bayi@example.com',
    billingPhone: '02165551122',
    billingMobilePhone: '05321112233',
    billingAddressLine: 'Caferağa Mah. No:1',
    billingDistrict: 'Kadıköy',
    billingCity: 'İstanbul',
    productsTotalTaxExcluding: new Prisma.Decimal('80'),
    productsTotalTaxIncluding: new Prisma.Decimal('96'),
    totalPaidTaxExcluding: new Prisma.Decimal('84'),
    totalPaidTaxIncluding: new Prisma.Decimal('100.8'),
    orders: [
      {
        humanOrderNo: '61000001',
        items: [
          {
            productId: 'p1',
            productSlug: 'urun-1',
            productName: 'Ürün 1',
            unitPrice: new Prisma.Decimal('80'),
            qty: 1,
            product: {
              id: 'cuid-p1',
              internalCode: 'STK-001',
              publicBarcode: 'TBDR-1',
            },
          },
        ],
      },
    ],
    ...overrides,
  };
}

/** Test harness — taze mock'lar + servis örneği. */
function setup() {
  const settingsState = {
    booleans: {} as Record<string, boolean>,
    strings: {} as Record<string, string>,
  };

  // applyInvoiceLink akışı için durum (testler setter ile değiştirir).
  const state = {
    batchRow: null as { id: string; invoicedAt: Date | null } | null,
    batchUpdateCount: 1,
    memberUpdateCount: 1,
    legacyOrder: null as { id: string; humanOrderNo: string } | null,
    consolidatedBatches: [] as Record<string, unknown>[],
    legacyOrders: [] as Record<string, unknown>[],
  };

  const tx = {
    invoiceBatch: {
      updateMany: jest.fn(async () => ({ count: state.batchUpdateCount })),
    },
    order: {
      updateMany: jest.fn(async () => ({ count: state.memberUpdateCount })),
    },
  };

  const prisma = {
    invoiceBatch: {
      findMany: jest.fn(async () => state.consolidatedBatches),
      findUnique: jest.fn(async () => state.batchRow),
    },
    order: {
      findMany: jest.fn(async () => state.legacyOrders),
      findFirst: jest.fn(async () => state.legacyOrder),
      update: jest.fn(async () => ({})),
    },
    $transaction: jest.fn(async (cb: (t: typeof tx) => Promise<unknown>) =>
      cb(tx),
    ),
  };

  const settings = {
    getBoolean: jest.fn(async (key: string, def: boolean) =>
      key in settingsState.booleans ? settingsState.booleans[key] : def,
    ),
    getString: jest.fn(async (key: string, def: string) =>
      key in settingsState.strings ? settingsState.strings[key] : def,
    ),
  };

  const config = { get: jest.fn(() => undefined) };
  type AuditEntry = { action: string; metadata?: Record<string, unknown> };
  const audit = {
    log: jest.fn(async (_entry: AuditEntry) => undefined),
  };
  const exchangeRate = {
    getUsdToTry: jest.fn(async () => ({ rate: 33 })),
  };

  const service = new BirfaturaService(
    prisma as never,
    audit as never,
    settings as never,
    config as never,
    exchangeRate as never,
  );

  /** Belirli action'lı audit kaydını bul. */
  const auditCall = (action: string): AuditEntry | undefined =>
    audit.log.mock.calls.find((c) => c[0].action === action)?.[0];

  return {
    service,
    prisma,
    tx,
    audit,
    exchangeRate,
    state,
    auditCall,
    enable: (key: string, val: boolean) => {
      settingsState.booleans[key] = val;
    },
  };
}

const ordersDto: OrdersRequestDto = {
  orderStatusId: 2,
  startDateTime: '01.06.2026 00:00:00',
  endDateTime: '30.06.2026 23:59:59',
} as OrdersRequestDto;

describe('fetchOrders — Faz 0 kill-switch (birfatura.md §6 #3)', () => {
  it('ordersEnabled=false (varsayılan) → daima {Orders:[]}, DB sorgusu yok', async () => {
    const t = setup();

    const res = await t.service.fetchOrders(ordersDto);

    expect(res.Orders).toEqual([]);
    expect(t.prisma.invoiceBatch.findMany).not.toHaveBeenCalled();
    expect(t.prisma.order.findMany).not.toHaveBeenCalled();
    expect(t.auditCall('BIRFATURA_ORDERS_FETCH_DISABLED')).toBeDefined();
  });
});

describe('fetchOrders — mod seçimi (konsolide / legacy)', () => {
  it('ordersEnabled=true + consolidationEnabled=true → konsolide yol', async () => {
    const t = setup();
    t.enable(ORDERS_ENABLED_KEY, true);
    t.enable(CONSOLIDATION_ENABLED_KEY, true);
    t.state.consolidatedBatches = [];

    const res = await t.service.fetchOrders(ordersDto);

    expect(res.Orders).toEqual([]);
    expect(t.prisma.invoiceBatch.findMany).toHaveBeenCalledTimes(1);
    expect(t.prisma.order.findMany).not.toHaveBeenCalled();
    const a = t.auditCall('BIRFATURA_ORDERS_FETCH');
    expect(a?.metadata?.mode).toBe('consolidated');
    expect(a?.metadata?.returnedCount).toBe(0);
  });

  it('konsolide: donmuş batch → mapBatchToBirfaturaOrder ile eşlenir', async () => {
    const t = setup();
    t.enable(ORDERS_ENABLED_KEY, true);
    t.enable(CONSOLIDATION_ENABLED_KEY, true);
    t.state.consolidatedBatches = [makeBatchRow()];

    const res = await t.service.fetchOrders(ordersDto);

    expect(res.Orders).toHaveLength(1);
    const order = res.Orders[0];
    // Sentetik konsolide sipariş alanları (mapper entegrasyonu).
    expect(order.OrderId).toBe(9_000_000_007);
    expect(order.OrderCode).toEqual(expect.stringContaining('Toplu Fatura'));
    expect(order.SalesChannelWebSite).toBe('Toptan Budur');
    expect(order.PaymentTypeId).toBe(2); // cari
    // Yalnız 1 ürün satırı — ayrı Kargo Bedeli satırı YOK (paketleme matraha gömülü).
    expect(order.OrderDetails as unknown[]).toHaveLength(1);
    expect(t.auditCall('BIRFATURA_ORDERS_FETCH')?.metadata?.returnedCount).toBe(
      1,
    );
  });

  it('consolidationEnabled=false → legacy per-order yol (batch sorgusu yok)', async () => {
    const t = setup();
    t.enable(ORDERS_ENABLED_KEY, true);
    t.enable(CONSOLIDATION_ENABLED_KEY, false);
    t.state.legacyOrders = [];

    const res = await t.service.fetchOrders(ordersDto);

    expect(res.Orders).toEqual([]);
    expect(t.prisma.order.findMany).toHaveBeenCalledTimes(1);
    expect(t.prisma.invoiceBatch.findMany).not.toHaveBeenCalled();
    expect(t.auditCall('BIRFATURA_ORDERS_FETCH')?.metadata?.mode).toBe('legacy');
  });
});

describe('applyInvoiceLink — konsolide batch çözümü + idempotency (§6 #5)', () => {
  const linkDto: InvoiceLinkDto = {
    faturaUrl: 'https://birfatura.test/inv/abc.pdf',
    orderId: 9_000_000_007,
    faturaNo: 'AB2026000001',
    faturaTarihi: '25.06.2026 21:00:00',
  } as InvoiceLinkDto;

  it('batch bulundu, faturalanmamış → tek transaction’da batch + üyeler', async () => {
    const t = setup();
    t.state.batchRow = { id: 'batch-1', invoicedAt: null };
    t.state.batchUpdateCount = 1;
    t.state.memberUpdateCount = 3;

    const res = await t.service.applyInvoiceLink(linkDto);

    expect(res).toEqual({ success: true });
    expect(t.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(t.tx.invoiceBatch.updateMany).toHaveBeenCalledTimes(1);
    expect(t.tx.order.updateMany).toHaveBeenCalledTimes(1);
    const a = t.auditCall('BIRFATURA_INVOICE_LINK');
    expect(a?.metadata?.mode).toBe('consolidated');
    expect(a?.metadata?.memberCount).toBe(3);
  });

  it('batch zaten faturalı → idempotent no-op, transaction YOK, DUPLICATE audit', async () => {
    const t = setup();
    t.state.batchRow = {
      id: 'batch-1',
      invoicedAt: new Date('2026-06-25T18:00:00.000Z'),
    };

    const res = await t.service.applyInvoiceLink(linkDto);

    expect(res).toEqual({ success: true });
    expect(t.prisma.$transaction).not.toHaveBeenCalled();
    const a = t.auditCall('BIRFATURA_INVOICE_LINK_DUPLICATE');
    expect(a?.metadata?.reason).toBe('batch already invoiced');
    expect(t.auditCall('BIRFATURA_INVOICE_LINK')).toBeUndefined();
  });

  it('yarış: updateMany count=0 → üye propagate YOK, DUPLICATE audit', async () => {
    const t = setup();
    t.state.batchRow = { id: 'batch-1', invoicedAt: null };
    t.state.batchUpdateCount = 0; // başkası önce faturaladı

    const res = await t.service.applyInvoiceLink(linkDto);

    expect(res).toEqual({ success: true });
    expect(t.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(t.tx.order.updateMany).not.toHaveBeenCalled();
    const a = t.auditCall('BIRFATURA_INVOICE_LINK_DUPLICATE');
    expect(a?.metadata?.reason).toBe('batch invoiced concurrently');
  });
});

describe('applyInvoiceLink — legacy fallback (batch yok)', () => {
  const legacyLinkDto: InvoiceLinkDto = {
    faturaUrl: 'https://birfatura.test/inv/legacy.pdf',
    orderId: 61_000_001,
    faturaNo: 'AB2026000099',
  } as InvoiceLinkDto;

  it('batch yok ama order var → per-order güncelle + legacy audit', async () => {
    const t = setup();
    t.state.batchRow = null;
    t.state.legacyOrder = { id: 'o1', humanOrderNo: '61000001' };

    const res = await t.service.applyInvoiceLink(legacyLinkDto);

    expect(res).toEqual({ success: true });
    expect(t.prisma.order.update).toHaveBeenCalledTimes(1);
    expect(t.prisma.$transaction).not.toHaveBeenCalled();
    const a = t.auditCall('BIRFATURA_INVOICE_LINK');
    expect(a?.metadata?.mode).toBe('legacy');
    expect(a?.metadata?.humanOrderNo).toBe('61000001');
  });

  it('batch yok, order yok → NotFoundException', async () => {
    const t = setup();
    t.state.batchRow = null;
    t.state.legacyOrder = null;

    await expect(t.service.applyInvoiceLink(legacyLinkDto)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('geçersiz faturaTarihi → bugüne düşer (parse hatası yutulur), yine de faturalanır', async () => {
    const t = setup();
    t.state.batchRow = null;
    t.state.legacyOrder = { id: 'o1', humanOrderNo: '61000001' };

    const res = await t.service.applyInvoiceLink({
      ...legacyLinkDto,
      faturaTarihi: 'gecersiz-tarih',
    } as InvoiceLinkDto);

    expect(res).toEqual({ success: true });
    expect(t.prisma.order.update).toHaveBeenCalledTimes(1);
  });
});

describe('applyCargoUpdate — konsolide batch no-op + legacy (§6 #4)', () => {
  const cargoDto: CargoUpdateDto = {
    orderId: 9_000_000_007,
    orderStatusId: 3,
    cargoTrackingCode: 'YK1234567890',
    cargoCompany: 'Yurtiçi Kargo',
  } as CargoUpdateDto;

  it('batch eşleşti → no-op + audit, üye Order’a DOKUNMAZ', async () => {
    const t = setup();
    t.state.batchRow = { id: 'batch-1', invoicedAt: null };

    const res = await t.service.applyCargoUpdate(cargoDto);

    expect(res).toEqual({ success: true });
    // Toplu fatura kargoyla ilerlemez: ne legacy lookup ne order.update.
    expect(t.prisma.order.findFirst).not.toHaveBeenCalled();
    expect(t.prisma.order.update).not.toHaveBeenCalled();
    const a = t.auditCall('BIRFATURA_CARGO_UPDATE_NOOP');
    expect(a?.metadata?.reason).toBe(
      'consolidated batch — cargo managed at order level',
    );
    // Yanlışlıkla legacy başarı audit'i atılmamalı.
    expect(t.auditCall('BIRFATURA_CARGO_UPDATE')).toBeUndefined();
  });

  it('batch yok ama order var → legacy per-order kargo güncelle + audit', async () => {
    const t = setup();
    t.state.batchRow = null;
    t.state.legacyOrder = { id: 'o1', humanOrderNo: '61000001' };

    const res = await t.service.applyCargoUpdate({
      ...cargoDto,
      orderId: 61_000_001,
    } as CargoUpdateDto);

    expect(res).toEqual({ success: true });
    expect(t.prisma.order.update).toHaveBeenCalledTimes(1);
    const a = t.auditCall('BIRFATURA_CARGO_UPDATE');
    expect(a?.metadata?.mode).toBe('legacy');
    expect(a?.metadata?.humanOrderNo).toBe('61000001');
    expect(t.auditCall('BIRFATURA_CARGO_UPDATE_NOOP')).toBeUndefined();
  });

  it('batch yok, order yok → NotFoundException', async () => {
    const t = setup();
    t.state.batchRow = null;
    t.state.legacyOrder = null;

    await expect(
      t.service.applyCargoUpdate({
        ...cargoDto,
        orderId: 61_000_999,
      } as CargoUpdateDto),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

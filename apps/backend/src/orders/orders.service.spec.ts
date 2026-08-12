import { ForbiddenException, HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHmac } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { OrdersService } from './orders.service';
import type { OrderNumberService } from './order-number.service';
import type { MailService } from '../mail/mail.service';
import type { AdminNotifierService } from '../mail/admin-notifier.service';
import type { AppSettingsService } from '../app-settings/app-settings.service';
import type { CariBalanceService } from '../cari-balance/cari-balance.service';
import type { IFileStorage } from '../storage/storage.interface';
import type { NotificationsService } from '../notifications/notifications.service';
import type { ConversationsService } from '../conversations/conversations.service';
import type { HouseStockService } from '../house-stock/house-stock.service';
import type { ReceiptsService } from '../receipts/receipts.service';
import type { BasitKargoService } from '../basitkargo/basitkargo.service';

process.env.ORDER_TOKEN_SECRET =
  process.env.ORDER_TOKEN_SECRET ??
  'test-secret-test-secret-test-secret-32+chars';

interface FakeProduct {
  id: string;
  slug: string;
  name: string;
  price: Prisma.Decimal;
  currency: string;
  stock: number;
}

interface UpdateManyWhere {
  id: string;
  stock?: { gte: number };
}
interface UpdateManyData {
  stock?: { decrement: number };
}

interface PrismaMock {
  prisma: PrismaService;
  orderNumber: OrderNumberService;
  mail: MailService;
  cariBalance: CariBalanceService;
  adminNotifier: AdminNotifierService;
  appSettings: AppSettingsService;
  notifications: NotificationsService;
  conversations: ConversationsService;
  houseStock: HouseStockService;
  receipts: ReceiptsService;
  basitKargo: BasitKargoService;
  storage: IFileStorage;
  txOrderCreate: jest.Mock;
  txProductUpdateMany: jest.Mock;
}

function buildPrismaMock(opts: {
  tenant: { id: string } | null;
  products: FakeProduct[];
}): PrismaMock {
  const products = opts.products;
  const txProductUpdateMany = jest.fn(
    (args: { where: UpdateManyWhere; data: UpdateManyData }) => {
      const target = products.find((p) => p.id === args.where.id);
      if (!target) return Promise.resolve({ count: 0 });
      const need = args.where.stock?.gte ?? 0;
      if (target.stock < need) return Promise.resolve({ count: 0 });
      target.stock -= args.data.stock?.decrement ?? 0;
      return Promise.resolve({ count: 1 });
    },
  );

  const txOrderCreate = jest.fn(
    (args: {
      data: {
        total: Prisma.Decimal;
        subtotal?: Prisma.Decimal;
        kdvAmount?: Prisma.Decimal;
        kdvRate?: number;
        packagingCost?: Prisma.Decimal;
        packagingUnitFee?: Prisma.Decimal;
        currency: string;
        status: string;
      };
    }) =>
      Promise.resolve({
        id: '11111111-1111-4111-8111-111111111111',
        total: args.data.total,
        subtotal: args.data.subtotal ?? null,
        kdvAmount: args.data.kdvAmount ?? null,
        kdvRate: args.data.kdvRate ?? null,
        packagingCost: args.data.packagingCost ?? null,
        packagingUnitFee: args.data.packagingUnitFee ?? null,
        currency: args.data.currency,
        status: args.data.status,
      }),
  );

  interface TxClient {
    product: {
      findMany: jest.Mock;
      updateMany: jest.Mock;
    };
    order: { create: jest.Mock };
    posProvider: { findFirst: jest.Mock };
  }

  const tx: TxClient = {
    product: {
      findMany: jest.fn().mockResolvedValue(products),
      updateMany: txProductUpdateMany,
    },
    order: { create: txOrderCreate },
    // Kart ödeme yolu aktif bir POS arar (komisyon snapshot'ı için). Komisyon
    // oranı null → ek komisyon eklenmez; mevcut total beklentileri korunur.
    posProvider: {
      findFirst: jest.fn().mockResolvedValue({ customerCommissionRate: null }),
    },
  };

  const prisma = {
    tenant: { findUnique: jest.fn().mockResolvedValue(opts.tenant) },
    customer: { findUnique: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn((cb: (tx: TxClient) => unknown) =>
      Promise.resolve(cb(tx)),
    ),
  } as unknown as PrismaService;

  const orderNumber = {
    generateHumanOrderNo: jest.fn().mockResolvedValue('61000001'),
  } as unknown as OrderNumberService;

  const mail = {
    sendOrderConfirmation: jest.fn().mockResolvedValue(undefined),
  } as unknown as MailService;

  const cariBalance = {
    debitForOrderTx: jest.fn().mockResolvedValue({
      ledgerId: 'ledger-1',
      newBalance: new Prisma.Decimal(0),
    }),
  } as unknown as CariBalanceService;

  const storage = {
    upload: jest.fn().mockResolvedValue({
      url: '/api/storage/order-pdfs/temp-x/file.pdf?exp=1&sig=x',
      key: 'order-pdfs/temp-x/file.pdf',
    }),
    getSignedUrl: jest
      .fn()
      .mockResolvedValue(
        '/api/storage/order-pdfs/temp-x/file.pdf?exp=2&sig=y',
      ),
    read: jest.fn(),
    delete: jest.fn(),
  } as unknown as IFileStorage;

  const adminNotifier = {
    resolveAdminEmails: jest.fn().mockResolvedValue([]),
    resolveDefaultTenantId: jest.fn().mockResolvedValue(null),
    notifyAdmins: jest.fn().mockResolvedValue(undefined),
  } as unknown as AdminNotifierService;

  const appSettings = {
    getDecimal: jest.fn().mockImplementation(
      (_key: string, fallback: number) => Promise.resolve(new Prisma.Decimal(fallback)),
    ),
  } as unknown as AppSettingsService;

  const notifications = {
    emit: jest.fn().mockResolvedValue(undefined),
  } as unknown as NotificationsService;

  const conversations = {
    getOrCreateForReturnOrder: jest.fn().mockResolvedValue({ id: 'conv-1' }),
  } as unknown as ConversationsService;

  const houseStock = {
    reserveForOrder: jest.fn().mockResolvedValue(undefined),
  } as unknown as HouseStockService;

  // Makbuz üretimi post-commit best-effort çağrılır; testte no-op yeterli.
  const receipts = {
    createForOrder: jest.fn().mockResolvedValue(null),
  } as unknown as ReceiptsService;

  // "Kendim İçin" (self) paid-hook'unda çağrılır; testte no-op yeterli.
  const basitKargo = {
    fulfillSelfOrder: jest.fn().mockResolvedValue(undefined),
  } as unknown as BasitKargoService;

  return {
    prisma,
    orderNumber,
    mail,
    cariBalance,
    adminNotifier,
    appSettings,
    notifications,
    conversations,
    houseStock,
    receipts,
    basitKargo,
    storage,
    txOrderCreate,
    txProductUpdateMany,
  };
}

const baseCustomer = {
  name: 'Ali',
  email: 'ali@example.com',
  phone: '+905550000000',
  address: {
    line1: 'Ataturk Cad. 1',
    city: 'Istanbul',
    postalCode: '34000',
    country: 'TR',
  },
};

const baseShipping = {
  cargoCompany: 'ARAS' as const,
  cargoBarcode: 'TEST1234',
  marketplace: 'other' as const,
  endCustomerName: 'Son Musteri',
};

describe('OrdersService.create', () => {
  it('creates an order with backend-computed total (happy path)', async () => {
    const mock = buildPrismaMock({
      tenant: { id: 't1' },
      products: [
        {
          id: 'p1',
          slug: 'foo',
          name: 'Foo',
          price: new Prisma.Decimal('100.00'),
          currency: 'TRY',
          stock: 10,
        },
      ],
    });
    const svc = new OrdersService(mock.prisma, mock.orderNumber, mock.mail, mock.cariBalance, mock.adminNotifier, mock.appSettings, mock.notifications, mock.conversations, mock.houseStock, mock.receipts, mock.basitKargo, mock.storage);
    const result = await svc.create({
      tenantSlug: 'demo',
      items: [{ productSlug: 'foo', qty: 2 }],
      customer: baseCustomer,
      ...baseShipping,
    });

    // Default payment method is `card`, so the order is born `awaiting_payment`
    // and only flips to `paid` after confirmCardPayment (POS akışı). Cari
    // ödemede sipariş aynı transaction'da tahsil edilip doğrudan `paid` doğar.
    expect(result.status).toBe('awaiting_payment');
    expect(result.currency).toBe('TRY');
    // 100 TL × 2 = 200 (subtotal) + %20 KDV = 40 + paketleme 2 × 4.80 = 9.60 → total 249.60.
    expect(result.subtotal).toBe(200);
    expect(result.kdvAmount).toBe(40);
    expect(result.kdvRate).toBe(20);
    expect(result.packagingUnitFee).toBe(4.8);
    expect(result.packagingCost).toBe(9.6);
    expect(result.total).toBe(249.6);
    expect(result.discountPercent).toBe(0);
    expect(mock.txOrderCreate).toHaveBeenCalledTimes(1);
    expect(mock.txProductUpdateMany).toHaveBeenCalledTimes(1);
  });

  it('uses runtime packagingUnitFee from AppSettings (not the 4.80 fallback)', async () => {
    const mock = buildPrismaMock({
      tenant: { id: 't1' },
      products: [
        {
          id: 'p1',
          slug: 'foo',
          name: 'Foo',
          price: new Prisma.Decimal('100.00'),
          currency: 'TRY',
          stock: 10,
        },
      ],
    });
    // Admin set the per-unit fee to 6.50 — backend must respect it.
    (mock.appSettings.getDecimal as jest.Mock).mockResolvedValueOnce(
      new Prisma.Decimal('6.50'),
    );
    const svc = new OrdersService(
      mock.prisma,
      mock.orderNumber,
      mock.mail,
      mock.cariBalance,
      mock.adminNotifier,
      mock.appSettings,
      mock.notifications,
      mock.conversations,
      mock.houseStock,
      mock.receipts,
      mock.basitKargo,
      mock.storage,
    );
    const result = await svc.create({
      tenantSlug: 'demo',
      items: [{ productSlug: 'foo', qty: 3 }],
      customer: baseCustomer,
      ...baseShipping,
    });

    // subtotal 300 + KDV 60 + paketleme 3 × 6.50 = 19.50 → total 379.50.
    expect(result.packagingUnitFee).toBe(6.5);
    expect(result.packagingCost).toBe(19.5);
    expect(result.total).toBe(379.5);
  });

  it('snapshots packagingUnitFee onto the Order row (so admin changes do not affect history)', async () => {
    const mock = buildPrismaMock({
      tenant: { id: 't1' },
      products: [
        {
          id: 'p1',
          slug: 'foo',
          name: 'Foo',
          price: new Prisma.Decimal('50.00'),
          currency: 'TRY',
          stock: 4,
        },
      ],
    });
    const svc = new OrdersService(
      mock.prisma,
      mock.orderNumber,
      mock.mail,
      mock.cariBalance,
      mock.adminNotifier,
      mock.appSettings,
      mock.notifications,
      mock.conversations,
      mock.houseStock,
      mock.receipts,
      mock.basitKargo,
      mock.storage,
    );
    await svc.create({
      tenantSlug: 'demo',
      items: [{ productSlug: 'foo', qty: 2 }],
      customer: baseCustomer,
      ...baseShipping,
    });

    const created = mock.txOrderCreate.mock.calls[0][0] as {
      data: {
        packagingCost: Prisma.Decimal;
        packagingUnitFee: Prisma.Decimal;
      };
    };
    expect(created.data.packagingUnitFee.toString()).toBe('4.8');
    expect(created.data.packagingCost.toString()).toBe('9.6');
  });

  it('returns 422 with insufficient list when stock is too low', async () => {
    const mock = buildPrismaMock({
      tenant: { id: 't1' },
      products: [
        {
          id: 'p1',
          slug: 'foo',
          name: 'Foo',
          price: new Prisma.Decimal('100.00'),
          currency: 'TRY',
          stock: 1,
        },
      ],
    });
    const svc = new OrdersService(mock.prisma, mock.orderNumber, mock.mail, mock.cariBalance, mock.adminNotifier, mock.appSettings, mock.notifications, mock.conversations, mock.houseStock, mock.receipts, mock.basitKargo, mock.storage);
    await expect(
      svc.create({
        tenantSlug: 'demo',
        items: [{ productSlug: 'foo', qty: 5 }],
        customer: baseCustomer,
        ...baseShipping,
      }),
    ).rejects.toMatchObject({
      response: {
        message: 'insufficient stock',
        insufficient: [{ slug: 'foo', available: 1 }],
      },
    });
    expect(mock.txOrderCreate).not.toHaveBeenCalled();
  });

  it('throws when tenant not found', async () => {
    const mock = buildPrismaMock({ tenant: null, products: [] });
    const svc = new OrdersService(mock.prisma, mock.orderNumber, mock.mail, mock.cariBalance, mock.adminNotifier, mock.appSettings, mock.notifications, mock.conversations, mock.houseStock, mock.receipts, mock.basitKargo, mock.storage);
    await expect(
      svc.create({
        tenantSlug: 'nope',
        items: [{ productSlug: 'foo', qty: 1 }],
        customer: baseCustomer,
        ...baseShipping,
      }),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it('mints kid-prefixed token in the new keyset format', async () => {
    const mock = buildPrismaMock({
      tenant: { id: 't1' },
      products: [
        {
          id: 'p1',
          slug: 'foo',
          name: 'Foo',
          price: new Prisma.Decimal('10.00'),
          currency: 'TRY',
          stock: 5,
        },
      ],
    });
    const svc = new OrdersService(
      mock.prisma,
      mock.orderNumber,
      mock.mail,
      mock.cariBalance,
      mock.adminNotifier,
      mock.appSettings,
      mock.notifications,
      mock.conversations,
      mock.houseStock,
      mock.receipts,
      mock.basitKargo,
      mock.storage,
    );
    const result = (await svc.create({
      tenantSlug: 'demo',
      items: [{ productSlug: 'foo', qty: 1 }],
      customer: baseCustomer,
      ...baseShipping,
    })) as { token: string };
    // Default (legacy) config produces a v1.<sig> token.
    expect(result.token).toMatch(/^v1\.[0-9a-f]{64}$/);
  });
});

describe('OrdersService.getById token verification (kid rotation)', () => {
  const ORDER_ID = '11111111-1111-4111-8111-111111111111';
  const PRODUCT = {
    id: 'p1',
    slug: 'foo',
    name: 'Foo',
    price: new Prisma.Decimal('10.00'),
    currency: 'TRY',
    stock: 5,
  };

  function buildSvcWithExistingOrder() {
    const mock = buildPrismaMock({ tenant: { id: 't1' }, products: [PRODUCT] });
    // Wire prisma.order.findUnique → return an order matching ORDER_ID.
    (mock.prisma as unknown as {
      order: { findUnique: jest.Mock };
    }).order = {
      findUnique: jest.fn().mockResolvedValue({
        id: ORDER_ID,
        status: 'pending',
        total: new Prisma.Decimal('10'),
        subtotal: new Prisma.Decimal('10'),
        kdvAmount: new Prisma.Decimal('0'),
        kdvRate: 20,
        currency: 'TRY',
        customerName: 'Ali',
        customerEmail: 'ali@example.com',
        customerPhone: '+905550000000',
        addressLine1: 'a',
        addressCity: 'b',
        addressPostal: '34000',
        addressCountry: 'TR',
        createdAt: new Date(),
        items: [],
      }),
    };
    return new OrdersService(
      mock.prisma,
      mock.orderNumber,
      mock.mail,
      mock.cariBalance,
      mock.adminNotifier,
      mock.appSettings,
      mock.notifications,
      mock.conversations,
      mock.houseStock,
      mock.receipts,
      mock.basitKargo,
      mock.storage,
    );
  }

  function hmac(secret: string, msg: string): string {
    return createHmac('sha256', secret).update(msg).digest('hex');
  }

  // Reset memoized keyset between scenarios by mutating env then forcing re-read.
  // The implementation invalidates its own cache when the env fingerprint changes.
  afterEach(() => {
    delete process.env.ORDER_TOKEN_KEYS;
    delete process.env.ORDER_TOKEN_ACTIVE_KID;
    process.env.ORDER_TOKEN_SECRET =
      'test-secret-test-secret-test-secret-32+chars';
  });

  it('verifies a token signed by the active kid (v2)', async () => {
    process.env.ORDER_TOKEN_KEYS =
      'v1:old-secret-old-secret-old-secret-32chars,v2:new-secret-new-secret-new-secret-32chars';
    process.env.ORDER_TOKEN_ACTIVE_KID = 'v2';
    const svc = buildSvcWithExistingOrder();
    const sig = hmac('new-secret-new-secret-new-secret-32chars', ORDER_ID);
    const token = `v2.${sig}`;
    await expect(svc.getById(ORDER_ID, token)).resolves.toBeDefined();
  });

  it('verifies tokens still signed under retired kid (v1) for grace period', async () => {
    process.env.ORDER_TOKEN_KEYS =
      'v1:old-secret-old-secret-old-secret-32chars,v2:new-secret-new-secret-new-secret-32chars';
    process.env.ORDER_TOKEN_ACTIVE_KID = 'v2';
    const svc = buildSvcWithExistingOrder();
    const sig = hmac('old-secret-old-secret-old-secret-32chars', ORDER_ID);
    const token = `v1.${sig}`;
    await expect(svc.getById(ORDER_ID, token)).resolves.toBeDefined();
  });

  it('rejects token with unknown kid', async () => {
    process.env.ORDER_TOKEN_KEYS =
      'v1:old-secret-old-secret-old-secret-32chars,v2:new-secret-new-secret-new-secret-32chars';
    process.env.ORDER_TOKEN_ACTIVE_KID = 'v2';
    const svc = buildSvcWithExistingOrder();
    const sig = hmac('any-secret-any-secret-any-secret-32chars', ORDER_ID);
    const token = `v9.${sig}`;
    await expect(svc.getById(ORDER_ID, token)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('rejects token with valid kid but tampered signature', async () => {
    process.env.ORDER_TOKEN_KEYS =
      'v1:old-secret-old-secret-old-secret-32chars';
    process.env.ORDER_TOKEN_ACTIVE_KID = 'v1';
    const svc = buildSvcWithExistingOrder();
    const sig = hmac('different-secret-different-secret-32', ORDER_ID);
    const token = `v1.${sig}`;
    await expect(svc.getById(ORDER_ID, token)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('accepts legacy unprefixed token when ORDER_TOKEN_SECRET is set (back-compat)', async () => {
    delete process.env.ORDER_TOKEN_KEYS;
    delete process.env.ORDER_TOKEN_ACTIVE_KID;
    const legacy = 'legacy-secret-legacy-secret-legacy-secret-32';
    process.env.ORDER_TOKEN_SECRET = legacy;
    const svc = buildSvcWithExistingOrder();
    const token = hmac(legacy, ORDER_ID); // no kid prefix
    await expect(svc.getById(ORDER_ID, token)).resolves.toBeDefined();
  });
});

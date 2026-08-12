import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { CariBalanceService } from '../../cari-balance/cari-balance.service';
import { AppSettingsService } from '../../app-settings/app-settings.service';
import { MailService } from '../../mail/mail.service';
import type { IFileStorage } from '../../storage/storage.interface';
import { AdminOrdersService } from './admin-orders.service';

type LedgerEntry = { type: 'ORDER_PAYMENT' | 'REFUND'; amount: string };

const makePrisma = (
  overrides: Record<string, unknown> = {},
  ledgerEntries: LedgerEntry[] = [],
) => {
  const order = {
    count: jest.fn().mockResolvedValue(0),
    findMany: jest.fn().mockResolvedValue([]),
    findFirst: jest.fn().mockResolvedValue(null),
    findUnique: jest.fn().mockResolvedValue(null),
    aggregate: jest.fn().mockResolvedValue({
      _sum: { total: null },
      _count: { _all: 0 },
    }),
    groupBy: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockResolvedValue({}),
    ...overrides,
  };
  const productUpdate = jest.fn().mockResolvedValue({});
  const cariLedgerFindMany = jest.fn().mockResolvedValue(ledgerEntries);
  // Tedarikçi bakiye iadesi (D.3): cancel akışı tx.supplierAccountLedger.findMany
  // ile ORDER_PURCHASE tedarikçilerini arar. Varsayılan boş → refund loop no-op,
  // mevcut cari testleri davranışını değiştirmez.
  const supplierAccountLedgerFindMany = jest.fn().mockResolvedValue([]);
  const tx = {
    order,
    product: { update: productUpdate },
    cariLedger: { findMany: cariLedgerFindMany },
    supplierAccountLedger: { findMany: supplierAccountLedgerFindMany },
    // İptal/iade'de siparişe bağlı kredi kartı makbuzu silinir (§orta).
    paymentReceipt: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
  };
  return {
    prisma: {
      order,
      $transaction: jest.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    } as unknown as PrismaService,
    productUpdate,
    cariLedgerFindMany,
    supplierAccountLedgerFindMany,
    tx,
  };
};

const makeAudit = () =>
  ({ log: jest.fn().mockResolvedValue(undefined) }) as unknown as AuditService;

const makeCari = () =>
  ({
    refundForOrderTx: jest.fn().mockResolvedValue({
      ledgerId: 'l1',
      previousBalance: 0,
      newBalance: 0,
    }),
    // İade penceresi toplamı — testler refund yok senaryosu kurar → 0.
    refundTotalInWindow: jest.fn().mockResolvedValue(0),
    refundTotalsByCustomer: jest.fn().mockResolvedValue(new Map<string, number>()),
  }) as unknown as CariBalanceService;

const makeSettings = () =>
  ({
    getNumber: jest.fn().mockResolvedValue(144),
    getDecimal: jest.fn().mockImplementation(async (_k: string, fb: unknown) => fb),
    getBoolean: jest.fn().mockResolvedValue(false),
    getString: jest.fn().mockResolvedValue(''),
  }) as unknown as AppSettingsService;

const makeMail = () =>
  ({ sendOrderStatusChanged: jest.fn().mockResolvedValue(undefined) }) as unknown as MailService;

const makeSupplierAccount = () =>
  ({
    refundForOrderTx: jest
      .fn()
      .mockResolvedValue({ skipped: true, reason: 'no-purchase' }),
    deductForOrderTx: jest.fn().mockResolvedValue(undefined),
    maybeNotifyLowBalance: jest.fn().mockResolvedValue(undefined),
  }) as unknown as import('../../supplier-account/supplier-account.service').SupplierAccountService;

const makeStorage = (): IFileStorage =>
  ({
    upload: jest.fn(),
    getSignedUrl: jest.fn().mockResolvedValue('https://example.test/signed'),
    read: jest.fn(),
    delete: jest.fn(),
  }) as unknown as IFileStorage;

const actor = { id: 'admin1', tenantId: 't1' };

describe('AdminOrdersService', () => {
  describe('list', () => {
    it('returns empty data with meta when no orders', async () => {
      const svc = new AdminOrdersService(makePrisma().prisma, makeAudit(), makeCari(), makeSettings(), makeMail(), makeSupplierAccount(), makeStorage());
      const result = await svc.list('t1', {});
      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
      expect(result.meta.total).toBe(0);
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException when order not in tenant', async () => {
      const svc = new AdminOrdersService(makePrisma().prisma, makeAudit(), makeCari(), makeSettings(), makeMail(), makeSupplierAccount(), makeStorage());
      await expect(svc.findOne('t1', 'nonexistent')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    // Destek talebi drawer'ı (TicketOrderPanel) kalem thumbnail'ini bu uçtan
    // okur — ilk ürün görseli imageUrl olarak dönmeli, ürünü silinmiş kalemde null.
    it('returns per-item imageUrl from first product image; null when product is gone', async () => {
      const baseItem = {
        productSlug: null,
        productName: 'Ürün',
        unitPrice: '100',
        unitPriceOriginal: null,
        discountPercent: null,
        qty: 1,
        supplierSku: null,
        supplierBarcode: null,
        supplierIdOverride: null,
        supplierOrderNo: null,
        supplierOverride: null,
      };
      const orderRow = {
        id: 'o1',
        status: 'paid',
        total: '100',
        subtotal: null,
        kdvAmount: null,
        kdvRate: null,
        packagingCost: null,
        packagingUnitFee: null,
        cargoCost: null,
        paymentType: null,
        cardCommissionRate: null,
        cardCommissionAmount: null,
        posProviderKey: null,
        currency: 'TRY',
        humanOrderNo: 'SIP-1',
        marketplace: null,
        cargoCompany: null,
        cargoBarcode: null,
        supplierOrderNo: null,
        customerName: 'Bayi A',
        customerEmail: 'a@b.c',
        customerPhone: null,
        endCustomerName: null,
        addressLine1: null,
        addressCity: null,
        addressPostal: null,
        addressCountry: null,
        billingName: null,
        billingAddressLine: null,
        billingDistrict: null,
        billingCity: null,
        billingPostal: null,
        trackingNumber: null,
        notes: null,
        pdfUrl: null,
        pdfKey: null,
        pdfPurgedAt: null,
        createdAt: new Date('2026-07-01T00:00:00Z'),
        updatedAt: new Date('2026-07-01T00:00:00Z'),
        invoicedAt: null,
        invoiceBatchId: null,
        invoiceBatch: null,
        customer: { id: 'c1', email: 'a@b.c', name: 'Bayi A' },
        customerId: 'c1',
        supportMessages: [],
        trackingEvents: [],
        items: [
          {
            ...baseItem,
            id: 'i1',
            productId: 'p1',
            product: {
              supplier: {
                id: 's1',
                name: 'Tedarikçi A',
                mandatoryCarriers: [],
                requiresPdf: false,
                leadTimeDays: null,
              },
              images: [{ url: 'https://cdn.example/img1.jpg' }],
            },
          },
          { ...baseItem, id: 'i2', productId: null, product: null },
        ],
      };
      const base = makePrisma({
        findFirst: jest.fn().mockResolvedValue(orderRow),
      });
      const prisma = {
        ...(base.prisma as unknown as Record<string, unknown>),
        cheaperSupplierHint: { findMany: jest.fn().mockResolvedValue([]) },
      } as unknown as PrismaService;
      const svc = new AdminOrdersService(prisma, makeAudit(), makeCari(), makeSettings(), makeMail(), makeSupplierAccount(), makeStorage());
      const res = await svc.findOne('t1', 'o1');
      expect(res.data.items[0].imageUrl).toBe('https://cdn.example/img1.jpg');
      expect(res.data.items[1].imageUrl).toBeNull();
    });
  });

  describe('updateOrder', () => {
    it('throws NotFoundException when order not found', async () => {
      const svc = new AdminOrdersService(makePrisma().prisma, makeAudit(), makeCari(), makeSettings(), makeMail(), makeSupplierAccount(), makeStorage());
      await expect(
        svc.updateOrder('t1', 'bad-id', { status: 'shipped' }, actor),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    describe('cari refund on cancel (B1: ledger-based)', () => {
      const baseExisting = {
        id: 'o1',
        status: 'pending',
        total: '100.00',
        customerId: 'c1',
        customerName: 'Test Müşteri',
        humanOrderNo: 'AB-001',
        paidAt: null,
        invoiceHoldUntil: null,
        invoicedAt: null,
        items: [{ productId: 'p1', qty: 2 }],
      };

      it('refunds the net paid amount when ORDER_PAYMENT ledger entries exist', async () => {
        const { prisma, productUpdate } = makePrisma(
          {
            findFirst: jest.fn().mockResolvedValue({
              ...baseExisting,
              paymentType: 'card',
              cariApprovalStatus: null,
            }),
          },
          [{ type: 'ORDER_PAYMENT', amount: '-100.00' }],
        );
        const cari = makeCari();
        const svc = new AdminOrdersService(prisma, makeAudit(), cari, makeSettings(), makeMail(), makeSupplierAccount(), makeStorage());

        await svc.updateOrder('t1', 'o1', { status: 'cancelled' }, actor);

        expect(cari.refundForOrderTx).toHaveBeenCalledTimes(1);
        expect(productUpdate).toHaveBeenCalledTimes(1);
      });

      it('refunds when paymentType=cari and bakiyeden gerçekten düşüldüyse (ledger has ORDER_PAYMENT)', async () => {
        const { prisma } = makePrisma(
          {
            findFirst: jest.fn().mockResolvedValue({
              ...baseExisting,
              paymentType: 'cari',
              cariApprovalStatus: 'approved',
            }),
          },
          [{ type: 'ORDER_PAYMENT', amount: '-100.00' }],
        );
        const cari = makeCari();
        const svc = new AdminOrdersService(prisma, makeAudit(), cari, makeSettings(), makeMail(), makeSupplierAccount(), makeStorage());

        await svc.updateOrder('t1', 'o1', { status: 'cancelled' }, actor);

        expect(cari.refundForOrderTx).toHaveBeenCalledTimes(1);
      });

      it('does NOT refund when ledger has no ORDER_PAYMENT (henüz tahsil edilmemiş)', async () => {
        const { prisma } = makePrisma(
          {
            findFirst: jest.fn().mockResolvedValue({
              ...baseExisting,
              paymentType: 'cari',
              cariApprovalStatus: 'pending',
            }),
          },
          [],
        );
        const cari = makeCari();
        const svc = new AdminOrdersService(prisma, makeAudit(), cari, makeSettings(), makeMail(), makeSupplierAccount(), makeStorage());

        await svc.updateOrder('t1', 'o1', { status: 'cancelled' }, actor);

        expect(cari.refundForOrderTx).not.toHaveBeenCalled();
      });

      it('does NOT double-refund when an earlier REFUND fully neutralized the payment', async () => {
        const { prisma } = makePrisma(
          {
            findFirst: jest.fn().mockResolvedValue({
              ...baseExisting,
              paymentType: 'card',
              cariApprovalStatus: null,
            }),
          },
          [
            { type: 'ORDER_PAYMENT', amount: '-100.00' },
            { type: 'REFUND', amount: '100.00' },
          ],
        );
        const cari = makeCari();
        const svc = new AdminOrdersService(prisma, makeAudit(), cari, makeSettings(), makeMail(), makeSupplierAccount(), makeStorage());

        await svc.updateOrder('t1', 'o1', { status: 'cancelled' }, actor);

        expect(cari.refundForOrderTx).not.toHaveBeenCalled();
      });

      it('does NOT auto-refund or restore stock on refunded transition', async () => {
        const { prisma, productUpdate } = makePrisma(
          {
            findFirst: jest.fn().mockResolvedValue({
              ...baseExisting,
              paymentType: 'card',
              cariApprovalStatus: null,
            }),
          },
          [{ type: 'ORDER_PAYMENT', amount: '-100.00' }],
        );
        const cari = makeCari();
        const svc = new AdminOrdersService(prisma, makeAudit(), cari, makeSettings(), makeMail(), makeSupplierAccount(), makeStorage());

        await svc.updateOrder('t1', 'o1', { status: 'refunded' }, actor);

        expect(cari.refundForOrderTx).not.toHaveBeenCalled();
        expect(productUpdate).not.toHaveBeenCalled();
      });
      it('returns meta.refund with previousBalance/newBalance on successful refund', async () => {
        const { prisma } = makePrisma(
          {
            findFirst: jest.fn().mockResolvedValue({
              ...baseExisting,
              paymentType: 'card',
              cariApprovalStatus: null,
            }),
          },
          [{ type: 'ORDER_PAYMENT', amount: '-100.00' }],
        );
        const cari = {
          refundForOrderTx: jest.fn().mockResolvedValue({
            ledgerId: 'l-new',
            previousBalance: 50,
            newBalance: 150,
          }),
        } as unknown as CariBalanceService;
        const svc = new AdminOrdersService(prisma, makeAudit(), cari, makeSettings(), makeMail(), makeSupplierAccount(), makeStorage());

        const result = await svc.updateOrder(
          't1',
          'o1',
          { status: 'cancelled' },
          actor,
        );

        expect(result.meta?.refund).toEqual({
          amount: 100,
          previousBalance: 50,
          newBalance: 150,
          customerId: 'c1',
          customerName: 'Test Müşteri',
        });
        expect(result.meta?.statusChanged).toBe(true);
      });
    });
  });

  describe('setItemSupplierOverride', () => {
    // Bot orchestrator'ları (bot'lu tedarikçiler)
    // tedarikçi SKU/barkodunu OVERRIDE-first çözer (supplierSkuOverride →
    // fallback supplierSku). Bayi "daha ucuz" önerisini kabul edip override
    // değiştirildiğinde, üç override alanı (id/sku/barcode) yeni tedarikçinin
    // değerlerine ATOMİK yazılmalı + costPriceSnapshot güncellenmeli; aksi halde
    // auto-route'tan kalan bayat supplierSkuOverride bota yanlış SKU gönderir
    // (bug #61002900: Tedarikçi B "Sem.7676038" → Tedarikçi C urunID INTEGER).
    const buildPrisma = (mocks: {
      order?: unknown;
      item?: unknown;
      supplier?: unknown;
      newProduct?: unknown;
    }) => {
      const orderItemUpdate = jest.fn().mockResolvedValue({});
      const prisma = {
        order: {
          findFirst: jest.fn().mockResolvedValue(mocks.order ?? null),
        },
        orderItem: {
          findFirst: jest.fn().mockResolvedValue(mocks.item ?? null),
          update: orderItemUpdate,
        },
        supplier: {
          findFirst: jest.fn().mockResolvedValue(mocks.supplier ?? null),
        },
        product: {
          findFirst: jest.fn().mockResolvedValue(mocks.newProduct ?? null),
        },
      } as unknown as PrismaService;
      return { prisma, orderItemUpdate };
    };

    const buildSvc = (prisma: PrismaService) => {
      const svc = new AdminOrdersService(
        prisma,
        makeAudit(),
        makeCari(),
        makeSettings(),
        makeMail(),
        makeSupplierAccount(),
        makeStorage(),
      );
      // findOne is called at the end to return refreshed order; bypass its
      // complex query graph in this unit test.
      jest.spyOn(svc, 'findOne').mockResolvedValue({
        success: true,
        data: { id: 'o1' },
      } as unknown as Awaited<ReturnType<typeof svc.findOne>>);
      return svc;
    };

    it('writes the override layer (id/sku/barcode + cost) when overriding to a new supplier', async () => {
      const { prisma, orderItemUpdate } = buildPrisma({
        order: { id: 'o1' },
        item: {
          id: 'oi1',
          productName: 'Widget',
          product: { externalCode: 'OLD-SKU', barcode: 'OLD-BAR', costPrice: 10 },
        },
        supplier: { id: 's2' },
        newProduct: { externalCode: 'NEW-SKU', barcode: 'NEW-BAR', costPrice: 7 },
      });
      const svc = buildSvc(prisma);

      await svc.setItemSupplierOverride('t1', 'o1', 'oi1', 's2');

      expect(orderItemUpdate).toHaveBeenCalledTimes(1);
      // KRİTİK: override alanlarına yazar (snapshot supplierSku/Barcode'a DEĞİL)
      // ki bot resolveItemSupplierSku override-first ile yeni tedarikçinin
      // SKU'sunu okusun; bayat supplierSkuOverride kalmasın.
      expect(orderItemUpdate).toHaveBeenCalledWith({
        where: { id: 'oi1' },
        data: {
          supplierIdOverride: 's2',
          supplierSkuOverride: 'NEW-SKU',
          supplierBarcodeOverride: 'NEW-BAR',
          costPriceSnapshot: 7,
        },
      });
    });

    it('clears all override fields and restores snapshots when override is cleared', async () => {
      const { prisma, orderItemUpdate } = buildPrisma({
        order: { id: 'o1' },
        item: {
          id: 'oi1',
          productName: 'Widget',
          product: { externalCode: 'ORIG-SKU', barcode: 'ORIG-BAR', costPrice: 9 },
        },
      });
      const svc = buildSvc(prisma);

      await svc.setItemSupplierOverride('t1', 'o1', 'oi1', null);

      expect(orderItemUpdate).toHaveBeenCalledTimes(1);
      expect(orderItemUpdate).toHaveBeenCalledWith({
        where: { id: 'oi1' },
        data: {
          supplierIdOverride: null,
          supplierSkuOverride: null,
          supplierBarcodeOverride: null,
          supplierSku: 'ORIG-SKU',
          supplierBarcode: 'ORIG-BAR',
          costPriceSnapshot: 9,
        },
      });
    });

    it('throws BadRequestException when the selected supplier is not in the tenant', async () => {
      const { prisma, orderItemUpdate } = buildPrisma({
        order: { id: 'o1' },
        item: {
          id: 'oi1',
          productName: 'Widget',
          product: { externalCode: 'OLD-SKU', barcode: 'OLD-BAR', costPrice: 10 },
        },
        // supplier.findFirst → null (tenant mismatch)
      });
      const svc = buildSvc(prisma);

      await expect(
        svc.setItemSupplierOverride('t1', 'o1', 'oi1', 'sX'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(orderItemUpdate).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when the new supplier does not stock the product', async () => {
      const { prisma, orderItemUpdate } = buildPrisma({
        order: { id: 'o1' },
        item: {
          id: 'oi1',
          productName: 'Widget',
          product: { externalCode: 'OLD-SKU', barcode: 'OLD-BAR' },
        },
        supplier: { id: 's2' },
        // product.findFirst → null (supplier does not stock this product)
      });
      const svc = buildSvc(prisma);

      await expect(
        svc.setItemSupplierOverride('t1', 'o1', 'oi1', 's2'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(orderItemUpdate).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the order is not in the tenant', async () => {
      const { prisma, orderItemUpdate } = buildPrisma({});
      const svc = buildSvc(prisma);

      await expect(
        svc.setItemSupplierOverride('t1', 'missing', 'oi1', 's2'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(orderItemUpdate).not.toHaveBeenCalled();
    });
  });
});

/**
 * Maliyet/kâr görünürlüğü — çalışan (MEMBER) rolü sipariş yanıtlarında ALIŞ
 * MALİYETİ türevli alanları GÖRMEZ. Controller `canSeeCost(req)` ile bu
 * bayrağı geçirir; burada servis sözleşmesini doğruluyoruz.
 */
describe('AdminOrdersService — maliyet maskesi (canSeeCost)', () => {
  const ORDER_ROW = {
    id: 'o1',
    humanOrderNo: 'SIP-1',
    orderNumber: 'SIP-1',
    status: 'paid',
    total: '100',
    createdAt: new Date('2026-07-01T00:00:00Z'),
    updatedAt: new Date('2026-07-01T00:00:00Z'),
    customerId: 'c1',
    customerName: 'Bayi A',
    customerEmail: 'a@b.c',
    customerPhone: null,
    marketplace: null,
    cargoCompany: null,
    cargoBarcode: null,
    trackingNumber: null,
    notes: null,
    dispatchRoutingNote: null,
    supplierOrderNo: null,
    pdfKey: null,
    pdfUrl: null,
    pdfPurgedAt: null,
    _count: { items: 1 },
    items: [
      {
        id: 'i1',
        productId: 'p1',
        productName: 'Ürün A',
        qty: 1,
        unitPrice: '100',
        supplierOrderNo: null,
        supplierId: 's1',
        houseStockOwnerId: null,
        supplierIdOverride: null,
        product: {
          id: 'p1',
          imageUrl: null,
          supplierId: 's1',
          supplier: { id: 's1', name: 'Tedarikçi A' },
        },
      },
    ],
  };

  function buildService(productFindMany: jest.Mock) {
    const base = makePrisma();
    const prisma = {
      ...(base.prisma as unknown as Record<string, unknown>),
      order: {
        ...(base.prisma as unknown as { order: Record<string, unknown> }).order,
        findMany: jest.fn().mockResolvedValue([ORDER_ROW]),
        count: jest.fn().mockResolvedValue(1),
      },
      product: { findMany: productFindMany },
      cheaperSupplierHint: { findMany: jest.fn().mockResolvedValue([]) },
      customer: { findMany: jest.fn().mockResolvedValue([]) },
      appSetting: { findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as PrismaService;
    return new AdminOrdersService(
      prisma,
      makeAudit(),
      makeCari(),
      makeSettings(),
      makeMail(),
      makeSupplierAccount(),
      makeStorage(),
    );
  }

  it('canSeeCost=false → alternatif tedarikçi MALİYET sorgusu HİÇ koşmaz', async () => {
    const productFindMany = jest.fn().mockResolvedValue([]);
    const svc = buildService(productFindMany);
    await svc.list('t1', {}, false);
    expect(productFindMany).not.toHaveBeenCalled();
  });

  it('canSeeCost=true → maliyet sorgusu koşar (yönetici davranışı korunur)', async () => {
    const productFindMany = jest.fn().mockResolvedValue([]);
    const svc = buildService(productFindMany);
    await svc.list('t1', {}, true);
    expect(productFindMany).toHaveBeenCalled();
  });

  it('canSeeCost=false → yanıtta cheaperSupplierHint DAİMA null', async () => {
    const productFindMany = jest.fn().mockResolvedValue([
      {
        name: 'Ürün A',
        price: '100',
        costPrice: '40',
        supplierId: 's2',
        supplier: { name: 'Ucuz Tedarikçi' },
      },
    ]);
    const svc = buildService(productFindMany);
    const res = await svc.list('t1', {}, false);
    const row = res.data[0] as { cheaperSupplierHint: unknown };
    expect(row.cheaperSupplierHint).toBeNull();
    // Maliyet değeri yanıtın HİÇBİR yerinde geçmemeli.
    expect(JSON.stringify(res.data)).not.toContain('Ucuz Tedarikçi');
  });

  it('varsayılan (parametresiz) çağrı maliyeti gösterir — eski davranış bozulmaz', async () => {
    const productFindMany = jest.fn().mockResolvedValue([]);
    const svc = buildService(productFindMany);
    await svc.list('t1', {});
    expect(productFindMany).toHaveBeenCalled();
  });
});

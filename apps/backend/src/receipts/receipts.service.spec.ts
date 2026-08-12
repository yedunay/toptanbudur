import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ReceiptsService } from './receipts.service';
import type { ReceiptNumberService } from './receipt-number.service';
import type { BayiNumberService } from './bayi-number.service';
import type { CariTopupNumberService } from '../cari-balance/cari-topup-number.service';
import type { ReceiptPdfService } from './receipt-pdf.service';
import type { IFileStorage } from '../storage/storage.interface';

/**
 * EN ÖNEMLİ KURAL testleri: makbuz YALNIZCA kredi kartı işlemlerinde üretilir.
 *
 * `createForOrder`/`createForTopup`'a bir `tx` verildiğinde servis doğrudan
 * private `*Tx` yolunu çalıştırır (gerçek $transaction'a girmez), bu yüzden
 * sahte bir transaction client ile kart-yalnızca guard'ını birim test edebiliriz.
 */

interface TxMock {
  paymentReceipt: { findUnique: jest.Mock; create: jest.Mock };
  order: { findUnique: jest.Mock };
  cariTopup: { findUnique: jest.Mock; update: jest.Mock };
  customer: { update: jest.Mock };
  tenant: { findFirst: jest.Mock };
}

function buildTx(): TxMock {
  return {
    paymentReceipt: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn((args: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'rcpt-1', ...args.data }),
      ),
    },
    order: { findUnique: jest.fn() },
    cariTopup: {
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    customer: { update: jest.fn().mockResolvedValue({}) },
    tenant: { findFirst: jest.fn().mockResolvedValue({ id: 'tenant-1' }) },
  };
}

function buildService(): ReceiptsService {
  const prisma = {} as PrismaService;
  const receiptNumbers = {
    generateHumanReceiptNo: jest.fn().mockResolvedValue('MBZ-2026-000001'),
  } as unknown as ReceiptNumberService;
  const bayiNumbers = {
    generateBayiNo: jest.fn().mockResolvedValue('BAYI-000099'),
  } as unknown as BayiNumberService;
  const topupNumbers = {
    generateHumanTopupNo: jest.fn().mockResolvedValue('YUKLEME-000099'),
  } as unknown as CariTopupNumberService;
  const pdf = { renderPdf: jest.fn() } as unknown as ReceiptPdfService;
  const storage = {
    upload: jest.fn(),
    getSignedUrl: jest.fn(),
  } as unknown as IFileStorage;
  return new ReceiptsService(
    prisma,
    receiptNumbers,
    bayiNumbers,
    topupNumbers,
    pdf,
    storage,
  );
}

const CUSTOMER = {
  id: 'cust-1',
  name: 'Ahmet Yılmaz',
  companyTitle: 'Test Bayi A.Ş.',
  bayiNo: 'BAYI-000005',
};

function cardOrder() {
  return {
    id: 'order-1',
    tenantId: 'tenant-1',
    customerId: 'cust-1',
    humanOrderNo: 'SIP-2026-000123',
    total: new Prisma.Decimal(100),
    cardCommissionAmount: new Prisma.Decimal(18),
    posProviderKey: 'tosla',
    paymentType: 'card',
    paidAt: new Date('2026-06-01T10:00:00Z'),
    createdAt: new Date('2026-06-01T09:00:00Z'),
    customer: { ...CUSTOMER },
    paymentTransactions: [
      {
        totalAmount: new Prisma.Decimal(118),
        amount: new Prisma.Decimal(100),
        providerKey: 'tosla',
      },
    ],
  };
}

function cardTopup() {
  return {
    id: 'topup-1',
    customerId: 'cust-1',
    amount: new Prisma.Decimal(500),
    method: 'card',
    chargedAmount: new Prisma.Decimal(590),
    commissionAmount: new Prisma.Decimal(90),
    humanTopupNo: 'YUKLEME-000010',
    decidedAt: new Date('2026-06-02T10:00:00Z'),
    createdAt: new Date('2026-06-02T09:00:00Z'),
    customer: { ...CUSTOMER },
    paymentTransactions: [
      {
        totalAmount: new Prisma.Decimal(590),
        amount: new Prisma.Decimal(500),
        providerKey: 'tosla',
        tenantId: 'tenant-1',
      },
    ],
  };
}

describe('ReceiptsService — EN ÖNEMLİ KURAL: yalnızca kredi kartı', () => {
  describe('createForOrder', () => {
    test('kart ile ödenen sipariş için makbuz üretir', async () => {
      const service = buildService();
      const tx = buildTx();
      tx.order.findUnique.mockResolvedValue(cardOrder());

      const result = await service.createForOrder(
        'order-1',
        tx as unknown as Prisma.TransactionClient,
      );

      expect(result).not.toBeNull();
      expect(tx.paymentReceipt.create).toHaveBeenCalledTimes(1);
      const data = tx.paymentReceipt.create.mock.calls[0][0].data;
      expect(data.kind).toBe('order');
      expect(data.orderId).toBe('order-1');
      expect(data.customerId).toBe('cust-1');
      expect(data.aciklama).toBe(
        'SIP-2026-000123 numaralı siparişe ait ürün bedeli kredi kartı ile tahsil edilmiştir.',
      );
      // totalAmount (komisyon dahil) baz alınır.
      expect(data.amount.toString()).toBe('118');
    });

    test('kart DIŞI sipariş (cari/bakiye) için makbuz ÜRETMEZ', async () => {
      const service = buildService();
      const tx = buildTx();
      tx.order.findUnique.mockResolvedValue({
        ...cardOrder(),
        paymentType: 'balance',
      });

      const result = await service.createForOrder(
        'order-1',
        tx as unknown as Prisma.TransactionClient,
      );

      expect(result).toBeNull();
      expect(tx.paymentReceipt.create).not.toHaveBeenCalled();
    });

    test('zaten makbuzu olan siparişte idempotenttir (yeniden üretmez)', async () => {
      const service = buildService();
      const tx = buildTx();
      const existing = { id: 'rcpt-existing', kind: 'order' };
      tx.paymentReceipt.findUnique.mockResolvedValue(existing);

      const result = await service.createForOrder(
        'order-1',
        tx as unknown as Prisma.TransactionClient,
      );

      expect(result).toBe(existing);
      expect(tx.order.findUnique).not.toHaveBeenCalled();
      expect(tx.paymentReceipt.create).not.toHaveBeenCalled();
    });
  });

  describe('createForTopup', () => {
    test('kart ile yapılan yükleme için makbuz üretir (doğru açıklama metni)', async () => {
      const service = buildService();
      const tx = buildTx();
      tx.cariTopup.findUnique.mockResolvedValue(cardTopup());

      const result = await service.createForTopup(
        'topup-1',
        tx as unknown as Prisma.TransactionClient,
      );

      expect(result).not.toBeNull();
      expect(tx.paymentReceipt.create).toHaveBeenCalledTimes(1);
      const data = tx.paymentReceipt.create.mock.calls[0][0].data;
      expect(data.kind).toBe('cari_topup');
      expect(data.topupId).toBe('topup-1');
      // chargedAmount (komisyon dahil tahsilat) baz alınır.
      expect(data.amount.toString()).toBe('590');
      expect(data.aciklama).toBe(
        'Cari hesap bakiyenize kredi kartı ile 590,00 TL tutarında yükleme yapılmıştır.',
      );
    });

    test('kart DIŞI yükleme (havale/eft) için makbuz ÜRETMEZ', async () => {
      const service = buildService();
      const tx = buildTx();
      tx.cariTopup.findUnique.mockResolvedValue({
        ...cardTopup(),
        method: 'bank',
      });

      const result = await service.createForTopup(
        'topup-1',
        tx as unknown as Prisma.TransactionClient,
      );

      expect(result).toBeNull();
      expect(tx.paymentReceipt.create).not.toHaveBeenCalled();
    });
  });
});

/**
 * issuedAt fallback zinciri (Finding 1, HIGH): backfill/eski kayıtlarda
 * `paidAt`/`decidedAt` NULL olabilir; bu durumda makbuz tarihi başarılı POS
 * kaydının `callbackAt`'ine düşmeli (createdAt'e değil), çünkü `callbackAt`
 * gerçek tahsilat anını temsil eder.
 */
describe('ReceiptsService — issuedAt fallback (paidAt/decidedAt NULL)', () => {
  test('sipariş: paidAt NULL → issuedAt POS callbackAt’ine düşer', async () => {
    const service = buildService();
    const tx = buildTx();
    const callbackAt = new Date('2026-05-20T14:30:00Z');
    tx.order.findUnique.mockResolvedValue({
      ...cardOrder(),
      paidAt: null,
      createdAt: new Date('2026-05-19T08:00:00Z'),
      paymentTransactions: [
        {
          totalAmount: new Prisma.Decimal(118),
          amount: new Prisma.Decimal(100),
          providerKey: 'tosla',
          callbackAt,
        },
      ],
    });

    await service.createForOrder(
      'order-1',
      tx as unknown as Prisma.TransactionClient,
    );

    const data = tx.paymentReceipt.create.mock.calls[0][0].data;
    expect((data.issuedAt as Date).getTime()).toBe(callbackAt.getTime());
  });

  test('sipariş: paidAt ve callbackAt NULL → issuedAt createdAt’e düşer', async () => {
    const service = buildService();
    const tx = buildTx();
    const createdAt = new Date('2026-05-18T07:00:00Z');
    tx.order.findUnique.mockResolvedValue({
      ...cardOrder(),
      paidAt: null,
      createdAt,
      paymentTransactions: [
        {
          totalAmount: new Prisma.Decimal(118),
          amount: new Prisma.Decimal(100),
          providerKey: 'tosla',
          callbackAt: null,
        },
      ],
    });

    await service.createForOrder(
      'order-1',
      tx as unknown as Prisma.TransactionClient,
    );

    const data = tx.paymentReceipt.create.mock.calls[0][0].data;
    expect((data.issuedAt as Date).getTime()).toBe(createdAt.getTime());
  });

  test('yükleme: decidedAt NULL → issuedAt POS callbackAt’ine düşer', async () => {
    const service = buildService();
    const tx = buildTx();
    const callbackAt = new Date('2026-05-21T11:15:00Z');
    tx.cariTopup.findUnique.mockResolvedValue({
      ...cardTopup(),
      decidedAt: null,
      createdAt: new Date('2026-05-20T09:00:00Z'),
      paymentTransactions: [
        {
          totalAmount: new Prisma.Decimal(590),
          amount: new Prisma.Decimal(500),
          providerKey: 'tosla',
          tenantId: 'tenant-1',
          callbackAt,
        },
      ],
    });

    await service.createForTopup(
      'topup-1',
      tx as unknown as Prisma.TransactionClient,
    );

    const data = tx.paymentReceipt.create.mock.calls[0][0].data;
    expect((data.issuedAt as Date).getTime()).toBe(callbackAt.getTime());
  });
});

/**
 * Tutar çözümleme uyarıları (Finding 4, MEDIUM): tutar matematiği DEĞİŞMEZ ama
 * komisyon doğrulanamadığında / tutar sıfıra düştüğünde denetim için sesli
 * uyarı (logger.warn) verilmeli.
 */
describe('ReceiptsService — tutar çözümleme uyarıları', () => {
  function warnSpyOf(service: ReceiptsService): jest.SpyInstance {
    const withLogger = service as unknown as { logger: { warn: jest.Mock } };
    return jest
      .spyOn(withLogger.logger, 'warn')
      .mockImplementation(() => undefined);
  }

  test('sipariş: POS kaydı + cardCommissionAmount yok → çıplak total + uyarı', async () => {
    const service = buildService();
    const warn = warnSpyOf(service);
    const tx = buildTx();
    tx.order.findUnique.mockResolvedValue({
      ...cardOrder(),
      cardCommissionAmount: null,
      paymentTransactions: [],
    });

    await service.createForOrder(
      'order-1',
      tx as unknown as Prisma.TransactionClient,
    );

    const data = tx.paymentReceipt.create.mock.calls[0][0].data;
    // Matematik korunur: komisyon doğrulanamayınca çıplak sipariş toplamı (100).
    expect(data.amount.toString()).toBe('100');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('SIP-2026-000123');
  });

  test('yükleme: chargedAmount/amount/POS yok → tutar=0 + uyarı', async () => {
    const service = buildService();
    const warn = warnSpyOf(service);
    const tx = buildTx();
    tx.cariTopup.findUnique.mockResolvedValue({
      ...cardTopup(),
      chargedAmount: null,
      amount: null,
      commissionAmount: null,
      paymentTransactions: [
        { totalAmount: null, amount: null, providerKey: null, tenantId: 'tenant-1' },
      ],
    });

    await service.createForTopup(
      'topup-1',
      tx as unknown as Prisma.TransactionClient,
    );

    const data = tx.paymentReceipt.create.mock.calls[0][0].data;
    expect(data.amount.toString()).toBe('0');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('YUKLEME-000010');
  });
});

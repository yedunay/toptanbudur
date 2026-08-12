import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma, SupplierLedgerType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { AdminNotifierService } from '../mail/admin-notifier.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SupplierAccountService } from './supplier-account.service';

// ──────────────────────────────────────────────────────────────────────────
//  TEDARİKÇİ BAKİYE SENKRONU — servis testleri
//
//  Mock kuralları (admin-suppliers.service.spec.ts ile aynı):
//   • $transaction callback formu `base` mock'unu `tx` olarak yeniden kullanır,
//     böylece transaction gövdesinden yapılan model çağrıları aynı jest.fn'i
//     yakalar.
//   • $queryRaw (FOR UPDATE kilidi) tagged-template; default [{id}] döner.
//   • Bağımlılıklar `as unknown as` ile kabaca cast edilir.
// ──────────────────────────────────────────────────────────────────────────

type JestModel = Record<string, jest.Mock>;

interface PrismaMock {
  supplier: JestModel;
  supplierAccount: JestModel;
  supplierAccountLedger: JestModel;
  $queryRaw: jest.Mock;
  $transaction: jest.Mock;
}

function makePrismaMock(opts: { queryRaw?: jest.Mock } = {}): PrismaMock {
  const base: PrismaMock = {
    supplier: {
      findFirst: jest.fn().mockResolvedValue({ id: 's1', name: 'Tedarikçi A' }),
    },
    supplierAccount: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    supplierAccountLedger: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue({ id: 'ledger1' }),
    },
    // FOR UPDATE kilidi: default olarak satır var.
    $queryRaw: opts.queryRaw ?? jest.fn().mockResolvedValue([{ id: 'acc1' }]),
    $transaction: jest.fn(),
  };
  // Callback-form $transaction `base`'i `tx` olarak verir.
  base.$transaction.mockImplementation(async (arg: unknown) => {
    if (typeof arg === 'function') {
      return (arg as (tx: PrismaMock) => Promise<unknown>)(base);
    }
    if (Array.isArray(arg)) return Promise.all(arg);
    return arg;
  });
  return base;
}

const asPrisma = (m: PrismaMock): PrismaService =>
  m as unknown as PrismaService;

const makeMailMock = () =>
  ({
    sendAdminSupplierLowBalance: jest.fn().mockResolvedValue(undefined),
  }) as unknown as MailService;

const makeAdminNotifierMock = () =>
  ({
    resolveAdminEmails: jest.fn().mockResolvedValue([]),
  }) as unknown as AdminNotifierService;

const makeNotificationsMock = () =>
  ({
    emit: jest.fn().mockResolvedValue(undefined),
  }) as unknown as NotificationsService;

interface Deps {
  prisma: PrismaMock;
  mail: MailService;
  adminNotifier: AdminNotifierService;
  notifications: NotificationsService;
}

function build(opts: { queryRaw?: jest.Mock } = {}): {
  svc: SupplierAccountService;
  deps: Deps;
} {
  const prisma = makePrismaMock(opts);
  const mail = makeMailMock();
  const adminNotifier = makeAdminNotifierMock();
  const notifications = makeNotificationsMock();
  const svc = new SupplierAccountService(
    asPrisma(prisma),
    mail,
    adminNotifier,
    notifications,
  );
  return { svc, deps: { prisma, mail, adminNotifier, notifications } };
}

/** lockAccountTx'in döndüğü "kilitli hesap" satırı. */
function lockedAccount(
  balance: number,
  threshold = 1000,
  lowBalanceNotifiedAt: Date | null = null,
) {
  return {
    id: 'acc1',
    balance: new Prisma.Decimal(balance),
    threshold: new Prisma.Decimal(threshold),
    lowBalanceNotifiedAt,
  };
}

const fn = (v: unknown): jest.Mock => v as jest.Mock;

describe('SupplierAccountService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ─────────────────────── deductForOrderTx ───────────────────────
  describe('deductForOrderTx', () => {
    const params = {
      supplierId: 's1',
      tenantId: 't1',
      orderId: 'o1',
      humanOrderNo: '12345',
    };

    it('deducts the real supplier amount and writes a negative ledger entry', async () => {
      const { svc, deps } = build();
      fn(deps.prisma.supplierAccount.findUnique).mockResolvedValue(
        lockedAccount(5000),
      );

      const res = await svc.deductForOrderTx(asPrisma(deps.prisma), {
        ...params,
        amount: 1200.5,
      });

      expect(res.skipped).toBe(false);
      expect(res.ledgerId).toBe('ledger1');
      expect(res.balanceAfter).toBe(3799.5);
      // Bakiye 5000 - 1200.5 = 3799.5 olarak güncellenir.
      expect(deps.prisma.supplierAccount.update).toHaveBeenCalledWith({
        where: { id: 'acc1' },
        data: { balance: expect.any(Prisma.Decimal) },
      });
      // Ledger: negatif tutar (çıkış) + ORDER_PURCHASE.
      const ledgerArg = fn(deps.prisma.supplierAccountLedger.create).mock
        .calls[0][0];
      expect(ledgerArg.data.type).toBe(SupplierLedgerType.ORDER_PURCHASE);
      expect(Number(ledgerArg.data.amount)).toBe(-1200.5);
      expect(Number(ledgerArg.data.balanceAfter)).toBe(3799.5);
      expect(ledgerArg.data.orderId).toBe('o1');
    });

    it('skips when amount is zero or negative (nothing to deduct)', async () => {
      const { svc, deps } = build();
      const res = await svc.deductForOrderTx(asPrisma(deps.prisma), {
        ...params,
        amount: 0,
      });
      expect(res).toEqual({ skipped: true, ledgerId: null, balanceAfter: null });
      expect(deps.prisma.supplierAccount.update).not.toHaveBeenCalled();
      expect(deps.prisma.supplierAccountLedger.create).not.toHaveBeenCalled();
    });

    it('is idempotent — skips when an ORDER_PURCHASE already exists for the order', async () => {
      const { svc, deps } = build();
      fn(deps.prisma.supplierAccountLedger.findFirst).mockResolvedValue({
        id: 'existing-led',
        balanceAfter: new Prisma.Decimal(3799.5),
        amount: new Prisma.Decimal(-1200.5),
      });

      const res = await svc.deductForOrderTx(asPrisma(deps.prisma), {
        ...params,
        amount: 1200.5,
      });

      expect(res).toEqual({
        skipped: true,
        ledgerId: 'existing-led',
        balanceAfter: 3799.5,
      });
      expect(deps.prisma.supplierAccount.update).not.toHaveBeenCalled();
      expect(deps.prisma.supplierAccountLedger.create).not.toHaveBeenCalled();
    });

    it('lets the balance go negative without throwing (order flow never breaks)', async () => {
      const { svc, deps } = build();
      fn(deps.prisma.supplierAccount.findUnique).mockResolvedValue(
        lockedAccount(500),
      );
      const res = await svc.deductForOrderTx(asPrisma(deps.prisma), {
        ...params,
        amount: 800,
      });
      expect(res.skipped).toBe(false);
      expect(res.balanceAfter).toBe(-300);
    });

    it('creates the account when it does not exist yet, then deducts', async () => {
      // lockAccountTx: ilk FOR UPDATE boş → create yolu.
      const { svc, deps } = build({
        queryRaw: jest.fn().mockResolvedValue([]),
      });
      fn(deps.prisma.supplierAccount.create).mockResolvedValue(
        lockedAccount(0),
      );
      const res = await svc.deductForOrderTx(asPrisma(deps.prisma), {
        ...params,
        amount: 200,
      });
      expect(deps.prisma.supplierAccount.create).toHaveBeenCalled();
      expect(res.balanceAfter).toBe(-200);
    });

    it('uses a generic description when humanOrderNo is null', async () => {
      const { svc, deps } = build();
      fn(deps.prisma.supplierAccount.findUnique).mockResolvedValue(
        lockedAccount(5000),
      );
      await svc.deductForOrderTx(asPrisma(deps.prisma), {
        ...params,
        humanOrderNo: null,
        amount: 100,
      });
      const ledgerArg = fn(deps.prisma.supplierAccountLedger.create).mock
        .calls[0][0];
      expect(ledgerArg.data.description).toBe(
        'Sipariş — tedarikçi tutarı düşüldü',
      );
    });
  });

  // ─────────────────────── refundForOrderTx ───────────────────────
  describe('refundForOrderTx', () => {
    const params = {
      supplierId: 's1',
      tenantId: 't1',
      orderId: 'o1',
      humanOrderNo: '12345',
    };

    it('refunds the previously deducted amount on cancellation', async () => {
      const { svc, deps } = build();
      fn(deps.prisma.supplierAccountLedger.findFirst)
        // 1) purchase kaydı (negatif tutar)
        .mockResolvedValueOnce({ amount: new Prisma.Decimal(-1200.5) })
        // 2) mevcut refund yok
        .mockResolvedValueOnce(null);
      fn(deps.prisma.supplierAccount.findUnique).mockResolvedValue(
        lockedAccount(3799.5),
      );

      const res = await svc.refundForOrderTx(asPrisma(deps.prisma), params);

      expect(res.skipped).toBe(false);
      expect(res.balanceAfter).toBe(5000);
      const ledgerArg = fn(deps.prisma.supplierAccountLedger.create).mock
        .calls[0][0];
      expect(ledgerArg.data.type).toBe(SupplierLedgerType.ORDER_REFUND);
      // İade pozitif (giriş).
      expect(Number(ledgerArg.data.amount)).toBe(1200.5);
    });

    it('skips with reason no-purchase when there was never a deduction', async () => {
      const { svc, deps } = build();
      fn(deps.prisma.supplierAccountLedger.findFirst).mockResolvedValue(null);
      const res = await svc.refundForOrderTx(asPrisma(deps.prisma), params);
      expect(res).toEqual({
        skipped: true,
        reason: 'no-purchase',
        ledgerId: null,
        balanceAfter: null,
      });
      expect(deps.prisma.supplierAccount.update).not.toHaveBeenCalled();
    });

    it('is idempotent — skips with reason already-refunded', async () => {
      const { svc, deps } = build();
      fn(deps.prisma.supplierAccountLedger.findFirst)
        .mockResolvedValueOnce({ amount: new Prisma.Decimal(-1200.5) })
        .mockResolvedValueOnce({
          id: 'refund-led',
          balanceAfter: new Prisma.Decimal(5000),
        });
      const res = await svc.refundForOrderTx(asPrisma(deps.prisma), params);
      expect(res).toEqual({
        skipped: true,
        reason: 'already-refunded',
        ledgerId: 'refund-led',
        balanceAfter: 5000,
      });
      expect(deps.prisma.supplierAccount.update).not.toHaveBeenCalled();
    });

    it('skips when the recorded purchase amount is zero', async () => {
      const { svc, deps } = build();
      fn(deps.prisma.supplierAccountLedger.findFirst)
        .mockResolvedValueOnce({ amount: new Prisma.Decimal(0) })
        .mockResolvedValueOnce(null);
      const res = await svc.refundForOrderTx(asPrisma(deps.prisma), params);
      expect(res.skipped).toBe(true);
      expect(deps.prisma.supplierAccount.update).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────── topUp ───────────────────────────
  describe('topUp', () => {
    const base = {
      supplierId: 's1',
      tenantId: 't1',
      adminUserId: 'admin1',
    };

    it('increases the balance and records a TOPUP ledger entry', async () => {
      const { svc, deps } = build();
      jest.spyOn(svc, 'maybeNotifyLowBalance').mockResolvedValue(undefined);
      fn(deps.prisma.supplierAccount.findUnique).mockResolvedValue(
        lockedAccount(5000),
      );

      const res = await svc.topUp({ ...base, amount: 1000 });

      expect(res.balance).toBe(6000);
      expect(res.ledgerId).toBe('ledger1');
      const ledgerArg = fn(deps.prisma.supplierAccountLedger.create).mock
        .calls[0][0];
      expect(ledgerArg.data.type).toBe(SupplierLedgerType.TOPUP);
      expect(Number(ledgerArg.data.amount)).toBe(1000);
      expect(ledgerArg.data.createdByUserId).toBe('admin1');
    });

    it('rejects a non-positive amount', async () => {
      const { svc } = build();
      await expect(svc.topUp({ ...base, amount: 0 })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(svc.topUp({ ...base, amount: -5 })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('throws NotFoundException when the supplier is not in the tenant', async () => {
      const { svc, deps } = build();
      fn(deps.prisma.supplier.findFirst).mockResolvedValue(null);
      await expect(svc.topUp({ ...base, amount: 100 })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('rejects when the resulting balance exceeds the hard ceiling', async () => {
      const { svc, deps } = build();
      jest.spyOn(svc, 'maybeNotifyLowBalance').mockResolvedValue(undefined);
      fn(deps.prisma.supplierAccount.findUnique).mockResolvedValue(
        lockedAccount(49_999_999),
      );
      await expect(
        svc.topUp({ ...base, amount: 1000 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  // ──────────────────────── adjustByAdmin ────────────────────────
  describe('adjustByAdmin', () => {
    const base = {
      supplierId: 's1',
      tenantId: 't1',
      adminUserId: 'admin1',
    };

    it('applies a signed positive delta', async () => {
      const { svc, deps } = build();
      jest.spyOn(svc, 'maybeNotifyLowBalance').mockResolvedValue(undefined);
      fn(deps.prisma.supplierAccount.findUnique).mockResolvedValue(
        lockedAccount(1000),
      );
      const res = await svc.adjustByAdmin({ ...base, amount: 250 });
      expect(res.balance).toBe(1250);
      const ledgerArg = fn(deps.prisma.supplierAccountLedger.create).mock
        .calls[0][0];
      expect(ledgerArg.data.type).toBe(SupplierLedgerType.ADJUSTMENT);
      expect(Number(ledgerArg.data.amount)).toBe(250);
    });

    it('applies a signed negative delta', async () => {
      const { svc, deps } = build();
      jest.spyOn(svc, 'maybeNotifyLowBalance').mockResolvedValue(undefined);
      fn(deps.prisma.supplierAccount.findUnique).mockResolvedValue(
        lockedAccount(1000),
      );
      const res = await svc.adjustByAdmin({ ...base, amount: -300 });
      expect(res.balance).toBe(700);
    });

    it('rejects a zero delta', async () => {
      const { svc } = build();
      await expect(
        svc.adjustByAdmin({ ...base, amount: 0 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects when the result would fall below the minimum allowed balance', async () => {
      const { svc, deps } = build();
      jest.spyOn(svc, 'maybeNotifyLowBalance').mockResolvedValue(undefined);
      fn(deps.prisma.supplierAccount.findUnique).mockResolvedValue(
        lockedAccount(-999_999),
      );
      await expect(
        svc.adjustByAdmin({ ...base, amount: -100 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  // ─────────────────────── setBalanceByAdmin ───────────────────────
  describe('setBalanceByAdmin', () => {
    const base = {
      supplierId: 's1',
      tenantId: 't1',
      adminUserId: 'admin1',
    };

    it('sets an absolute balance and records the signed difference', async () => {
      const { svc, deps } = build();
      jest.spyOn(svc, 'maybeNotifyLowBalance').mockResolvedValue(undefined);
      fn(deps.prisma.supplierAccount.findUnique).mockResolvedValue(
        lockedAccount(1000),
      );
      const res = await svc.setBalanceByAdmin({ ...base, newBalance: 2500 });
      expect(res.balance).toBe(2500);
      const ledgerArg = fn(deps.prisma.supplierAccountLedger.create).mock
        .calls[0][0];
      expect(ledgerArg.data.type).toBe(SupplierLedgerType.MANUAL_SET);
      // delta = 2500 - 1000 = 1500
      expect(Number(ledgerArg.data.amount)).toBe(1500);
      expect(Number(ledgerArg.data.balanceAfter)).toBe(2500);
    });

    it('rejects when the new balance equals the current balance (no change)', async () => {
      const { svc, deps } = build();
      jest.spyOn(svc, 'maybeNotifyLowBalance').mockResolvedValue(undefined);
      fn(deps.prisma.supplierAccount.findUnique).mockResolvedValue(
        lockedAccount(2500),
      );
      await expect(
        svc.setBalanceByAdmin({ ...base, newBalance: 2500 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a balance value outside the allowed range', async () => {
      const { svc } = build();
      await expect(
        svc.setBalanceByAdmin({ ...base, newBalance: 99_000_000 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  // ──────────────────────── setThreshold ────────────────────────
  describe('setThreshold', () => {
    const base = { supplierId: 's1', tenantId: 't1' };

    it('updates the threshold and reports isLow correctly', async () => {
      const { svc, deps } = build();
      jest.spyOn(svc, 'maybeNotifyLowBalance').mockResolvedValue(undefined);
      fn(deps.prisma.supplierAccount.findUnique).mockResolvedValue(
        lockedAccount(500),
      );
      fn(deps.prisma.supplierAccount.update).mockResolvedValue({
        balance: new Prisma.Decimal(500),
        threshold: new Prisma.Decimal(1000),
      });
      const res = await svc.setThreshold({ ...base, threshold: 1000 });
      expect(res.threshold).toBe(1000);
      expect(res.balance).toBe(500);
      expect(res.isLow).toBe(true);
    });

    it('rejects a negative threshold', async () => {
      const { svc } = build();
      await expect(
        svc.setThreshold({ ...base, threshold: -1 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  // ───────────────────────── getSummary ─────────────────────────
  describe('getSummary', () => {
    it('aggregates totals and counts low-balance suppliers', async () => {
      const { svc, deps } = build();
      fn(deps.prisma.supplierAccount.findMany).mockResolvedValue([
        {
          supplierId: 's1',
          balance: new Prisma.Decimal(500),
          threshold: new Prisma.Decimal(1000),
          lowBalanceNotifiedAt: new Date('2026-06-01T00:00:00Z'),
          updatedAt: new Date('2026-06-02T00:00:00Z'),
          supplier: { name: 'Tedarikçi A', active: true },
        },
        {
          supplierId: 's2',
          balance: new Prisma.Decimal(3000),
          threshold: new Prisma.Decimal(1000),
          lowBalanceNotifiedAt: null,
          updatedAt: new Date('2026-06-02T00:00:00Z'),
          supplier: { name: 'Tedarikçi A', active: true },
        },
      ]);

      const res = await svc.getSummary('t1');

      expect(res.totals.totalBalance).toBe(3500);
      expect(res.totals.supplierCount).toBe(2);
      expect(res.totals.lowCount).toBe(1);
      expect(res.totals.currency).toBe('TRY');
      expect(res.suppliers[0].isLow).toBe(true);
      expect(res.suppliers[0].lowBalanceNotifiedAt).toBe(
        '2026-06-01T00:00:00.000Z',
      );
      expect(res.suppliers[1].isLow).toBe(false);
    });

    it('returns zeroed totals when there are no accounts', async () => {
      const { svc } = build();
      const res = await svc.getSummary('t1');
      expect(res.totals).toEqual({
        totalBalance: 0,
        supplierCount: 0,
        lowCount: 0,
        currency: 'TRY',
      });
      expect(res.suppliers).toEqual([]);
    });
  });

  // ────────────────────── getSupplierAccount ──────────────────────
  describe('getSupplierAccount', () => {
    it('returns the stored account when present', async () => {
      const { svc, deps } = build();
      fn(deps.prisma.supplierAccount.findUnique).mockResolvedValue({
        balance: new Prisma.Decimal(750),
        threshold: new Prisma.Decimal(1000),
        lowBalanceNotifiedAt: null,
        updatedAt: new Date('2026-06-02T00:00:00Z'),
      });
      const res = await svc.getSupplierAccount('s1', 't1');
      expect(res.balance).toBe(750);
      expect(res.threshold).toBe(1000);
      expect(res.isLow).toBe(true);
      expect(res.supplierName).toBe('Tedarikçi A');
    });

    it('returns defaults (0 / 1000) when no account row exists yet', async () => {
      const { svc, deps } = build();
      fn(deps.prisma.supplierAccount.findUnique).mockResolvedValue(null);
      const res = await svc.getSupplierAccount('s1', 't1');
      expect(res.balance).toBe(0);
      expect(res.threshold).toBe(1000);
      expect(res.isLow).toBe(true);
      expect(res.lastMovementAt).toBeNull();
    });

    it('throws NotFoundException when the supplier is missing', async () => {
      const { svc, deps } = build();
      fn(deps.prisma.supplier.findFirst).mockResolvedValue(null);
      await expect(
        svc.getSupplierAccount('s1', 't1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ───────────────────────── getLedger ─────────────────────────
  describe('getLedger', () => {
    it('returns a paginated, mapped ledger page', async () => {
      const { svc, deps } = build();
      fn(deps.prisma.supplierAccountLedger.findMany).mockResolvedValue([
        {
          id: 'l1',
          type: SupplierLedgerType.ORDER_PURCHASE,
          amount: new Prisma.Decimal(-1200.5),
          balanceAfter: new Prisma.Decimal(3799.5),
          orderId: 'o1',
          humanOrderNo: '12345',
          description: 'Sipariş #12345',
          createdByUserId: null,
          createdAt: new Date('2026-06-02T00:00:00Z'),
        },
      ]);
      fn(deps.prisma.supplierAccountLedger.count).mockResolvedValue(1);

      const res = await svc.getLedger('s1', 't1', { page: 1, pageSize: 20 });
      expect(res.total).toBe(1);
      expect(res.page).toBe(1);
      expect(res.pageSize).toBe(20);
      expect(res.rows[0].amount).toBe(-1200.5);
      expect(res.rows[0].balanceAfter).toBe(3799.5);
      expect(res.rows[0].createdAt).toBe('2026-06-02T00:00:00.000Z');
    });

    it('clamps pageSize to the maximum and defaults the page to 1', async () => {
      const { svc, deps } = build();
      await svc.getLedger('s1', 't1', { page: 0, pageSize: 9999 });
      const findArg = fn(deps.prisma.supplierAccountLedger.findMany).mock
        .calls[0][0];
      expect(findArg.take).toBe(200); // MAX_PAGE_SIZE
      expect(findArg.skip).toBe(0); // page clamped to 1
    });

    it('applies the type filter when provided', async () => {
      const { svc, deps } = build();
      await svc.getLedger('s1', 't1', {
        type: SupplierLedgerType.TOPUP,
      });
      const findArg = fn(deps.prisma.supplierAccountLedger.findMany).mock
        .calls[0][0];
      expect(findArg.where.type).toBe(SupplierLedgerType.TOPUP);
    });
  });

  // ────────────────────── maybeNotifyLowBalance ──────────────────────
  describe('maybeNotifyLowBalance', () => {
    function lowAccount(over: Record<string, unknown> = {}) {
      return {
        id: 'acc1',
        tenantId: 't1',
        balance: new Prisma.Decimal(500),
        threshold: new Prisma.Decimal(1000),
        lowBalanceNotifiedAt: null,
        supplier: { name: 'Tedarikçi A' },
        ...over,
      };
    }

    it('emits an admin notification and mail when below threshold (no prior notice)', async () => {
      const { svc, deps } = build();
      fn(deps.prisma.supplierAccount.findUnique).mockResolvedValue(
        lowAccount(),
      );
      fn(deps.adminNotifier.resolveAdminEmails).mockResolvedValue([
        'admin@ornek.com',
      ]);

      await svc.maybeNotifyLowBalance('s1');

      expect(deps.notifications.emit).toHaveBeenCalledTimes(1);
      const emitArg = fn(deps.notifications.emit).mock.calls[0][0];
      expect(emitArg.type).toBe('supplier.balance.low');
      expect(emitArg.severity).toBe('warning');
      expect(emitArg.audience).toEqual({ role: 'ADMIN' });
      expect(deps.mail.sendAdminSupplierLowBalance).toHaveBeenCalledWith(
        expect.objectContaining({
          to: ['admin@ornek.com'],
          supplierName: 'Tedarikçi A',
          balance: 500,
          threshold: 1000,
        }),
      );
    });

    it('does nothing when the balance is at or above the threshold', async () => {
      const { svc, deps } = build();
      fn(deps.prisma.supplierAccount.findUnique).mockResolvedValue(
        lowAccount({ balance: new Prisma.Decimal(2000) }),
      );
      await svc.maybeNotifyLowBalance('s1');
      expect(deps.notifications.emit).not.toHaveBeenCalled();
      expect(deps.mail.sendAdminSupplierLowBalance).not.toHaveBeenCalled();
    });

    it('clears the notified flag when balance recovers above threshold', async () => {
      const { svc, deps } = build();
      fn(deps.prisma.supplierAccount.findUnique).mockResolvedValue(
        lowAccount({
          balance: new Prisma.Decimal(2000),
          lowBalanceNotifiedAt: new Date('2026-06-01T00:00:00Z'),
        }),
      );
      await svc.maybeNotifyLowBalance('s1');
      expect(deps.prisma.supplierAccount.update).toHaveBeenCalledWith({
        where: { id: 'acc1' },
        data: { lowBalanceNotifiedAt: null },
      });
    });

    it('respects the cooldown — does not re-notify within the window', async () => {
      const { svc, deps } = build();
      // fresh (tx içi) okuma cooldown içinde bir bildirim zamanı döner.
      const recent = new Date();
      fn(deps.prisma.supplierAccount.findUnique).mockResolvedValue(
        lowAccount({ lowBalanceNotifiedAt: recent }),
      );
      await svc.maybeNotifyLowBalance('s1');
      expect(deps.notifications.emit).not.toHaveBeenCalled();
      expect(deps.mail.sendAdminSupplierLowBalance).not.toHaveBeenCalled();
    });

    it('returns quietly when the account does not exist', async () => {
      const { svc, deps } = build();
      fn(deps.prisma.supplierAccount.findUnique).mockResolvedValue(null);
      await expect(svc.maybeNotifyLowBalance('s1')).resolves.toBeUndefined();
      expect(deps.notifications.emit).not.toHaveBeenCalled();
    });

    it('swallows errors so the caller flow is never broken', async () => {
      const { svc, deps } = build();
      fn(deps.prisma.supplierAccount.findUnique).mockRejectedValue(
        new Error('db down'),
      );
      await expect(svc.maybeNotifyLowBalance('s1')).resolves.toBeUndefined();
    });
  });
});

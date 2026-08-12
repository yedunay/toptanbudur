import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { VaultService } from '../../vault/vault.service';
import { MailService } from '../../mail/mail.service';
import { AdminNotifierService } from '../../mail/admin-notifier.service';
import { XmlSlotService } from '../../product-core/xml-slot.service';
import { AdminSuppliersService } from './admin-suppliers.service';

// Service uses `$transaction(async (tx) => ...)` callback form for `remove` +
// `create` cascade; the helper below returns the same model mock as `tx` so
// `tx.supplier.deleteMany` mutates the same jest.fn as `prisma.supplier.deleteMany`.
const makePrismaMock = (overrides: Partial<Record<string, unknown>> = {}) => {
  const base = {
    supplier: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    supplierFeed: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    supplierCategory: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    supplierBrandMapping: {
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn(),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    product: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
      groupBy: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    $queryRaw: jest.fn().mockResolvedValue([]),
    $executeRaw: jest.fn().mockResolvedValue(0),
    ...overrides,
  } as Record<string, unknown>;
  // Callback-form $transaction reuses the same mock as `tx` so model spies
  // capture calls made from inside the transaction body.
  base.$transaction = jest
    .fn()
    .mockImplementation(async (arg: unknown) => {
      if (typeof arg === 'function') {
        return (arg as (tx: typeof base) => Promise<unknown>)(base);
      }
      // Array-form: resolve each promise (legacy interactive transactions).
      if (Array.isArray(arg)) return Promise.all(arg);
      return arg;
    });
  return base as unknown as PrismaService;
};

const makeVaultMock = (): VaultService =>
  ({ seal: jest.fn().mockReturnValue('sealed'), open: jest.fn() }) as unknown as VaultService;

const makeMailMock = (): MailService =>
  ({ sendAdminNewSupplier: jest.fn().mockResolvedValue(undefined) }) as unknown as MailService;

const makeAdminNotifierMock = (): AdminNotifierService =>
  ({
    resolveAdminEmails: jest.fn().mockResolvedValue([]),
    resolveDefaultTenantId: jest.fn().mockResolvedValue(null),
    notifyAdmins: jest.fn().mockResolvedValue(undefined),
  }) as unknown as AdminNotifierService;

const makeXmlSlotMock = (): XmlSlotService =>
  ({ recomputeSlots: jest.fn().mockResolvedValue(undefined) }) as unknown as XmlSlotService;

const makeQueueMock = () => ({ add: jest.fn().mockResolvedValue({ id: 'job1' }) });

describe('AdminSuppliersService', () => {
  describe('list', () => {
    it('returns empty list when no suppliers exist', async () => {
      const svc = new AdminSuppliersService(
        makePrismaMock(),
        makeVaultMock(),
        makeMailMock(),
        makeAdminNotifierMock(),
        makeXmlSlotMock(),
        makeQueueMock() as never,
      );
      const result = await svc.list('t1', {});
      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
      expect(result.meta.total).toBe(0);
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException when supplier not found', async () => {
      const svc = new AdminSuppliersService(
        makePrismaMock(),
        makeVaultMock(),
        makeMailMock(),
        makeAdminNotifierMock(),
        makeXmlSlotMock(),
        makeQueueMock() as never,
      );
      await expect(svc.findOne('t1', 'nonexistent')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('remove', () => {
    it('hard-deletes supplier WITH products, cascading product deletes inside tx', async () => {
      const prisma = makePrismaMock();
      (prisma.supplier.findFirst as jest.Mock).mockResolvedValue({
        id: 's1',
        name: 'Acme',
        _count: { products: 3 },
      });

      const svc = new AdminSuppliersService(
        prisma,
        makeVaultMock(),
        makeMailMock(),
        makeAdminNotifierMock(),
        makeXmlSlotMock(),
        makeQueueMock() as never,
      );
      const result = await svc.remove('t1', 's1');

      // Service now always hard-deletes; soft-delete branch was removed
      // because foreign-key cascade is owned by the $transaction body.
      expect(result.data.deleted).toBe(true);
      expect(result.data.productCount).toBe(3);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      // Cascade: products are deleted because productCount > 0.
      expect(prisma.product.deleteMany).toHaveBeenCalledWith({
        where: { tenantId: 't1', supplierId: 's1' },
      });
      expect(prisma.supplier.deleteMany).toHaveBeenCalledWith({
        where: { id: 's1', tenantId: 't1' },
      });
    });

    it('hard-deletes supplier with no products WITHOUT calling product.deleteMany', async () => {
      const prisma = makePrismaMock();
      (prisma.supplier.findFirst as jest.Mock).mockResolvedValue({
        id: 's2',
        name: 'Beta',
        _count: { products: 0 },
      });

      const svc = new AdminSuppliersService(
        prisma,
        makeVaultMock(),
        makeMailMock(),
        makeAdminNotifierMock(),
        makeXmlSlotMock(),
        makeQueueMock() as never,
      );
      const result = await svc.remove('t1', 's2');
      expect(result.data.deleted).toBe(true);
      expect(result.data.productCount).toBe(0);
      // No-op shortcut: product.deleteMany NOT called when count is 0.
      expect(prisma.product.deleteMany).not.toHaveBeenCalled();
      expect(prisma.supplier.deleteMany).toHaveBeenCalledWith({
        where: { id: 's2', tenantId: 't1' },
      });
    });
  });

  describe('enqueueSync', () => {
    it('enqueues a BullMQ job per active feed and returns jobIds', async () => {
      const queueMock = makeQueueMock();
      const prisma = makePrismaMock();
      (prisma.supplier.findFirst as jest.Mock).mockResolvedValue({
        id: 's1',
        tenantId: 't1',
        active: true,
      });
      (prisma.supplierFeed.findMany as jest.Mock).mockResolvedValue([
        { id: 'feed1' },
      ]);
      const svc = new AdminSuppliersService(
        prisma,
        makeVaultMock(),
        makeMailMock(),
        makeAdminNotifierMock(),
        makeXmlSlotMock(),
        queueMock as never,
      );
      const result = await svc.enqueueSync('t1', 's1');
      expect(result.success).toBe(true);
      expect(result.data.jobIds[0]).toBe('job1');
      expect(queueMock.add).toHaveBeenCalledTimes(1);
    });

    it('skips when supplier is inactive', async () => {
      const queueMock = makeQueueMock();
      const prisma = makePrismaMock();
      (prisma.supplier.findFirst as jest.Mock).mockResolvedValue({
        id: 's1',
        tenantId: 't1',
        active: false,
      });
      const svc = new AdminSuppliersService(
        prisma,
        makeVaultMock(),
        makeMailMock(),
        makeAdminNotifierMock(),
        makeXmlSlotMock(),
        queueMock as never,
      );
      const result = await svc.enqueueSync('t1', 's1');
      expect(result.data.jobIds).toEqual([]);
      expect(queueMock.add).not.toHaveBeenCalled();
    });
  });

  describe('upsertBrandMappings — marka bazlı aktif/pasif', () => {
    it('deactivates products of hidden brands immediately and reports hidden count', async () => {
      const prisma = makePrismaMock();
      (prisma.supplier.findFirst as jest.Mock).mockResolvedValue({ id: 's1' });
      (prisma.supplierBrandMapping.upsert as jest.Mock).mockReturnValue(
        Promise.resolve({
          id: 'bm1',
          sourceBrandName: 'Marka',
          targetBrandName: null,
          hidden: true,
          updatedAt: new Date(),
        }),
      );
      // recomputeBrandsForSupplier issues 2 raw queries in order:
      //   [0] brand-name normalization, [1] hidden-brand deactivation.
      (prisma.$executeRaw as jest.Mock)
        .mockResolvedValueOnce(10) // brand-name normalization rows
        .mockResolvedValueOnce(3); // hidden-brand products deactivated

      const svc = new AdminSuppliersService(
        prisma,
        makeVaultMock(),
        makeMailMock(),
        makeAdminNotifierMock(),
        makeXmlSlotMock(),
        makeQueueMock() as never,
      );

      const result = await svc.upsertBrandMappings('t1', 's1', {
        mappings: [{ sourceBrandName: 'Marka', hidden: true }],
      });

      expect(result.success).toBe(true);
      expect(result.meta.hidden).toBe(3);
      expect(result.meta.updated).toBe(1);
      // Brand-name recompute + hidden deactivation = two raw statements.
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);
    });
  });

  describe('listProducts — marka drill-down', () => {
    const makeSvc = (prisma: PrismaService) =>
      new AdminSuppliersService(
        prisma,
        makeVaultMock(),
        makeMailMock(),
        makeAdminNotifierMock(),
        makeXmlSlotMock(),
        makeQueueMock() as never,
      );

    it('filtreyi ham markaya (Product.sourceBrand) uygular — Product.brand değil', async () => {
      const prisma = makePrismaMock();
      (prisma.supplier.findFirst as jest.Mock).mockResolvedValue({ id: 's1' });
      (prisma.product.count as jest.Mock).mockResolvedValue(0);

      await makeSvc(prisma).listProducts(
        't1',
        's1',
        1,
        50,
        undefined,
        undefined,
        'Marka',
      );

      // Hem stoktaki hem stoksuz sayım çağrıları sourceBrand ile filtrelenmeli.
      const countCalls = (prisma.product.count as jest.Mock).mock.calls;
      expect(countCalls).toHaveLength(2);
      for (const [arg] of countCalls) {
        expect(arg.where).toEqual(
          expect.objectContaining({
            tenantId: 't1',
            supplierId: 's1',
            sourceBrand: 'Marka',
          }),
        );
        expect(arg.where).not.toHaveProperty('brand');
      }
    });

    it('sourceBrand baştaki/sondaki boşluklardan arındırılır', async () => {
      const prisma = makePrismaMock();
      (prisma.supplier.findFirst as jest.Mock).mockResolvedValue({ id: 's1' });
      (prisma.product.count as jest.Mock).mockResolvedValue(0);

      await makeSvc(prisma).listProducts(
        't1',
        's1',
        1,
        50,
        undefined,
        undefined,
        '  Marka  ',
      );

      const [firstCall] = (prisma.product.count as jest.Mock).mock.calls;
      expect(firstCall[0].where).toHaveProperty('sourceBrand', 'Marka');
    });

    it('sourceBrand verilmezse where içine sourceBrand eklenmez', async () => {
      const prisma = makePrismaMock();
      (prisma.supplier.findFirst as jest.Mock).mockResolvedValue({ id: 's1' });
      (prisma.product.count as jest.Mock).mockResolvedValue(0);

      await makeSvc(prisma).listProducts('t1', 's1', 1, 50);

      for (const [arg] of (prisma.product.count as jest.Mock).mock.calls) {
        expect(arg.where).not.toHaveProperty('sourceBrand');
      }
    });
  });
});

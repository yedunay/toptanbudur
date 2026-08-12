import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ProductDedupService } from '../product-core/product-dedup.service';
import { AdminProductsService } from './admin-products.service';

const makeAudit = (): AuditService =>
  ({ log: jest.fn().mockResolvedValue(undefined) }) as unknown as AuditService;

const makeDedup = (): ProductDedupService =>
  ({
    recomputeCanonicalForKeys: jest.fn().mockResolvedValue(undefined),
  }) as unknown as ProductDedupService;

interface PrismaMock {
  product: {
    count: jest.Mock;
    findMany: jest.Mock;
    findFirst: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
  };
  category: {
    findFirst: jest.Mock;
    findMany: jest.Mock;
  };
  $executeRaw: jest.Mock;
}

const makePrisma = (overrides: Partial<PrismaMock> = {}): PrismaService => {
  const base: PrismaMock = {
    product: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    category: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    },
    $executeRaw: jest.fn().mockResolvedValue(0),
  };
  return {
    ...base,
    ...overrides,
    product: { ...base.product, ...overrides.product },
  } as unknown as PrismaService;
};

// update() yanıtı için tam alan seçimi içeren satır fabrikası.
const makeUpdatedRow = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  slug: 'urun-1',
  name: 'Test ürün',
  price: new Prisma.Decimal(150),
  currency: 'TRY',
  stock: 5,
  manualPrice: null,
  manualStock: null,
  feedPrice: new Prisma.Decimal(150),
  feedStock: 5,
  active: true,
  updatedAt: new Date('2026-05-01T00:00:00Z'),
  ...over,
});

describe('AdminProductsService', () => {
  describe('list — universal search (q)', () => {
    it('matches barcode via OR contains filter', async () => {
      // Arrange
      const productRow = {
        id: 'p1',
        slug: 'urun-1',
        externalCode: 'TBDR-12345',
        name: 'Test ürün',
        brand: 'TBDR',
        model: null,
        barcode: '8690000123456',
        publicBarcode: 'TBDR7K2P',
        costPrice: 100,
        price: 150,
        currency: 'TRY',
        stock: 5,
        active: true,
        updatedAt: new Date('2026-05-01T00:00:00Z'),
        supplier: { id: 's1', name: 'Tedarikçi A' },
        category: { name: 'Cat', slug: 'cat', path: 'Cat' },
        images: [],
      };
      const count = jest
        .fn()
        .mockResolvedValueOnce(1) // in-stock count
        .mockResolvedValueOnce(0); // out-of-stock count
      const findMany = jest
        .fn()
        .mockResolvedValueOnce([productRow]) // in-stock slice
        .mockResolvedValueOnce([]); // out-of-stock slice
      const svc = new AdminProductsService(
        makePrisma({
          product: { count, findMany } as unknown as PrismaMock['product'],
        }),
        makeAudit(),
        makeDedup(),
      );

      // Act
      const result = await svc.list('t1', { q: '8690000123456' });

      // Assert: count was called with where containing OR for barcode
      const firstCountArg = count.mock.calls[0][0];
      expect(firstCountArg.where.OR).toBeDefined();
      const orFields = (firstCountArg.where.OR as Array<Record<string, unknown>>).map(
        (clause) => Object.keys(clause)[0],
      );
      expect(orFields).toEqual(
        expect.arrayContaining([
          'name',
          'brand',
          'externalCode',
          'barcode',
          'publicBarcode',
        ]),
      );
      expect(result.data).toHaveLength(1);
      expect(result.data[0].barcode).toBe('8690000123456');
      expect(result.data[0].sku).toBe('TBDR-12345');
    });

    it('returns empty result when q matches nothing', async () => {
      const count = jest
        .fn()
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0);
      const findMany = jest.fn().mockResolvedValue([]);
      const svc = new AdminProductsService(
        makePrisma({
          product: { count, findMany } as unknown as PrismaMock['product'],
        }),
        makeAudit(),
        makeDedup(),
      );

      const result = await svc.list('t1', { q: 'doesnotexist' });

      expect(result.data).toEqual([]);
      expect(result.meta.total).toBe(0);
    });
  });

  describe('update — manuel override', () => {
    // Mevcut satır: feedPrice=100, feedStock=7, efektif price=150, stock=5.
    const existingRow = {
      id: 'p1',
      feedPrice: new Prisma.Decimal(100),
      feedStock: 7,
      price: new Prisma.Decimal(150),
      stock: 5,
    };

    it('sayı fiyat → manualPrice pinlenir, efektif price = manuel değer', async () => {
      // Arrange
      const findFirst = jest.fn().mockResolvedValue(existingRow);
      const update = jest.fn().mockResolvedValue(makeUpdatedRow());
      const svc = new AdminProductsService(
        makePrisma({
          product: { findFirst, update } as unknown as PrismaMock['product'],
        }),
        makeAudit(),
        makeDedup(),
      );

      // Act
      await svc.update('t1', 'p1', { price: 199.9 });

      // Assert
      const data = update.mock.calls[0][0].data;
      expect(Number(data.manualPrice)).toBe(199.9);
      expect(Number(data.price)).toBe(199.9);
    });

    it('null fiyat → manualPrice temizlenir, efektif price = feedPrice', async () => {
      const findFirst = jest.fn().mockResolvedValue(existingRow);
      const update = jest.fn().mockResolvedValue(makeUpdatedRow());
      const svc = new AdminProductsService(
        makePrisma({
          product: { findFirst, update } as unknown as PrismaMock['product'],
        }),
        makeAudit(),
        makeDedup(),
      );

      await svc.update('t1', 'p1', { price: null });

      const data = update.mock.calls[0][0].data;
      expect(data.manualPrice).toBeNull();
      expect(Number(data.price)).toBe(100); // feedPrice
    });

    it('null stok → manualStock temizlenir, stock = feedStock, marketplaceListed = feedStock>0', async () => {
      const findFirst = jest.fn().mockResolvedValue(existingRow);
      const update = jest.fn().mockResolvedValue(makeUpdatedRow());
      const svc = new AdminProductsService(
        makePrisma({
          product: { findFirst, update } as unknown as PrismaMock['product'],
        }),
        makeAudit(),
        makeDedup(),
      );

      await svc.update('t1', 'p1', { stock: null });

      const data = update.mock.calls[0][0].data;
      expect(data.manualStock).toBeNull();
      expect(data.stock).toBe(7); // feedStock
      expect(data.marketplaceListed).toBe(true);
    });

    it('sayı stok=0 → manualStock=0 pinlenir, marketplaceListed=false', async () => {
      const findFirst = jest.fn().mockResolvedValue(existingRow);
      const update = jest.fn().mockResolvedValue(makeUpdatedRow());
      const svc = new AdminProductsService(
        makePrisma({
          product: { findFirst, update } as unknown as PrismaMock['product'],
        }),
        makeAudit(),
        makeDedup(),
      );

      await svc.update('t1', 'p1', { stock: 0 });

      const data = update.mock.calls[0][0].data;
      expect(data.manualStock).toBe(0);
      expect(data.stock).toBe(0);
      expect(data.marketplaceListed).toBe(false);
    });
  });

  describe('bulkUpdate — manuel override', () => {
    it('sayı fiyat → updateMany manualPrice+price set, raw COALESCE çağrılmaz', async () => {
      // Arrange
      const updateMany = jest.fn().mockResolvedValue({ count: 2 });
      const executeRaw = jest.fn().mockResolvedValue(0);
      const svc = new AdminProductsService(
        makePrisma({
          product: { updateMany } as unknown as PrismaMock['product'],
          $executeRaw: executeRaw,
        }),
        makeAudit(),
        makeDedup(),
      );

      // Act
      const res = await svc.bulkUpdate('t1', {
        ids: ['p1', 'p2'],
        patch: { price: 250 },
      });

      // Assert
      const data = updateMany.mock.calls[0][0].data;
      expect(Number(data.manualPrice)).toBe(250);
      expect(Number(data.price)).toBe(250);
      expect(executeRaw).not.toHaveBeenCalled();
      expect(res.updated).toBe(2);
    });

    it('null fiyat → updateMany manualPrice=null, sonra raw COALESCE çağrılır', async () => {
      const updateMany = jest.fn().mockResolvedValue({ count: 2 });
      const executeRaw = jest.fn().mockResolvedValue(2);
      const svc = new AdminProductsService(
        makePrisma({
          product: { updateMany } as unknown as PrismaMock['product'],
          $executeRaw: executeRaw,
        }),
        makeAudit(),
        makeDedup(),
      );

      await svc.bulkUpdate('t1', { ids: ['p1', 'p2'], patch: { price: null } });

      const data = updateMany.mock.calls[0][0].data;
      expect(data.manualPrice).toBeNull();
      expect(data.price).toBeUndefined(); // efektif price raw SQL ile set edilir
      expect(executeRaw).toHaveBeenCalledTimes(1);
    });

    it('null stok → raw COALESCE stok + marketplaceListed günceller', async () => {
      const updateMany = jest.fn().mockResolvedValue({ count: 3 });
      const executeRaw = jest.fn().mockResolvedValue(3);
      const svc = new AdminProductsService(
        makePrisma({
          product: { updateMany } as unknown as PrismaMock['product'],
          $executeRaw: executeRaw,
        }),
        makeAudit(),
        makeDedup(),
      );

      await svc.bulkUpdate('t1', {
        ids: ['p1', 'p2', 'p3'],
        patch: { stock: null },
      });

      const data = updateMany.mock.calls[0][0].data;
      expect(data.manualStock).toBeNull();
      expect(executeRaw).toHaveBeenCalledTimes(1);
    });
  });
});

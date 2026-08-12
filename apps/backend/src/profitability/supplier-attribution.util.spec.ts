import {
  DELETED_SUPPLIER_NAME,
  resolveSupplier,
  resolveSupplierId,
  supplierMatchOr,
  snapshotSupplierBeforeProductDelete,
} from './supplier-attribution.util';

describe('resolveSupplierId', () => {
  it('prefers override over snapshot and product', () => {
    expect(
      resolveSupplierId({
        supplierIdOverride: 'ov',
        supplierIdSnapshot: 'snap',
        product: { supplierId: 'prod' },
      }),
    ).toBe('ov');
  });

  it('uses snapshot when no override (e.g. hard-deleted product)', () => {
    expect(
      resolveSupplierId({
        supplierIdOverride: null,
        supplierIdSnapshot: 'snap',
        product: null,
      }),
    ).toBe('snap');
  });

  it('falls back to live product supplier when no override/snapshot', () => {
    expect(
      resolveSupplierId({
        supplierIdOverride: null,
        supplierIdSnapshot: null,
        product: { supplierId: 'prod' },
      }),
    ).toBe('prod');
  });

  it('returns null when nothing is attributable', () => {
    expect(
      resolveSupplierId({
        supplierIdOverride: null,
        supplierIdSnapshot: null,
        product: null,
      }),
    ).toBeNull();
  });
});

describe('resolveSupplier (id + name always agree)', () => {
  it('override branch → override id and override name', () => {
    expect(
      resolveSupplier({
        supplierIdOverride: 'ov',
        supplierOverride: { name: 'Override A.Ş.' },
        supplierIdSnapshot: 'snap',
        supplierNameSnapshot: 'Snap A.Ş.',
        product: { supplierId: 'prod', supplier: { name: 'Prod A.Ş.' } },
      }),
    ).toEqual({ id: 'ov', name: 'Override A.Ş.' });
  });

  it('snapshot branch, product still same supplier → uses CURRENT (renamed) product name', () => {
    // Tedarikçi yeniden adlandırıldı: id snapshot'tan (S1), ad güncel üründen.
    expect(
      resolveSupplier({
        supplierIdOverride: null,
        supplierIdSnapshot: 'S1',
        supplierNameSnapshot: 'Eski Ad',
        product: { supplierId: 'S1', supplier: { name: 'Yeni Ad' } },
      }),
    ).toEqual({ id: 'S1', name: 'Yeni Ad' });
  });

  it('snapshot branch, product MOVED to another supplier → id and name BOTH from snapshot', () => {
    // Bu, eski kodun yanlış etiketlediği senaryo: id=S1 ama eski kod adı S2 (ürün) gösteriyordu.
    expect(
      resolveSupplier({
        supplierIdOverride: null,
        supplierIdSnapshot: 'S1',
        supplierNameSnapshot: 'S1 Adı',
        product: { supplierId: 'S2', supplier: { name: 'S2 Adı' } },
      }),
    ).toEqual({ id: 'S1', name: 'S1 Adı' });
  });

  it('snapshot branch, product hard-deleted → snapshot name', () => {
    expect(
      resolveSupplier({
        supplierIdOverride: null,
        supplierIdSnapshot: 'S1',
        supplierNameSnapshot: 'Silinen Ürünün Tedarikçisi',
        product: null,
      }),
    ).toEqual({ id: 'S1', name: 'Silinen Ürünün Tedarikçisi' });
  });

  it('product branch → product supplier id and name', () => {
    expect(
      resolveSupplier({
        supplierIdOverride: null,
        supplierIdSnapshot: null,
        product: { supplierId: 'prod', supplier: { name: 'Prod A.Ş.' } },
      }),
    ).toEqual({ id: 'prod', name: 'Prod A.Ş.' });
  });

  it('nothing attributable → null id and fallback name', () => {
    expect(
      resolveSupplier({
        supplierIdOverride: null,
        supplierIdSnapshot: null,
        product: null,
      }),
    ).toEqual({ id: null, name: DELETED_SUPPLIER_NAME });
  });

  it('honors a custom fallback for the unresolved name', () => {
    expect(resolveSupplier({ product: null }, '—')).toEqual({ id: null, name: '—' });
  });
});

describe('supplierMatchOr', () => {
  it('mirrors the resolution priority override → snapshot → product', () => {
    expect(supplierMatchOr('s9')).toEqual([
      { supplierIdOverride: 's9' },
      { supplierIdOverride: null, supplierIdSnapshot: 's9' },
      {
        supplierIdOverride: null,
        supplierIdSnapshot: null,
        product: { supplierId: 's9' },
      },
    ]);
  });
});

describe('snapshotSupplierBeforeProductDelete', () => {
  it('fills snapshot only for null rows, grouped per supplier', async () => {
    const findMany = jest.fn().mockResolvedValue([
      { id: 'p1', supplierId: 'sA', supplier: { name: 'A' } },
      { id: 'p2', supplierId: 'sA', supplier: { name: 'A' } },
      { id: 'p3', supplierId: 'sB', supplier: { name: 'B' } },
    ]);
    const updateMany = jest
      .fn()
      .mockResolvedValueOnce({ count: 2 })
      .mockResolvedValueOnce({ count: 1 });
    // Müşteri-kodu snapshot'ı tek raw UPDATE...FROM ile yazılır (ürün başına
    // benzersiz internalCode → grupla­namaz). Tagged-template mock'u.
    const executeRaw = jest.fn().mockResolvedValue(0);
    const db = {
      product: { findMany },
      orderItem: { updateMany },
      $executeRaw: executeRaw,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const filled = await snapshotSupplierBeforeProductDelete(db, {
      id: { in: ['p1', 'p2', 'p3'] },
    });

    expect(filled).toBe(3);
    expect(updateMany).toHaveBeenCalledTimes(2);
    expect(updateMany).toHaveBeenCalledWith({
      where: { productId: { in: ['p1', 'p2'] }, supplierIdSnapshot: null },
      data: { supplierIdSnapshot: 'sA', supplierNameSnapshot: 'A' },
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { productId: { in: ['p3'] }, supplierIdSnapshot: null },
      data: { supplierIdSnapshot: 'sB', supplierNameSnapshot: 'B' },
    });
    // MÜŞTERİ-kodu snapshot'ı da silmeden önce yazılır (tüm ürün id chunk'ı için
    // tek raw UPDATE...FROM): slug-sızıntısının silme-yolu savunması.
    expect(executeRaw).toHaveBeenCalledTimes(1);
  });

  it('no-ops when no products match', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const updateMany = jest.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = { product: { findMany }, orderItem: { updateMany } } as any;

    const filled = await snapshotSupplierBeforeProductDelete(db, { id: { in: [] } });

    expect(filled).toBe(0);
    expect(updateMany).not.toHaveBeenCalled();
  });
});

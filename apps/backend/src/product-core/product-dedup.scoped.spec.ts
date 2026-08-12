import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AppSettingsService } from '../app-settings/app-settings.service';
import { ProductDedupService } from './product-dedup.service';

/**
 * recomputeCanonicalForKeys — HEDEFLİ canonical yeniden-hesabı.
 *
 * Senaryo (admin manuel stok / stock-reconcile sonrası "adaptif" davranış):
 * Aynı isimde A ve B ürünleri var. A canonical iken stoğu 0'a düşerse, STOKLU
 * kardeş B canonical olmalı (yoksa feed `isCanonical=true AND stock>0` ile ürün
 * komple kaybolur). A tekrar stoğa/üstünlüğe dönerse canonical geri alınmalı.
 */
const KEY = 'Kılıf';

const row = (over: Partial<{
  id: string;
  stock: number;
  isCanonical: boolean;
  isCheapestInGroup: boolean;
  price: number;
}>) => ({
  id: over.id ?? 'X',
  name: KEY,
  nameKey: KEY,
  price: new Prisma.Decimal(over.price ?? 100),
  stock: over.stock ?? 0,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  isCanonical: over.isCanonical ?? false,
  isCheapestInGroup: over.isCheapestInGroup ?? false,
  matchGroupId: null,
  supplier: { stockThreshold: 0 },
});

const makePrisma = (rows: ReturnType<typeof row>[]) => {
  const updateMany = jest.fn().mockResolvedValue({ count: 0 });
  const findMany = jest.fn().mockResolvedValue(rows);
  const tx = { product: { updateMany } };
  const $transaction = jest.fn(async (cb: (t: typeof tx) => Promise<unknown>) =>
    cb(tx),
  );
  const prisma = {
    product: { findMany },
    // Vitrin/Satın-Alma flag'i açıkken aktif match-group'lar sorgulanır;
    // testlerde aktif grup yok → nameKey davranışı aynen sürer.
    productMatchGroup: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction,
  } as unknown as PrismaService;
  return { prisma, findMany, updateMany, $transaction };
};

// PRODUCT_MATCH_SETTING_KEYS.ENABLED default'u true — gerçek davranışla aynı.
const makeAppSettings = () =>
  ({
    getBoolean: jest.fn().mockResolvedValue(true),
  } as unknown as AppSettingsService);

// updateMany çağrılarından (id -> yeni bayrak) haritası çıkar. Servis artık
// isCanonical'a ek olarak isCheapestInGroup da yazıyor; flag'e göre ayrıştır.
const flipsFrom = (
  updateMany: jest.Mock,
  flag: 'isCanonical' | 'isCheapestInGroup' = 'isCanonical',
) => {
  const flips: Record<string, boolean> = {};
  for (const call of updateMany.mock.calls) {
    const arg = call[0] as {
      where: { id: { in: string[] } };
      data: Partial<{ isCanonical: boolean; isCheapestInGroup: boolean }>;
    };
    if (arg.data[flag] === undefined) continue;
    for (const id of arg.where.id.in) flips[id] = arg.data[flag]!;
  }
  return flips;
};

describe('ProductDedupService.recomputeCanonicalForKeys', () => {
  it('0 stoğa düşen canonical yerine STOKLU kardeşi canonical yapar', async () => {
    const { prisma, updateMany } = makePrisma([
      // eski canonical + admin-en-ucuz, artık 0 stok
      row({ id: 'A', stock: 0, isCanonical: true, isCheapestInGroup: true }),
      row({ id: 'B', stock: 20, isCanonical: false }), // stoklu kardeş
    ]);
    const svc = new ProductDedupService(prisma, makeAppSettings());
    await svc.recomputeCanonicalForKeys('t1', [KEY]);

    const flips = flipsFrom(updateMany);
    expect(flips['A']).toBe(false); // gizlenir
    expect(flips['B']).toBe(true); // devralır → ürün feed'de görünür kalır

    // ADMIN en-ucuz bayrağı da stoklu kardeşe taşınır (additive davranış).
    const cheapFlips = flipsFrom(updateMany, 'isCheapestInGroup');
    expect(cheapFlips['A']).toBe(false);
    expect(cheapFlips['B']).toBe(true);
  });

  it('stok/üstünlük geri dönen ürün canonical olarak geri alınır', async () => {
    // A daha pahalı (price DESC kazanır) ve tekrar stoklu → A geri canonical olmalı.
    const { prisma, updateMany } = makePrisma([
      row({ id: 'A', stock: 10, isCanonical: false, price: 200 }),
      // B en ucuz stoklu → isCheapestInGroup zaten doğru, o bayrak yazılmaz.
      row({
        id: 'B',
        stock: 20,
        isCanonical: true,
        price: 100,
        isCheapestInGroup: true,
      }),
    ]);
    const svc = new ProductDedupService(prisma, makeAppSettings());
    await svc.recomputeCanonicalForKeys('t1', [KEY]);

    const flips = flipsFrom(updateMany);
    expect(flips['A']).toBe(true);
    expect(flips['B']).toBe(false);
  });

  it('zaten doğru ise hiçbir yazma yapmaz (idempotent, transaction yok)', async () => {
    const { prisma, updateMany, $transaction } = makePrisma([
      // A tek stoklu: hem canonical hem admin-en-ucuz bayrağı zaten doğru.
      row({ id: 'A', stock: 20, isCanonical: true, isCheapestInGroup: true }),
      row({ id: 'B', stock: 0, isCanonical: false }),
    ]);
    const svc = new ProductDedupService(prisma, makeAppSettings());
    await svc.recomputeCanonicalForKeys('t1', [KEY]);

    expect($transaction).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('boş/null key kümesinde DB sorgusu bile yapmaz', async () => {
    const { prisma, findMany } = makePrisma([]);
    const svc = new ProductDedupService(prisma, makeAppSettings());
    await svc.recomputeCanonicalForKeys('t1', [null, undefined, '']);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('yalnız verilen nameKey gruplarını sorgular (tüm katalog DEĞİL)', async () => {
    const { prisma, findMany } = makePrisma([
      row({ id: 'A', stock: 5, isCanonical: true, isCheapestInGroup: true }),
    ]);
    const svc = new ProductDedupService(prisma, makeAppSettings());
    await svc.recomputeCanonicalForKeys('t1', [KEY]);

    expect(findMany).toHaveBeenCalledTimes(1);
    const where = findMany.mock.calls[0][0].where;
    expect(where.tenantId).toBe('t1');
    expect(where.active).toBe(true);
    expect(where.nameKey.in).toEqual([KEY]);
  });
});

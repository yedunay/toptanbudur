import { PrismaService } from '../prisma/prisma.service';
import { XmlSlotService } from './xml-slot.service';
import { AppSettingsService } from '../app-settings/app-settings.service';

type Product = {
  id: string;
  stock: number;
  xmlPartIndex: number | null;
  xmlSlotPosition: number | null;
  active: boolean;
  isCanonical: boolean;
};

type ProductWhere = {
  tenantId?: string;
  active?: boolean;
  isCanonical?: boolean;
  stock?: { gt: number };
  xmlPartIndex?: null | { not: null };
};

/**
 * In-memory Prisma mock — testlerin gerçek DB'ye ihtiyacı olmasın diye
 * XmlSlotService'in kullandığı dar yüzeyi (findMany, groupBy, updateMany,
 * update, $executeRaw, $transaction) taklit eder.
 *
 * Feed havuzu kuralı SERVİSLE BİREBİR aynıdır: `findMany` gerçek sorgudaki
 * gibi `active` + `isCanonical` + `stock > 0` filtrelerini uygular. Böylece
 * mock, "stoksuz ürün feed'e girmez" sözleşmesini sadık biçimde yansıtır.
 */
class FakePrisma {
  products: Product[] = [];

  reset(seed: Product[]) {
    this.products = seed.map((p) => ({ ...p }));
  }

  private matches(p: Product, where: ProductWhere = {}): boolean {
    if (where.active === true && p.active === false) return false;
    if (where.isCanonical === true && p.isCanonical === false) return false;
    if (where.stock && typeof where.stock.gt === 'number') {
      if (!(p.stock > where.stock.gt)) return false;
    }
    if (where.xmlPartIndex === null && p.xmlPartIndex !== null) return false;
    if (
      where.xmlPartIndex &&
      typeof where.xmlPartIndex === 'object' &&
      'not' in where.xmlPartIndex &&
      p.xmlPartIndex === null
    ) {
      return false;
    }
    return true;
  }

  get product() {
    return {
      findMany: async ({ where }: { where?: ProductWhere }) => {
        return this.products
          .filter((p) => this.matches(p, where))
          .sort((a, b) => a.id.localeCompare(b.id))
          .map((p) => ({ id: p.id }));
      },
      groupBy: async (_args: {
        by: string[];
        where: { xmlPartIndex?: { not: null } };
      }) => {
        const byPart = new Map<number, number>();
        for (const p of this.products) {
          if (p.xmlPartIndex == null) continue;
          const cur = byPart.get(p.xmlPartIndex) ?? 0;
          if ((p.xmlSlotPosition ?? 0) > cur) {
            byPart.set(p.xmlPartIndex, p.xmlSlotPosition ?? 0);
          }
        }
        return Array.from(byPart.entries()).map(([part, max]) => ({
          xmlPartIndex: part,
          _max: { xmlSlotPosition: max },
        }));
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; xmlPartIndex?: null };
        data: { xmlPartIndex?: number; xmlSlotPosition?: number };
      }) => {
        const target = this.products.find((p) => p.id === where.id);
        if (!target) return { count: 0 };
        // Race-safe defansif filtre: yalnız hâlâ slotsuz olana yaz.
        if (where.xmlPartIndex === null && target.xmlPartIndex !== null) {
          return { count: 0 };
        }
        if (data.xmlPartIndex != null) target.xmlPartIndex = data.xmlPartIndex;
        if (data.xmlSlotPosition != null) {
          target.xmlSlotPosition = data.xmlSlotPosition;
        }
        return { count: 1 };
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: { xmlPartIndex?: number; xmlSlotPosition?: number };
      }) => {
        const target = this.products.find((p) => p.id === where.id);
        if (!target) throw new Error(`Product ${where.id} not found`);
        if (data.xmlPartIndex != null) target.xmlPartIndex = data.xmlPartIndex;
        if (data.xmlSlotPosition != null) {
          target.xmlSlotPosition = data.xmlSlotPosition;
        }
        return target;
      },
    };
  }

  // rebalanceAll tek bir $executeRaw kullanır: aktif ürünlerin slotlarını
  // NULL'lar (görünmeyenler feed dışı kalsın). Tagged-template argümanları
  // önemsizdir; etkisi sabittir.
  $executeRaw = async (..._args: unknown[]): Promise<number> => {
    for (const p of this.products) {
      if (p.active === false) continue;
      p.xmlPartIndex = null;
      p.xmlSlotPosition = null;
    }
    return 0;
  };

  async $transaction<T>(
    cb: (tx: FakePrisma) => Promise<T>,
    _opts?: unknown,
  ): Promise<T> {
    return cb(this);
  }
}

const TENANT = 'tenant-1';

function mkProduct(
  id: string,
  stock: number,
  opts: {
    slot?: number | null;
    position?: number | null;
    active?: boolean;
    isCanonical?: boolean;
  } = {},
): Product {
  return {
    id,
    stock,
    xmlPartIndex: opts.slot ?? null,
    xmlSlotPosition: opts.position ?? null,
    active: opts.active ?? true,
    isCanonical: opts.isCanonical ?? true,
  };
}

describe('XmlSlotService', () => {
  let fake: FakePrisma;
  let svc: XmlSlotService;

  beforeEach(() => {
    fake = new FakePrisma();
    svc = new XmlSlotService(
      fake as unknown as PrismaService,
      { getString: async () => '' } as unknown as AppSettingsService,
    );
  });

  describe('recomputeSlots (append-only)', () => {
    it('orphan yoksa no-op döner — mevcut slotlu ürünlere dokunmaz', async () => {
      fake.reset([
        mkProduct('p1', 5, { slot: 1, position: 1 }),
        mkProduct('p2', 0, { slot: 5, position: 1 }),
      ]);

      await svc.recomputeSlots(TENANT);

      expect(fake.products[0]).toMatchObject({ xmlPartIndex: 1, xmlSlotPosition: 1 });
      expect(fake.products[1]).toMatchObject({ xmlPartIndex: 5, xmlSlotPosition: 1 });
    });

    it('mevcut slotlu ürünlerin slot ve pozisyonunu ASLA değiştirmez', async () => {
      fake.reset([
        // 5 slotlu mevcut ürün
        mkProduct('p1', 10, { slot: 1, position: 1 }),
        mkProduct('p2', 8, { slot: 2, position: 1 }),
        mkProduct('p3', 6, { slot: 3, position: 1 }),
        mkProduct('p4', 4, { slot: 4, position: 1 }),
        mkProduct('p5', 2, { slot: 5, position: 1 }),
        // 5 yeni orphan stoklu ürün
        mkProduct('n1', 5),
        mkProduct('n2', 5),
        mkProduct('n3', 5),
        mkProduct('n4', 5),
        mkProduct('n5', 5),
      ]);

      await svc.recomputeSlots(TENANT);

      // Mevcutlar değişmedi
      expect(fake.products.find((p) => p.id === 'p1')).toMatchObject({ xmlPartIndex: 1, xmlSlotPosition: 1 });
      expect(fake.products.find((p) => p.id === 'p2')).toMatchObject({ xmlPartIndex: 2, xmlSlotPosition: 1 });
      expect(fake.products.find((p) => p.id === 'p5')).toMatchObject({ xmlPartIndex: 5, xmlSlotPosition: 1 });

      // Yeni stoklular her parçaya birer tane (5 ürün / 5 parça = 1 per part)
      // chunkSize = ceil(5/5) = 1 → her parçaya 1
      const slots = ['n1', 'n2', 'n3', 'n4', 'n5']
        .map((id) => fake.products.find((p) => p.id === id)?.xmlPartIndex)
        .sort();
      expect(slots).toEqual([1, 2, 3, 4, 5]);

      // Yeni ürünlerin pozisyonu mevcut max+1 olmalı → her parçada pozisyon 2
      for (const id of ['n1', 'n2', 'n3', 'n4', 'n5']) {
        expect(fake.products.find((p) => p.id === id)?.xmlSlotPosition).toBe(2);
      }
    });

    it('stoksuz yeni ürünlere slot ATAMAZ — feed havuzu yalnız stok>0', async () => {
      fake.reset([
        mkProduct('p1', 10, { slot: 1, position: 1 }),
        mkProduct('p5', 5, { slot: 5, position: 1 }),
        // yeni stoksuz ürünler → feed havuzuna girmez
        mkProduct('n1', 0),
        mkProduct('n2', 0),
      ]);

      await svc.recomputeSlots(TENANT);

      // Stoksuzlar slot almaz (null kalır), feed'e girmez.
      expect(fake.products.find((p) => p.id === 'n1')?.xmlPartIndex).toBeNull();
      expect(fake.products.find((p) => p.id === 'n2')?.xmlPartIndex).toBeNull();

      // Mevcut slotlu ürünlere dokunulmadı.
      expect(fake.products.find((p) => p.id === 'p1')).toMatchObject({
        xmlPartIndex: 1,
        xmlSlotPosition: 1,
      });
      expect(fake.products.find((p) => p.id === 'p5')).toMatchObject({
        xmlPartIndex: 5,
        xmlSlotPosition: 1,
      });
    });

    it('idempotent: ikinci çağrı no-op', async () => {
      fake.reset([
        mkProduct('p1', 10, { slot: 1, position: 1 }),
        mkProduct('n1', 5),
      ]);

      await svc.recomputeSlots(TENANT);
      const afterFirst = JSON.stringify(fake.products);

      await svc.recomputeSlots(TENANT);
      const afterSecond = JSON.stringify(fake.products);

      expect(afterSecond).toBe(afterFirst);
    });

    it('yalnız stoklu orphan ürünlere slot atar; stoksuzları atlar', async () => {
      fake.reset([
        // stok=0 → feed havuzu dışı, slot almaz
        mkProduct('n1', 0),
        // stok=10 → tek stoklu orphan → chunkSize=ceil(1/5)=1 → parça 1
        mkProduct('n2', 10),
      ]);

      await svc.recomputeSlots(TENANT);

      expect(fake.products.find((p) => p.id === 'n1')?.xmlPartIndex).toBeNull();
      expect(fake.products.find((p) => p.id === 'n2')?.xmlPartIndex).toBe(1);
      expect(fake.products.find((p) => p.id === 'n2')?.xmlSlotPosition).toBe(1);
    });
  });

  describe('rebalanceAll', () => {
    it('feed havuzunu (stok>0) sıfırdan dengeler; stoksuzları feed dışı bırakır', async () => {
      fake.reset([
        mkProduct('p1', 5, { slot: 3, position: 99 }), // önceden 3. parçadaydı
        mkProduct('p2', 5, { slot: 3, position: 100 }),
        mkProduct('p3', 5),
        mkProduct('p4', 5),
        mkProduct('p5', 5),
        mkProduct('p6', 0), // stoksuz → feed dışı
      ]);

      const result = await svc.rebalanceAll(TENANT);

      // Feed havuzu yalnız stok>0 → 5 ürün; stoksuz feed'e girmez.
      expect(result.total).toBe(5);
      expect(result.inStock).toBe(5);
      expect(result.outOfStock).toBe(0);

      // 5 stoklu / 5 parça → her parçaya 1
      const stockluSlots = ['p1', 'p2', 'p3', 'p4', 'p5']
        .map((id) => fake.products.find((p) => p.id === id)?.xmlPartIndex)
        .sort();
      expect(stockluSlots).toEqual([1, 2, 3, 4, 5]);

      // Stoksuz feed dışı → slotu NULL'landı.
      expect(fake.products.find((p) => p.id === 'p6')?.xmlPartIndex).toBeNull();
      expect(fake.products.find((p) => p.id === 'p6')?.xmlSlotPosition).toBeNull();

      // Eski pozisyon 99/100 temizlendi; her parçada tek ürün → pozisyon 1.
      for (const id of ['p1', 'p2', 'p3', 'p4', 'p5']) {
        expect(fake.products.find((p) => p.id === id)?.xmlSlotPosition).toBe(1);
      }
    });
  });
});

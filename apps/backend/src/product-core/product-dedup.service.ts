import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { computeNameKey } from '../common/utils/name-key';
import { AppSettingsService } from '../app-settings/app-settings.service';
import { PRODUCT_MATCH_SETTING_KEYS } from '../product-match/product-match.constants';

export interface DedupResult {
  total: number;
  groups: number;
  duplicateGroups: number;
  canonical: number;
  hidden: number;
  durationMs: number;
}

interface DedupProductRow {
  id: string;
  name: string;
  nameKey: string | null;
  price: Prisma.Decimal;
  stock: number;
  createdAt: Date;
  isCanonical: boolean;
  isCheapestInGroup: boolean;
  matchGroupId: string | null;
  supplier: { stockThreshold: number | null } | null;
}

@Injectable()
export class ProductDedupService {
  private readonly logger = new Logger(ProductDedupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly appSettings: AppSettingsService,
  ) {}

  /**
   * Vitrin/Satın-Alma: AKTİF match-group'ların id→displayProductId haritası.
   * Flag kapalıysa boş map döner (mevcut nameKey davranışı aynen sürer).
   */
  private async loadActiveGroupDisplay(
    tenantId: string,
  ): Promise<Map<string, string>> {
    const enabled = await this.appSettings.getBoolean(
      PRODUCT_MATCH_SETTING_KEYS.ENABLED,
      true,
    );
    if (!enabled) return new Map();
    const groups = await this.prisma.productMatchGroup.findMany({
      where: { tenantId, status: 'active' },
      select: { id: true, displayProductId: true },
    });
    return new Map(groups.map((g) => [g.id, g.displayProductId]));
  }

  /**
   * Aynı normalize edilmiş isimde birden fazla aktif ürün varsa (genelde farklı
   * tedarikçilerde), yalnızca "kazanan" ürünü isCanonical=true bırakır, geri
   * kalanını false yapar. Müşteri listeleri isCanonical=true filtreler.
   *
   * Kazanan seçimi:
   *  1. Önce stoktakiler (effectiveStock > 0). Grupta stoklu varsa stoksuzlar
   *     aday dışı kalır.
   *  2. Aday grubu içinde en pahalı (price DESC).
   *  3. Eşitlik bozma: stock DESC → createdAt DESC → id ASC.
   *
   * Tüm tenant kataloğunu kapsar — yeni tedarikçi eklendiğinde de ürünleri DB'de
   * zaten olan ürünlerle kıyaslanır. Idempotent: yalnızca isCanonical değeri
   * değişmesi gereken satırlara yazar.
   */
  async recomputeCanonical(tenantId: string): Promise<DedupResult> {
    const start = Date.now();
    this.logger.log(`product.dedup.start { tenantId: '${tenantId}' }`);

    const products: DedupProductRow[] = await this.prisma.product.findMany({
      where: { tenantId, active: true },
      select: {
        id: true,
        name: true,
        nameKey: true,
        price: true,
        stock: true,
        createdAt: true,
        isCanonical: true,
        isCheapestInGroup: true,
        matchGroupId: true,
        supplier: { select: { stockThreshold: true } },
      },
    });

    /// Vitrin/Satın-Alma: AKTİF match-group'a bağlı ürünler nameKey gruplamasından
    /// MUAF — onların canonical'ı grubun displayProductId'sine göre belirlenir
    /// (vitrin = en pahalı/TB). Flag kapalıysa map boş → tüm ürünler nameKey yolu.
    const activeGroupDisplay = await this.loadActiveGroupDisplay(tenantId);
    const isGroupGoverned = (p: DedupProductRow): boolean =>
      p.matchGroupId !== null && activeGroupDisplay.has(p.matchGroupId);

    const groups = new Map<string, DedupProductRow[]>();
    /// Auto-route ile dedup'ın aynı anahtarı kullanması için Product.nameKey
    /// kolonu bu fonksiyonda hesaplanan değerle senkron tutulur. Kolon NULL ya
    /// da bayatsa (isim değişmiş) burada düzeltilir — self-healing.
    const nameKeyFix = new Map<string, string[]>();
    for (const p of products) {
      const key = computeNameKey(p.name);
      if (p.nameKey !== key) {
        const ids = nameKeyFix.get(key);
        if (ids) ids.push(p.id);
        else nameKeyFix.set(key, [p.id]);
      }
      /// Grup-yönetimli ürünleri nameKey grubuna SOKMA.
      if (isGroupGoverned(p)) continue;
      const bucket = groups.get(key);
      if (bucket) bucket.push(p);
      else groups.set(key, [p]);
    }

    const needTrue: string[] = [];
    const needFalse: string[] = [];
    /// ADMIN vitrin (isCheapestInGroup) — isCanonical'dan BAĞIMSIZ, additive.
    /// Müşteri davranışı (needTrue/needFalse = isCanonical) HİÇ değişmez.
    const needCheapTrue: string[] = [];
    const needCheapFalse: string[] = [];
    let duplicateGroups = 0;
    let canonical = 0;
    let hidden = 0;

    for (const bucket of groups.values()) {
      const winner =
        bucket.length === 1 ? bucket[0] : this.pickWinner(bucket);
      /// ADMIN: aynı bucket'ta en UCUZ (stoklu) ürün = isCheapestInGroup.
      const cheapest =
        bucket.length === 1 ? bucket[0] : this.pickCheapest(bucket);
      if (bucket.length > 1) duplicateGroups++;

      for (const p of bucket) {
        const shouldBeCanonical = p.id === winner.id;
        if (shouldBeCanonical) {
          canonical++;
          if (!p.isCanonical) needTrue.push(p.id);
        } else {
          hidden++;
          if (p.isCanonical) needFalse.push(p.id);
        }
        const shouldBeCheapest = p.id === cheapest.id;
        if (shouldBeCheapest) {
          if (!p.isCheapestInGroup) needCheapTrue.push(p.id);
        } else if (p.isCheapestInGroup) {
          needCheapFalse.push(p.id);
        }
      }
    }

    /// Grup-yönetimli ürünler: canonical = (id === group.displayProductId).
    /// ADMIN en-ucuz için matchGroupId'ye göre topla, grup içinde en ucuzu seç.
    const govByGroup = new Map<string, DedupProductRow[]>();
    for (const p of products) {
      if (!isGroupGoverned(p)) continue;
      const shouldBeCanonical = p.id === activeGroupDisplay.get(p.matchGroupId!);
      if (shouldBeCanonical) {
        canonical++;
        if (!p.isCanonical) needTrue.push(p.id);
      } else {
        hidden++;
        if (p.isCanonical) needFalse.push(p.id);
      }
      const arr = govByGroup.get(p.matchGroupId!);
      if (arr) arr.push(p);
      else govByGroup.set(p.matchGroupId!, [p]);
    }
    for (const members of govByGroup.values()) {
      const cheapest =
        members.length === 1 ? members[0] : this.pickCheapest(members);
      for (const p of members) {
        const shouldBeCheapest = p.id === cheapest.id;
        if (shouldBeCheapest) {
          if (!p.isCheapestInGroup) needCheapTrue.push(p.id);
        } else if (p.isCheapestInGroup) {
          needCheapFalse.push(p.id);
        }
      }
    }

    const BATCH = 500;
    if (
      needTrue.length > 0 ||
      needFalse.length > 0 ||
      needCheapTrue.length > 0 ||
      needCheapFalse.length > 0 ||
      nameKeyFix.size > 0
    ) {
      await this.prisma.$transaction(
        async (tx) => {
          for (let i = 0; i < needTrue.length; i += BATCH) {
            await tx.product.updateMany({
              where: { id: { in: needTrue.slice(i, i + BATCH) } },
              data: { isCanonical: true },
            });
          }
          for (let i = 0; i < needFalse.length; i += BATCH) {
            await tx.product.updateMany({
              where: { id: { in: needFalse.slice(i, i + BATCH) } },
              data: { isCanonical: false },
            });
          }
          /// ADMIN en-ucuz bayrağı — ayrı updateMany'ler (isCanonical'a dokunmaz).
          for (let i = 0; i < needCheapTrue.length; i += BATCH) {
            await tx.product.updateMany({
              where: { id: { in: needCheapTrue.slice(i, i + BATCH) } },
              data: { isCheapestInGroup: true },
            });
          }
          for (let i = 0; i < needCheapFalse.length; i += BATCH) {
            await tx.product.updateMany({
              where: { id: { in: needCheapFalse.slice(i, i + BATCH) } },
              data: { isCheapestInGroup: false },
            });
          }
          for (const [key, ids] of nameKeyFix) {
            for (let i = 0; i < ids.length; i += BATCH) {
              await tx.product.updateMany({
                where: { id: { in: ids.slice(i, i + BATCH) } },
                data: { nameKey: key },
              });
            }
          }
        },
        { timeout: 120_000 },
      );
    }

    let nameKeyFilled = 0;
    for (const ids of nameKeyFix.values()) nameKeyFilled += ids.length;

    const durationMs = Date.now() - start;
    this.logger.log(
      `product.dedup.done { tenantId: '${tenantId}', total: ${products.length}, groups: ${groups.size}, duplicateGroups: ${duplicateGroups}, canonical: ${canonical}, hidden: ${hidden}, flippedToTrue: ${needTrue.length}, flippedToFalse: ${needFalse.length}, cheapTrue: ${needCheapTrue.length}, cheapFalse: ${needCheapFalse.length}, nameKeyFilled: ${nameKeyFilled}, durationMs: ${durationMs} }`,
    );

    return {
      total: products.length,
      groups: groups.size,
      duplicateGroups,
      canonical,
      hidden,
      durationMs,
    };
  }

  /**
   * HEDEFLİ canonical yeniden-hesabı: yalnız verilen nameKey grup(lar)ını yeniden
   * değerlendirir — tüm katalog TARANMAZ. Admin manuel stok/fiyat düzenlemesi veya
   * stock-reconcile sıfırlaması gibi az sayıda ürünü etkileyen olaylar için; tam
   * recompute 60K satır çekip gruplar (donma riski), bu ise yalnız ilgili grupları.
   *
   * Neden gerekli: canonical (isCanonical=true) yalnız tam recompute'ta seçiliyordu;
   * stock-reconcile/admin stok değişimi tetiklemiyordu. Sonuç: 0-stoğa düşen bir
   * canonical, aynı isimdeki STOKLU kardeşi varken canonical kalıp ürünü gizliyordu
   * (feed `isCanonical=true AND stock>0` filtreler → ikisi de düşer). Bu metot,
   * değişimden hemen sonra kazananı stoklu kardeşe taşır (ve tersi: stok dönünce).
   *
   * keys: ham nameKey değerleri (Product.nameKey kolonu) ya da computeNameKey(name)
   * çıktısı. Boş/yinelenen elenir. Büyük key kümeleri 1000'lik parçalarda işlenir.
   */
  async recomputeCanonicalForKeys(
    tenantId: string,
    keys: Iterable<string | null | undefined>,
  ): Promise<void> {
    const keySet = new Set<string>();
    for (const k of keys) {
      if (typeof k === 'string' && k) keySet.add(k);
    }
    if (keySet.size === 0) return;
    const keyList = [...keySet];

    /// Vitrin/Satın-Alma: grup-yönetimli ürünleri scoped recompute'ta da atla —
    /// onların canonical'ı gruba göre belirlenir, stok değişiminden etkilenmez.
    const activeGroupDisplay = await this.loadActiveGroupDisplay(tenantId);

    const needTrue: string[] = [];
    const needFalse: string[] = [];
    /// ADMIN en-ucuz (isCheapestInGroup) — additive, isCanonical'dan bağımsız.
    const needCheapTrue: string[] = [];
    const needCheapFalse: string[] = [];
    const KEY_CHUNK = 1000;
    for (let i = 0; i < keyList.length; i += KEY_CHUNK) {
      const chunkKeys = keyList.slice(i, i + KEY_CHUNK);
      const products: DedupProductRow[] = await this.prisma.product.findMany({
        where: { tenantId, active: true, nameKey: { in: chunkKeys } },
        select: {
          id: true,
          name: true,
          nameKey: true,
          price: true,
          stock: true,
          createdAt: true,
          isCanonical: true,
          isCheapestInGroup: true,
          matchGroupId: true,
          supplier: { select: { stockThreshold: true } },
        },
      });
      if (products.length === 0) continue;

      const groups = new Map<string, DedupProductRow[]>();
      for (const p of products) {
        /// Grup-yönetimli ürün → scoped recompute'ta dokunma.
        if (p.matchGroupId !== null && activeGroupDisplay.has(p.matchGroupId)) {
          continue;
        }
        // nameKey kolonuyla sorguladık → non-null. computeNameKey fallback yalnız
        // güvenlik için.
        const key = p.nameKey ?? computeNameKey(p.name);
        const bucket = groups.get(key);
        if (bucket) bucket.push(p);
        else groups.set(key, [p]);
      }

      for (const bucket of groups.values()) {
        const winner =
          bucket.length === 1 ? bucket[0] : this.pickWinner(bucket);
        const cheapest =
          bucket.length === 1 ? bucket[0] : this.pickCheapest(bucket);
        for (const p of bucket) {
          if (p.id === winner.id) {
            if (!p.isCanonical) needTrue.push(p.id);
          } else if (p.isCanonical) {
            needFalse.push(p.id);
          }
          if (p.id === cheapest.id) {
            if (!p.isCheapestInGroup) needCheapTrue.push(p.id);
          } else if (p.isCheapestInGroup) {
            needCheapFalse.push(p.id);
          }
        }
      }
    }

    if (
      needTrue.length === 0 &&
      needFalse.length === 0 &&
      needCheapTrue.length === 0 &&
      needCheapFalse.length === 0
    )
      return;

    const BATCH = 500;
    await this.prisma.$transaction(
      async (tx) => {
        for (let i = 0; i < needTrue.length; i += BATCH) {
          await tx.product.updateMany({
            where: { id: { in: needTrue.slice(i, i + BATCH) } },
            data: { isCanonical: true },
          });
        }
        for (let i = 0; i < needFalse.length; i += BATCH) {
          await tx.product.updateMany({
            where: { id: { in: needFalse.slice(i, i + BATCH) } },
            data: { isCanonical: false },
          });
        }
        for (let i = 0; i < needCheapTrue.length; i += BATCH) {
          await tx.product.updateMany({
            where: { id: { in: needCheapTrue.slice(i, i + BATCH) } },
            data: { isCheapestInGroup: true },
          });
        }
        for (let i = 0; i < needCheapFalse.length; i += BATCH) {
          await tx.product.updateMany({
            where: { id: { in: needCheapFalse.slice(i, i + BATCH) } },
            data: { isCheapestInGroup: false },
          });
        }
      },
      { timeout: 60_000 },
    );

    this.logger.log(
      `product.dedup.scoped { tenantId: '${tenantId}', keys: ${keyList.length}, flippedToTrue: ${needTrue.length}, flippedToFalse: ${needFalse.length} }`,
    );
  }

  /**
   * Grup içindeki kazananı seçer. Önce stoklular elenir; stoklu varsa stoksuzlar
   * aday dışı. Aday grubunda price DESC → stock DESC → createdAt DESC → id ASC.
   */
  private pickWinner(bucket: DedupProductRow[]): DedupProductRow {
    const withStockFlag = bucket.map((p) => {
      const threshold = p.supplier?.stockThreshold ?? 0;
      const effectiveStock =
        threshold > 0 && p.stock < threshold ? 0 : p.stock;
      return { product: p, inStock: effectiveStock > 0 };
    });

    const anyInStock = withStockFlag.some((x) => x.inStock);
    const candidates = anyInStock
      ? withStockFlag.filter((x) => x.inStock)
      : withStockFlag;

    let best = candidates[0].product;
    for (let i = 1; i < candidates.length; i++) {
      if (this.beats(candidates[i].product, best)) {
        best = candidates[i].product;
      }
    }
    return best;
  }

  /** a, b'yi geçer mi? price DESC → stock DESC → createdAt DESC → id ASC. */
  private beats(a: DedupProductRow, b: DedupProductRow): boolean {
    const priceCmp = a.price.comparedTo(b.price);
    if (priceCmp !== 0) return priceCmp > 0;
    if (a.stock !== b.stock) return a.stock > b.stock;
    const ta = a.createdAt.getTime();
    const tb = b.createdAt.getTime();
    if (ta !== tb) return ta > tb;
    return a.id < b.id;
  }

  /**
   * ADMIN vitrin: grup içindeki EN UCUZ ürünü seçer (pickWinner simetriği).
   * Önce stoklular elenir (stoklu varsa stoksuzlar aday dışı — admin de stoklu
   * kartı görsün, katalog stock>0 filtreler). Aday grubunda price ASC → stock
   * DESC → createdAt DESC → id ASC. isCanonical seçiminden TAMAMEN bağımsız.
   */
  private pickCheapest(bucket: DedupProductRow[]): DedupProductRow {
    const withStockFlag = bucket.map((p) => {
      const threshold = p.supplier?.stockThreshold ?? 0;
      const effectiveStock =
        threshold > 0 && p.stock < threshold ? 0 : p.stock;
      return { product: p, inStock: effectiveStock > 0 };
    });
    const anyInStock = withStockFlag.some((x) => x.inStock);
    const candidates = anyInStock
      ? withStockFlag.filter((x) => x.inStock)
      : withStockFlag;
    let best = candidates[0].product;
    for (let i = 1; i < candidates.length; i++) {
      if (this.cheaperThan(candidates[i].product, best)) {
        best = candidates[i].product;
      }
    }
    return best;
  }

  /** a, b'den daha ucuz mu? price ASC → stock DESC → createdAt DESC → id ASC. */
  private cheaperThan(a: DedupProductRow, b: DedupProductRow): boolean {
    const priceCmp = a.price.comparedTo(b.price);
    if (priceCmp !== 0) return priceCmp < 0;
    if (a.stock !== b.stock) return a.stock > b.stock;
    const ta = a.createdAt.getTime();
    const tb = b.createdAt.getTime();
    if (ta !== tb) return ta > tb;
    return a.id < b.id;
  }
}

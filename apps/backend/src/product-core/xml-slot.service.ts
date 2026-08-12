import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppSettingsService } from '../app-settings/app-settings.service';

const XML_FEED_PART_COUNT = parseInt(process.env.XML_FEED_PART_COUNT ?? '5', 10);

/// V2 sabit part dağılımı:
///  - Part 1-4 → öncelikli tedarikçi kapsamındaki ürünler
///  - Part 5-6 → kapsam dışı kalan tüm ürünler (rest)
/// Kalan grup ~45K'ya ulaşıp tek part'ta hem PG bind-parametre limitini
/// (~32.767) hem ~40MB dosya sınırını aştığı için rest 2 part'a
/// bölündü (5 ve 6). Yeni kalan ürünler append-only 5↔6'ya dağılır;
/// mevcut part-5 bir kez 5/6 olarak yeniden dengelenir (sadece rest, part 1-4
/// dokunulmaz). Daha da şişerse REST_PARTS'a 7 eklenir.
export const XML_V2_TOTAL_PARTS = 6;
export const XML_V2_PRIORITY_PARTS = [1, 2, 3, 4] as const;
export const XML_V2_REST_PARTS = [5, 6] as const;

/// Öncelikli (part 1-4) tedarikçi beyaz listesinin AppSetting anahtarı.
/// Değer: virgülle ayrılmış tedarikçi adı deseni listesi (ör. "alfa, beta").
/// VARSAYILAN BOŞ — kuruluma özel tedarikçi adı KOD İÇİNE GÖMÜLMEZ.
/// Liste boşken hiçbir tedarikçi öncelikli parçalara girmez; tüm ürünler
/// rest (5-6) parçalarına eşit dağılır.
export const PRODUCT_CORE_SETTING_KEYS = {
  SLOT_SUPPLIER_PATTERNS: 'productcore.slotSupplierPatterns',
} as const;

/// Tedarikçi adını eşleştirme için normalize eder: küçük harf + Türkçe karakter
/// sadeleştirme + alfanümerik dışını atma. ("Ör Nek (1)" → "ornek1").
export function normalizeSupplierName(name: string): string {
  return name
    .toLowerCase()
    .replace(/ı/g, 'i')
    .replace(/İ/g, 'i')
    .replace(/i̇/g, 'i')
    .replace(/ş/g, 's')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/[^a-z0-9]/g, '');
}

/// Bir tedarikçi adı verilen desen listesine giriyor mu?
/// Kısa desenler (≤3 harf) TAM eşleşir → yanlış pozitif olmaz;
/// uzun desenler içerik (includes) eşleşir.
export function matchesSupplierPatterns(
  name: string,
  patterns: readonly string[],
): boolean {
  if (patterns.length === 0) return false;
  const n = normalizeSupplierName(name);
  return patterns.some((p) => (p.length <= 3 ? n === p : n.includes(p)));
}

@Injectable()
export class XmlSlotService {
  private readonly logger = new Logger(XmlSlotService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly appSettings: AppSettingsService,
  ) {}

  /// Öncelikli parça (1-4) tedarikçi desenlerini AppSetting'ten okur.
  /// Boş/tanımsızsa boş liste döner → hiçbir tedarikçi öncelikli sayılmaz.
  private async loadSlotSupplierPatterns(): Promise<string[]> {
    const raw = await this.appSettings.getString(
      PRODUCT_CORE_SETTING_KEYS.SLOT_SUPPLIER_PATTERNS,
      '',
    );
    return raw
      .split(',')
      .map((p) => normalizeSupplierName(p))
      .filter((p) => p.length > 0);
  }

  /**
   * Append-only slot atama.
   *
   * Sadece xmlPartIndex IS NULL olan aktif ürünlere slot atar. Mevcut
   * slotlu ürünlere ASLA dokunulmaz — pazaryerine verilen XML link'lerinin
   * içerik ve sırası bozulmaz.
   *
   * Dağıtım kuralı (yeni ürünler için):
   *  - Feed havuzu = active + isCanonical + stock > 0. Yalnız bu havuzdaki
   *    slotsuz ürünler 1..N parçalarına EŞİT dağıtılır.
   *  - Stoksuz (stock = 0) ürünler havuza GİRMEZ → hiç slot almaz (feed'de
   *    yer almaz, parçaları şişirmez). Stoğa dönerlerse sonraki recompute alır.
   * Her atanan ürün, hedef parçadaki mevcut MAX(xmlSlotPosition) + 1
   * pozisyonunu alır → sondan ekleme.
   *
   * Idempotent: orphan yoksa no-op.
   */
  async recomputeSlots(tenantId: string): Promise<void> {
    const totalParts = XML_FEED_PART_COUNT;
    const start = Date.now();

    this.logger.log(
      `xml.slots.append.start { tenantId: '${tenantId}', totalParts: ${totalParts} }`,
    );

    // V1 = V2'nin sunduğu AYNI ürün havuzu (active+isCanonical+stok>0), ama
    // 5 parçaya EŞİT dağıtılır. Whitelist YOK (V1 tüm ürünleri eşit yayar).
    // V2 (6 parça) mantığına/ayarlarına ASLA dokunulmaz.
    const orphans = await this.prisma.product.findMany({
      where: {
        tenantId,
        active: true,
        isCanonical: true,
        stock: { gt: 0 },
        xmlPartIndex: null,
      },
      select: { id: true },
      orderBy: { id: 'asc' },
    });

    if (orphans.length === 0) {
      this.logger.log(
        `xml.slots.append.noop { tenantId: '${tenantId}', durationMs: ${Date.now() - start} }`,
      );
      return;
    }

    const newIds = orphans.map((o) => o.id);

    // Her parça için mevcut MAX(xmlSlotPosition) — append-only base.
    const maxRows = await this.prisma.product.groupBy({
      by: ['xmlPartIndex'],
      where: { tenantId, xmlPartIndex: { not: null } },
      _max: { xmlSlotPosition: true },
    });
    const maxPositions = new Map<number, number>();
    for (let i = 1; i <= totalParts; i++) maxPositions.set(i, 0);
    for (const row of maxRows) {
      if (row.xmlPartIndex != null) {
        maxPositions.set(row.xmlPartIndex, row._max.xmlSlotPosition ?? 0);
      }
    }

    const assignments: Array<{ id: string; slot: number; position: number }> = [];

    // Yeni (slotsuz) görünür ürünleri 1..N parçalarına EŞİT dağıt (append).
    const chunkSize = Math.max(Math.ceil(newIds.length / totalParts), 1);
    for (let i = 0; i < newIds.length; i++) {
      const slot = Math.min(Math.floor(i / chunkSize) + 1, totalParts);
      const nextPos = (maxPositions.get(slot) ?? 0) + 1;
      maxPositions.set(slot, nextPos);
      assignments.push({ id: newIds[i], slot, position: nextPos });
    }

    // SADECE xmlPartIndex IS NULL olanlara dokunan batch UPDATE.
    // Defansif filtre: where içinde xmlPartIndex: null koşulu vardır —
    // bir başka transaction araya girip slot atamış olsaydı bile mevcut
    // slot bozulmaz (race-safe).
    const BATCH = 500;
    await this.prisma.$transaction(async (tx) => {
      for (let i = 0; i < assignments.length; i += BATCH) {
        const slice = assignments.slice(i, i + BATCH);
        await Promise.all(
          slice.map(({ id, slot, position }) =>
            tx.product.updateMany({
              where: { id, xmlPartIndex: null },
              data: { xmlPartIndex: slot, xmlSlotPosition: position },
            }),
          ),
        );
      }
    }, { timeout: 120_000 });

    const durationMs = Date.now() - start;
    this.logger.log(
      `xml.slots.append.done { tenantId: '${tenantId}', assigned: ${assignments.length}, görünür: ${newIds.length}, durationMs: ${durationMs} }`,
    );
  }

  /**
   * REBALANCE — tehlikeli işlem.
   *
   * Tüm xmlPartIndex ve xmlSlotPosition değerlerini sıfırlar ve baştan
   * hesaplar. Pazaryerine verilen XML link'lerinin içeriği değişir.
   * Yalnızca admin "Rebalance" butonu tetiklediğinde çağrılır.
   *
   * Kural:
   *   - Feed havuzu = active + isCanonical + stock > 0 (id ASC)
   *   - Havuzdaki ürünler 1..N'e eşit dağıtılır; pozisyonlar 1..K sıralı
   *   - Stoksuz ürünler havuza girmez → slotları NULL'lanır, feed dışı kalır
   */
  async rebalanceAll(tenantId: string): Promise<{ total: number; inStock: number; outOfStock: number; durationMs: number }> {
    const totalParts = XML_FEED_PART_COUNT;
    const start = Date.now();

    this.logger.warn(
      `xml.slots.rebalance.start { tenantId: '${tenantId}', totalParts: ${totalParts} }`,
    );

    // V1 = V2'nin sunduğu AYNI ürün havuzu (active+isCanonical+stok>0), 5
    // parçaya EŞİT dağıtılır (eşit MB). Görünmeyenler (dedup kaybedeni/stoksuz)
    // slot işgal etmez. Whitelist YOK. V2 (6 parça) mantığına DOKUNULMAZ.
    const products = await this.prisma.product.findMany({
      where: { tenantId, active: true, isCanonical: true, stock: { gt: 0 } },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    const ids = products.map((p) => p.id);

    const slotPositions = new Map<number, number>();
    for (let i = 1; i <= totalParts; i++) slotPositions.set(i, 0);

    const assignments: Array<{ id: string; slot: number; position: number }> = [];

    const chunkSize = Math.max(Math.ceil(ids.length / totalParts), 1);
    for (let i = 0; i < ids.length; i++) {
      const slot = Math.min(Math.floor(i / chunkSize) + 1, totalParts);
      const nextPos = (slotPositions.get(slot) ?? 0) + 1;
      slotPositions.set(slot, nextPos);
      assignments.push({ id: ids[i], slot, position: nextPos });
    }

    const BATCH = 500;
    await this.prisma.$transaction(async (tx) => {
      // Önce TÜM aktif ürünlerin V1 slotunu sıfırla (görünmeyenler NULL kalır →
      // feed'de yer almaz). Sonra görünenleri 5 parçaya eşit ata.
      await tx.$executeRaw`UPDATE "Product" SET "xmlPartIndex" = NULL, "xmlSlotPosition" = NULL WHERE "tenantId" = ${tenantId} AND "active" = true`;
      for (let i = 0; i < assignments.length; i += BATCH) {
        const slice = assignments.slice(i, i + BATCH);
        await Promise.all(
          slice.map(({ id, slot, position }) =>
            tx.product.update({
              where: { id },
              data: { xmlPartIndex: slot, xmlSlotPosition: position },
            }),
          ),
        );
      }
    }, { timeout: 300_000 });

    const durationMs = Date.now() - start;
    this.logger.warn(
      `xml.slots.rebalance.done { tenantId: '${tenantId}', total: ${ids.length}, parts: ${totalParts}, durationMs: ${durationMs} }`,
    );

    return {
      total: ids.length,
      inStock: ids.length,
      outOfStock: 0,
      durationMs,
    };
  }

  /**
   * V2 append-only slot atama.
   *
   * Sadece xmlPartIndexV2 IS NULL olan aktif ürünlere slot atar. Mevcut V2
   * slotlu ürünlere ve legacy xmlPartIndex alanlarına ASLA dokunulmaz.
   *
   * Dağıtım:
   *  - Öncelikli tedarikçilerin ürünleri → part 1-4'e eşit dağıtılır
   *  - Kalan ürünler → part 5-6'ya eşit dağıtılır
   * Öncelik kapsamı AppSetting `productcore.slotSupplierPatterns` ile belirlenir.
   *
   * Idempotent: orphan yoksa no-op.
   */
  async recomputeSlotsV2(tenantId: string): Promise<void> {
    const start = Date.now();
    this.logger.log(`xml.slotsV2.append.start { tenantId: '${tenantId}' }`);

    // Yalnızca FEED'de GÖRÜNEN (active + isCanonical + stok>0) slotsuz ürünlere
    // slot ver — görünmeyen ürün (dedup kaybedeni / stoksuz) slot işgal etmesin,
    // parçalar eşit kalsın. Stoğa dönen/yeni ürünler bir sonraki recompute'ta alınır.
    const orphans = await this.prisma.product.findMany({
      where: {
        tenantId,
        active: true,
        isCanonical: true,
        stock: { gt: 0 },
        xmlPartIndexV2: null,
      },
      select: { id: true, supplierId: true },
      orderBy: { id: 'asc' },
    });

    if (orphans.length === 0) {
      this.logger.log(
        `xml.slotsV2.append.noop { tenantId: '${tenantId}', durationMs: ${Date.now() - start} }`,
      );
      return;
    }

    const isPriority = await this.buildPrioritySupplierClassifier(tenantId);

    const priorityNew: string[] = [];
    const restNew: string[] = [];
    for (const p of orphans) {
      if (isPriority(p.supplierId)) priorityNew.push(p.id);
      else restNew.push(p.id);
    }

    // Her part için mevcut MAX(xmlSlotPositionV2) — append base.
    const maxRows = await this.prisma.product.groupBy({
      by: ['xmlPartIndexV2'],
      where: { tenantId, xmlPartIndexV2: { not: null } },
      _max: { xmlSlotPositionV2: true },
    });
    const maxPositions = new Map<number, number>();
    for (let i = 1; i <= XML_V2_TOTAL_PARTS; i++) maxPositions.set(i, 0);
    for (const row of maxRows) {
      if (row.xmlPartIndexV2 != null) {
        maxPositions.set(row.xmlPartIndexV2, row._max.xmlSlotPositionV2 ?? 0);
      }
    }

    const assignments: Array<{ id: string; slot: number; position: number }> =
      [];
    this.chunkAssignV2(
      priorityNew,
      XML_V2_PRIORITY_PARTS,
      maxPositions,
      assignments,
    );
    this.chunkAssignV2(restNew, XML_V2_REST_PARTS, maxPositions, assignments);

    // SADECE xmlPartIndexV2 IS NULL olanlara dokunan race-safe batch UPDATE.
    const BATCH = 500;
    await this.prisma.$transaction(
      async (tx) => {
        for (let i = 0; i < assignments.length; i += BATCH) {
          const slice = assignments.slice(i, i + BATCH);
          await Promise.all(
            slice.map(({ id, slot, position }) =>
              tx.product.updateMany({
                where: { id, xmlPartIndexV2: null },
                data: { xmlPartIndexV2: slot, xmlSlotPositionV2: position },
              }),
            ),
          );
        }
      },
      { timeout: 120_000 },
    );

    this.logger.log(
      `xml.slotsV2.append.done { tenantId: '${tenantId}', assigned: ${assignments.length}, priority: ${priorityNew.length}, rest: ${restNew.length}, durationMs: ${Date.now() - start} }`,
    );
  }

  /**
   * V2 REBALANCE — tehlikeli işlem. Tüm xmlPartIndexV2/xmlSlotPositionV2
   * değerlerini sıfırlar ve güncel öncelikli tedarikçi listesine göre baştan
   * hesaplar. Liste değiştikten sonra mevcut ürünlerin yeniden sınıflanması
   * için tetiklenir. Legacy slotlara dokunmaz.
   */
  async rebalanceAllV2(
    tenantId: string,
  ): Promise<{ total: number; priority: number; rest: number; durationMs: number }> {
    const start = Date.now();
    this.logger.warn(`xml.slotsV2.rebalance.start { tenantId: '${tenantId}' }`);

    // YALNIZCA feed'de görünen ürünleri (active + isCanonical + stok>0) slotla —
    // her parça eşit sayıda GÖRÜNEN ürün alsın → MB'ler birbirine yakın olsun.
    // Görünmeyen ürünler (dedup kaybedeni / stoksuz) feed'de yer almaz; slotları
    // aşağıda NULL'lanır, parça boyutunu şişirmezler.
    const products = await this.prisma.product.findMany({
      where: { tenantId, active: true, isCanonical: true, stock: { gt: 0 } },
      select: { id: true, supplierId: true },
      orderBy: { id: 'asc' },
    });

    const isPriority = await this.buildPrioritySupplierClassifier(tenantId);
    const priority: string[] = [];
    const rest: string[] = [];
    for (const p of products) {
      if (isPriority(p.supplierId)) priority.push(p.id);
      else rest.push(p.id);
    }

    const positions = new Map<number, number>();
    for (let i = 1; i <= XML_V2_TOTAL_PARTS; i++) positions.set(i, 0);

    const assignments: Array<{ id: string; slot: number; position: number }> =
      [];
    this.chunkAssignV2(priority, XML_V2_PRIORITY_PARTS, positions, assignments);
    this.chunkAssignV2(rest, XML_V2_REST_PARTS, positions, assignments);

    const BATCH = 500;
    await this.prisma.$transaction(
      async (tx) => {
        // Önce TÜM aktif ürünlerin V2 slotunu sıfırla (görünmeyenler NULL kalır →
        // feed'de yer almaz, parça işgal etmez). Sonra görünenleri eşit ata.
        await tx.$executeRaw`UPDATE "Product" SET "xmlPartIndexV2" = NULL, "xmlSlotPositionV2" = NULL WHERE "tenantId" = ${tenantId} AND "active" = true`;
        for (let i = 0; i < assignments.length; i += BATCH) {
          const slice = assignments.slice(i, i + BATCH);
          await Promise.all(
            slice.map(({ id, slot, position }) =>
              tx.product.update({
                where: { id },
                data: { xmlPartIndexV2: slot, xmlSlotPositionV2: position },
              }),
            ),
          );
        }
      },
      { timeout: 300_000 },
    );

    const durationMs = Date.now() - start;
    this.logger.warn(
      `xml.slotsV2.rebalance.done { tenantId: '${tenantId}', total: ${products.length}, priority: ${priority.length}, rest: ${rest.length}, durationMs: ${durationMs} }`,
    );
    return {
      total: products.length,
      priority: priority.length,
      rest: rest.length,
      durationMs,
    };
  }

  /// Verilen ürün id listesini hedef part grubuna (örn. [1,2,3]) eşit
  /// chunk'larla dağıtır. Her ürün hedef part'taki maxPosition+1'i alır.
  private chunkAssignV2(
    ids: string[],
    parts: readonly number[],
    maxPositions: Map<number, number>,
    out: Array<{ id: string; slot: number; position: number }>,
  ): void {
    if (ids.length === 0) return;
    const chunkSize = Math.max(Math.ceil(ids.length / parts.length), 1);
    for (let i = 0; i < ids.length; i++) {
      const partIdx = Math.min(Math.floor(i / chunkSize), parts.length - 1);
      const slot = parts[partIdx];
      const nextPos = (maxPositions.get(slot) ?? 0) + 1;
      maxPositions.set(slot, nextPos);
      out.push({ id: ids[i], slot, position: nextPos });
    }
  }

  /// Öncelikli parça (1-4) sınıflandırıcısı. Beyaz liste tek kaynaktan gelir:
  /// AppSetting `productcore.slotSupplierPatterns`. Liste boşsa hiçbir
  /// tedarikçi öncelikli sayılmaz → tüm ürünler rest (5-6) parçalarına gider.
  private async buildPrioritySupplierClassifier(
    tenantId: string,
  ): Promise<(supplierId: string) => boolean> {
    const [suppliers, patterns] = await Promise.all([
      this.prisma.supplier.findMany({
        where: { tenantId },
        select: { id: true, name: true },
      }),
      this.loadSlotSupplierPatterns(),
    ]);

    const priority = new Set<string>();
    for (const s of suppliers) {
      if (matchesSupplierPatterns(s.name, patterns)) priority.add(s.id);
    }

    this.logger.log(
      `xml.slot.priorityClassifier: desen=${patterns.length}, eşleşen tedarikçi=${priority.size}`,
    );

    return (supplierId: string): boolean => priority.has(supplierId);
  }

  /// Bir kategoriyi (ve alt ağacını, Category.path prefix) id listesine genişletir.
  private async expandCategorySubtree(
    tenantId: string,
    categoryId: string,
  ): Promise<string[]> {
    const cats = await this.prisma.category.findMany({
      where: { tenantId },
      select: { id: true, path: true },
    });
    const root = cats.find((c) => c.id === categoryId);
    if (!root) return [categoryId];
    return cats
      .filter((c) => c.path === root.path || c.path.startsWith(root.path + ' > '))
      .map((c) => c.id);
  }

  /// Verilen ürünleri hedef part grubuna (örn. 1-4) EŞİT dağıtır — her ürünü o
  /// an EN AZ DOLU parçaya ekleyerek dengeler (append). Tam rebalance GEREKMEZ;
  /// mevcut diğer ürünlere/parçalara dokunmaz, sadece verilen id'leri yerleştirir.
  private async distributeInto(
    tenantId: string,
    ids: string[],
    targetParts: readonly number[],
  ): Promise<Record<number, number>> {
    if (ids.length === 0) return {};
    const counts = new Map<number, number>();
    const maxPos = new Map<number, number>();
    for (const p of targetParts) {
      counts.set(
        p,
        await this.prisma.product.count({
          where: {
            tenantId,
            active: true,
            isCanonical: true,
            stock: { gt: 0 },
            xmlPartIndexV2: p,
          },
        }),
      );
      const mx = await this.prisma.product.aggregate({
        where: { tenantId, xmlPartIndexV2: p },
        _max: { xmlSlotPositionV2: true },
      });
      maxPos.set(p, mx._max.xmlSlotPositionV2 ?? 0);
    }

    const assignments: Array<{ id: string; slot: number; position: number }> = [];
    for (const id of ids) {
      let best = targetParts[0];
      for (const p of targetParts) {
        if ((counts.get(p) ?? 0) < (counts.get(best) ?? 0)) best = p;
      }
      counts.set(best, (counts.get(best) ?? 0) + 1);
      maxPos.set(best, (maxPos.get(best) ?? 0) + 1);
      assignments.push({ id, slot: best, position: maxPos.get(best)! });
    }

    const BATCH = 500;
    await this.prisma.$transaction(
      async (tx) => {
        for (let i = 0; i < assignments.length; i += BATCH) {
          const slice = assignments.slice(i, i + BATCH);
          await Promise.all(
            slice.map(({ id, slot, position }) =>
              tx.product.update({
                where: { id },
                data: { xmlPartIndexV2: slot, xmlSlotPositionV2: position },
              }),
            ),
          );
        }
      },
      { timeout: 180_000 },
    );

    const dist: Record<number, number> = {};
    for (const a of assignments) dist[a.slot] = (dist[a.slot] ?? 0) + 1;
    return dist;
  }

  /**
   * Bir tedarikçinin (opsiyonel kategori + alt ağacı) ürünlerini 1-4'e EKLE ve
   * ANINDA eşit dağıt — tam rebalance yaptırmadan. Şu an 1-4 dışında olan
   * (5-6 veya slotsuz) görünür ürünleri en az dolu öncelikli parçaya ekler.
   */
  async addToPriorityParts(
    tenantId: string,
    supplierId: string,
    categoryId: string | null,
  ): Promise<{ added: number; distribution: Record<number, number> }> {
    const where: import('@prisma/client').Prisma.ProductWhereInput = {
      tenantId,
      supplierId,
      active: true,
      isCanonical: true,
      stock: { gt: 0 },
      // Henüz 1-4'te OLMAYANLAR: 5-6'da veya slotsuz (null).
      OR: [
        { xmlPartIndexV2: { in: [...XML_V2_REST_PARTS] } },
        { xmlPartIndexV2: null },
      ],
    };
    if (categoryId) {
      where.categoryId = { in: await this.expandCategorySubtree(tenantId, categoryId) };
    }
    const prods = await this.prisma.product.findMany({
      where,
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    const ids = prods.map((p) => p.id);
    const distribution = await this.distributeInto(
      tenantId,
      ids,
      XML_V2_PRIORITY_PARTS,
    );
    this.logger.warn(
      `xml.slot.priority.add { supplier: '${supplierId}', category: '${categoryId ?? 'ALL'}', added: ${ids.length} }`,
    );
    return { added: ids.length, distribution };
  }

  /**
   * Bir tedarikçinin (opsiyonel kategori) ürünlerini 1-4'ten ÇIKAR ve 5-6'ya
   * eşit dağıt. AppSetting beyaz listesindeki tedarikçi çıkarılamaz
   * (her zaman 1-4'te kalır).
   */
  async removeFromPriorityParts(
    tenantId: string,
    supplierId: string,
    categoryId: string | null,
  ): Promise<{ moved: number; distribution: Record<number, number> }> {
    const [sup, patterns] = await Promise.all([
      this.prisma.supplier.findFirst({
        where: { id: supplierId, tenantId },
        select: { name: true },
      }),
      this.loadSlotSupplierPatterns(),
    ]);
    if (sup && matchesSupplierPatterns(sup.name, patterns)) {
      // Beyaz listede — 1-4'te kalır, çıkarılmaz.
      return { moved: 0, distribution: {} };
    }
    const where: import('@prisma/client').Prisma.ProductWhereInput = {
      tenantId,
      supplierId,
      active: true,
      isCanonical: true,
      stock: { gt: 0 },
      xmlPartIndexV2: { in: [...XML_V2_PRIORITY_PARTS] },
    };
    if (categoryId) {
      where.categoryId = { in: await this.expandCategorySubtree(tenantId, categoryId) };
    }
    const prods = await this.prisma.product.findMany({
      where,
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    const ids = prods.map((p) => p.id);
    const distribution = await this.distributeInto(
      tenantId,
      ids,
      XML_V2_REST_PARTS,
    );
    this.logger.warn(
      `xml.slot.priority.remove { supplier: '${supplierId}', category: '${categoryId ?? 'ALL'}', moved: ${ids.length} }`,
    );
    return { moved: ids.length, distribution };
  }
}

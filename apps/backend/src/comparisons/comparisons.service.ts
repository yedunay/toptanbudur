import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ComparisonIngestService } from './comparison-ingest.service';
import { ComparisonMatchService } from './comparison-match.service';
import { Workbook } from 'exceljs';
import { resolveDiscountMode, applyDealerDiscount } from '../orders/dealer-price.util';
import { stripCleanup } from './comparison-match.util';
import type { CreateCompetitorDto, UpdateCompetitorDto } from './dto/comparison.dto';

/**
 * Karşılaştırmalar servisi (Faz 2). Rakip/tedarikçi CRUD + XML sync (ingest+match)
 * + onay kuyruğu + onayla/reddet. YALNIZ kendi tablolarına yazar; mevcut
 * fiyat/sipariş/müşteri koduna dokunmaz (bizim ürünler yalnız OKUNUR).
 */
@Injectable()
export class ComparisonsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ingest: ComparisonIngestService,
    private readonly matcher: ComparisonMatchService,
  ) {}

  /**
   * Bayi-BAĞIMSIZ ağır veri (rakip fiyat grubu + ürün skalarları) tenant başına
   * cache'lenir; yalnız senkron/onay/elle-eşleştirmede sıfırlanır. Kullanıcı kuralı:
   * "rakip XML'i çektikten sonra tekrar senkrona basmadıkça çekmeye gerek yok".
   * Bayi değişince DB'ye tekrar gidilmez; sadece RAM'deki veriye iskonto uygulanır.
   */
  private priceCache = new Map<string, {
    rivalsByProduct: Map<string, Map<string, { competitor: string; price: number; isDealerPrice: boolean; url: string | null }>>;
    scalars: Map<string, { name: string; slug: string | null; supplierId: string | null; supplierName: string | null; list: number | null; cost: number | null; tax: number }>;
  }>();

  private invalidatePriceCache(tenantId: string) {
    this.priceCache.delete(tenantId);
  }

  private async getPriceData(tenantId: string) {
    const hit = this.priceCache.get(tenantId);
    if (hit) return hit;
    const comps = await this.prisma.competitor.findMany({
      where: { tenantId, type: 'competitor' }, // YALNIZ rakipler — aday tedarikçiler (supplier) hariç
      select: { id: true, name: true, priceKdvIncluded: true, purchaseDiscountPercent: true, packagingFee: true, isDealerPrice: true },
    });
    const compMap = new Map(comps.map((c) => [c.id, c]));
    const matches = await this.prisma.competitorMatch.findMany({
      where: { tenantId, status: { in: ['approved', 'auto'] }, competitorProduct: { competitor: { type: 'competitor' } } },
      select: { productId: true, competitorProduct: { select: { competitorId: true, price: true, productUrl: true } } },
    });
    // rakip başına EN UCUZ (aynı rakipten çok eşleşme = jenerik isim)
    const rivalsByProduct = new Map<string, Map<string, any>>();
    for (const m of matches) {
      const comp = compMap.get(m.competitorProduct.competitorId);
      if (!comp) continue;
      let rp = Number(m.competitorProduct.price);
      if (!comp.priceKdvIncluded) rp *= 1.2;
      rp = Math.round((rp * (1 - (comp.purchaseDiscountPercent ?? 0) / 100) + (comp.packagingFee != null ? Number(comp.packagingFee) : 0)) * 100) / 100;
      if (!(rp > 0)) continue;
      let byComp = rivalsByProduct.get(m.productId);
      if (!byComp) { byComp = new Map(); rivalsByProduct.set(m.productId, byComp); }
      const ex = byComp.get(comp.name);
      if (!ex || rp < ex.price) byComp.set(comp.name, { competitor: comp.name, price: rp, isDealerPrice: comp.isDealerPrice, url: m.competitorProduct.productUrl });
    }
    // ürün skalarları (chunk'lı — büyük IN param limitinden kaçın), tedarikçi adı dahil (to-one join)
    const ids = [...rivalsByProduct.keys()];
    const scalars = new Map<string, any>();
    const CH = 10000;
    for (let i = 0; i < ids.length; i += CH) {
      const rows = await this.prisma.product.findMany({
        where: { tenantId, id: { in: ids.slice(i, i + CH) } },
        select: { id: true, name: true, slug: true, price: true, costPrice: true, taxRate: true, supplierId: true, supplier: { select: { name: true } } },
      });
      for (const p of rows) {
        scalars.set(p.id, {
          name: p.name, slug: p.slug, supplierId: p.supplierId ?? null, supplierName: p.supplier?.name ?? null,
          list: p.price != null ? Number(p.price) : null,
          cost: p.costPrice != null ? Number(p.costPrice) : null,
          tax: p.taxRate != null ? Number(p.taxRate) : 20,
        });
      }
    }
    const entry = { rivalsByProduct, scalars };
    this.priceCache.set(tenantId, entry);
    return entry;
  }

  /** Bir ürünün bu bayiye özel KDV dahil satış fiyatı (sepetle birebir util). */
  private dealerGross(s: { supplierId: string | null; list: number | null; cost: number | null; tax: number }, cfg: any): number | null {
    if (s.list == null) return null;
    const { mode, modePct } = resolveDiscountMode({
      isAdminDiscount: cfg.isAdminDiscount,
      supplierAdminDiscount: s.supplierId ? cfg.supplierAdminDiscountSet.has(s.supplierId) : false,
      hasRow: s.supplierId ? cfg.supplierRowSet.has(s.supplierId) : false,
      rowProfit: s.supplierId ? cfg.supplierProfitMap.get(s.supplierId) ?? 0 : 0,
      rowOfflist: s.supplierId ? cfg.supplierDiscountMap.get(s.supplierId) ?? 0 : 0,
      globalProfitDiscountPercent: cfg.globalProfit,
      globalDiscountPercent: cfg.globalOfflist,
    });
    const net = applyDealerDiscount(new Prisma.Decimal(s.list), s.cost != null ? new Prisma.Decimal(s.cost) : null, mode, modePct);
    return net != null ? Math.round(Number(net) * (1 + s.tax / 100) * 100) / 100 : null;
  }

  async listCompetitors(tenantId: string) {
    const data = await this.prisma.competitor.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
    return { success: true, data };
  }

  async createCompetitor(tenantId: string, dto: CreateCompetitorDto) {
    const c = await this.prisma.competitor.create({
      data: {
        tenantId,
        name: dto.name.trim(),
        type: dto.type ?? 'competitor',
        feedUrl: dto.feedUrl?.trim() || null,
        priceKdvIncluded: dto.priceKdvIncluded ?? true,
        purchaseDiscountPercent: dto.purchaseDiscountPercent ?? 0,
        packagingFee: dto.packagingFee ?? null,
        isDealerPrice: dto.isDealerPrice ?? false,
        fieldMap: dto.fieldMap ?? undefined,
        cleanupWords: dto.cleanupWords ?? undefined,
      },
    });
    return { success: true, data: c };
  }

  async updateCompetitor(tenantId: string, id: string, dto: UpdateCompetitorDto) {
    await this.assertOwn(tenantId, id);
    const c = await this.prisma.competitor.update({
      where: { id },
      data: {
        name: dto.name?.trim(),
        type: dto.type,
        feedUrl: dto.feedUrl === undefined ? undefined : dto.feedUrl?.trim() || null,
        priceKdvIncluded: dto.priceKdvIncluded,
        purchaseDiscountPercent: dto.purchaseDiscountPercent,
        packagingFee: dto.packagingFee,
        isDealerPrice: dto.isDealerPrice,
        fieldMap: dto.fieldMap ?? undefined,
        cleanupWords: dto.cleanupWords ?? undefined,
        active: dto.active,
      },
    });
    return { success: true, data: c };
  }

  async deleteCompetitor(tenantId: string, id: string) {
    await this.assertOwn(tenantId, id);
    await this.prisma.competitor.delete({ where: { id } }); // cascade: ürünler + eşleşmeler gider
    return { success: true };
  }

  /** XML çek + eşleştir. Uzun sürebilir (feed büyükse) → arka plan çağrısı önerilir. */
  async sync(tenantId: string, id: string) {
    await this.assertOwn(tenantId, id);
    const ing = await this.ingest.ingest(id, tenantId);
    const match = await this.matcher.runMatch(id, tenantId);
    this.invalidatePriceCache(tenantId); // yeni veri → cache tazelensin
    return { success: true, ingest: ing, match };
  }

  /** Genel Bakış: rakip başına özet sayılar + toplamlar (hızlı). */
  async overview(tenantId: string) {
    const competitors = await this.prisma.competitor.findMany({ where: { tenantId }, orderBy: { name: 'asc' } });
    const totals = { competitors: competitors.length, products: 0, matched: 0, pending: 0, missing: 0 };
    const rows = [];
    for (const c of competitors) {
      const [products, grp, missing] = await Promise.all([
        this.prisma.competitorProduct.count({ where: { competitorId: c.id } }),
        this.prisma.competitorMatch.groupBy({ by: ['status'], where: { competitorProduct: { competitorId: c.id } }, _count: true }),
        this.prisma.competitorProduct.count({ where: { competitorId: c.id, active: true, matches: { none: { status: { in: ['auto', 'approved'] } } } } }),
      ]);
      const g = Object.fromEntries(grp.map((x) => [x.status, x._count])) as Record<string, number>;
      const matched = (g.auto ?? 0) + (g.approved ?? 0);
      const pending = g.pending ?? 0;
      totals.products += products; totals.matched += matched; totals.pending += pending; totals.missing += missing;
      rows.push({
        id: c.id, name: c.name, type: c.type, isDealerPrice: c.isDealerPrice,
        lastSyncedAt: c.lastSyncedAt, products, matched, pending, missing,
      });
    }
    return { success: true, totals, competitors: rows };
  }

  /**
   * Ucuz olduğumuz ürünler: LİSTE fiyatımız (KDV dahil) rakibin fiyatından düşük
   * olan (auto/approved) eşleşmeler. Ürün başına EN UCUZ rakip baz alınır.
   * Avantaj yüzdesine göre sıralı. (Bayi bazlı indirimli kıyas için "Bayi Fiyat".)
   */
  async opportunities(tenantId: string, take = 40) {
    const r2 = (v: number) => Math.round(v * 100) / 100;
    const { rivalsByProduct, scalars } = await this.getPriceData(tenantId);
    // LİSTE fiyatımız (indirimsiz) vs EN UCUZ rakip
    const all: any[] = [];
    for (const [pid, byComp] of rivalsByProduct) {
      const s = scalars.get(pid);
      if (!s || s.list == null) continue;
      const ourGross = s.list * (1 + s.tax / 100);
      let best: any = null;
      for (const rv of byComp.values()) if (!best || rv.price < best.price) best = rv;
      if (!best || !(best.price >= 10)) continue;
      if (ourGross < best.price) {
        all.push({ pid, name: s.name, slug: s.slug, ourGross, rivalName: best.competitor, rivalPrice: best.price, rivalUrl: best.url, advantagePct: Math.round(((best.price - ourGross) / best.price) * 100) });
      }
    }
    all.sort((a, b) => b.advantagePct - a.advantagePct);
    const top = all.slice(0, Math.min(take, 200));
    const imgById = new Map<string, string | null>();
    if (top.length) {
      const imgs = await this.prisma.product.findMany({
        where: { tenantId, id: { in: top.map((x) => x.pid) } },
        select: { id: true, images: { take: 1, orderBy: { position: 'asc' }, select: { url: true } } },
      });
      for (const p of imgs) imgById.set(p.id, p.images[0]?.url ?? null);
    }
    const data = top.map((x) => ({
      productId: x.pid,
      name: x.name,
      url: x.slug ? `/katalog/${encodeURIComponent(x.slug)}` : null,
      imageUrl: imgById.get(x.pid) ?? null,
      ourGross: r2(x.ourGross),
      rivalName: x.rivalName,
      rivalPrice: r2(x.rivalPrice),
      rivalUrl: x.rivalUrl,
      advantage: r2(x.rivalPrice - x.ourGross),
      advantagePct: x.advantagePct,
    }));
    return { success: true, cheaperCount: all.length, comparedCount: rivalsByProduct.size, data };
  }

  /** Elle onay bekleyen eşleşmeler (yüksek güven üstte). */
  async listPending(tenantId: string, competitorIds: string[], take = 50, skip = 0, sort: 'conf_desc' | 'conf_asc' = 'conf_desc') {
    const info = await this.competitorInfo(tenantId);
    const where: any = { tenantId, status: 'pending' };
    if (competitorIds.length) where.competitorProduct = { competitorId: { in: competitorIds } };
    const [total, matches] = await Promise.all([
      this.prisma.competitorMatch.count({ where }),
      this.prisma.competitorMatch.findMany({
        where,
        include: { competitorProduct: true },
        orderBy: { confidence: sort === 'conf_asc' ? 'asc' : 'desc' },
        take: Math.min(take, 200),
        skip,
      }),
    ]);
    const ourMap = await this.ourProductMap(tenantId, matches.map((m) => m.productId));
    return {
      success: true,
      total,
      data: matches.map((m) => {
        const ci = info.get(m.competitorProduct.competitorId);
        return {
          matchId: m.id,
          confidence: m.confidence,
          matchedBy: m.matchedBy,
          rival: {
            name: this.cleanName(m.competitorProduct.name, ci?.cleanupWords ?? []),
            price: m.competitorProduct.price,
            imageUrl: m.competitorProduct.imageUrl,
            url: m.competitorProduct.productUrl,
            code: m.competitorProduct.externalCode,
            competitor: ci?.name ?? '',
            isDealerPrice: ci?.isDealerPrice ?? false,
          },
          ours: ourMap.get(m.productId) ?? null,
        };
      }),
    };
  }

  /** Onaylanan/otomatik eşleşmeler — geri dönüp kontrol + geri alma için. */
  async listApproved(tenantId: string, competitorIds: string[], take = 60, skip = 0) {
    const info = await this.competitorInfo(tenantId);
    const where: any = { tenantId, status: { in: ['auto', 'approved'] } };
    if (competitorIds.length) where.competitorProduct = { competitorId: { in: competitorIds } };
    const [total, matches] = await Promise.all([
      this.prisma.competitorMatch.count({ where }),
      this.prisma.competitorMatch.findMany({
        where,
        include: { competitorProduct: true },
        orderBy: [{ status: 'asc' }, { confidence: 'desc' }], // approved (elle) üstte, sonra güven
        take: Math.min(take, 200),
        skip,
      }),
    ]);
    const ourMap = await this.ourProductMap(tenantId, matches.map((m) => m.productId));
    return {
      success: true,
      total,
      data: matches.map((m) => {
        const ci = info.get(m.competitorProduct.competitorId);
        return {
          matchId: m.id,
          status: m.status,
          confidence: m.confidence,
          matchedBy: m.matchedBy,
          rival: {
            name: this.cleanName(m.competitorProduct.name, ci?.cleanupWords ?? []),
            price: m.competitorProduct.price,
            imageUrl: m.competitorProduct.imageUrl,
            url: m.competitorProduct.productUrl,
            code: m.competitorProduct.externalCode,
            competitor: ci?.name ?? '',
            isDealerPrice: ci?.isDealerPrice ?? false,
          },
          ours: ourMap.get(m.productId) ?? null,
        };
      }),
    };
  }

  async decide(tenantId: string, matchId: string, status: 'approved' | 'rejected', userId: string) {
    const m = await this.prisma.competitorMatch.findFirst({ where: { id: matchId, tenantId } });
    if (!m) throw new NotFoundException('match not found');
    await this.prisma.competitorMatch.update({
      where: { id: matchId },
      data: { status, decidedByUserId: userId, decidedAt: new Date() },
    });
    this.invalidatePriceCache(tenantId); // eşleşme durumu değişti → cache tazelensin
    return { success: true };
  }

  /** Envanterimizde OLMAYAN: auto|approved eşleşmesi olmayan rakip ürünler (fiyat yüksek üstte). */
  async listMissing(tenantId: string, competitorIds: string[], take = 50, skip = 0) {
    const info = await this.competitorInfo(tenantId);
    const where: any = { tenantId, active: true, matches: { none: { status: { in: ['auto', 'approved'] } } } };
    if (competitorIds.length) where.competitorId = { in: competitorIds };
    const [total, rows] = await Promise.all([
      this.prisma.competitorProduct.count({ where }),
      this.prisma.competitorProduct.findMany({
        where,
        orderBy: { price: 'desc' },
        take: Math.min(take, 200),
        skip,
        select: { id: true, name: true, price: true, imageUrl: true, productUrl: true, externalCode: true, barcode: true, competitorId: true },
      }),
    ]);
    const data = rows.map((r) => {
      const ci = info.get(r.competitorId);
      return {
        id: r.id, name: this.cleanName(r.name, ci?.cleanupWords ?? []),
        price: r.price, imageUrl: r.imageUrl, productUrl: r.productUrl,
        externalCode: r.externalCode, barcode: r.barcode, competitor: ci?.name ?? '',
      };
    });
    return { success: true, total, data };
  }

  /** Elle eşleştir: bizdeki stok kodu / barkod ile ürünü bul → ONAYLI eşleşme kur. */
  async manualMatch(tenantId: string, competitorProductId: string, code: string, userId: string) {
    const cp = await this.prisma.competitorProduct.findFirst({
      where: { id: competitorProductId, tenantId },
      select: { id: true },
    });
    if (!cp) throw new NotFoundException('competitor product not found');
    const q = code.trim();
    const our = await this.prisma.product.findFirst({
      where: { tenantId, OR: [{ internalCode: q }, { barcode: q }, { publicBarcode: q }] },
      select: { id: true, name: true },
    });
    if (!our) throw new BadRequestException('bizde bu stok kodu/barkodla ürün bulunamadı');
    await this.prisma.competitorMatch.upsert({
      where: { competitorProductId_productId: { competitorProductId, productId: our.id } },
      create: {
        tenantId, competitorProductId, productId: our.id,
        status: 'approved', confidence: 100, matchedBy: 'manual',
        decidedByUserId: userId, decidedAt: new Date(),
      },
      update: { status: 'approved', matchedBy: 'manual', decidedByUserId: userId, decidedAt: new Date() },
    });
    this.invalidatePriceCache(tenantId); // yeni onaylı eşleşme → cache tazelensin
    return { success: true, matched: { productId: our.id, name: our.name } };
  }

  /** Tedarikçi değerlendirme (type='supplier'): onların ALIŞ fiyatı vs bizim MALİYET. */
  async supplierEval(tenantId: string, competitorId: string) {
    const comp = await this.prisma.competitor.findFirst({ where: { id: competitorId, tenantId } });
    if (!comp) throw new NotFoundException('competitor not found');
    const matches = await this.prisma.competitorMatch.findMany({
      where: { tenantId, status: { in: ['auto', 'approved'] }, competitorProduct: { competitorId } },
      include: { competitorProduct: true },
    });
    const ourMap = await this.ourProductMap(tenantId, matches.map((m) => m.productId));
    const disc = comp.purchaseDiscountPercent ?? 0;
    const pack = comp.packagingFee != null ? Number(comp.packagingFee) : 0;
    let cheaper = 0, expensive = 0;
    const rows = matches.map((m) => {
      const ours = ourMap.get(m.productId);
      let their = Number(m.competitorProduct.price);
      if (!comp.priceKdvIncluded) their = their * 1.2; // KDV hariçse dahile getir
      their = Math.round((their * (1 - disc / 100) + pack) * 100) / 100;
      const ourCostGross = ours?.cost != null ? Math.round(ours.cost * 1.2 * 100) / 100 : null;
      const cheaperHere = ourCostGross != null && their < ourCostGross;
      if (ourCostGross != null) cheaperHere ? cheaper++ : expensive++;
      const saving = ourCostGross != null ? Math.round((ourCostGross - their) * 100) / 100 : null;
      return {
        name: ours?.name ?? m.competitorProduct.name,
        supplier: ours?.supplier ?? null,
        theirPrice: their,
        ourCost: ourCostGross,
        saving, // + ise onlardan almak ucuz
        cheaper: cheaperHere,
        rival: m.competitorProduct.name,
      };
    });
    rows.sort((a, b) => (b.saving ?? -1e9) - (a.saving ?? -1e9)); // en çok tasarruf üstte
    return { success: true, summary: { total: rows.length, cheaper, expensive }, data: rows };
  }

  /**
   * YENİ TEDARİKÇİ ANALİZİ: aday tedarikçinin (Competitor) XML'i bizim ALIŞ
   * (costPrice, KDV hariç) maliyetimizle kıyaslanır. Ortak ürün, ucuz/pahalı %,
   * ortalama avantaj, kategori/marka/mevcut-tedarikçi kırılımı, geçmiş sipariş
   * adedi ve tahmini tasarruf. Aday fiyatı KDV/iskonto/paketleme ile net maliyete
   * indirgenir. NOT: her ürünün mevcut TEK tedarikçisi+maliyeti bilinir; tüm
   * tedarikçiler için ayrı fiyat matrisi verimizde YOK (o yüzden tek "bizim maliyet").
   */
  async supplierAnalysis(
    tenantId: string,
    competitorId: string,
    opts: { page?: number; pageSize?: number; priceStatus?: string; stockStatus?: string; q?: string; all?: boolean; sortBy?: string; sortDir?: string } = {},
  ) {
    const comp = await this.prisma.competitor.findFirst({ where: { id: competitorId, tenantId } });
    if (!comp) throw new NotFoundException('tedarikçi bulunamadı');
    const r2 = (v: number) => Math.round(v * 100) / 100;
    const disc = comp.purchaseDiscountPercent ?? 0;
    const pack = comp.packagingFee != null ? Number(comp.packagingFee) : 0;
    const kdvIncl = comp.priceKdvIncluded;
    const xmlTotal = await this.prisma.competitorProduct.count({ where: { competitorId } });

    const matches = await this.prisma.competitorMatch.findMany({
      where: { tenantId, status: { in: ['auto', 'approved'] }, competitorProduct: { competitorId } },
      select: {
        productId: true, confidence: true, matchedBy: true,
        competitorProduct: { select: { name: true, price: true, barcode: true, productUrl: true, imageUrl: true, externalCode: true } },
      },
    });
    const ids = [...new Set(matches.map((m) => m.productId))];
    const ourMap = new Map<string, any>();
    for (let i = 0; i < ids.length; i += 10000) {
      const rows = await this.prisma.product.findMany({
        where: { tenantId, id: { in: ids.slice(i, i + 10000) } },
        select: {
          id: true, name: true, slug: true, internalCode: true, stock: true, costPrice: true,
          brand: true, canonicalCategoryPath: true, matchGroupId: true,
          supplier: { select: { name: true } },
          images: { take: 1, orderBy: { position: 'asc' }, select: { url: true } },
        },
      });
      for (const p of rows) ourMap.set(p.id, p);
    }
    // ÇAPRAZ TEDARİKÇİ: aynı ürün birden çok tedarikçide olabilir (ProductMatchGroup).
    // "Bizim maliyet" = o gruptan EN UCUZ aldığımız tedarikçi+maliyet.
    const groupIds = [...new Set([...ourMap.values()].map((p) => p.matchGroupId).filter(Boolean))] as string[];
    const groupCheapest = new Map<string, { cost: number; supplier: string | null }>();
    for (let i = 0; i < groupIds.length; i += 10000) {
      const members = await this.prisma.product.findMany({
        where: { tenantId, active: true, matchGroupId: { in: groupIds.slice(i, i + 10000) } },
        select: { matchGroupId: true, costPrice: true, supplier: { select: { name: true } } },
      });
      for (const m of members) {
        if (!m.matchGroupId || m.costPrice == null) continue;
        const c = Number(m.costPrice);
        if (!(c > 0)) continue;
        const cur = groupCheapest.get(m.matchGroupId);
        if (!cur || c < cur.cost) groupCheapest.set(m.matchGroupId, { cost: c, supplier: m.supplier?.name ?? null });
      }
    }

    // Karşılaştırmalar modülündeki RAKİP satış fiyatları (bu ürünü daha önce eşlediğimiz
    // Mey/Kargolat/Hepsidepo/… feed'leri) — "komple fiyatlar" için. Cache'ten (DB yok).
    const { rivalsByProduct } = await this.getPriceData(tenantId);

    // geçmiş sipariş adedi (tüm zaman) — chunk'lı groupBy
    const qtyMap = new Map<string, number>();
    for (let i = 0; i < ids.length; i += 10000) {
      const g = await this.prisma.orderItem.groupBy({ by: ['productId'], where: { productId: { in: ids.slice(i, i + 10000) } }, _sum: { qty: true } });
      for (const x of g) if (x.productId) qtyMap.set(x.productId, x._sum.qty ?? 0);
    }
    // ürün başına EN UCUZ aday maliyeti (net)
    const perProduct = new Map<string, any>();
    for (const m of matches) {
      const p = ourMap.get(m.productId);
      if (!p) continue;
      let their = Number(m.competitorProduct.price);
      if (kdvIncl) their = their / 1.2; // KDV dahilse net maliyete indir
      their = their * (1 - disc / 100) + pack;
      if (!(their > 0)) continue;
      const cur = perProduct.get(m.productId);
      if (!cur || their < cur.theirCost) perProduct.set(m.productId, {
        p, theirCost: their,
        theirName: m.competitorProduct.name, theirImage: m.competitorProduct.imageUrl,
        theirCode: m.competitorProduct.externalCode, theirUrl: m.competitorProduct.productUrl,
        confidence: m.confidence,
      });
    }

    const cat = new Map<string, any>(), brand = new Map<string, any>(), sup = new Map<string, any>();
    const bump = (map: Map<string, any>, key: string, isCheaper: boolean, adv: number) => {
      const e = map.get(key) ?? { matched: 0, cheaper: 0, advSum: 0 };
      e.matched++; if (isCheaper) e.cheaper++; e.advSum += adv; map.set(key, e);
    };
    let cheaper = 0, expensive = 0, advSum = 0, annualSaving = 0, switchable = 0;
    const products: any[] = [];
    for (const [pid, x] of perProduct) {
      // ÇAPRAZ TEDARİKÇİ: bu ürünü aldığımız EN UCUZ yer (match-group). Yoksa kendi tedarikçisi.
      const grp = x.p.matchGroupId ? groupCheapest.get(x.p.matchGroupId) : null;
      const ourCost = grp ? grp.cost : Number(x.p.costPrice);
      const curSupplier = grp ? grp.supplier : (x.p.supplier?.name ?? null);
      if (!(ourCost > 0)) continue;
      const isCheaper = x.theirCost < ourCost;
      const advPct = Math.round(((ourCost - x.theirCost) / ourCost) * 1000) / 10; // + = onlardan almak ucuz
      if (isCheaper) cheaper++; else expensive++;
      advSum += advPct;
      const qty = qtyMap.get(pid) ?? 0;
      const saving = isCheaper ? r2((ourCost - x.theirCost) * qty) : 0;
      if (isCheaper) { switchable++; annualSaving += saving; }
      const catKey = (x.p.canonicalCategoryPath || '').split('>').map((s: string) => s.trim()).filter(Boolean)[0] || 'Diğer';
      bump(cat, catKey, isCheaper, advPct);
      bump(brand, x.p.brand || 'Diğer', isCheaper, advPct);
      bump(sup, curSupplier || 'Bilinmiyor', isCheaper, advPct);
      const rivalSales = [...(rivalsByProduct.get(pid)?.values() ?? [])]
        .map((r: any) => ({ competitor: r.competitor, price: r.price }))
        .sort((a, b) => a.price - b.price);
      products.push({
        productId: pid,
        // bizim ürün
        name: x.p.name, ourCode: x.p.internalCode ?? null, ourImage: x.p.images?.[0]?.url ?? null,
        url: x.p.slug ? `/katalog/${encodeURIComponent(x.p.slug)}` : null, ourStock: x.p.stock ?? 0,
        // yeni tedarikçi ürünü
        theirName: x.theirName, theirCode: x.theirCode ?? null, theirImage: x.theirImage ?? null, theirUrl: x.theirUrl ?? null,
        // fiyat/karar
        currentSupplier: curSupplier, ourCost: r2(ourCost), theirCost: r2(x.theirCost),
        fark: r2(x.theirCost - ourCost), diffPct: advPct, cheaper: isCheaper,
        confidence: x.confidence ?? 0, orderQty: qty, projectedSaving: saving,
        rivalSales, // rakiplerin SATIŞ fiyatı (Karşılaştırmalar'dan; KDV dahil, maliyet değil)
      });
    }
    const matched = perProduct.size;
    const avgAdv = matched ? Math.round((advSum / matched) * 10) / 10 : 0;
    const cheaperPct = matched ? Math.round((cheaper / matched) * 100) : 0;
    const matchedPct = xmlTotal ? Math.round((matched / xmlTotal) * 100) : 0;
    const worthScore = Math.max(0, Math.min(100, Math.round(cheaperPct * 0.5 + Math.max(0, avgAdv) * 1.5 + matchedPct * 0.2)));
    const recommend = worthScore >= 60 ? 'Çalışılmalı' : worthScore >= 35 ? 'Değerlendir' : 'Şimdilik değmez';
    const toRows = (map: Map<string, any>) => [...map.entries()]
      .map(([k, e]) => ({ name: k, matched: e.matched, cheaper: e.cheaper, expensive: e.matched - e.cheaper, avgAdvantagePct: Math.round((e.advSum / e.matched) * 10) / 10 }))
      .sort((a, b) => b.matched - a.matched).slice(0, 15);
    // FİLTRELER (yalnız tabloyu süzer; stat kartları TÜM eşleşmelerden). Sayfalama.
    const query = (opts.q ?? '').trim().toLowerCase();
    let filtered = products;
    if (opts.priceStatus === 'cheaper') filtered = filtered.filter((p) => p.cheaper);
    else if (opts.priceStatus === 'expensive') filtered = filtered.filter((p) => !p.cheaper);
    if (opts.stockStatus === 'instock') filtered = filtered.filter((p) => p.ourStock > 10);
    else if (opts.stockStatus === 'low') filtered = filtered.filter((p) => p.ourStock > 0 && p.ourStock <= 10);
    else if (opts.stockStatus === 'out') filtered = filtered.filter((p) => p.ourStock <= 0);
    if (query) filtered = filtered.filter((p) => p.name.toLowerCase().includes(query) || (p.theirName || '').toLowerCase().includes(query));
    // SIRALAMA (kolon başlığından). Varsayılan: tahmini tasarruf ↓.
    const dir = opts.sortDir === 'asc' ? 1 : -1;
    const sortKey = (p: any): number => {
      switch (opts.sortBy) {
        case 'fark': return p.fark;
        case 'avantaj': return p.diffPct;
        case 'confidence': return p.confidence;
        case 'theirCost': return p.theirCost;
        case 'ourCost': return p.ourCost;
        case 'stock': return p.ourStock;
        case 'saving': return p.projectedSaving;
        default: return NaN;
      }
    };
    if (opts.sortBy) filtered = [...filtered].sort((a, b) => (sortKey(a) - sortKey(b)) * dir);
    else filtered.sort((a, b) => b.projectedSaving - a.projectedSaving || b.diffPct - a.diffPct);
    const total = filtered.length;
    const pageSize = opts.all ? total || 1 : Math.min(Math.max(opts.pageSize ?? 100, 1), 500);
    const page = Math.max(opts.page ?? 1, 1);
    const paged = opts.all ? filtered : filtered.slice((page - 1) * pageSize, page * pageSize);
    return {
      success: true,
      competitor: { name: comp.name, priceKdvIncluded: kdvIncl, purchaseDiscountPercent: disc, packagingFee: pack },
      totals: { xmlTotal, matched, matchedPct, cheaper, cheaperPct, expensive, expensivePct: matched ? Math.round((expensive / matched) * 100) : 0, avgAdvantagePct: avgAdv, worthScore },
      insight: { recommend, annualSaving: r2(annualSaving), switchable },
      categories: toRows(cat),
      suppliers: toRows(sup),
      brands: toRows(brand),
      total, page, pageSize,
      products: paged,
    };
  }

  /** Yeni Tedarikçi Analizi — TÜM eşleşen ürünleri xlsx olarak dışa aktar. */
  async supplierAnalysisExcel(tenantId: string, competitorId: string) {
    const a = await this.supplierAnalysis(tenantId, competitorId, { all: true });
    const wb = new Workbook();
    const ws = wb.addWorksheet('Yeni Tedarikçi Analizi');
    ws.columns = [
      { header: 'Yeni Tedarikçi Ürünü', key: 'theirName', width: 42 },
      { header: 'Aday Kodu', key: 'theirCode', width: 16 },
      { header: 'Bizim Ürün', key: 'name', width: 42 },
      { header: 'Stok Kodu', key: 'ourCode', width: 16 },
      { header: 'Stok', key: 'ourStock', width: 8 },
      { header: 'Yeni Tedarikçi Fiyat (₺)', key: 'theirCost', width: 18 },
      { header: 'En Ucuz Mevcut Tedarikçi', key: 'currentSupplier', width: 22 },
      { header: 'Bizim Maliyet (₺)', key: 'ourCost', width: 16 },
      { header: 'Fark (₺)', key: 'fark', width: 12 },
      { header: 'Avantaj %', key: 'diffPct', width: 10 },
      { header: 'Eşleşme %', key: 'confidence', width: 10 },
      { header: 'Sipariş Adedi', key: 'orderQty', width: 12 },
      { header: 'Tahmini Tasarruf (₺)', key: 'projectedSaving', width: 18 },
    ];
    ws.getRow(1).font = { bold: true };
    for (const p of a.products as any[]) ws.addRow(p);
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const safe = (a.competitor.name || 'tedarikci').replace(/[^\w.-]+/g, '_');
    return { buffer, fileName: `yeni-tedarikci-analizi-${safe}.xlsx` };
  }

  /**
   * Bayi Fiyat Karşılaştırma: seçili bayinin GERÇEK gördüğü fiyat (paylaşılan
   * dealer-price.util — sepetle birebir) vs her rakibin fiyatı. Yalnız
   * onaylı/oto eşleşmeler. Ürün başına gruplanır; en ucuz işaretlenir.
   */
  async priceCompare(tenantId: string, customerId: string, _competitorId?: string, q?: string) {
    const cfg = await this.loadDealerConfig(customerId);
    const { rivalsByProduct, scalars } = await this.getPriceData(tenantId);
    const query = (q ?? '').trim().toLowerCase();

    // özet (kaç üründe ucuz/pahalı) + aday listesi — bayiye ÖZEL fiyatla (cache'ten, DB yok)
    let cheaper = 0, expensive = 0;
    const candidates: { pid: string; rivals: number; ourGross: number | null }[] = [];
    for (const [pid, byComp] of rivalsByProduct) {
      const s = scalars.get(pid);
      if (!s) continue;
      if (query && !s.name.toLowerCase().includes(query)) continue; // BİZİM ürün adına göre filtre
      const ourGross = this.dealerGross(s, cfg);
      const minRival = Math.min(...[...byComp.values()].map((r) => r.price));
      if (ourGross != null && ourGross <= minRival) cheaper++; else expensive++;
      candidates.push({ pid, rivals: byComp.size, ourGross });
    }
    const total = candidates.length;
    candidates.sort((a, b) => b.rivals - a.rivals);
    const top = candidates.slice(0, 300);

    // görseller (to-many) YALNIZ gösterilecek 300 için (P2029'dan kaçın)
    const imgById = new Map<string, string | null>();
    if (top.length) {
      const imgs = await this.prisma.product.findMany({
        where: { tenantId, id: { in: top.map((x) => x.pid) } },
        select: { id: true, images: { take: 1, orderBy: { position: 'asc' }, select: { url: true } } },
      });
      for (const p of imgs) imgById.set(p.id, p.images[0]?.url ?? null);
    }
    const data = top.map((x) => {
      const s = scalars.get(x.pid)!;
      const rivals = [...rivalsByProduct.get(x.pid)!.values()].sort((a, b) => a.price - b.price);
      const minRival = rivals.length ? rivals[0].price : null;
      return {
        productId: x.pid, name: s.name, supplier: s.supplierName, ourGross: x.ourGross,
        imageUrl: imgById.get(x.pid) ?? null,
        url: s.slug ? `/katalog/${encodeURIComponent(s.slug)}` : null,
        rivals,
        weCheapest: x.ourGross != null && (minRival == null || x.ourGross <= minRival),
      };
    });

    const suggestion = this.priceSuggestion(cfg, rivalsByProduct, scalars, query);
    return { success: true, discount: cfg.label, total, summary: { cheaper, expensive }, suggestion, data };
  }

  /**
   * Fiyat önerisi: bayi çoğu üründe rakiplerden bariz ucuzsa, GLOBAL iskontoyu
   * düşürüp (fiyatı artırıp) hâlâ en ucuz kalınabilecek noktayı simüle eder.
   * Örn. "%50 → %42'ye çek, ürünlerin ~%90'ında hâlâ en ucuzsun, kârı artırırsın".
   * Yalnız global profit/offlist modunda + global-yönetilen ürünlerde anlamlı.
   */
  private priceSuggestion(cfg: any, rivalsByProduct: Map<string, Map<string, any>>, scalars: Map<string, any>, query: string) {
    let mode: 'profit' | 'offlist' | null = null;
    let curD = 0;
    if (!cfg.isAdminDiscount) {
      if (cfg.globalProfit > 0) { mode = 'profit'; curD = cfg.globalProfit; }
      else if (cfg.globalOfflist > 0) { mode = 'offlist'; curD = cfg.globalOfflist; }
    }
    if (!mode || curD < 2) return null;
    const pool: { list: number; cost: number | null; tax: number; nearest: number }[] = [];
    for (const [pid, byComp] of rivalsByProduct) {
      const s = scalars.get(pid);
      if (!s || s.list == null) continue;
      if (query && !s.name.toLowerCase().includes(query)) continue;
      const supId = s.supplierId;
      const governed = !(supId && (cfg.supplierRowSet.has(supId) || cfg.supplierAdminDiscountSet.has(supId)));
      if (!governed) continue; // tedarikçi override'ı olan ürün global iskontodan etkilenmez
      if (mode === 'profit' && (s.cost == null || s.cost <= 0)) continue;
      const nearest = Math.min(...[...byComp.values()].map((r) => r.price));
      pool.push({ list: s.list, cost: s.cost, tax: s.tax, nearest });
    }
    if (pool.length < 20) return null;
    const netAt = (p: any, d: number) => mode === 'profit'
      ? p.list - (Math.max(p.list - (p.cost ?? p.list), 0) * d) / 100
      : (p.list * (100 - d)) / 100;
    const grossAt = (p: any, d: number) => netAt(p, d) * (1 + p.tax / 100);
    const cheaperAt = (d: number) => pool.reduce((n, p) => (grossAt(p, d) <= p.nearest ? n + 1 : n), 0);
    // KÂRLI ucuz: hem en ucuz hem net ≥ maliyet (maliyetin altına inme)
    const profitCheaperAt = (d: number) => pool.reduce((n, p) => {
      if (grossAt(p, d) > p.nearest) return n;
      if (p.cost != null && p.cost > 0 && netAt(p, d) < p.cost) return n;
      return n + 1;
    }, 0);
    const pct = (n: number) => Math.round((n / pool.length) * 100);
    const base = cheaperAt(curD);
    const avgGross = (d: number) => { let s = 0; for (const p of pool) s += grossAt(p, d); return s; };

    // AŞAĞI — çoğunda öndeysek iskontoyu düşür, kârı artır (hâlâ ~%1 altta kal)
    let lower: any = null;
    if (base >= pool.length * 0.6) {
      let best = curD;
      for (let d = curD - 1; d >= 0; d--) { if (cheaperAt(d) >= base * 0.9) best = d; else break; }
      if (best <= curD - 2) {
        const sc = avgGross(curD), sn = avgGross(best);
        lower = { suggestedPct: best, keepCheaperPct: pct(cheaperAt(best)), gainPct: sc > 0 ? Math.round(((sn - sc) / sc) * 1000) / 10 : 0 };
      }
    }

    // YUKARI — pahalı kaldığımız ürünler varsa, iskontoyu artırıp (maliyet altına inmeden)
    // en çok üründe KÂRLI en-ucuz olacağımız noktayı bul
    let raise: any = null;
    const expensiveNow = pool.length - base;
    if (expensiveNow >= pool.length * 0.08) {
      const maxD = mode === 'profit' ? 100 : 95;
      const ceil = profitCheaperAt(maxD); // maliyet dibinde (kârlı) ulaşılabilir max
      // hedef: %95 kapsama, ama tavanın son %3'ünü (maliyet dibi) kovalama → EN KÜÇÜK iskonto
      const target = Math.min(pool.length * 0.95, ceil * 0.97);
      let bestD: number | null = null;
      for (let d = curD + 1; d <= maxD; d++) { if (profitCheaperAt(d) >= target) { bestD = d; break; } }
      if (bestD != null && bestD > curD) {
        const reach = profitCheaperAt(bestD);
        const sc = avgGross(curD), sn = avgGross(bestD);
        raise = {
          suggestedPct: bestD,
          reachCheaperPct: pct(reach),
          unwinnable: pool.length - ceil, // rakip maliyetimizin altında → kârlı kazanılamaz
          coversAll: pool.length - ceil <= pool.length * 0.01,
          marginDropPct: sc > 0 ? Math.round(((sc - sn) / sc) * 1000) / 10 : 0,
        };
      }
    }

    if (!lower && !raise) return null;
    return { mode, currentPct: curD, pool: pool.length, cheaperPct: pct(base), lower, raise };
  }

  /** "Geçiş Yap" → ürüne "daha ucuz tedarikçi" MANUEL işareti (Siparişlerde uyarı). */
  async setCheaperHint(
    tenantId: string,
    dto: { productId: string; supplierName: string; competitorId?: string; theirCost: number; ourCost: number; productUrl?: string },
    userId: string,
  ) {
    const savingPerUnit = Math.round((dto.ourCost - dto.theirCost) * 100) / 100;
    const data = await this.prisma.cheaperSupplierHint.upsert({
      where: { tenantId_productId: { tenantId, productId: dto.productId } },
      create: { tenantId, productId: dto.productId, supplierName: dto.supplierName, competitorId: dto.competitorId ?? null, theirCost: dto.theirCost, ourCost: dto.ourCost, savingPerUnit, productUrl: dto.productUrl ?? null, createdByUserId: userId },
      update: { supplierName: dto.supplierName, competitorId: dto.competitorId ?? null, theirCost: dto.theirCost, ourCost: dto.ourCost, savingPerUnit, productUrl: dto.productUrl ?? null, createdByUserId: userId },
    });
    return { success: true, data };
  }

  async removeCheaperHint(tenantId: string, productId: string) {
    await this.prisma.cheaperSupplierHint.deleteMany({ where: { tenantId, productId } });
    return { success: true };
  }

  /** Tenant'ın tüm "daha ucuz" işaretleri (analiz sayfasında hangi ürün işaretli göstermek için). */
  async listCheaperHints(tenantId: string) {
    const data = await this.prisma.cheaperSupplierHint.findMany({
      where: { tenantId },
      select: { productId: true, supplierName: true, theirCost: true, ourCost: true, savingPerUnit: true },
    });
    return { success: true, data };
  }

  // ---- yardımcılar ----

  /** Müşteri iskonto config'i (orders.service ile birebir yükleme; formül util'de). */
  private async loadDealerConfig(customerId: string) {
    const supplierDiscountMap = new Map<string, number>();
    const supplierProfitMap = new Map<string, number>();
    const supplierRowSet = new Set<string>();
    const supplierAdminDiscountSet = new Set<string>();
    let isAdminDiscount = false, globalOfflist = 0, globalProfit = 0;
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: {
        discountPercent: true, profitDiscountPercent: true, customerStatus: true,
        supplierDiscounts: { select: { supplierId: true, discountPercent: true, profitDiscountPercent: true, adminDiscount: true } },
      },
    });
    isAdminDiscount = customer?.customerStatus === 'ADMIN_DISCOUNT';
    globalOfflist = Math.max(0, Math.min(100, customer?.discountPercent ?? 0));
    globalProfit = Math.max(0, Math.min(100, customer?.profitDiscountPercent ?? 0));
    for (const sd of customer?.supplierDiscounts ?? []) {
      supplierRowSet.add(sd.supplierId);
      if (sd.adminDiscount) supplierAdminDiscountSet.add(sd.supplierId);
      supplierDiscountMap.set(sd.supplierId, Math.max(0, Math.min(100, sd.discountPercent)));
      supplierProfitMap.set(sd.supplierId, Math.max(0, Math.min(100, sd.profitDiscountPercent)));
    }
    const label = isAdminDiscount ? 'Admin İndirimi (maliyet)' : globalProfit > 0 ? `Kâr İndirimi %${globalProfit}` : globalOfflist > 0 ? `Liste %${globalOfflist}` : 'indirim yok';
    return { isAdminDiscount, globalOfflist, globalProfit, supplierDiscountMap, supplierProfitMap, supplierRowSet, supplierAdminDiscountSet, label };
  }
  /** tenant'ın tüm rakipleri: id → {ad, cleanupWords, bayi-fiyatı mı, tip}. */
  private async competitorInfo(tenantId: string) {
    const cs = await this.prisma.competitor.findMany({
      where: { tenantId },
      select: { id: true, name: true, cleanupWords: true, isDealerPrice: true, type: true },
    });
    return new Map(cs.map((c) => [c.id, { name: c.name, cleanupWords: (c.cleanupWords as string[]) ?? [], isDealerPrice: c.isDealerPrice, type: c.type }]));
  }

  /** Görüntülenecek rakip adı: cleanupWords (ör. "Firma Adı®") çıkarılmış. */
  private cleanName(name: string, cw: string[]): string {
    if (!cw.length) return name;
    const c = stripCleanup(name, cw).cleaned;
    return c || name;
  }

  private async assertOwn(tenantId: string, id: string) {
    const c = await this.prisma.competitor.findFirst({ where: { id, tenantId }, select: { id: true } });
    if (!c) throw new BadRequestException('competitor not found');
  }

  private async ourProductMap(tenantId: string, ids: string[]) {
    const rows = await this.prisma.product.findMany({
      where: { tenantId, id: { in: ids } },
      select: {
        id: true, name: true, slug: true, price: true, taxRate: true, costPrice: true,
        supplier: { select: { name: true } },
        images: { take: 1, orderBy: { position: 'asc' }, select: { url: true } },
      },
    });
    const map = new Map<string, any>();
    for (const p of rows) {
      const tax = p.taxRate != null ? Number(p.taxRate) : 20;
      map.set(p.id, {
        id: p.id,
        name: p.name,
        listGross: p.price != null ? Math.round(Number(p.price) * (1 + tax / 100) * 100) / 100 : null,
        cost: p.costPrice != null ? Number(p.costPrice) : null,
        supplier: p.supplier?.name ?? null,
        imageUrl: p.images[0]?.url ?? null,
        url: p.slug ? `/katalog/${encodeURIComponent(p.slug)}` : null,
      });
    }
    return map;
  }
}

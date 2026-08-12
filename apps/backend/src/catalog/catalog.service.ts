import { Injectable, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma, CustomerStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  ProductDetailDto,
  ProductCardDto,
  ProductListQueryDto,
  CategoryNodeDto,
  BrandCountDto,
  CatalogCountDto,
  CategoryTreeQueryDto,
} from './dto';
import { decodeHtmlEntities } from '../common/utils/html-entities';
import {
  SESSION_COOKIE_NAME,
  readSessionCookie,
} from '../customer-auth/session-cookie';
import type { CustomerJwtPayload } from '../customer-auth/customer-jwt.guard';

const DEFAULT_PAGE_SIZE = 24;
const MAX_PAGE_SIZE = 60;

// Türkçe arama normalizasyonu — PostgreSQL `lower()` standart collation'da
// "İ" → "i + U+0307" (combining dot above) üretir, bu yüzden
// 'çiçekli' ILIKE '%ÇİÇEKLİ%' eşleşmez. Hem JS hem SQL tarafında aynı
// karakter haritasını uyguluyoruz: TRANSLATE(col, MAP_SRC, MAP_DST) + LOWER.
const TR_LETTER_MAP: Record<string, string> = {
  İ: 'i',
  I: 'i',
  ı: 'i',
  Ş: 's',
  ş: 's',
  Ğ: 'g',
  ğ: 'g',
  Ç: 'c',
  ç: 'c',
  Ö: 'o',
  ö: 'o',
  Ü: 'u',
  ü: 'u',
};
const TR_SEARCH_MAP_SRC = 'İIıŞşĞğÇçÖöÜü';
const TR_SEARCH_MAP_DST = 'iiissggccoouu';

function trSearchNormalize(s: string): string {
  let out = '';
  for (const ch of s) out += TR_LETTER_MAP[ch] ?? ch;
  return out.toLowerCase();
}

interface CategoryRow {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  path: string;
  depth: number;
}

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  /**
   * Opsiyonel cookie-auth: `tb_session` çerezinden müşteri statüsünü çözer.
   * Cookie yoksa / geçersizse / müşteri bulunamazsa `null` döner — bu durumda
   * çağıran taraf STANDARD (deduped) davranışı korur. Hiçbir koşulda 401
   * fırlatmaz; public katalog anonim erişime açık kalır.
   */
  async resolveCustomerStatus(
    cookieHeader: string | undefined,
  ): Promise<CustomerStatus | null> {
    const token = readSessionCookie(cookieHeader, SESSION_COOKIE_NAME);
    if (!token) return null;
    let payload: CustomerJwtPayload;
    try {
      payload = this.jwt.verify<CustomerJwtPayload>(token);
    } catch {
      return null;
    }
    if (payload?.type !== 'customer' || !payload.sub) return null;
    const customer = await this.prisma.customer.findUnique({
      where: { id: payload.sub },
      select: { customerStatus: true },
    });
    return customer?.customerStatus ?? null;
  }

  private async resolveTenantId(slug: string): Promise<string> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!tenant) throw new NotFoundException('tenant not found');
    return tenant.id;
  }

  // Türkçe-normalize, token-AND içeren raw arama. Her token ürünün
  // name + model (NULL → '') kolonunda alt-string olarak bulunmalı.
  // Prisma `mode: 'insensitive'` Türkçe İ/I/ı/i ailesinde combining mark
  // ürettiği için yetersiz; bu yüzden hem kolon hem token aynı
  // TRANSLATE+LOWER haritasından geçiyor.
  // ID set'i `where.id = { in: ... }` ile dışarıda kullanılır;
  // diğer filtreler (kategori, fiyat, stok, sort) standart yolla çalışır.
  private async searchProductIdsByTokens(
    tenantId: string,
    tokens: string[],
    includeAllVariants = false,
  ): Promise<string[]> {
    if (tokens.length === 0) return [];
    const conditions = tokens.map((t) => {
      const normalized = `%${trSearchNormalize(t)}%`;
      return Prisma.sql`(
        LOWER(TRANSLATE("name", ${TR_SEARCH_MAP_SRC}, ${TR_SEARCH_MAP_DST})) LIKE ${normalized}
        OR LOWER(TRANSLATE(COALESCE("model", ''), ${TR_SEARCH_MAP_SRC}, ${TR_SEARCH_MAP_DST})) LIKE ${normalized}
      )`;
    });
    // ADMIN_DISCOUNT müşteri her eşleşen üründe TEK + EN UCUZ kartı görür
    // (isCheapestInGroup=true). STANDARD/anonim için deduped (canonical=en pahalı)
    // davranış aynen. (Eskiden admin TÜM varyantları görüyordu → çift kart;
    // kullanıcı kararı 2026-06-29: admin de tek, ama en ucuz.)
    const canonicalClause = includeAllVariants
      ? Prisma.sql`AND "isCheapestInGroup" = TRUE`
      : Prisma.sql`AND "isCanonical" = TRUE`;
    const rows = await this.prisma.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT "id" FROM "Product"
        WHERE "tenantId" = ${tenantId}
          AND "active" = TRUE
          ${canonicalClause}
          AND ${Prisma.join(conditions, ' AND ')}
        LIMIT 5000`,
    );
    return rows.map((r) => r.id);
  }

  async getCategoryTree(
    query: CategoryTreeQueryDto,
  ): Promise<CategoryNodeDto[]> {
    const tenantId = await this.resolveTenantId(query.tenantSlug);
    const cats = await this.prisma.category.findMany({
      where: { tenantId },
      orderBy: [{ depth: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        parentId: true,
        name: true,
        slug: true,
        path: true,
        depth: true,
      },
    });
    const tree = this.buildTree(cats);
    if (!query.withCounts) return tree;

    // Tek sorguda tüm kategoriler için aktif ürün sayısı.
    // Önceden landing kök kategori başına ayrı `?pageSize=1` isteği atıyor
    // ve throttler 429'a düşürüyordu — bu enrichment ile tek istek yetiyor.
    const grouped = await this.prisma.product.groupBy({
      by: ['categoryId'],
      // Sayımlar yalnızca stoklu ürünleri kapsar — kategori ağacındaki sayı
      // ile vitrinde listelenen ürün sayısı birebir tutsun.
      where: { tenantId, active: true, stock: { gt: 0 }, categoryId: { not: null } },
      _count: { _all: true },
    });
    const directCount = new Map<string, number>();
    for (const row of grouped) {
      if (row.categoryId) directCount.set(row.categoryId, row._count._all);
    }

    // Lookup `id` üzerinden — slug aynı tenant içinde benzersiz değil
    // (`@@unique([tenantId, path])` var, slug yok).
    function attachCount(node: CategoryNodeDto): number {
      const own = directCount.get(node.id) ?? 0;
      let total = own;
      for (const child of node.children) total += attachCount(child);
      node.count = total;
      return total;
    }
    for (const root of tree) attachCount(root);
    return tree;
  }

  /**
   * V3 (doğru-kategori) storefront ağacı — ürünlerin canonicalCategoryPath
   * (Trendyol tabanlı doğru kategori) değerlerinden sentetik bir kategori ağacı
   * kurar. getCategoryTree ile AYNI DTO şeklini döndürür. Mevcut Category-tabanlı
   * ağaca DOKUNMAZ — additive. Ürün filtreleme path-prefix ile yapılır.
   */
  async getCanonicalCategoryTree(
    query: CategoryTreeQueryDto,
  ): Promise<CategoryNodeDto[]> {
    const tenantId = await this.resolveTenantId(query.tenantSlug);
    const grouped = await this.prisma.product.groupBy({
      by: ['canonicalCategoryPath'],
      where: {
        tenantId,
        active: true,
        stock: { gt: 0 },
        canonicalCategoryPath: { not: null },
      },
      _count: { _all: true },
    });

    const slugify = (s: string): string =>
      s
        .toLocaleLowerCase('tr-TR')
        .replace(/ı/g, 'i')
        .replace(/ş/g, 's')
        .replace(/ç/g, 'c')
        .replace(/ğ/g, 'g')
        .replace(/ü/g, 'u')
        .replace(/ö/g, 'o')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');

    const byPath = new Map<string, CategoryNodeDto>();
    const roots: CategoryNodeDto[] = [];
    const ensureNode = (segments: string[]): CategoryNodeDto => {
      const fullPath = segments.join(' > ');
      const existing = byPath.get(fullPath);
      if (existing) return existing;
      const node: CategoryNodeDto = {
        id: slugify(fullPath),
        name: segments[segments.length - 1],
        slug: slugify(fullPath),
        path: fullPath,
        depth: segments.length - 1,
        children: [],
        count: 0,
      };
      byPath.set(fullPath, node);
      if (segments.length === 1) {
        roots.push(node);
      } else {
        ensureNode(segments.slice(0, -1)).children.push(node);
      }
      return node;
    };

    for (const row of grouped) {
      const path = row.canonicalCategoryPath as string;
      const segments = path
        .split(' > ')
        .map((s) => s.trim())
        .filter(Boolean);
      if (!segments.length) continue;
      const leaf = ensureNode(segments);
      leaf.count = (leaf.count ?? 0) + row._count._all;
    }

    // Alt ağaç toplamlarını yukarı taşı (her düğümün count'u kendisi + altları).
    const roll = (node: CategoryNodeDto): number => {
      let total = node.count ?? 0;
      for (const c of node.children) total += roll(c);
      node.count = total;
      return total;
    };
    for (const r of roots) roll(r);
    return roots;
  }

  private buildTree(rows: CategoryRow[]): CategoryNodeDto[] {
    const byId = new Map<string, CategoryNodeDto>();
    for (const r of rows) {
      byId.set(r.id, {
        id: r.id,
        name: r.name,
        slug: r.slug,
        path: r.path,
        depth: r.depth,
        children: [],
      });
    }
    const roots: CategoryNodeDto[] = [];
    for (const r of rows) {
      const node = byId.get(r.id);
      if (!node) continue;
      if (r.parentId && byId.has(r.parentId)) {
        byId.get(r.parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    }
    return roots;
  }

  async listProducts(
    query: ProductListQueryDto,
    includeAllVariants = false,
  ): Promise<{
    data: ProductCardDto[];
    meta: { total: number; page: number; pageSize: number; totalPages: number };
  }> {
    const tenantId = await this.resolveTenantId(query.tenantSlug);
    // `limit`/`offset` standart REST aliaslarını destekle. Verildiğinde
    // `page`/`pageSize`'a göre öncelikli olarak kullanılır.
    const effectivePageSize =
      query.limit ?? query.pageSize ?? DEFAULT_PAGE_SIZE;
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, effectivePageSize),
    );
    const page =
      query.offset !== undefined
        ? Math.max(1, Math.floor(query.offset / pageSize) + 1)
        : Math.max(1, query.page ?? 1);

    const where: Prisma.ProductWhereInput = {
      tenantId,
      active: true,
      // Stoğu olmayan ürün mağazada HİÇ listelenmez (kural: stoksuz ürün
      // vitrinde görünmez, "Tükendi" rozeti dahi gösterilmez). 0-stoğa düşen
      // ürün anında listeden kalkar; 3 gün 0 kalırsa stock-reconcile cron'u
      // DB'den tamamen siler.
      stock: { gt: 0 },
    };
    // Dedup: aynı ürünün varyantlarından müşteri (STANDARD/anonim) canonical
    // (en pahalı/stoklu) tek kartı görür. ADMIN_DISCOUNT her eşleşen üründe TEK +
    // EN UCUZ kartı görür (isCheapestInGroup). Müşteri davranışı değişmez.
    if (includeAllVariants) {
      where.isCheapestInGroup = true;
    } else {
      where.isCanonical = true;
    }

    if (query.categorySlug) {
      const cat = await this.prisma.category.findFirst({
        where: { tenantId, slug: query.categorySlug },
        select: { id: true, path: true },
      });
      if (!cat) {
        return { data: [], meta: { total: 0, page, pageSize, totalPages: 0 } };
      }
      const descendants = await this.prisma.category.findMany({
        where: {
          tenantId,
          OR: [{ id: cat.id }, { path: { startsWith: `${cat.path} > ` } }],
        },
        select: { id: true },
      });
      where.categoryId = { in: descendants.map((d) => d.id) };
    }

    // V3: DOĞRU kategori yolu ile filtre — tam yol VEYA alt ağaç (path prefix).
    // Mevcut categorySlug filtresine DOKUNMAZ; storefront canonical gezinme bunu kullanır.
    if (query.canonicalPath) {
      const cp = query.canonicalPath;
      const cond: Prisma.ProductWhereInput = {
        OR: [
          { canonicalCategoryPath: cp },
          { canonicalCategoryPath: { startsWith: `${cp} > ` } },
        ],
      };
      where.AND = where.AND
        ? [...(Array.isArray(where.AND) ? where.AND : [where.AND]), cond]
        : [cond];
    }

    if (query.q) {
      const trimmed = query.q.trim();
      // Tokenize: noktalama-only parçaları (örn. "-") at — bunlar isimde
      // tire olmayan ürünleri yanlışlıkla eler. Tam ürün adı + renk
      // girildiğinde tüm anlamlı token'lar eşleşmeli, bu yüzden cap yüksek.
      const tokens = trimmed
        .split(/\s+/)
        .map((t) => t.trim())
        .filter((t) => /[\p{L}\p{N}]/u.test(t))
        .slice(0, 16);

      if (tokens.length > 0) {
        // Tek token ve TBDR prefix'i veya saf rakam (barkod) → tam eşleşme öncelikli
        const singleToken = tokens.length === 1 ? tokens[0] : null;
        const isCodeLike =
          singleToken !== null &&
          (singleToken.toUpperCase().startsWith('TBDR') ||
            /^\d{6,}$/.test(singleToken));

        if (isCodeLike) {
          // Kod-benzeri tek token: externalCode / publicBarcode tam eşleşmesi
          // + ad/model'de Türkçe-normalize alt-string araması fallback.
          const matchedIds = await this.searchProductIdsByTokens(
            tenantId,
            [singleToken],
            includeAllVariants,
          );
          where.OR = [
            { externalCode: { equals: singleToken, mode: 'insensitive' } },
            { publicBarcode: { equals: singleToken, mode: 'insensitive' } },
            // Müşteriye "Stok Kodu" olarak gösterilen dahili kod (TBDR-XXXXXX)
            // de aranabilir olmalı; aksi halde bayi gördüğü kodu yazınca 0
            // sonuç dönüyordu (#35). internalCode da TBDR prefix'li olduğu için
            // isCodeLike dalına düşer.
            { internalCode: { equals: singleToken, mode: 'insensitive' } },
            ...(matchedIds.length > 0
              ? [{ id: { in: matchedIds } } as Prisma.ProductWhereInput]
              : []),
          ] as Prisma.ProductWhereInput[];
        } else {
          // Metin araması: name ve model — description/brand dahil değil.
          // Türkçe büyük-küçük harf (İ/I/ı/i, Ş/ş, Ğ/ğ, Ç/ç, Ö/ö, Ü/ü) için
          // Prisma `mode: 'insensitive'` (ILIKE+lower) yetersiz — combining
          // mark üretiyor. Raw SQL TRANSLATE+LOWER ile normalize eşleştirme.
          const matchedIds = await this.searchProductIdsByTokens(
            tenantId,
            tokens,
            includeAllVariants,
          );
          if (matchedIds.length === 0) {
            return {
              data: [],
              meta: { total: 0, page, pageSize, totalPages: 0 },
            };
          }
          where.id = { in: matchedIds };
        }
      }
    }

    if (query.brand) where.brand = { equals: query.brand, mode: 'insensitive' };

    if (query.minPrice !== undefined || query.maxPrice !== undefined) {
      where.price = {};
      if (query.minPrice !== undefined)
        (where.price as Prisma.DecimalFilter).gte = query.minPrice;
      if (query.maxPrice !== undefined)
        (where.price as Prisma.DecimalFilter).lte = query.maxPrice;
    }

    if (query.inStock) where.stock = { gt: 0 };

    const sort = query.sort;
    const isAggregateSort =
      sort === 'best_selling' || sort === 'popular' || sort === 'recommended';
    // Arama modunda kullanıcı sort seçmediyse name ASC — alfabetik sıra,
    // "iPhone 13 Pro" önce "iPhone 13 Pro Kılıf"'tan önce gelir.
    const orderBy = query.q && !sort
      ? { name: 'asc' as const }
      : this.buildOrderBy(sort);

    // Out-of-stock products always go to the end, regardless of filter/sort.
    // For aggregate ranking, the score path already encodes a heavy penalty
    // for stock===0. For everything else we split the page across two
    // segments (in-stock first, out-of-stock after) preserving the chosen sort.
    const productSelect = {
      id: true,
      slug: true,
      name: true,
      brand: true,
      price: true,
      currency: true,
      stock: true,
      supplierId: true,
      // Sepette kargo/PDF kuralları için tedarikçi politikası liste yanıtında
      // da gelir — grid'den eklenen ürün de policy taşır.
      supplier: {
        select: {
          mandatoryCarriers: true,
          requiresPdf: true,
          pttavmEnabled: true,
        },
      },
      images: {
        orderBy: { position: 'asc' as const },
        take: 1,
        select: { url: true },
      },
      category: { select: { path: true } },
    };

    let total: number;
    let rows: Prisma.ProductGetPayload<{ select: typeof productSelect }>[];

    if (isAggregateSort) {
      [total, rows] = await Promise.all([
        this.prisma.product.count({ where }),
        this.findManyWithSalesRanking(where, page, pageSize, sort),
      ]);
    } else {
      // Stoksuz ürünler base where'de (stock>0) tamamen elendiği için artık
      // "in-stock / out-of-stock segment" ayrımına gerek yok — tek sorgu,
      // seçilen sıralamayla düz sayfalama.
      const offset = (page - 1) * pageSize;
      [total, rows] = await Promise.all([
        this.prisma.product.count({ where }),
        this.prisma.product.findMany({
          where,
          orderBy,
          skip: offset,
          take: pageSize,
          select: productSelect,
        }),
      ]);
    }

    // Eski kayıtlarda DB'ye HTML entity'li yazılmış olabilir (yeni ingest temiz
    // yazıyor). Response sırasında decode et — kullanıcı "&Ouml;" görmesin.
    const data: ProductCardDto[] = rows.map((p) => ({
      id: p.id,
      slug: p.slug,
      name: decodeHtmlEntities(p.name),
      brand: decodeHtmlEntities(p.brand ?? null),
      price: p.price.toString(),
      currency: p.currency,
      stock: p.stock,
      image: p.images[0]?.url ?? null,
      categoryPath: p.category?.path ?? null,
      supplierId: p.supplierId,
      supplier: p.supplier
        ? {
            mandatoryCarriers: p.supplier.mandatoryCarriers,
            requiresPdf: p.supplier.requiresPdf,
            pttavmEnabled: p.supplier.pttavmEnabled,
          }
        : null,
    }));

    return {
      data,
      meta: { total, page, pageSize, totalPages: Math.ceil(total / pageSize) },
    };
  }

  private buildOrderBy(sort?: string): Prisma.ProductOrderByWithRelationInput {
    switch (sort) {
      case 'price_asc':
        return { price: 'asc' };
      case 'price_desc':
        return { price: 'desc' };
      case 'name':
        return { name: 'asc' };
      case 'best_selling':
      case 'popular':
      case 'recommended':
      case 'newest':
      default:
        return { createdAt: 'desc' };
    }
  }

  private async findManyWithSalesRanking(
    where: Prisma.ProductWhereInput,
    page: number,
    pageSize: number,
    // 'popular' = landing vitrininin gönderdiği ad; best_selling ile aynı skor.
    mode: 'best_selling' | 'popular' | 'recommended',
  ) {
    const candidates = await this.prisma.product.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 2000,
      select: { id: true },
    });
    const ids = candidates.map((c) => c.id);
    if (ids.length === 0) return [];
    const sales = await this.prisma.orderItem.groupBy({
      by: ['productId'],
      where: { productId: { in: ids } },
      _sum: { qty: true },
    });
    const salesByProduct = new Map<string, number>();
    for (const s of sales) {
      // OrderItem.productId artık nullable (supplier hard-delete sonrası
      // SET NULL); satış aggregasyonunda null girişleri atla.
      if (s.productId === null) continue;
      salesByProduct.set(s.productId, s._sum.qty ?? 0);
    }
    const products = await this.prisma.product.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        slug: true,
        name: true,
        brand: true,
        price: true,
        currency: true,
        stock: true,
        supplierId: true,
        createdAt: true,
        supplier: {
          select: {
            mandatoryCarriers: true,
            requiresPdf: true,
            pttavmEnabled: true,
          },
        },
        images: {
          orderBy: { position: 'asc' },
          take: 1,
          select: { url: true },
        },
        category: { select: { path: true } },
      },
    });
    const ranked = products
      .map((p) => {
        const sold = salesByProduct.get(p.id) ?? 0;
        const stockTier = p.stock > 0 ? 1 : 0;
        const recencyBoost = Math.max(
          0,
          1 -
            (Date.now() - new Date(p.createdAt).getTime()) /
              (1000 * 60 * 60 * 24 * 90),
        );
        const baseScore =
          mode === 'best_selling' || mode === 'popular'
            ? sold * 100
            : sold * 50 + recencyBoost * 3;
        // Dominant tier guarantees in-stock always ranks above out-of-stock.
        const score = stockTier * 1_000_000_000 + baseScore;
        return { p, score, sold };
      })
      .sort((a, b) => b.score - a.score)
      .slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize)
      .map((x) => x.p);
    return ranked;
  }

  async getProductDetail(
    slug: string,
    tenantSlug: string,
  ): Promise<ProductDetailDto> {
    const tenantId = await this.resolveTenantId(tenantSlug);
    const p = await this.prisma.product.findUnique({
      where: { tenantId_slug: { tenantId, slug } },
      select: {
        id: true,
        slug: true,
        name: true,
        brand: true,
        model: true,
        description: true,
        price: true,
        currency: true,
        stock: true,
        active: true,
        // Müşteriye yalnızca site stok kodu (internalCode — TBDR-XXXXXX) gösterilir.
        // Ham tedarikçi kodu (externalCode) bu endpoint'e bilerek dahil edilmez.
        internalCode: true,
        // Müşteri-yüzlü endpoint orijinal `barcode`'u DEĞİL, `publicBarcode`'u
        // gösterir (orijinal tedarikçi barkodu gizli kalır).
        publicBarcode: true,
        images: {
          orderBy: { position: 'asc' },
          select: { url: true, position: true },
        },
        category: { select: { id: true, name: true, slug: true } },
        // V3: doğru (canonical) kategori — breadcrumb bundan kurulur.
        canonicalCategoryPath: true,
        supplierId: true,
        // Checkout'ta PDF/kargo şartlarını dayatabilmek için tedarikçi
        // politikalarını detaya iliştir. Tedarikçi adı/feedUrl gibi iç
        // bilgiler asla buraya girmez.
        supplier: {
          select: {
            mandatoryCarriers: true,
            requiresPdf: true,
            pttavmEnabled: true,
            leadTimeDays: true,
          },
        },
      },
    });
    // Pasif VEYA stoksuz ürün mağazada görünmez — ikisi de "kaldırıldı"
    // sayılır (stoksuz ürün hiç listelenmez kuralı backend'de de zorunlu).
    if (!p || !p.active || p.stock <= 0) {
      throw new NotFoundException({
        status: 'NOT_FOUND',
        message: 'Ürün kaldırıldı',
      });
    }

    // Breadcrumb: only the leaf category (no parent chain). The PDP shows a
    // single chip linking to the leaf taxonomy node — full hierarchy is intentionally
    // suppressed to keep the breadcrumb terse and category-page focused.
    // V3: breadcrumb DOĞRU (canonical) kategoriden — leaf adı + canonical leaf
    // slug'ı (katalog bu slug'ı doğru kategori ağacında çözer). canonical yoksa
    // eski Category'ye düşülür (fallback).
    let breadcrumb: { name: string; slug: string }[] = [];
    if (p.canonicalCategoryPath) {
      const segs = p.canonicalCategoryPath
        .split(' > ')
        .map((s) => s.trim())
        .filter(Boolean);
      if (segs.length) {
        const slug = p.canonicalCategoryPath
          .toLocaleLowerCase('tr-TR')
          .replace(/ı/g, 'i')
          .replace(/ş/g, 's')
          .replace(/ç/g, 'c')
          .replace(/ğ/g, 'g')
          .replace(/ü/g, 'u')
          .replace(/ö/g, 'o')
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/(^-|-$)/g, '');
        breadcrumb = [{ name: segs[segs.length - 1], slug }];
      }
    }
    if (breadcrumb.length === 0 && p.category) {
      breadcrumb = [{ name: p.category.name, slug: p.category.slug }];
    }

    return {
      id: p.id,
      slug: p.slug,
      name: decodeHtmlEntities(p.name),
      brand: decodeHtmlEntities(p.brand ?? null),
      model: decodeHtmlEntities(p.model ?? null),
      description: decodeHtmlEntities(p.description ?? null),
      price: p.price.toString(),
      currency: p.currency,
      stock: p.stock,
      sku: p.internalCode ?? null,
      // Müşteri sadece publicBarcode (TBDR...) görür — orijinal barcode asla
      // bu response'a sızmaz.
      barcode: p.publicBarcode ?? null,
      supplierId: p.supplierId,
      images: p.images.map((i) => ({ url: i.url, position: i.position })),
      breadcrumb,
      supplier: p.supplier
        ? {
            mandatoryCarriers: p.supplier.mandatoryCarriers,
            requiresPdf: p.supplier.requiresPdf,
            pttavmEnabled: p.supplier.pttavmEnabled,
            leadTimeDays: p.supplier.leadTimeDays,
          }
        : null,
    };
  }

  /**
   * Tenant'taki ürün sayısını döndürür. `activeOnly=false` verilirse pasif
   * ürünler de sayılır (admin/dashboard için faydalı). Default: aktif ürünler.
   * Auth gerektirmez — yalnızca toplam sayı sızar, içerik değil.
   */
  async getProductCount(
    tenantSlug: string,
    activeOnly: boolean,
    includeAllVariants = false,
  ): Promise<CatalogCountDto> {
    const tenantId = await this.resolveTenantId(tenantSlug);
    // ADMIN_DISCOUNT için en-ucuz-tek (isCheapestInGroup) sayımı liste ile tutarlı;
    // STANDARD/anonim için canonical-only sayım korunur.
    const where: Prisma.ProductWhereInput = activeOnly
      ? { tenantId, active: true, stock: { gt: 0 }, ...(includeAllVariants ? { isCheapestInGroup: true } : { isCanonical: true }) }
      : { tenantId };
    const total = await this.prisma.product.count({ where });
    return { total, activeOnly };
  }

  async listBrands(
    tenantSlug: string,
    includeAllVariants = false,
  ): Promise<BrandCountDto[]> {
    const tenantId = await this.resolveTenantId(tenantSlug);
    const rows = await this.prisma.product.groupBy({
      by: ['brand'],
      where: {
        tenantId,
        active: true,
        stock: { gt: 0 },
        ...(includeAllVariants ? { isCheapestInGroup: true } : { isCanonical: true }),
        brand: { not: null },
      },
      _count: { _all: true },
      orderBy: { brand: 'asc' },
    });
    return rows
      .filter((r) => r.brand)
      .map((r) => ({
        brand: decodeHtmlEntities(r.brand as string),
        count: r._count._all,
      }));
  }
}

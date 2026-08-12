import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import slugify from 'slugify';
import { createHash, randomBytes } from 'crypto';
import { Prisma, Supplier, SupplierFeed } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { XmlParserService, ParsedProduct, ParseResult } from './xml-parser.service';
import { ShopifyFeedService } from './shopify-feed.service';
import {
  normalizeProductName,
  normalizeProductDescription,
} from './product-normalizer';
import { applyTextRules } from './text-rules';
import { decodeHtmlEntities } from '../common/utils/html-entities';
import { computeNameKey } from '../common/utils/name-key';
import { generatePublicBarcode } from '../common/utils/public-barcode';
import { generateUniqueInternalCode } from '../common/utils/internal-code';
import { assertSafeFeedUrl } from '../common/utils/safe-feed-url';
import { ExchangeRateService } from '../common/services/exchange-rate.service';
import { XmlSlotService } from '../product-core/xml-slot.service';
import {
  resolveEffectivePricing,
  computeSalePrice,
  pricingSignature,
  type SupplierPricingInput,
  type CategoryPricingInput,
} from '../pricing/tiered-profit.util';
import { ProductDedupService } from '../product-core/product-dedup.service';
import { ProductMatchService } from '../product-match/product-match.service';

export interface SyncResult {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
}

export interface RecomputeTextResult {
  scanned: number;
  updated: number;
}

const SLUG_OPTS = { lower: true, strict: true, trim: true } as const;

// Part 2 — "aynı görsel çok FARKLI üründe" kuralı eşiği. Bir ANA görsel (pos0)
// URL'i aynı feed sync batch'inde bu sayıda veya daha fazla FARKLI ADLI (distinct
// nameKey) üründe geçiyorsa, o görsel jenerik/placeholder/kırık demektir (tek bir
// ürünün gerçek fotoğrafı bu kadar farklı ürüne ait olamaz) → o ürünler pasiflenir
// (active=false, marketplaceListed=false). ADET değil İSİM ÇEŞİTLİLİĞİ sayılır:
// aynı ürünün varyant kopyaları aynı/benzer addadır → tetiklemez (onları dedup/
// isCanonical "1 tut" ile yönetir). Self-healing: tedarikçi özgün görsel verince
// görsel URL'i değişir → contentHash bozulur → ürün yeniden işlenip aktifleşir
// (kalıcı forceInactive'in AKSİNE).
const DUP_MAIN_IMAGE_THRESHOLD = 5;

@Injectable()
export class IngestService {
  private readonly logger = new Logger(IngestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly xml: XmlParserService,
    private readonly shopify: ShopifyFeedService,
    private readonly config: ConfigService,
    private readonly exchangeRate: ExchangeRateService,
    private readonly xmlSlot: XmlSlotService,
    private readonly productDedup: ProductDedupService,
    private readonly productMatch: ProductMatchService,
  ) {}

  async syncFeed(feedId: string, tenantId: string): Promise<SyncResult> {
    const feedWithSupplier = await this.prisma.supplierFeed.findFirst({
      where: { id: feedId, tenantId },
      include: { supplier: true },
    });
    if (!feedWithSupplier) throw new NotFoundException('feed not found');
    if (!feedWithSupplier.active) {
      this.logger.log(`syncFeed skipped: feed=${feedId} inactive`);
      return { total: 0, created: 0, updated: 0, skipped: 0, errors: 0 };
    }
    if (!feedWithSupplier.supplier.active) {
      this.logger.log(`syncFeed skipped: feed=${feedId} supplier inactive`);
      return { total: 0, created: 0, updated: 0, skipped: 0, errors: 0 };
    }

    try {
      return await this.runSync(feedWithSupplier.supplier, feedWithSupplier);
    } catch (err) {
      const message = (err as Error).message ?? 'unknown sync error';
      this.logger.error(
        `syncFeed failed feed=${feedId}: ${message}`,
        (err as Error).stack,
      );
      try {
        await this.prisma.supplierFeed.update({
          where: { id: feedId },
          data: { lastSyncError: message.slice(0, 4000) },
        });
      } catch (writeErr) {
        this.logger.warn(
          `failed to persist lastSyncError: ${(writeErr as Error).message}`,
        );
      }
      throw err;
    }
  }

  async syncSupplier(
    supplierId: string,
    requestTenantId?: string,
  ): Promise<SyncResult> {
    const supplier = await this.prisma.supplier.findFirst({
      where: requestTenantId
        ? { id: supplierId, tenantId: requestTenantId }
        : { id: supplierId },
      select: { id: true, tenantId: true, active: true },
    });
    if (!supplier) throw new NotFoundException('supplier not found');
    if (!supplier.active) {
      this.logger.log(`syncSupplier skipped: supplier=${supplierId} inactive`);
      return { total: 0, created: 0, updated: 0, skipped: 0, errors: 0 };
    }

    const feeds = await this.prisma.supplierFeed.findMany({
      where: { supplierId, tenantId: supplier.tenantId, active: true },
      select: { id: true },
    });
    if (feeds.length === 0) {
      this.logger.log(`syncSupplier skipped: supplier=${supplierId} no active feeds`);
      return { total: 0, created: 0, updated: 0, skipped: 0, errors: 0 };
    }

    const settled = await Promise.allSettled(
      feeds.map((f) => this.syncFeed(f.id, supplier.tenantId)),
    );
    return settled.reduce<SyncResult>(
      (acc, r) => {
        if (r.status === 'fulfilled') {
          acc.total += r.value.total;
          acc.created += r.value.created;
          acc.updated += r.value.updated;
          acc.skipped += r.value.skipped;
          acc.errors += r.value.errors;
        } else {
          acc.errors++;
        }
        return acc;
      },
      { total: 0, created: 0, updated: 0, skipped: 0, errors: 0 },
    );
  }

  /**
   * Tedarikçi metin kuralları (SupplierTextRule) değiştiğinde mevcut ürünlere
   * GERİYE DÖNÜK uygular. BullMQ `recompute-text` job'ından çağrılır (UI bloklanmaz).
   *
   * Determinizm: name/description HAM kaynaktan (rawFeedName / rawFeedDescription)
   * yeniden türetilir → "değiştir" kuralları tekrar uygulanınca metin büyümez.
   * Ham yoksa mevcut name/description'a düşülür (eski satırlar için en iyi çaba).
   *
   * contentNormalizedAt'e DOKUNMAZ (donmuş ürünleri yalnız bu pass değiştirir,
   * sonsuz re-normalize döngüsü olmaz). 500'lük cursor batch — ToptanBudur ~25K.
   */
  async recomputeTextRulesForSupplier(
    supplierId: string,
    tenantId: string,
  ): Promise<RecomputeTextResult> {
    const rules = await this.prisma.supplierTextRule.findMany({
      where: { supplierId, tenantId },
      select: {
        search: true,
        replacement: true,
        applyToName: true,
        applyToDescription: true,
        caseInsensitive: true,
        wholeWord: true,
        enabled: true,
        sortOrder: true,
      },
    });

    const RECOMPUTE_BATCH = 500;
    let scanned = 0;
    let updated = 0;
    let cursor: string | undefined;

    for (;;) {
      const batch = await this.prisma.product.findMany({
        take: RECOMPUTE_BATCH,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        where: { supplierId, tenantId },
        orderBy: { id: 'asc' },
        select: {
          id: true,
          name: true,
          nameKey: true,
          description: true,
          rawFeedName: true,
          rawFeedDescription: true,
        },
      });
      if (batch.length === 0) break;
      cursor = batch[batch.length - 1].id;
      scanned += batch.length;

      const updates: Prisma.PrismaPromise<unknown>[] = [];
      for (const p of batch) {
        // Determinizm: mümkünse HAM kaynaktan yeniden türet.
        const baseName = normalizeProductName(p.rawFeedName ?? p.name);
        const newName = applyTextRules(baseName, rules, 'name') || baseName;
        const newNameKey = computeNameKey(newName);

        const baseDesc = normalizeProductDescription(
          p.rawFeedDescription ?? p.description,
        );
        // Açıklama boşa düşerse ürün adına geri düş — boş açıklama pazaryerinde
        // listelenmiyor (recompute de bu garantiyi korur).
        const newDesc =
          (baseDesc ? applyTextRules(baseDesc, rules, 'description') : baseDesc) ||
          newName;

        if (
          newName !== p.name ||
          newNameKey !== p.nameKey ||
          newDesc !== p.description
        ) {
          updated++;
          updates.push(
            this.prisma.product.update({
              where: { id: p.id },
              // contentNormalizedAt'e DOKUNMA — yalnız name/nameKey/description.
              data: { name: newName, nameKey: newNameKey, description: newDesc },
            }),
          );
        }
      }

      if (updates.length) {
        await this.prisma.$transaction(updates, {
          isolationLevel: 'ReadCommitted',
          timeout: 60_000,
        });
      }
    }

    this.logger.log(
      `recomputeTextRules supplier=${supplierId}: scanned=${scanned} updated=${updated}`,
    );
    return { scanned, updated };
  }

  private async runSync(
    supplier: Supplier,
    feed: Pick<
      SupplierFeed,
      | 'id'
      | 'feedUrl'
      | 'feedCurrency'
      | 'exchangeRate'
      | 'exchangeRateMargin'
      | 'lastFeedItemCount'
    >,
  ): Promise<SyncResult> {
    await assertSafeFeedUrl(feed.feedUrl);

    // Shopify products.json feed'i (XML vermeyen tedarikçiler): aynı ParseResult
    // şekli üretilir; alttaki tüm akış (markup, dedup, TBDR, kategori, stale)
    // hiçbir değişiklik olmadan aynı çalışır. Login/scraping gerekmez.
    let parseResult: ParseResult;
    if (this.shopify.isShopifyFeedUrl(feed.feedUrl)) {
      this.logger.log(
        `fetching SHOPIFY feed: supplier=${supplier.id} feed=${feed.id}`,
      );
      parseResult = await this.shopify.fetchAndParse(feed.feedUrl);
    } else {
    this.logger.log(`fetching feed: supplier=${supplier.id} feed=${feed.id}`);
    // AbortController ile DNS + TCP + download dahil tüm pipeline için
    // tek bir 55 saniyelik saat. Tedarikçi sunucusu takılırsa keser.
    const abort = new AbortController();
    const abortTimer = setTimeout(() => abort.abort(), 55_000);
    let resp: Awaited<ReturnType<typeof axios.get<string>>>;
    try {
      resp = await axios.get<string>(feed.feedUrl, {
        timeout: 55_000,
        signal: abort.signal as never,
        responseType: 'text',
        maxContentLength: 1024 * 1024 * 200,
        maxBodyLength: 1024 * 1024 * 200,
        headers: {
          'User-Agent': 'TB-B2B-FeedSync/1.0 (+https://toptanbudur.com)',
          'Accept': 'application/xml, text/xml, text/plain, */*',
          'Accept-Encoding': 'gzip, deflate',
        },
        transformResponse: [
          (d: unknown) => (typeof d === 'string' ? d : String(d)),
        ],
      });
    } finally {
      clearTimeout(abortTimer);
    }

    const xmlText = resp.data.replace(/^\uFEFF/, '');
    parseResult = this.xml.parseDetailed(xmlText);
    }
    const parsed = parseResult.items;
    this.logger.log(
      `parsed ${parsed.length}/${parseResult.totalCandidates} products ` +
        `(drops: missingSku=${parseResult.dropped.missingSku} ` +
        `missingName=${parseResult.dropped.missingName} ` +
        `missingPrice=${parseResult.dropped.missingPrice} ` +
        `invalidPriceFormat=${parseResult.dropped.invalidPriceFormat} ` +
        `duplicateSkuInFeed=${parseResult.dropped.duplicateSkuInFeed} ` +
        `malformed=${parseResult.dropped.malformed})`,
    );

    // Anomali alarmı: feed beklenenden ÇOK daha az ürün import ettiyse (bozuk/
    // değişmiş feed → sessizce katalog küçülmesin) WARN düş. Eşik env ile
    // ayarlanır (FEED_DROP_WARN_RATIO, varsayılan 0.5 = adayların yarısından
    // fazlası import edilemediyse). Küçük feed'lerde gürültü olmasın diye
    // min 50 aday şartı. Duplicate düşüşü normal (Toptanbudur ölü kopyaları),
    // bu yüzden eşik yüksek tutuldu; gerçek bozulma (toplu missing/malformed)
    // bunu aşar.
    const importRatio =
      parseResult.totalCandidates > 0
        ? parsed.length / parseResult.totalCandidates
        : 1;
    const dropWarnRatio =
      Number(process.env.FEED_DROP_WARN_RATIO ?? '0.5') || 0.5;
    if (parseResult.totalCandidates >= 50 && importRatio < 1 - dropWarnRatio) {
      this.logger.warn(
        `feed.drop.anomaly supplier='${supplier.name}' feed=${feed.id} ` +
          `imported=${parsed.length}/${parseResult.totalCandidates} ` +
          `(${(importRatio * 100).toFixed(1)}%) — feed bozuk/değişmiş olabilir ` +
          `[missingSku=${parseResult.dropped.missingSku} ` +
          `missingName=${parseResult.dropped.missingName} ` +
          `missingPrice=${parseResult.dropped.missingPrice} ` +
          `invalidPriceFormat=${parseResult.dropped.invalidPriceFormat} ` +
          `duplicateSkuInFeed=${parseResult.dropped.duplicateSkuInFeed} ` +
          `malformed=${parseResult.dropped.malformed}]`,
      );
    }

    // Satış fiyatlandırma (sabit marj veya kademeli kâr) TEK KAYNAK
    // tiered-profit.util ile çözülür — aşağıda supplierPricingInput olarak
    // hazırlanır ve her ürün için resolveEffectivePricing + computeSalePrice
    // çağrılır. SQL recompute (admin-suppliers) AYNI motoru kullanır → parite.
    const tenantId = supplier.tenantId;
    const stockThreshold = Math.max(0, Number(supplier.stockThreshold) || 0);
    // Minimum kabul edilen ürün maliyeti (TL, KDVsiz). Bu eşiğin altındaki
    // feed satırları skip + (varsa) deactive edilir. Default 1.0 TL.
    const supplierMinPrice = Math.max(0, Number(supplier.minPrice ?? 1) || 0);

    const result: SyncResult = {
      total: parsed.length,
      created: 0,
      updated: 0,
      skipped: 0,
      errors: 0,
    };
    // Telemetri: minPrice / inactive category nedeniyle atlanan satır sayıları.
    let skippedBelowMinPrice = 0;
    let skippedInactiveCategory = 0;
    let deactivatedBelowMinPrice = 0;
    const categoryCache = new Map<string, string>();
    const slugCache = new Set<string>();
    const seenExternalCodes = new Set<string>();
    // Feed'de görülen tüm kategori path'leri (her seviye ayrı tutulur) →
    // sync sonunda SupplierCategory tablosuna upsert edilir. Admin kategori
    // yönetimi UI'ı bu tablodan beslenir; eski sürümde upsert silindiği için
    // tablo boş kalıyordu (#9). Set key = path.join(' > '); değer = segments.
    const seenCategoryPaths = new Map<string, string[]>();

    // Pricing normalize parametreleri (Supplier-level config).
    // - feedCurrency: feed'in para birimi override; XML "currency" alanı yoksa veya
    //   XML hatalı geliyorsa (örn. FBI feed'i USD ama tag eksik) buradan zorlanır.
    // - exchangeRate + exchangeRateMargin: TRY dönüşümü (rate + margin, TL).
    // - priceIncludesVat: feed KDV dahil geliyorsa cost'u KDV oranıyla bölerek
    //   sistemde KDV hariç fiyat tutarız.
    const manualExchangeRate =
      feed.exchangeRate !== null && feed.exchangeRate !== undefined
        ? Number(feed.exchangeRate)
        : null;
    const supplierExchangeRateMargin = Number(feed.exchangeRateMargin || 0);
    const supplierFeedCurrency = feed.feedCurrency ?? 'TRY';
    const supplierPriceIncludesVat = Boolean(supplier.priceIncludesVat);
    // ── TEK KAYNAK ALIŞ ─────────────────────────────────────────────────────
    // KDV oranı (10/20): KDV strip için TEK rate (eski per-ürün taxRate yerine).
    const sVat = Number((supplier as { purchaseVatRate?: unknown }).purchaseVatRate);
    const supplierVatRate = Number.isFinite(sVat) && sVat > 0 ? sVat : 20;
    // Alış indirimi (%) — XML fiyatına uygulanır (TEK indirim alanı).
    const supplierDiscountPct = Math.max(
      0,
      Number(supplier.purchaseDiscountInclVatPct ?? 0) || 0,
    );
    // Alış indirimi (TL) — XML fiyatına uygulanır (yüzdeyle birlikte).
    const supplierDiscountTl = Math.max(
      0,
      Number((supplier as { purchaseDiscountTl?: unknown }).purchaseDiscountTl ?? 0) || 0,
    );
    // Alış EK MALİYETİ (TL) — birim başına net costPrice'a eklenir.
    const supplierPurchaseExtraCostTl = Math.max(
      0,
      Number((supplier as { purchaseExtraCostTl?: unknown }).purchaseExtraCostTl ?? 0) || 0,
    );

    // TCMB fallback: feed TRY değil ve manuel kur set edilmemişse canlı TCMB
    // kurunu çek. Network hatası olursa lastSuccess kullanılır; o da yoksa
    // null döner — bu durumda dönüşüm yapılamaz, raw cost saklanır.
    let liveExchangeRate: number | null = null;
    const needsLiveRate =
      supplierFeedCurrency.toUpperCase() === 'USD' &&
      (manualExchangeRate === null || manualExchangeRate <= 0);
    if (needsLiveRate) {
      const snap = await this.exchangeRate.getUsdToTry();
      if (snap) {
        liveExchangeRate = snap.rate;
        this.logger.log(
          `supplier=${supplier.id} feedCurrency=USD manualRate=null → using TCMB rate=${snap.rate}`,
        );
      } else {
        this.logger.warn(
          `supplier=${supplier.id} feedCurrency=USD manualRate=null → TCMB unavailable, raw cost will be used`,
        );
      }
    }
    const effectiveSupplierExchangeRate =
      manualExchangeRate !== null && manualExchangeRate > 0
        ? manualExchangeRate
        : liveExchangeRate;

    // SupplierCategory.isActive lookup — feed'in categoryPath değeri
    // bu tedarikçinin pasif kategorisine veya alt-kategorilerine denk
    // geliyorsa ürün atlanır. path String[] alanını "" (kontrol
    // karakteri) separator'lü join'liyoruz; böylece kategori isimleri
    // içinde geçen normal karakterlerle çakışma olmuyor. Prefix kontrolü
    // için inactivePathPrefixes ayrı bir liste olarak tutulur.
    //
    // Sadece bu supplier'a ait kategoriler etkilenir; pathKey
    // karşılaştırmasında supplier.id zaten where filtresinde.
    const PATH_SEP = '';
    const inactiveCategories = await this.prisma.supplierCategory.findMany({
      where: { supplierId: supplier.id, isActive: false },
      select: { path: true },
    });
    const inactivePathKeys = new Set<string>();
    const inactivePathPrefixes: string[] = [];
    for (const c of inactiveCategories) {
      if (Array.isArray(c.path) && c.path.length > 0) {
        const key = c.path.join(PATH_SEP);
        inactivePathKeys.add(key);
        inactivePathPrefixes.push(key + PATH_SEP);
      }
    }

    // Kategori bazlı fiyat override'ları (SupplierCategory.marginPercentOverride
    // / extraCostTryOverride). Bir ürünün leaf kategori path'i bir override'a
    // denk geliyorsa, global supplier.profitMargin / extraCostTry yerine bu
    // değerler kullanılır. Anahtar = path.join(' > ') — Category.path ile birebir
    // aynı; admin-suppliers.setCategoryPricing repricing'i de aynı exact-match'i
    // kullanır → feed sync ile manuel kategori fiyatlaması arasında parite.
    // (Override DEĞİŞİNCE pricingSig de değişir → contentHash mismatch → otomatik
    // reprice; override DURURKEN diğer alanlar değişse bile override korunur.)
    const categoryPriceOverrides = await this.prisma.supplierCategory.findMany({
      where: {
        supplierId: supplier.id,
        OR: [
          { marginPercentOverride: { not: null } },
          { extraCostTryOverride: { not: null } },
          { profitTypeOverride: { not: null } },
        ],
      },
      select: {
        path: true,
        marginPercentOverride: true,
        extraCostTryOverride: true,
        profitTypeOverride: true,
        profitTiers: true,
      },
    });
    // path.join(' > ') → kategori fiyatlandırma girdisi (sabit veya kademeli).
    const overrideByPathKey = new Map<string, CategoryPricingInput>();
    for (const c of categoryPriceOverrides) {
      if (!Array.isArray(c.path) || c.path.length === 0) continue;
      overrideByPathKey.set(c.path.join(' > '), {
        profitTypeOverride: c.profitTypeOverride,
        marginPercentOverride: c.marginPercentOverride,
        extraCostTryOverride: c.extraCostTryOverride,
        profitTiers: c.profitTiers,
      });
    }
    // Tedarikçi global fiyatlandırma girdisi (fixed veya tiered) — bir kez.
    const supplierPricingInput: SupplierPricingInput = {
      profitType: supplier.profitType,
      profitMargin: supplier.profitMargin,
      extraCostTry: supplier.extraCostTry,
      profitTiers: supplier.profitTiers,
    };

    // Brand mapping lookup — sourceBrandName key'li Map.
    // (XML'den case-sensitive geldiği şekilde key oluşturuyoruz; mapping
    // tablosuna eklenirken kullanıcı tam aynı string'i seçmiş olur.)
    const brandMappings = await this.prisma.supplierBrandMapping.findMany({
      where: { supplierId: supplier.id },
      select: { sourceBrandName: true, targetBrandName: true, hidden: true },
    });
    const brandMappingByName = new Map<
      string,
      { targetBrandName: string | null; hidden: boolean }
    >();
    for (const m of brandMappings) {
      brandMappingByName.set(m.sourceBrandName, {
        targetBrandName: m.targetBrandName,
        hidden: m.hidden,
      });
    }

    // Tedarikçi bazlı metin kuralları (SupplierTextRule) — normalize sonrası
    // name/description'a uygulanır (sil/değiştir). rawFeedName/rawFeedDescription'a
    // DOKUNMAZ (alım/Excel ham adı korur).
    const textRules = await this.prisma.supplierTextRule.findMany({
      where: { supplierId: supplier.id },
      select: {
        search: true,
        replacement: true,
        applyToName: true,
        applyToDescription: true,
        caseInsensitive: true,
        wholeWord: true,
        enabled: true,
        sortOrder: true,
      },
    });

    // Pre-load all existing products for this supplier in one query to avoid
    // N+1 findUnique calls inside the loop (60K products × 1 query = 60K → 1).
    const existingProductRows = await this.prisma.product.findMany({
      where: { tenantId, supplierId: supplier.id },
      select: {
        id: true,
        externalCode: true,
        categoryId: true,
        contentHash: true,
        slug: true,
        stock: true,
        publicBarcode: true,
        internalCode: true,
        contentNormalizedAt: true,
        // rawFeedName backfill: null ise skip edilmez (aşağıda), bir kez yazılır.
        rawFeedName: true,
        // Override durumu: manual* set ise feed bu ürünün price/stock'unu ezmez.
        // feedStock skip optimizasyonunda ham feed değeriyle karşılaştırılır.
        manualPrice: true,
        manualStock: true,
        feedStock: true,
        // Kalıcı pasifleme: true ise sync bu ürünü asla tekrar aktife çekmez.
        forceInactive: true,
        // Skip guard: kural ürünü pasiflemeli ama DB hâlâ aktifse skip etmeyiz.
        active: true,
        marketplaceListed: true,
      },
    });
    const existingProductMap = new Map(
      existingProductRows.map((r) => [r.externalCode, r]),
    );

    // Part 2: ANA görsel (pos0) → onu kullanan FARKLI ürün-ADI (nameKey) kümesi.
    // Sayım ürün adedi DEĞİL, distinct nameKey: kötü görsel (placeholder/jenerik/
    // kırık link) birbirinden FARKLI çok sayıda ürüne konur → küme büyür ve
    // >=DUP_MAIN_IMAGE_THRESHOLD olur → pasiflenir (hiç tutulmaz). Aynı ürünün
    // varyant kopyaları AYNI/benzer ada sahiptir → küme küçük kalır → bu kural
    // DOKUNMAZ; onları dedup (isCanonical) "1 tut" ile yönetir. Çapraz-ürün
    // toplaması olduğu için döngü öncesi tek seferde hesaplanır.
    const mainImageNameKeys = new Map<string, Set<string>>();
    for (const cp of parsed) {
      const mainUrl = cp.images[0]?.url;
      if (!mainUrl) continue;
      let keys = mainImageNameKeys.get(mainUrl);
      if (!keys) {
        keys = new Set<string>();
        mainImageNameKeys.set(mainUrl, keys);
      }
      keys.add(computeNameKey(cp.name ?? ''));
    }
    let deactivatedSharedMainImage = 0;

    for (const p of parsed) {
      try {
        seenExternalCodes.add(p.externalCode);

        // Kategori keşfi: feed'de gelen path'in HER seviyesini (root → leaf)
        // ayrı SupplierCategory kaydı olarak işaretle. Skip edilen ürünlerin
        // kategorisi de görünür olsun ki admin pasif/aktif yönetebilsin (#9).
        if (Array.isArray(p.categoryPath) && p.categoryPath.length > 0) {
          for (let i = 0; i < p.categoryPath.length; i++) {
            const segs = p.categoryPath.slice(0, i + 1);
            const key = segs.join(' > ');
            if (!seenCategoryPaths.has(key)) seenCategoryPaths.set(key, segs);
          }
        }

        // Pasif kategori filtresi: bu tedarikçinin SupplierCategory tablosunda
        // isActive=false olarak işaretlediği path'lere veya alt-path'lerine
        // düşen ürünler atlanır. Eksik kontrol örneği:
        //   inactive: ['Aksesuar']  (parent)
        //   feed:     ['Aksesuar', 'Bagaj']  (leaf) → prefix match ile skip.
        const pathKey = Array.isArray(p.categoryPath)
          ? p.categoryPath.join(PATH_SEP)
          : '';
        const isInactiveCategory =
          !!pathKey &&
          (inactivePathKeys.has(pathKey) ||
            inactivePathPrefixes.some((pre) => pathKey.startsWith(pre)));
        if (isInactiveCategory) {
          skippedInactiveCategory++;
          // Bu external code "seenExternalCodes" içine ekledik, dolayısıyla
          // sondaki stale-deactivation pas geçecek. Ama mevcutta aktif bir
          // kayıt varsa onu da deactive edelim (bir sonraki sync'te otomatik
          // gizlensin). RLS yok — explicit tenant/supplier filtre.
          await this.prisma.product.updateMany({
            where: {
              tenantId,
              supplierId: supplier.id,
              externalCode: p.externalCode,
              active: true,
            },
            data: { active: false, marketplaceListed: false, contentHash: '' },
          });
          result.skipped++;
          continue;
        }

        const categoryId = await this.ensureCategory(
          tenantId,
          p.categoryPath,
          categoryCache,
        );
        const normalizedCost = this.normalizeCost(p, {
          feedCurrency: supplierFeedCurrency,
          exchangeRate: effectiveSupplierExchangeRate,
          exchangeRateMargin: supplierExchangeRateMargin,
          priceIncludesVat: supplierPriceIncludesVat,
          vatRate: supplierVatRate,
          discountPct: supplierDiscountPct,
          discountTl: supplierDiscountTl,
          extraCostTl: supplierPurchaseExtraCostTl,
        });

        // minPrice eşiği: feed'den gelen normalize edilmiş cost (TRY, KDVsiz)
        // bu eşiğin altındaysa atla. Mevcutta aktif bir ürün varsa deactive et.
        if (
          supplierMinPrice > 0 &&
          Number.isFinite(normalizedCost) &&
          normalizedCost < supplierMinPrice
        ) {
          skippedBelowMinPrice++;
          const deactivated = await this.prisma.product.updateMany({
            where: {
              tenantId,
              supplierId: supplier.id,
              externalCode: p.externalCode,
              active: true,
              // Admin manuel override yaptıysa (price veya stock) ürünü
              // otomatik deactive etme — manuel karar feed eşiğini ezer.
              manualPrice: null,
              manualStock: null,
            },
            data: { active: false, marketplaceListed: false, contentHash: '' },
          });
          if (deactivated.count > 0) deactivatedBelowMinPrice++;
          result.skipped++;
          continue;
        }
        // Kategori bazlı fiyat override çözümü: ürünün leaf kategori path'i bir
        // override'a denk geliyorsa global markup/extra yerine kategori değerini
        // kullan (setCategoryPricing ile aynı exact-match). pricingSig bu efektif
        // değerleri içerir → override değişince contentHash mismatch → reprice.
        const categoryKey =
          Array.isArray(p.categoryPath) && p.categoryPath.length > 0
            ? p.categoryPath.join(' > ')
            : '';
        const categoryOverride = categoryKey
          ? overrideByPathKey.get(categoryKey) ?? null
          : null;
        // Çözülmüş fiyatlandırma: kategori override (sabit/kademeli) → tedarikçi
        // (fixed/tiered). TEK KAYNAK: tiered-profit.util — ingest ve admin
        // recompute aynı motoru kullanır. Barem TABANI = costPrice (normalizedCost).
        const pricing = resolveEffectivePricing(
          supplierPricingInput,
          categoryOverride,
        );
        // feedPrice: sync'in XML'den hesapladığı ham efektif fiyat. Manual
        // override yoksa price = feedPrice; varsa price = manualPrice (aşağıda).
        const feedPrice = computeSalePrice(normalizedCost, pricing);
        // contentHash brand mapping state'ini + fiyatlandırma imzasını içerir →
        // marj/ek kâr VEYA barem değişince sync otomatik reprice tetikler.
        const brandMappingForHash = brandMappingByName.get(p.brand ?? '') ?? null;
        const contentHash = this.computeHash(
          p,
          normalizedCost,
          brandMappingForHash,
          pricingSignature(pricing),
        );

        // Map lookup replaces per-product findUnique (N+1 → O(1)).
        const existing = existingProductMap.get(p.externalCode) ?? null;

        // Only generate a new slug for products that don't exist yet; for
        // existing products we keep the slug already stored in DB.
        const slug = existing?.slug ?? await this.ensureUniqueSlug(
          tenantId,
          p.externalCode,
          p.name,
          slugCache,
        );

        // Stock threshold rule: ham stok değeri eşiğin altındaysa hem DB stoğu
        // hem XML/marketplace çıktısı için 0 yaz, marketplaceListed=false yap.
        // Eşik 0 ise hiçbir şey değişmez (default davranış).
        const belowThreshold = stockThreshold > 0 && p.stock < stockThreshold;
        const feedStock = belowThreshold ? 0 : p.stock;

        // EFEKTİF değerler: admin manuel override yaptıysa onu kullan, yoksa
        // feed değeri. price/stock kolonları daima efektif değer tutar — hiçbir
        // okuyucu (marketplace feed, mağaza, sipariş) değişmez.
        const effPrice =
          existing?.manualPrice != null ? Number(existing.manualPrice) : feedPrice;
        const effectiveStock =
          existing?.manualStock != null ? existing.manualStock : feedStock;
        // marketplaceListed efektif stoğa göre: manual override 0 ise listeden çık.
        const marketplaceListed =
          existing?.manualStock != null ? existing.manualStock > 0 : !belowThreshold;

        // ── active / marketplaceListed kararı — skip kontrolünden ÖNCE ─────────
        // Bu değerler ürünün KENDİ içeriğine değil; marka mapping'i (hidden),
        // kalıcı forceInactive ve (Part 2) ANA-görsel paylaşımına da bağlı.
        // Paylaşım batch'teki BAŞKA ürünlere bağlı olduğundan contentHash'te yok;
        // bu yüzden aşağıdaki skip guard, "pasiflenmesi gerekirken hâlâ aktif"
        // ürünleri içeriği değişmese de işler (pasifler).
        const brandLookupKey = p.brand ?? '';
        const mapping = brandLookupKey
          ? brandMappingByName.get(brandLookupKey)
          : undefined;
        // KURAL: Mağazada gösterilen marka DAİMA "Toptan Budur". Brand mapping
        // artık yalnızca "gizle" (hidden) için kullanılır.
        const hiddenByBrand = mapping?.hidden === true;
        // Kalıcı pasifleme: forceInactive=true ise feed sync ürünü ASLA tekrar
        // aktife çekmez (tedarikçi içerik-tekrarı / placeholder / elle kalıcı gizle).
        // Admin geri açmak isterse forceInactive'i false yapar.
        const forcedInactive = existing?.forceInactive ?? false;
        // Part 2: ana görseli (pos0) bu feed'de ≥eşik FARKLI ADLI üründe
        // paylaşılıyorsa görsel jenerik/placeholder/kırık demektir → pasifle
        // (active/marketplaceListed false, HİÇ tutma). Aynı ürünün varyantları
        // az isimlidir → tetiklenmez; onları dedup "1 tut" yönetir. Kendini
        // iyileştirir: tedarikçi özgün görsel verince görsel URL'i değişip
        // contentHash bozulur → ürün o sync'te yeniden işlenip aktifleşir.
        const mainImageUrl = p.images[0]?.url;
        const sharedMainImage =
          mainImageUrl != null &&
          (mainImageNameKeys.get(mainImageUrl)?.size ?? 0) >=
            DUP_MAIN_IMAGE_THRESHOLD;
        if (sharedMainImage) deactivatedSharedMainImage++;

        const finalActive =
          !hiddenByBrand && !forcedInactive && !sharedMainImage;
        const finalMarketplaceListed =
          marketplaceListed &&
          !hiddenByBrand &&
          !forcedInactive &&
          !sharedMainImage;

        // Skip only when hash matches AND DB effective stock equals the new
        // effective stock AND the raw feed stock is unchanged. The feedStock
        // check matters under manual override: when manualStock masks a feed
        // change, effectiveStock stays equal but we must still persist the
        // fresh feedStock so clearing the override later returns the true value.
        if (
          existing &&
          existing.contentHash &&
          existing.contentHash === contentHash &&
          // Kategori (categoryId) degistiyse skip ETME — contentHash kategoriyi
          // icermez, bu yuzden parser kategori mantigi degisince (or. isim
          // siniflandirici) urunu yeniden kategorilendirmek icin acik sart.
          existing.categoryId === categoryId &&
          existing.stock === effectiveStock &&
          existing.feedStock === feedStock &&
          // Kural ürünü PASİFLEMELİyse (Part 2 ana-görsel paylaşımı / forceInactive)
          // ama DB'de hâlâ aktifse skip ETME — pasifle. Bu sinyaller contentHash'te
          // yok (batch'teki başka ürünlere / out-of-band flag'e bağlı). TERS yön
          // YOK: feed, admin'in elle active=false yaptığı ürünü geri AÇMAZ;
          // reaktivasyon ürünün kendi içeriği/görseli değişince (hash) gerçekleşir.
          !(existing.active && !finalActive) &&
          !(existing.marketplaceListed && !finalMarketplaceListed) &&
          // rawFeedName henüz yazılmamışsa (backfill öncesi) skip etme — orijinal
          // adı bir kez yaz. (rawFeedName hash'e dahil değil; dolunca tekrar skip.)
          existing.rawFeedName != null
        ) {
          result.skipped++;
          continue;
        }

        // Feed'lerde gelen HTML entity'lerini DB'ye yazmadan decode et
        // (örn. `&Ouml;ld&uuml;r&uuml;c&uuml;` → `Öldürücü`). Yeni kayıtlar
        // temiz olur; eski bozuk kayıtlar bir sonraki sync'te tazelenir.
        // Para birimi dönüşümü uygulandıysa store currency = TRY. Aksi
        // durumda XML'den gelen veya supplier override değerini sakla.
        // ÜRÜN-BAZI para birimi öncelikli (normalizeCost ile birebir aynı mantık):
        // her ürün kendi <ParaBirimi>'ne göre değerlendirilir, XML'de yoksa feed
        // seviyesine düşer. Böylece USD ürün çevrilir (storedCurrency=TRY), TL ürün
        // çevrilmez (storedCurrency=TRY zaten ama dönüşüm yok).
        const effectiveProductCurrency = (
          p.currency ||
          supplierFeedCurrency ||
          'TRY'
        ).toUpperCase();
        const conversionApplied =
          effectiveProductCurrency !== 'TRY' &&
          effectiveSupplierExchangeRate !== null &&
          effectiveSupplierExchangeRate > 0;
        const storedCurrency = conversionApplied
          ? 'TRY'
          : effectiveProductCurrency;

        // sourceBrand için ham marka adı. (Marka mapping + hiddenByBrand,
        // forceInactive ve sharedMainImage — yani active/marketplaceListed
        // kararı — skip kontrolünden ÖNCE yukarıda hesaplandı.)
        const decodedBrandRaw = decodeHtmlEntities(p.brand ?? null);

        // Public barkod: ilk CREATE'te üret + DB'de unique kontrolü ile
        // çakışma olursa retry. UPDATE'te asla dokunma — bir kez üretildikten
        // sonra ürünün ömrü boyunca sabit (müşteriler kayıtlı barkod tutar).
        let publicBarcode: string | null = existing?.publicBarcode ?? null;
        if (!publicBarcode) {
          publicBarcode = await this.generateUniquePublicBarcode();
        }

        let internalCode: string | null = existing?.internalCode ?? null;
        if (!internalCode) {
          internalCode = await generateUniqueInternalCode(this.prisma);
        }

        // sourceBrand: XML'den gelen ham marka adı (mapping uygulanmadan).
        // Bu alan listBrands distinct kaynağı olarak kullanılır; target marka
        // hiçbir zaman source listesine sızmaz. brand alanı ise mağazada
        // gösterilen "effective" marka olarak appliedBrand'i tutar.
        const sourceBrandValue = decodedBrandRaw;

        // Yeni ürünler (existing === null) normalize edilip flag set edilir.
        // Mevcut normalize edilmiş ürünler (existing.contentNormalizedAt != null)
        // dokunulmaz — name/description/barcode/model sonsuza kadar dondurulur.
        const rawName = decodeHtmlEntities(p.name);
        const rawDesc = decodeHtmlEntities(p.description ?? null);

        // Normalize → SONRA tedarikçi metin kuralları (sil/değiştir).
        // Boş isim koruması: kural ismi tamamen boşaltırsa normalize halini koru
        // (boş 'name' DB constraint'ini patlatır). Açıklama boşa düşebilir (serbest).
        const normName = normalizeProductName(rawName);
        const finalName = applyTextRules(normName, textRules, 'name') || normName;
        const normDesc = normalizeProductDescription(rawDesc);
        const finalDesc = normDesc
          ? applyTextRules(normDesc, textRules, 'description')
          : normDesc;

        const data: Prisma.ProductUncheckedCreateInput = {
          tenantId,
          supplierId: supplier.id,
          feedId: feed.id,
          categoryId: categoryId ?? null,
          externalCode: p.externalCode,
          slug,
          name: finalName,
          nameKey: computeNameKey(finalName),
          // Orijinal feed adı (normalize/temizleme + metin kuralları ÖNCESİ,
          // "Marka" dahil) — alım/Excel akışında tedarikçiye orijinal adı iletmek
          // için. Müşteri-yüzlü 'name' temizli kalır; bu alan additive, eşleştirmeyi
          // etkilemez. Metin kuralları rawFeedName'e DOKUNMAZ.
          rawFeedName: rawName,
          // Ham açıklama — metin kuralları değişince 'description' bundan
          // deterministik yeniden türetilir (recompute). Kurallardan etkilenmez.
          rawFeedDescription: rawDesc,
          brand: 'Toptan Budur',
          sourceBrand: sourceBrandValue,
          model: decodeHtmlEntities(p.model ?? null),
          // Açıklama boşsa ürün adını açıklama olarak yaz — boş açıklamalı ürün
          // pazaryerinde (Trendyol) listelenmiyor. finalName her zaman dolu
          // (MISSING_NAME drop edilir) → description asla boş kalmaz.
          description: finalDesc || finalName,
          barcode: p.barcode ?? null,
          publicBarcode,
          internalCode,
          costPrice: new Prisma.Decimal(normalizedCost.toFixed(2)),
          // price/stock = EFEKTİF değer (manualX ?? feedX). feedPrice/feedStock
          // ham feed değerini saklar (override temizlenince geri dönüş için).
          // manual* kolonlarına ingest asla yazmaz — onlar admin'in mülkü.
          feedPrice: new Prisma.Decimal(feedPrice.toFixed(2)),
          feedStock,
          price: new Prisma.Decimal(effPrice.toFixed(2)),
          currency: storedCurrency,
          taxRate:
            p.taxRate !== undefined
              ? new Prisma.Decimal(p.taxRate.toFixed(2))
              : null,
          stock: effectiveStock,
          active: finalActive,
          marketplaceListed: finalMarketplaceListed,
          contentHash,
          lastSyncedAt: new Date(),
          contentNormalizedAt: new Date(),
        };

        const product = await this.prisma.product.upsert({
          where: {
            tenantId_supplierId_externalCode: {
              tenantId,
              supplierId: supplier.id,
              externalCode: p.externalCode,
            },
          },
          update: {
            // model, description güncellenmez (pazaryeri compliance).
            // contentNormalizedAt set edilmiş ürünlerde barcode da dondurulur.
            name: data.name,
            // nameKey, name ile her zaman senkron — auto-route eşleştirme anahtarı.
            nameKey: data.nameKey,
            // Orijinal feed adı — mevcut 25.727 ürün bir sonraki sync'te dolar.
            rawFeedName: data.rawFeedName,
            // Ham açıklama — backfill; recompute'un ham kaynağı. description'ın
            // kendisi donmuş ürünlerde güncellenmez (yalnız recompute değiştirir).
            rawFeedDescription: data.rawFeedDescription,
            categoryId: data.categoryId,
            brand: data.brand,
            sourceBrand: data.sourceBrand,
            // barcode: contentNormalizedAt set ise dondurulur; henüz normalize
            // edilmemiş eski ürünlerde bootstrap service zaten çalıştırır.
            ...(existing?.contentNormalizedAt ? {} : { barcode: data.barcode }),
            // publicBarcode / internalCode: mevcut değer korunur (idempotent).
            publicBarcode: data.publicBarcode,
            internalCode: data.internalCode,
            feedId: data.feedId,
            costPrice: data.costPrice,
            // price/stock efektif değer; feedPrice/feedStock ham feed. manual*
            // kolonlarına dokunulmaz — override admin tarafından yönetilir.
            feedPrice: data.feedPrice,
            feedStock: data.feedStock,
            price: data.price,
            currency: data.currency,
            taxRate: data.taxRate,
            stock: data.stock,
            active: data.active,
            marketplaceListed: data.marketplaceListed,
            contentHash: data.contentHash,
            lastSyncedAt: data.lastSyncedAt,
          },
          create: data,
          select: { id: true },
        });

        // Görselleri YALNIZCA içerik gerçekten değiştiğinde yeniden yaz.
        // computeHash görsel URL'lerini (dizideki SIRAYLA) içerir → contentHash
        // değişmediyse (yalnız stok/fiyat/flag değişimi) görseller de aynıdır,
        // dolayısıyla deleteMany+createMany gereksizdir. Bu, "stok/fiyat sık
        // değişir, görsel nadiren" durumunu per-ürün OTOMATİK hafif-yola çevirir
        // (audit #3: her senkronda tüm ProductImage'ları koşulsuz yeniden yazma
        // — 357K satırlık tabloda gereksiz churn). İçerik değişen VEYA yeni
        // ürünlerde (existing yok / hash farklı) görseller eskisi gibi yazılır;
        // görsel URL'i değişirse hash bozulur → burada yeniden yazılır (self-heal).
        const imagesUnchanged =
          !!existing &&
          !!existing.contentHash &&
          existing.contentHash === contentHash;
        if (!imagesUnchanged) {
          await this.prisma.productImage.deleteMany({
            where: { productId: product.id },
          });
          if (p.images.length) {
            await this.prisma.productImage.createMany({
              data: p.images.map((img) => ({
                productId: product.id,
                url: img.url,
                position: img.position,
              })),
            });
          }
        }

        if (existing) result.updated++;
        else result.created++;
      } catch (err) {
        result.errors++;
        this.logger.warn(
          `product ${p.externalCode} failed: ${(err as Error).message}`,
        );
      }
    }

    // ── SupplierCategory senkronu (#9) ─────────────────────────────────────
    // Feed'de keşfedilen kategori path'lerini SupplierCategory tablosuna upsert
    // et. code = path.join(' > ') (deterministik, supplier başına unique —
    // setCategoryActive bu code ile eşler). isActive'e DOKUNMA: admin elle
    // pasifleştirdiyse korunur (update: {}). Global Category ağacı ayrı
    // (ensureCategory) — bu tablo sadece admin kategori yönetimi içindir.
    // Hata yutulur, sync sonucunu etkilemez.
    if (seenCategoryPaths.size > 0) {
      let catUpserts = 0;
      for (const [key, segs] of seenCategoryPaths) {
        const parentCode =
          segs.length > 1 ? segs.slice(0, segs.length - 1).join(' > ') : null;
        const name = segs[segs.length - 1];
        try {
          await this.prisma.supplierCategory.upsert({
            where: {
              supplierId_code: { supplierId: supplier.id, code: key },
            },
            // Mevcut kayıtta name/parentCode/path tazelenebilir ama isActive'e
            // ASLA dokunulmaz (admin'in pasifleştirmesi korunur).
            update: { name, parentCode, path: segs },
            create: {
              supplierId: supplier.id,
              code: key,
              name,
              parentCode,
              path: segs,
            },
          });
          catUpserts++;
        } catch (e) {
          this.logger.warn(
            `supplierCategory upsert failed supplier=${supplier.id} code="${key}": ${(e as Error).message}`,
          );
        }
      }
      try {
        await this.prisma.supplier.update({
          where: { id: supplier.id },
          data: { categoriesSyncedAt: new Date() },
        });
      } catch (e) {
        this.logger.warn(
          `supplier.categoriesSyncedAt update failed supplier=${supplier.id}: ${(e as Error).message}`,
        );
      }
      this.logger.log(
        `supplierCategory.sync { supplier: '${supplier.name}', paths: ${seenCategoryPaths.size}, upserted: ${catUpserts} }`,
      );
    }

    // Feed'de artık görünmeyen ürünlerin STOĞUNU 0'a çek (active=false DEĞİL):
    // ürün mağaza vitrininde + bayi XML'inde "tükendi" görünür, marketplaceListed
    // =false ile pazaryerinden düşer. Tedarikçide olmayan ürün satılamaz ama
    // kayıt silinmez (geçmiş korunur). Stoğa dönerse upsert stoğu geri yazar.
    //
    // KRİTİK (#ghost-stock): bu adım ARTIK `active` durumuna BAKMAZ — feed-dışı
    // kalan HER stoklu ürün (active=true VEYA active=false) sıfırlanır. Eskiden
    // yalnız `active:true` hedefleniyordu; bu yüzden başka bir nedenle pasiflenmiş
    // (ör. sharedMainImage / marka-gizle) ama hâlâ stoklu+marketplaceListed bir
    // ürün tedarikçi feed'inden düşse bile stoğu 0'a inmiyor, kirli kalıyordu:
    // active tekrar true'ya dönerse (görsel tekleşir / admin açar) ANINDA hayalet
    // stokla satışa açılıyordu. Toptan Budur pasif ürünleri feed'den komple
    // çıkardığı için bu kapı doğrudan "stoğu olmayan ürünün satışı"na yol açtı.
    //
    // NOT: Bu adım `feedId` bazlıdır; bir feed silinince yetim kalan ürünleri
    // (feedId=NULL) yakalayamaz — onlar StockReconcileService (cron) tarafından
    // tedarikçinin tüm feed'leri ile karşılaştırılarak 0'a çekilir.
    //
    // #H-Wipe — Eski sürümde `seenExternalCodes.size > 0` tek koruma idi.
    // Tedarikçi feed'i kısmen bozulup sadece N tane ürün döndürürse (ör. 60K
    // → 5 ürün) geri kalan tüm katalog `active=false` yapılıyordu. xml-parser
    // artık parse hatasında throw ediyor ama "kısmen bozuk feed" senaryosu
    // hâlâ tehlikeli — bu yüzden deactivate edilecek oran toplam aktif
    // katalogun STALE_DEACTIVATION_MAX_RATIO (default 0.5) üzerine çıkarsa
    // adım iptal edilir, supplier `lastSyncError` alanına işaret bırakılır,
    // operasyon ekibi manuel inceler.
    const STALE_DEACTIVATION_MAX_RATIO = Number(
      process.env.STALE_DEACTIVATION_MAX_RATIO ?? '0.5',
    );
    const STALE_DEACTIVATION_MIN_FEED_ITEMS = Number(
      process.env.STALE_DEACTIVATION_MIN_FEED_ITEMS ?? '50',
    );
    // #lockout-fix — Feed truncation eşiği: bu senkrondaki ürün sayısı feed'in
    // son SAĞLIKLI sayısının (lastFeedItemCount baseline) bu oranından aşağı
    // düşerse feed bozuk/truncate kabul edilir. Baseline-tabanlı guard, biriken
    // yetim yığınının DB oranına DEĞİL feed'in kendi geçmişine baktığı için
    // meşru büyük churn (Product_code şema migrasyonu gibi) kalıcı kilit yaratmaz.
    const STALE_DEACTIVATION_FEED_DROP_FACTOR = Number(
      process.env.STALE_DEACTIVATION_FEED_DROP_FACTOR ?? '0.5',
    );
    const feedItemCount = seenExternalCodes.size;
    let deactivated = 0;
    let stalenessAborted = false;
    if (feedItemCount > 0) {
      // Payda: feed'e bağlı TÜM stoklu ürünler (active durumundan bağımsız).
      const stockedCount = await this.prisma.product.count({
        where: {
          tenantId,
          supplierId: supplier.id,
          feedId: feed.id,
          stock: { gt: 0 },
        },
      });
      const wouldDeactivateCount = await this.prisma.product.count({
        where: {
          tenantId,
          supplierId: supplier.id,
          feedId: feed.id,
          stock: { gt: 0 },
          // Manuel stok override'lı ürünler stale de-list'ten muaf — feed'de
          // görünmese bile admin stoğu sabitlemiş, sıfırlanmaz.
          manualStock: null,
          externalCode: { notIn: Array.from(seenExternalCodes) },
        },
      });
      const ratio = stockedCount > 0 ? wouldDeactivateCount / stockedCount : 0;

      // KİLİT ÖNLEME: guard artık feed'in KENDİ önceki sağlıklı ürün sayısına
      // bakar. Tedarikçi kataloğun yarısını yeniden anahtarlasa bile (yeni
      // Product_code'lar) feed sayısı ~aynı kalır → feedTruncated=false → eski
      // yetimler temizlenir, kilit oluşmaz. Yalnız feed GERÇEKTEN küçülürse
      // (ör. 12K → 3K, HTTP/parça hatası) tetiklenir. Baseline yoksa (ilk
      // senkron) eski oran/absolute-floor koruması devreye girer.
      const baseline = feed.lastFeedItemCount ?? null;
      const feedTruncated =
        baseline != null &&
        baseline >= STALE_DEACTIVATION_MIN_FEED_ITEMS &&
        feedItemCount < baseline * STALE_DEACTIVATION_FEED_DROP_FACTOR;
      const feedTooSmallNoBaseline =
        baseline == null &&
        feedItemCount < STALE_DEACTIVATION_MIN_FEED_ITEMS &&
        stockedCount >= STALE_DEACTIVATION_MIN_FEED_ITEMS;
      const extremeRatioNoBaseline =
        baseline == null && ratio > STALE_DEACTIVATION_MAX_RATIO;

      if (feedTruncated || feedTooSmallNoBaseline || extremeRatioNoBaseline) {
        stalenessAborted = true;
        const reason = feedTruncated
          ? `feed truncated: ${feedItemCount} items vs baseline ${baseline} (min ${(STALE_DEACTIVATION_FEED_DROP_FACTOR * 100).toFixed(0)}% of baseline)`
          : feedTooSmallNoBaseline
            ? `feed too small: ${feedItemCount} items, no baseline (stocked ${stockedCount})`
            : `would deactivate ${(ratio * 100).toFixed(1)}% with no baseline (max ${(STALE_DEACTIVATION_MAX_RATIO * 100).toFixed(0)}%)`;
        this.logger.error(
          `xml.sync.staleness_guard_triggered { supplier: '${supplier.name}', reason: '${reason}', feedItems: ${feedItemCount}, baseline: ${baseline ?? 'none'}, wouldDeactivate: ${wouldDeactivateCount}, stocked: ${stockedCount} } — manual review required`,
        );
        await this.prisma.supplierFeed.update({
          where: { id: feed.id },
          data: {
            lastSyncError: `staleness guard tripped: ${reason}`,
          },
        });
      } else {
        const stale = await this.prisma.product.updateMany({
          where: {
            tenantId,
            supplierId: supplier.id,
            feedId: feed.id,
            // active YOK: feed-dışı kalan pasif-ama-stoklu ürünler de sıfırlanır
            // (#ghost-stock) — yoksa tekrar aktifleşince hayalet stokla satılır.
            stock: { gt: 0 },
            // Manuel stok override'lı ürünleri sıfırlama (yukarıdaki sayımla
            // tutarlı) — admin'in sabitlediği stok korunur.
            manualStock: null,
            externalCode: { notIn: Array.from(seenExternalCodes) },
          },
          data: { stock: 0, marketplaceListed: false },
        });
        deactivated = stale.count;
      }
    }

    // Staleness guard tetiklendiyse `lastSyncError` az önce set edildi, burada
    // null'la üzerine yazılmasın — ekip uyarıyı görmeli. lastFeedItemCount
    // baseline'ı YALNIZ sağlıklı (abort olmayan, feedItemCount>0) senkronda
    // güncellenir; bozuk/boş feed baseline'ı zehirlemesin.
    await this.prisma.supplierFeed.update({
      where: { id: feed.id },
      data: stalenessAborted
        ? { lastSyncedAt: new Date() }
        : {
            lastSyncedAt: new Date(),
            lastSyncError: null,
            ...(feedItemCount > 0
              ? { lastFeedItemCount: feedItemCount }
              : {}),
          },
    });

    this.logger.log(
      `xml.sync.completed { supplier: '${supplier.name}', updated: ${result.updated}, created: ${result.created}, deactivated: ${deactivated}, stalenessAborted: ${stalenessAborted}, errors: ${result.errors}, skippedBelowMinPrice: ${skippedBelowMinPrice}, deactivatedBelowMinPrice: ${deactivatedBelowMinPrice}, skippedInactiveCategory: ${skippedInactiveCategory}, deactivatedSharedMainImage: ${deactivatedSharedMainImage} }`,
    );

    // Append-only slot atama: yeni ürünler (xmlPartIndex IS NULL) varsa,
    // her XML parçasının sonuna eklenir. Mevcut slotlu ürünlere dokunulmaz.
    // Hata yutulur — sync sonucunu etkilemesin.
    if (result.created > 0) {
      try {
        await this.xmlSlot.recomputeSlots(tenantId);
      } catch (e) {
        this.logger.warn(
          `xml slot append after sync failed (tenant=${tenantId}): ${(e as Error).message}`,
        );
      }
      // V2 (marketplace) slot append — yeni ürünleri kurallara göre part
      // 1-4 (Trendyol) / 5 (kalan) gruplarına ekler. Legacy slotlardan
      // bağımsız. Hata yutulur — sync sonucunu etkilemesin.
      try {
        await this.xmlSlot.recomputeSlotsV2(tenantId);
      } catch (e) {
        this.logger.warn(
          `xml V2 slot append after sync failed (tenant=${tenantId}): ${(e as Error).message}`,
        );
      }
    }

    // Vitrin/Satın-Alma: senkronlanan tedarikçi kapsamdaysa çapraz-tedarikçi
    // eşleştirmeyi yeniden hesapla. Dedup'tan ÖNCE
    // çalışmalı ki canonical kararı taze match-group'lara göre verilsin.
    // Hata yutulur — sync sonucunu etkilemesin.
    if (result.created > 0 || result.updated > 0 || deactivated > 0) {
      try {
        const scope = await this.productMatch.getScopeSupplierIds(tenantId);
        if (scope.includes(supplier.id)) {
          await this.productMatch.recompute(tenantId);
        }
      } catch (e) {
        this.logger.warn(
          `product match recompute after sync failed (tenant=${tenantId}): ${(e as Error).message}`,
        );
      }
    }

    // Dedup yeniden hesabı: created/updated/deactivated herhangi biri varsa
    // stok veya fiyat değişmiş olabilir → aynı isimdeki ürünlerin kazananı
    // değişebilir. Yeni tedarikçi ürünleri de burada mevcut katalogla
    // kıyaslanır. Hata yutulur — sync sonucunu etkilemesin.
    if (result.created > 0 || result.updated > 0 || deactivated > 0) {
      try {
        await this.productDedup.recomputeCanonical(tenantId);
      } catch (e) {
        this.logger.warn(
          `product dedup recompute after sync failed (tenant=${tenantId}): ${(e as Error).message}`,
        );
      }
    }

    return result;
  }

  /**
   * TEK KAYNAK alış maliyeti normalize. Tüm sistem (satış fiyatı, tedarikçi
   * cüzdanı, kâr/maliyet analizi) bu costPrice'a dayanır. Sırası:
   *  1) Para birimi: feedCurrency !== 'TRY' ve exchangeRate set ise
   *     cost = cost * (exchangeRate + exchangeRateMargin).
   *  2) Alış indirimi — XML fiyatına uygulanır: önce yüzde (discountPct),
   *     sonra TL (discountTl). Tek indirim; KDV dahil/hariç ayrımı yok.
   *     (ör. toptanbudur: XML 100 → %25 → 75)
   *  3) KDV düşürme: priceIncludesVat ise cost / (1 + vatRate/100), tedarikçinin
   *     TEK KDV oranıyla (10/20). (75 → 62,50)
   *  4) Yuvarlama: kuruş.
   *  Sonuç = costPrice = indirimli GERÇEK NET ALIŞ. Kâr marjı bunun üzerine biner.
   */
  private normalizeCost(
    p: ParsedProduct,
    cfg: {
      feedCurrency: string;
      exchangeRate: number | null;
      exchangeRateMargin: number;
      priceIncludesVat: boolean;
      vatRate: number;
      discountPct?: number;
      discountTl?: number;
      extraCostTl?: number;
    },
  ): number {
    let cost = p.costPrice;
    // 1) Currency conversion — XML'deki ÜRÜN-BAZI para birimi ÖNCELİKLİ; XML'de
    //    yoksa feed-seviyesi (feedCurrency) fallback. Böylece aynı feed'de TL+USD
    //    karışık olabilir: TL ürün çevrilmez, USD ürün kurla çarpılır.
    const effectiveFeedCurrency = (p.currency || cfg.feedCurrency || 'TRY')
      .toUpperCase();
    if (
      effectiveFeedCurrency !== 'TRY' &&
      cfg.exchangeRate !== null &&
      cfg.exchangeRate > 0
    ) {
      const effectiveRate = cfg.exchangeRate + (cfg.exchangeRateMargin || 0);
      cost = cost * effectiveRate;
    }

    // 2) Alış indirimi — XML (ham) fiyatına: önce yüzde, sonra TL. Tek indirim.
    const discPct = Number(cfg.discountPct ?? 0);
    if (discPct > 0 && discPct < 100) {
      cost = cost * (1 - discPct / 100);
    }
    const discTl = Number(cfg.discountTl ?? 0);
    if (discTl > 0) {
      cost = Math.max(0, cost - discTl);
    }

    // 3) KDV düşürme (priceIncludesVat ise) — tedarikçinin TEK KDV oranıyla.
    if (cfg.priceIncludesVat) {
      const rate =
        Number.isFinite(cfg.vatRate) && cfg.vatRate > 0 ? cfg.vatRate : 20;
      cost = cost / (1 + rate / 100);
    }

    // 3.5) Alış ek maliyeti (TL) — birim başına net maliyete eklenir (kargo/
    //      komisyon/hizmet). Satış/cüzdan/kâr hepsi bu maliyete dayanır.
    const extra = Number(cfg.extraCostTl ?? 0);
    if (extra > 0) {
      cost += extra;
    }

    // 4) Kuruş yuvarlama.
    return Math.round(cost * 100) / 100;
  }

  private computeHash(
    p: ParsedProduct,
    normalizedCost?: number,
    brandMapping?: { targetBrandName: string | null; hidden: boolean } | null,
    pricingSig?: string,
  ): string {
    const imgs = p.images.map((i) => i.url).join('|');
    // Hash, normalize edilmiş cost üzerinden hesaplanır — supplier pricing
    // config değişince hash de değişir, sync güncellemeyi tetikler.
    const costForHash =
      normalizedCost !== undefined ? normalizedCost : p.costPrice;
    // Brand mapping state hash'e dahil → kullanıcı eşleştirmeyi
    // değiştirdiğinde sync ürünü otomatik günceller.
    const brandSig = brandMapping
      ? `${brandMapping.targetBrandName ?? ''}|${brandMapping.hidden ? 'H' : '_'}`
      : '_';
    const payload = [
      p.name,
      costForHash.toFixed(2),
      p.stock,
      p.description ?? '',
      imgs,
      p.brand ?? '',
      brandSig,
      // Fiyatlandırma imzası (marj + ek kâr): marj/ek kâr değişince hash de değişir
      // → feed sync ürünü re-price eder (eskiden sadece cost hash'teydi, marj
      // değişimi sync'te görünmezdi).
      pricingSig ?? '',
    ].join('::');
    return createHash('sha256').update(payload).digest('hex');
  }

  /**
   * TBDR public barkod üret + DB'de unique kontrolü ile çakışma olursa
   * yeniden üret. 32 karakter alanında çakışma astronomik düşük; 5 deneme
   * yeterli. Hepsi başarısız olursa exception throw — ingest hata sayar.
   */
  private async generateUniquePublicBarcode(): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = generatePublicBarcode();
      const exists = await this.prisma.product.findUnique({
        where: { publicBarcode: candidate },
        select: { id: true },
      });
      if (!exists) return candidate;
      this.logger.warn(
        `publicBarcode collision attempt=${attempt} candidate=${candidate}`,
      );
    }
    throw new Error('publicBarcode generation exceeded retry budget');
  }

  private async ensureUniqueSlug(
    tenantId: string,
    externalCode: string,
    name: string,
    cache: Set<string>,
  ): Promise<string> {
    const base =
      slugify(`${name}-${externalCode}`, SLUG_OPTS).slice(0, 180) ||
      externalCode.toLowerCase();
    if (!cache.has(base)) {
      const exists = await this.prisma.product.findFirst({
        where: { tenantId, slug: base },
        select: { id: true },
      });
      if (!exists) {
        cache.add(base);
        return base;
      }
    }
    const suffix = randomBytes(3).toString('hex');
    const slug = `${base}-${suffix}`;
    cache.add(slug);
    return slug;
  }

  private async ensureCategory(
    tenantId: string,
    segments: string[],
    cache: Map<string, string>,
  ): Promise<string | null> {
    if (!segments.length) return null;
    let parentId: string | null = null;
    let path = '';
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      path = i === 0 ? seg : `${path} > ${seg}`;
      const cacheKey = `${tenantId}::${path}`;
      const cached = cache.get(cacheKey);
      if (cached) {
        parentId = cached;
        continue;
      }
      const slug = slugify(seg, SLUG_OPTS) || `cat-${i}`;
      const cat: { id: string } = await this.prisma.category.upsert({
        where: { tenantId_path: { tenantId, path } },
        update: {},
        create: {
          tenantId,
          parentId,
          name: seg,
          slug,
          path,
          depth: i,
        },
        select: { id: true },
      });
      cache.set(cacheKey, cat.id);
      parentId = cat.id;
    }
    return parentId;
  }
}

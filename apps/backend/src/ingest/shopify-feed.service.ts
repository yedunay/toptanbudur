import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import {
  ParsedImage,
  ParsedProduct,
  ParseResult,
  DropStats,
} from './xml-parser.service';

/**
 * ShopifyFeedService — XML vermeyen ama Shopify üzerinde çalışan tedarikçilerin
 * herkese açık `/products.json` ucundan ürün/fiyat/stok çeker ve XML pipeline'ı
 * ile BİREBİR aynı `ParseResult` üretir. Böylece IngestService.runSync sonrası
 * tüm akış (TBDR barkod üretimi, marj, dedup, kategori senkronu, stale-
 * deaktivasyon, marketplace listeleme) hiçbir özel kod olmadan aynı çalışır.
 *
 * Tetikleme: feedUrl `/products.json` ile bitiyorsa bu servis devreye girer
 * (Shopify'a özgü, ambiguous olmayan konvansiyon). Login/scraping GEREKMEZ —
 * bu uç anonim, sayfalı (limit=250&page=N) ve son derece kararlıdır.
 *
 * Stok kuralı (tedarikçi kararı): Shopify yalnızca `available` (var/yok) verir;
 * kesin adet herkese açık değildir. var → IN_STOCK_QTY (10), yok → 0.
 */
@Injectable()
export class ShopifyFeedService {
  private readonly logger = new Logger(ShopifyFeedService.name);

  /** Stokta olan ürünlere yazılacak sabit adet (tedarikçi: "var → 10"). */
  private static readonly IN_STOCK_QTY = 10;
  private static readonly PAGE_LIMIT = 250;
  /** Sonsuz döngü emniyeti — 200 × 250 = 50K ürüne kadar. */
  private static readonly MAX_PAGES = 200;
  private static readonly PAGE_TIMEOUT_MS = 45_000;

  /**
   * feedUrl bir Shopify products.json ucu mu? Hem mağaza geneli
   * (`/products.json`) hem koleksiyon-scoped (`/collections/x/products.json`)
   * URL'leri bunun üzerinden geçer.
   */
  isShopifyFeedUrl(feedUrl: string): boolean {
    try {
      const u = new URL(feedUrl);
      return /\/products\.json$/i.test(u.pathname);
    } catch {
      return false;
    }
  }

  /**
   * products.json'ı sayfa sayfa çekip ParseResult döndürür. Her Shopify
   * varyantı ayrı bir ParsedProduct olur (platformun SKU-başı ürün modeline
   * uyar); externalCode = stabil & benzersiz Shopify varyant id'si.
   */
  async fetchAndParse(feedUrl: string): Promise<ParseResult> {
    const rawProducts = await this.fetchAllProducts(feedUrl);

    const items: ParsedProduct[] = [];
    const dropped: DropStats = {
      missingSku: 0,
      missingName: 0,
      missingPrice: 0,
      invalidPriceFormat: 0,
      duplicateSkuInFeed: 0,
      malformed: 0,
    };
    let totalCandidates = 0;
    // variantId → items[] indeksi. Aynı varyant tekrar gelirse "ilk-kazanır"
    // yerine stoğu yüksek (available) olanı tutarız — XML parser'la aynı kural.
    const indexByCode = new Map<string, number>();

    for (const product of rawProducts) {
      try {
        if (!product || typeof product !== 'object') {
          dropped.malformed++;
          continue;
        }

        const title =
          typeof product.title === 'string' ? product.title.trim() : '';
        const productType =
          typeof product.product_type === 'string'
            ? product.product_type.trim()
            : '';
        const categoryPath = productType ? [productType] : [];
        const description =
          typeof product.body_html === 'string' && product.body_html.trim()
            ? product.body_html
            : undefined;
        const images = this.mapImages(product.images);

        const variants = Array.isArray(product.variants)
          ? product.variants
          : [];
        if (variants.length === 0) {
          dropped.malformed++;
          continue;
        }

        for (const variant of variants) {
          totalCandidates++;

          // externalCode: Shopify varyant id'si — sync'ler arası stabil, benzersiz.
          const variantId =
            variant?.id !== undefined && variant?.id !== null
              ? String(variant.id)
              : '';
          if (!variantId) {
            dropped.missingSku++;
            continue;
          }

          if (!title) {
            dropped.missingName++;
            continue;
          }

          if (variant.price === undefined || variant.price === null) {
            dropped.missingPrice++;
            continue;
          }
          const cost = Number.parseFloat(String(variant.price));
          if (!Number.isFinite(cost) || cost <= 0) {
            dropped.invalidPriceFormat++;
            continue;
          }

          // Çok varyantlı üründe varyant başlığını isme ekle ("Default Title" hariç).
          const variantTitle =
            typeof variant.title === 'string' &&
            variant.title &&
            variant.title !== 'Default Title'
              ? ` - ${variant.title}`
              : '';

          const available = variant.available === true;
          const candidate: ParsedProduct = {
            externalCode: variantId,
            name: `${title}${variantTitle}`.trim(),
            // brand: Shopify vendor genelde mağaza adıdır (gerçek marka değil);
            // marka facet'ini kirletmemek için boş bırakıyoruz. Admin sonradan
            // SupplierBrandMapping ile atayabilir.
            brand: undefined,
            description,
            costPrice: cost, // KDV-hariç (supplier.priceIncludesVat=false ile uyumlu)
            currency: 'TRY',
            stock: available ? ShopifyFeedService.IN_STOCK_QTY : 0,
            categoryPath,
            images,
          };

          // Aynı varyant id'si birden çok kez gelebilir (collection-scoped feed
          // URL'leri / çakışan sayfalar). "İlk-kazanır" yerine stoğu yüksek
          // (available) kopyayı tut — önce gelen unavailable kopyayı ezer.
          const existingIdx = indexByCode.get(variantId);
          if (existingIdx !== undefined) {
            dropped.duplicateSkuInFeed++;
            if (candidate.stock > items[existingIdx].stock) {
              items[existingIdx] = candidate;
            }
            continue;
          }
          indexByCode.set(variantId, items.length);
          items.push(candidate);
        }
      } catch (err) {
        dropped.malformed++;
        this.logger.warn(
          `shopify product parse failed: ${(err as Error).message}`,
        );
      }
    }

    this.logger.log(
      `shopify parsed ${items.length}/${totalCandidates} variants ` +
        `(drops: missingSku=${dropped.missingSku} missingName=${dropped.missingName} ` +
        `missingPrice=${dropped.missingPrice} invalidPriceFormat=${dropped.invalidPriceFormat} ` +
        `duplicate=${dropped.duplicateSkuInFeed} malformed=${dropped.malformed})`,
    );

    return { items, dropped, totalCandidates };
  }

  /** products.json'ı limit=250&page=N ile boş sayfaya kadar çeker. */
  private async fetchAllProducts(feedUrl: string): Promise<any[]> {
    const all: any[] = [];
    for (let page = 1; page <= ShopifyFeedService.MAX_PAGES; page++) {
      const url = new URL(feedUrl);
      url.searchParams.set('limit', String(ShopifyFeedService.PAGE_LIMIT));
      url.searchParams.set('page', String(page));

      const resp = await axios.get(url.toString(), {
        timeout: ShopifyFeedService.PAGE_TIMEOUT_MS,
        responseType: 'json',
        maxContentLength: 1024 * 1024 * 200,
        maxBodyLength: 1024 * 1024 * 200,
        headers: {
          'User-Agent': 'TB-B2B-FeedSync/1.0 (+https://toptanbudur.com)',
          Accept: 'application/json',
          'Accept-Encoding': 'gzip, deflate',
        },
      });

      const products = Array.isArray(resp.data?.products)
        ? resp.data.products
        : [];
      all.push(...products);

      // Tam dolu sayfadan azsa son sayfadayız → dur.
      if (products.length < ShopifyFeedService.PAGE_LIMIT) break;
    }
    return all;
  }

  /** Shopify product.images[] → ParsedImage[] (CDN linki doğrudan kullanılır). */
  private mapImages(rawImages: unknown): ParsedImage[] {
    if (!Array.isArray(rawImages)) return [];
    const out: ParsedImage[] = [];
    for (const img of rawImages) {
      const src = img?.src;
      if (typeof src === 'string' && src) {
        const position =
          typeof img.position === 'number' ? img.position : out.length + 1;
        out.push({ url: src, position });
      }
    }
    out.sort((a, b) => a.position - b.position);
    return out;
  }
}

import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class ProductListQueryDto {
  @IsString()
  tenantSlug!: string;

  @IsOptional()
  @IsString()
  categorySlug?: string;

  /** V3: DOĞRU (canonical/Trendyol) kategori yolu ile filtre (alt ağaç dahil). */
  @IsOptional()
  @IsString()
  canonicalPath?: string;

  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsString()
  brand?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxPrice?: number;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  inStock?: boolean;

  @IsOptional()
  // 'popular': landing ana sayfadaki 5 fiyat bandı vitrini bu değeri
  // gönderiyor ama listede yoktu → beş bant da 400 alıp BOŞ kalıyordu.
  // best_selling ile aynı sıralamayı üretir (buildOrderBy).
  @IsIn([
    'price_asc',
    'price_desc',
    'newest',
    'name',
    'best_selling',
    'popular',
    'recommended',
  ])
  sort?:
    | 'price_asc'
    | 'price_desc'
    | 'newest'
    | 'name'
    | 'best_selling'
    | 'popular'
    | 'recommended';

  // page üst sınırı: ~60K ürünlük katalogda pageSize 24 ile son sayfa ~2500'dür.
  // 3000 tavanı tüm meşru gezinmeyi kapsar ama bot/scraper'ın page=3704 gibi
  // devasa OFFSET (89K satır tarama) istemesini engeller — tek Node process'i korur.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3000)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(60)
  pageSize?: number;

  /**
   * Standart REST sayfalama: kaç kayıt döndürüleceğini belirtir.
   * `pageSize` ile aynı işlevi görür; ikisi birlikte verilirse `limit` öncelikli.
   * Maksimum 100 (smoke test gereği).
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  /**
   * Standart REST sayfalama: kaç kayıt atlanacağını belirtir.
   * `page` yerine kullanılabilir; ikisi birlikte verilirse `offset` öncelikli.
   */
  // offset üst sınırı: katalog boyutunun (~60K) ötesi anlamsız; pathological
  // büyük OFFSET taramasını engeller (page tavanıyla aynı koruma, REST yolu için).
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(75000)
  offset?: number;
}

export class TenantSlugQueryDto {
  @IsString()
  tenantSlug!: string;
}

export class CatalogCountQueryDto {
  @IsString()
  tenantSlug!: string;

  /**
   * `?activeOnly=false` → pasifler dahil sayım. Default `true`. Query
   * string boolean'ları string olarak gelir, manuel Transform ile parse
   * edilir; aksi halde `'false'` truthy olur.
   */
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const v = value.trim().toLowerCase();
      if (v === 'false' || v === '0' || v === 'no') return false;
      if (v === 'true' || v === '1' || v === 'yes') return true;
    }
    return value;
  })
  @IsBoolean()
  activeOnly?: boolean;
}

export class CategoryTreeQueryDto {
  @IsString()
  tenantSlug!: string;

  // `?withCounts=true` → her node'a aktif ürün sayısı (kendisi + alt ağacı) eklenir.
  // Landing tek istekte tüm sayımları alabilsin diye eklendi (önceden N+1 istek
  // atıyordu ve throttler 429'a düşürüyordu).
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  withCounts?: boolean;
}

export interface ProductCardDto {
  id: string;
  slug: string;
  name: string;
  brand: string | null;
  price: string;
  currency: string;
  stock: number;
  image: string | null;
  categoryPath: string | null;
  supplierId: string | null;
  supplier: {
    mandatoryCarriers: string[];
    requiresPdf: boolean;
    pttavmEnabled: boolean;
  } | null;
}

export interface ProductDetailDto {
  id: string;
  slug: string;
  name: string;
  brand: string | null;
  model: string | null;
  description: string | null;
  price: string;
  currency: string;
  stock: number;
  /**
   * Müşteriye gösterilen site stok kodu (Product.internalCode — TBDR-XXXXXX).
   * Ham tedarikçi kodu (Product.externalCode) ASLA bu response'a sızmaz —
   * sadece admin endpoint'leri orijinali görür.
   */
  sku: string | null;
  /**
   * Müşteriye gösterilen public barkod (TBDR prefix). Orijinal tedarikçi
   * barkodu (Product.barcode) ASLA bu response'a sızmaz — sadece admin
   * endpoint'leri orijinali görür.
   */
  barcode: string | null;
  images: { url: string; position: number }[];
  breadcrumb: { name: string; slug: string }[];
  /**
   * Tedarikçi-spesifik kargo/PDF/teslim politikaları. Müşteri checkout'ta
   * bunlara göre form alanlarını şartlı render eder (PDF upload zorunlu mu,
   * sabit kargo firması var mı, tahmini teslim süresi).
   */
  supplierId: string | null;
  supplier: {
    mandatoryCarriers: string[];
    requiresPdf: boolean;
    pttavmEnabled: boolean;
    leadTimeDays: number | null;
  } | null;
}

export interface CatalogCountDto {
  total: number;
  activeOnly: boolean;
}

export interface CategoryNodeDto {
  id: string;
  name: string;
  slug: string;
  path: string;
  depth: number;
  /** Yalnız `withCounts=true` ile gelir. Bu node + alt ağacındaki aktif ürün sayısı. */
  count?: number;
  children: CategoryNodeDto[];
}

export interface BrandCountDto {
  brand: string;
  count: number;
}

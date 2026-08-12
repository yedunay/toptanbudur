export const API_BASE =
  (typeof window === "undefined"
    ? process.env.INTERNAL_API_BASE || process.env.NEXT_PUBLIC_API_BASE
    : process.env.NEXT_PUBLIC_API_BASE) || "http://localhost:4000/api";

export const TENANT_SLUG =
  process.env.NEXT_PUBLIC_TENANT_SLUG || "acme";

/**
 * Oturum cookie adı — `ADMIN_DISCOUNT` müşteride katalog isteğine taşınır ki
 * backend dedup'suz (tüm aynı-isimli varyant) listeyi açabilsin. Backend'deki
 * `SESSION_COOKIE_NAME` ile birebir aynı olmak zorunda.
 */
const SESSION_COOKIE_NAME = "tb_session";

export type ProductImage = { url: string; alt?: string };

/**
 * Tedarikçi bazlı kargo / sipariş kuralları.
 * Detay endpoint'i bu alanları doğrudan `supplier` içinde döndürebileceği gibi
 * geriye uyumluluk için "düz" alanlarda da (mandatoryCarriers, requiresPdf,
 * leadTimeDays) gönderebilir. `normalize…` yardımcıları her iki şekli de
 * tolere eder.
 */
export type ProductSupplier = {
  /**
   * Opak tedarikçi UUID'si — sepet gruplama / "Paket" etiketleme için
   * kullanılır. Müşteriye gösterilmez, sadece istemci içi kıyaslama için.
   */
  id?: string | null;
  /**
   * Tedarikçinin desteklediği/zorunlu kıldığı kargo firmaları. Boş dizi →
   * kısıtlama yok (her kargo seçilebilir). Birden fazla tedarikçi varsa
   * checkout sayfası bu dizilerin kesişimini hesaplar.
   */
  mandatoryCarriers?: string[] | null;
  /** Sipariş için PDF (yetki belgesi vb.) yüklenmesi şartmı? */
  requiresPdf?: boolean | null;
  /** Backend'den gelen eski tedarikçi bayrağı — checkout akışında kullanılmıyor. */
  pttavmEnabled?: boolean | null;
  /** Tahmini hazırlık/gönderim süresi (iş günü). */
  leadTimeDays?: number | null;
  /** İnsan-okunur tedarikçi adı (UI'de gösterilir). */
  name?: string | null;
};

export type Product = {
  id?: string;
  slug: string;
  name: string;
  brand?: string | null;
  price?: number | string | null;
  currency?: string | null;
  stock?: number | null;
  inStock?: boolean;
  description?: string | null;
  images?: ProductImage[] | string[];
  imageUrl?: string | null;
  categoryPath?: { slug: string; name: string }[];
  supplierId?: string | null;
  /** Tedarikçi/iç stok kodu — backend'den gelirse detayda gösterilir. */
  sku?: string | null;
  /**
   * Müşteriye gösterilecek public barkod (TBDR ile başlayan random).
   * Backend `/api/catalog/products/:slug` response'unda orijinal `barcode`
   * yerine bu alanı döndürür — orijinal tedarikçi barkodu yalnız admin
   * endpoint'lerinde görünür.
   */
  publicBarcode?: string | null;
  /** MPN — backend'den gelirse detayda gösterilir. */
  mpn?: string | null;
  /** Tedarikçi kargo/sipariş kuralları (detayda dolu gelir). */
  supplier?: ProductSupplier | null;
  /** Geriye dönük: bazı response'lar "düz" alanlarla gelebiliyor. */
  mandatoryCarriers?: string[] | null;
  requiresPdf?: boolean | null;
  leadTimeDays?: number | null;
  supplierName?: string | null;
};

export type ProductListMeta = {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export type ProductListResponse = {
  data: Product[];
  meta: ProductListMeta;
  brands?: { name: string; count: number }[];
  categories?: CategoryNode[];
};

export type CategoryNode = {
  slug: string;
  name: string;
  /** V3: doğru (canonical) ağaçta dolu — ürün filtresi bu yol ile yapılır. */
  path?: string;
  count?: number;
  children?: CategoryNode[];
};

type FetchOpts = {
  revalidate?: number;
  /**
   * `ADMIN_DISCOUNT` müşterinin oturum cookie değeri. Dolu geldiğinde istek
   * backend'e bu cookie ile taşınır ve cache tamamen bypass edilir
   * (`no-store`) — müşteriye özel dedup'suz liste paylaşımlı cache'e düşmez.
   * Anonim / `STANDARD` müşteride `undefined` kalır → public, cache'li davranış
   * birebir korunur (normal müşteri hiç etkilenmez).
   */
  sessionCookie?: string | null;
};

async function api<T>(path: string, opts: FetchOpts = {}): Promise<T | null> {
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    const forwardCookie = !!opts.sessionCookie;
    if (forwardCookie) {
      headers.Cookie = `${SESSION_COOKIE_NAME}=${opts.sessionCookie}`;
    }
    // Cookie taşınıyorsa yanıt müşteriye özeldir → revalidate'i yok say, daima
    // taze çek. Aksi halde mevcut davranış (revalidate varsa ISR, yoksa
    // no-store) birebir korunur.
    const useRevalidate = !forwardCookie && !!opts.revalidate;
    const res = await fetch(`${API_BASE}${path}`, {
      headers,
      next: useRevalidate ? { revalidate: opts.revalidate } : undefined,
      cache: useRevalidate ? undefined : "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export type CatalogQuery = {
  kategori?: string;
  /** V3: doğru (canonical) kategori yolu ile filtre (alt ağaç dahil). */
  canonicalPath?: string;
  q?: string;
  marka?: string | string[];
  min?: string;
  max?: string;
  sirala?: string;
  sayfa?: string;
  stoklu?: string;
};

export function buildCatalogQuery(sp: CatalogQuery): string {
  const p = new URLSearchParams();
  p.set("tenantSlug", TENANT_SLUG);
  if (sp.kategori) p.set("categorySlug", sp.kategori);
  if (sp.canonicalPath) p.set("canonicalPath", sp.canonicalPath);
  if (sp.q) p.set("q", sp.q);
  if (sp.marka) {
    const brands = Array.isArray(sp.marka) ? sp.marka : [sp.marka];
    brands.forEach((b) => p.append("brand", b));
  }
  if (sp.min) p.set("minPrice", sp.min);
  if (sp.max) p.set("maxPrice", sp.max);
  if (sp.sirala) p.set("sort", sp.sirala);
  if (sp.sayfa) p.set("page", sp.sayfa);
  if (sp.stoklu === "1" || sp.stoklu === "true") p.set("inStock", "true");
  p.set("pageSize", "24");
  return p.toString();
}

type RawProductCard = Product & { image?: string | null };
type RawProductDetail = Product & {
  breadcrumb?: { name: string; slug: string }[];
  /**
   * Geri uyumluluk: bazı eski response'lar `barcode` adıyla public barkod
   * dönmüş olabilir. Yeni response'da yalnız `publicBarcode` döner.
   */
  barcode?: string | null;
};

/**
 * Detay endpoint'inden gelen tedarikçi alanlarını tek bir `ProductSupplier`
 * şekline indirger. Backend ya iç içe `supplier` döndürür ya da düz alanlarla
 * (`mandatoryCarriers`, `requiresPdf`, `leadTimeDays`) — her ikisini de
 * tolere ediyoruz.
 */
function normalizeSupplier(raw: RawProductDetail): ProductSupplier | null {
  const nested = raw.supplier ?? null;
  const carriers: string[] | null = Array.isArray(nested?.mandatoryCarriers)
    ? (nested?.mandatoryCarriers ?? [])
    : Array.isArray(raw.mandatoryCarriers)
      ? raw.mandatoryCarriers
      : null;
  const merged: ProductSupplier = {
    id: nested?.id ?? raw.supplierId ?? null,
    mandatoryCarriers: carriers,
    requiresPdf:
      nested?.requiresPdf ?? raw.requiresPdf ?? null,
    pttavmEnabled: nested?.pttavmEnabled ?? null,
    leadTimeDays:
      nested?.leadTimeDays ?? raw.leadTimeDays ?? null,
    name: nested?.name ?? raw.supplierName ?? null,
  };
  const hasAny =
    merged.id != null ||
    (Array.isArray(merged.mandatoryCarriers) &&
      merged.mandatoryCarriers.length > 0) ||
    merged.requiresPdf != null ||
    merged.leadTimeDays != null ||
    merged.name != null;
  return hasAny ? merged : null;
}

function toTitleCaseTr(word: string): string {
  if (word.length === 0) return word;
  if (/\d/.test(word)) return word;
  if (/^[A-ZĞÜŞİÖÇ]+$/.test(word) && word.length <= 4) return word;
  const lower = word.toLocaleLowerCase("tr-TR");
  return lower.charAt(0).toLocaleUpperCase("tr-TR") + lower.slice(1);
}

export function cleanProductName(name: string, brand?: string | null): string {
  if (!name) return name;
  // Önce HTML entity'lerini çöz — feed'lerde "&Ouml;" gibi gelebiliyor.
  let working = decodeHtmlEntities(name);
  if (brand) {
    const re = new RegExp(`\\b${brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
    working = working.replace(re, " ");
  }
  // Strip trailing supplier/internal code tokens that sometimes leak
  // from the feed (e.g. "Ürün Adı SKU:ABC123", "[KOD-123]", "(STK 9988)").
  working = working
    // Sadece GERÇEK sızan kod token'larını sil ("KOD-123", "SKU: ABC9", "STK 9988").
    // `\b` keyword'ü tam sözcük yapar + `(?=...\d)` kod kısmında en az bir rakam
    // şart koşar → "Reflektör"→"ör", "Skull"→"", "Kodu: 313" gibi normal sözcük
    // önekleri ASLA kırpılmaz. (Eski hâli `REF` ile "Reflekt"i yiyordu.)
    .replace(
      /\b(SKU|KOD|BARKOD|STK|REF|MPN|GTIN|EAN)\b\s*[:#-]?\s*(?=[A-Z0-9._-]*\d)[A-Z0-9._-]+/gi,
      " ",
    )
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\((?:KOD|SKU|STK|REF)[^)]*\)/gi, " ");
  const cleaned = working.replace(/\s+/g, " ").trim();
  // Tüm ad bir koddan ibaretse (örn. "Stk 394-250A") temizlik boş bırakır →
  // boş başlık göstermek yerine decode edilmiş orijinali koru.
  if (!cleaned) return decodeHtmlEntities(name);
  const isShouting = cleaned === cleaned.toLocaleUpperCase("tr-TR") && /[A-ZĞÜŞİÖÇ]/.test(cleaned);
  if (!isShouting) return cleaned;
  return cleaned.split(" ").map(toTitleCaseTr).join(" ");
}

function normalizeCard(p: RawProductCard): Product {
  return {
    ...p,
    name: cleanProductName(p.name, p.brand),
    imageUrl: p.imageUrl ?? p.image ?? null,
    categoryPath: undefined,
  };
}

export async function fetchProducts(
  sp: CatalogQuery,
  revalidate = 60,
  sessionCookie?: string | null,
) {
  const qs = buildCatalogQuery(sp);
  const res = await api<{ data: RawProductCard[]; meta: ProductListMeta }>(
    `/catalog/products?${qs}`,
    { revalidate, sessionCookie }
  );
  if (!res) return null;
  return {
    ...res,
    data: res.data.map(normalizeCard),
  } satisfies ProductListResponse;
}

export async function fetchProduct(slug: string, revalidate = 60) {
  const qs = new URLSearchParams({ tenantSlug: TENANT_SLUG }).toString();
  const res = await api<RawProductDetail>(
    `/catalog/products/${encodeURIComponent(slug)}?${qs}`,
    { revalidate }
  );
  if (!res) return null;
  return {
    ...res,
    name: cleanProductName(res.name, res.brand),
    categoryPath: res.breadcrumb ?? res.categoryPath ?? [],
    // Müşteriye yalnızca site stok kodu (`sku` = internalCode, TBDR-XXXXXX)
    // gösterilir. Ham tedarikçi kodu (externalCode) müşteri storefront'una
    // ASLA dahil edilmez — backend zaten bu alanı catalog response'una koymaz.
    sku: res.sku ?? null,
    // Backend artık orijinal `barcode` alanını döndürmüyor — yalnız müşteriye
    // özel `publicBarcode` (TBDR…) geliyor. Eski response'larla uyum için
    // `barcode` fallback'ini de kabul ediyoruz.
    publicBarcode: res.publicBarcode ?? res.barcode ?? null,
    mpn: res.mpn ?? null,
    supplier: normalizeSupplier(res),
  } satisfies Product;
}

export async function fetchCategories(revalidate = 300) {
  const qs = new URLSearchParams({ tenantSlug: TENANT_SLUG }).toString();
  return api<CategoryNode[]>(`/catalog/categories?${qs}`, { revalidate });
}

/** V3: DOĞRU (canonical/Trendyol) kategori ağacı — storefront gezinmesi için. */
export async function fetchCorrectCategories(revalidate = 300) {
  const qs = new URLSearchParams({ tenantSlug: TENANT_SLUG }).toString();
  return api<CategoryNode[]>(`/catalog/categories/correct?${qs}`, { revalidate });
}

export async function fetchBrands(
  revalidate = 300,
  sessionCookie?: string | null,
) {
  const qs = new URLSearchParams({ tenantSlug: TENANT_SLUG }).toString();
  const res = await api<{ brand?: string; name?: string; count: number }[]>(
    `/catalog/brands?${qs}`,
    { revalidate, sessionCookie }
  );
  if (!res) return null;
  return res.map((b) => ({
    name: b.name ?? b.brand ?? "",
    count: b.count,
  }));
}

export function formatPrice(value?: number | string | null, currency = "TRY") {
  if (value == null || isNaN(Number(value))) return "—";
  try {
    return new Intl.NumberFormat("tr-TR", {
      style: "currency",
      currency: currency || "TRY",
      maximumFractionDigits: 2,
    }).format(Number(value));
  } catch {
    return `${value} ${currency}`;
  }
}

export function productImage(p: Product): string | null {
  if (p.imageUrl) return p.imageUrl;
  if (Array.isArray(p.images) && p.images.length > 0) {
    const first = p.images[0];
    if (typeof first === "string") return first;
    if (first && typeof first === "object" && "url" in first) return first.url;
  }
  return null;
}

export function productImages(p: Product): string[] {
  if (Array.isArray(p.images) && p.images.length > 0) {
    return p.images
      .map((i) => (typeof i === "string" ? i : i?.url))
      .filter((s): s is string => !!s);
  }
  if (p.imageUrl) return [p.imageUrl];
  return [];
}

/**
 * Customer-facing description sanitiser.
 *
 * Feed descriptions often contain CDATA wrappers, raw HTML, supplier
 * signatures, internal SKUs / vendor codes and other noise we should NOT
 * show end customers. We strip:
 *   - <![CDATA[ ... ]]> wrappers
 *   - HTML tags (keeping inner text, decoded entities)
 *   - lines that look like internal codes (SKU:, KOD:, BARKOD:, supplier_ref, etc.)
 *   - trailing supplier signatures (Tedarikçi:, Vendor:, Kaynak:)
 */
const HIDDEN_FIELD_PATTERNS: RegExp[] = [
  /^\s*(sku|stok\s*kodu|kod|barkod|barcode|gtin|ean|mpn)\s*[:=].*/i,
  /^\s*(supplier|tedarik(c|ç)i|vendor|kaynak|source|distrib(ü|u)t(ö|o)r)\s*[:=].*/i,
  /^\s*(internal[_\s-]?code|raw[_\s-]?xml|cost[_\s-]?price|maliyet)\s*[:=].*/i,
  /^\s*(supplier[_\s-]?ref|vendor[_\s-]?notes?)\s*[:=].*/i,
];

/**
 * XML/HTML entity tablosu — özellikle Türkçe karakterler (&Ouml;, &uuml;,
 * &Ccedil;, vb.) ve sıkça görülen HTML entity'lerini doğrudan UTF-8 karakterine
 * çözer. Tedarikçi feed'lerinde "MTR-RK200 USB Şarjlı Sinek &Ouml;ld&uuml;r&uuml;c&uuml;..."
 * gibi içerikler geliyor, bunları okunur hale getiriyoruz.
 */
const NAMED_ENTITIES: Record<string, string> = {
  // ASCII / yapısal
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  shy: "",
  copy: "©",
  reg: "®",
  trade: "™",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  laquo: "«",
  raquo: "»",
  ldquo: "“",
  rdquo: "”",
  lsquo: "‘",
  rsquo: "’",
  bull: "•",
  middot: "·",
  euro: "€",
  pound: "£",
  yen: "¥",
  cent: "¢",
  deg: "°",
  plusmn: "±",
  times: "×",
  divide: "÷",
  // Türkçe / Latin Extended
  Auml: "Ä",
  auml: "ä",
  Euml: "Ë",
  euml: "ë",
  Iuml: "Ï",
  iuml: "ï",
  Ouml: "Ö",
  ouml: "ö",
  Uuml: "Ü",
  uuml: "ü",
  Yuml: "Ÿ",
  yuml: "ÿ",
  Ccedil: "Ç",
  ccedil: "ç",
  szlig: "ß",
  // Sık karşılaşılan aksanlı harfler (TR feed'lerinde nadir ama olur)
  Aacute: "Á", aacute: "á",
  Eacute: "É", eacute: "é",
  Iacute: "Í", iacute: "í",
  Oacute: "Ó", oacute: "ó",
  Uacute: "Ú", uacute: "ú",
  Agrave: "À", agrave: "à",
  Egrave: "È", egrave: "è",
  Igrave: "Ì", igrave: "ì",
  Ograve: "Ò", ograve: "ò",
  Ugrave: "Ù", ugrave: "ù",
  Acirc: "Â", acirc: "â",
  Ecirc: "Ê", ecirc: "ê",
  Icirc: "Î", icirc: "î",
  Ocirc: "Ô", ocirc: "ô",
  Ucirc: "Û", ucirc: "û",
  Atilde: "Ã", atilde: "ã",
  Ntilde: "Ñ", ntilde: "ñ",
  Otilde: "Õ", otilde: "õ",
  // Türkçe özel: bazı feed'ler bu adlandırmayı döndürür
  // (W3C standardında olmasa da yaygın)
  Idot: "İ",
  inodot: "ı",
};

function decodeNumericEntity(code: number): string {
  if (!Number.isFinite(code) || code < 0) return "";
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

export function decodeHtmlEntities(s: string): string {
  if (!s) return "";
  // Hex numeric: &#xC4;
  let out = s.replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) =>
    decodeNumericEntity(parseInt(hex, 16)),
  );
  // Decimal numeric: &#196;
  out = out.replace(/&#(\d+);/g, (_, dec: string) =>
    decodeNumericEntity(parseInt(dec, 10)),
  );
  // Named entities: &Ouml; &uuml; &amp; ...
  out = out.replace(/&([a-zA-Z][a-zA-Z0-9]+);/g, (match, name: string) => {
    const direct = NAMED_ENTITIES[name];
    if (direct !== undefined) return direct;
    // Bilinmeyen named entity — case-insensitive son şans
    const lower = name.toLowerCase();
    if (NAMED_ENTITIES[lower] !== undefined) return NAMED_ENTITIES[lower];
    return match; // dokunma
  });
  return out;
}

export function sanitizeDescription(raw?: string | null): string {
  if (!raw) return "";
  let text = String(raw);

  // Strip CDATA wrappers
  text = text.replace(/<!\[CDATA\[/gi, "").replace(/\]\]>/g, "");

  // Strip <script>/<style> blocks entirely
  text = text.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "");

  // Convert <br>, <p>, <li> to line breaks before stripping tags
  text = text.replace(/<\s*br\s*\/?\s*>/gi, "\n");
  text = text.replace(/<\/\s*(p|div|li|tr|h[1-6])\s*>/gi, "\n");

  // Strip remaining tags
  text = text.replace(/<[^>]+>/g, "");

  // Decode entities
  text = decodeHtmlEntities(text);

  // Drop lines that look like internal code metadata
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const filtered = lines.filter((line) => {
    if (!line) return true; // keep blanks for paragraph breaks
    return !HIDDEN_FIELD_PATTERNS.some((re) => re.test(line));
  });

  // Collapse 3+ blank lines
  const cleaned = filtered.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return cleaned;
}

export function isInStock(p: Product): boolean {
  if (typeof p.inStock === "boolean") return p.inStock;
  if (typeof p.stock === "number") return p.stock > 0;
  return true;
}

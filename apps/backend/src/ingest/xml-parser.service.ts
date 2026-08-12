import { Injectable, Logger } from '@nestjs/common';
import { XMLParser } from 'fast-xml-parser';

export interface ParsedImage {
  url: string;
  position: number;
}

export interface ParsedProduct {
  externalCode: string;
  name: string;
  brand?: string;
  model?: string;
  description?: string;
  barcode?: string;
  costPrice: number;
  currency: string;
  stock: number;
  taxRate?: number;
  categoryPath: string[];
  images: ParsedImage[];
}

export interface DropStats {
  missingSku: number;
  missingName: number;
  missingPrice: number;
  invalidPriceFormat: number;
  duplicateSkuInFeed: number;
  malformed: number;
}

export interface ParseResult {
  items: ParsedProduct[];
  dropped: DropStats;
  totalCandidates: number;
}

const XML_SUFFIX_REGEX = /\s*\(\s*xml\s*\)\s*$/i;
const TAX_RATE_REGEX = /<g:rate>\s*([\d.]+)/i;
const URL_REGEX = /^https?:\/\/[^\s<>"']+/i;

// Türkçe başharfli hâl. "MİKROFON" → "Mikrofon", "PİL" → "Pil", "oto ampul" → "Oto Ampul".
function toTitleCaseTr(input: string): string {
  const lower = input.toLocaleLowerCase('tr');
  return lower.replace(/(^|[\s\-/&()])(\p{L})/gu, (_, sep, ch) =>
    sep + ch.toLocaleUpperCase('tr'),
  );
}

function normalizeCategoryName(raw: string): string {
  return toTitleCaseTr(raw.replace(XML_SUFFIX_REGEX, '').trim()).trim();
}

function asString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') {
    const t = value.trim();
    return t || undefined;
  }
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  if (Array.isArray(value)) {
    for (const v of value) {
      const s = asString(v);
      if (s) return s;
    }
    return undefined;
  }
  if (typeof value === 'object') {
    const v = (value as { '#text'?: unknown })['#text'];
    return v !== undefined ? asString(v) : undefined;
  }
  return undefined;
}

// Sayı parse — TR ("1.234,56") + EN ("1,234.56") + plain ("1234.56") + integer ("1234").
// Currency/whitespace strip dahil. Heuristic: hem ',' hem '.' varsa, en sonra
// gelen ayırıcı decimal kabul edilir; diğeri thousands separator olarak silinir.
// Tek bir ayırıcı varsa, > 2 ondalık basamak (örn. "1.234") thousands kabul edilir.
function toNumber(v: unknown, fallback = 0): number {
  const s = asString(v);
  if (!s) return fallback;
  // Currency, whitespace, harfleri sil; sadece sayı + ayırıcı + işaret kalsın.
  let cleaned = s.replace(/[^\d,.\-]/g, '');
  if (!cleaned) return fallback;

  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');

  if (lastComma !== -1 && lastDot !== -1) {
    // İki ayırıcı: en sondaki decimal, diğeri thousands.
    if (lastComma > lastDot) {
      // TR: "1.234,56" → "1234.56"
      cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
      // EN: "1,234.56" → "1234.56"
      cleaned = cleaned.replace(/,/g, '');
    }
  } else if (lastComma !== -1) {
    // Tek ',': decimal mi thousands mı? Sondan 3 hane sonra geliyorsa thousands.
    const after = cleaned.length - lastComma - 1;
    if (after === 3 && cleaned.indexOf(',') !== lastComma) {
      // birden fazla virgül → thousands ("1,234,567")
      cleaned = cleaned.replace(/,/g, '');
    } else {
      // tek virgül, decimal kabul ("1234,56" veya "1,5")
      cleaned = cleaned.replace(',', '.');
    }
  } else if (lastDot !== -1) {
    // Tek '.': birden fazla nokta varsa thousands; yoksa decimal.
    const dotCount = (cleaned.match(/\./g) || []).length;
    if (dotCount > 1) {
      cleaned = cleaned.replace(/\./g, '');
    }
    // Aksi halde dokunma — Number("1234.56") OK.
  }

  const n = Number(cleaned);
  return Number.isFinite(n) ? n : fallback;
}

function toInt(v: unknown, fallback = 0): number {
  return Math.trunc(toNumber(v, fallback));
}

function normalizeCurrency(raw: string | undefined): string {
  if (!raw) return 'TRY';
  const u = raw.trim().toUpperCase();
  if (u === 'TL' || u === '₺' || u === 'TRL') return 'TRY';
  return u;
}

// Bir kayıttan, aday alan isimlerinin (case-insensitive) ilk eşleşenini döndürür.
function pickField(
  record: Record<string, unknown>,
  candidates: readonly string[],
): unknown {
  // Önce birebir eşleşme
  for (const c of candidates) {
    if (c in record) {
      const v = record[c];
      if (v !== undefined && v !== null && v !== '') return v;
    }
  }
  // Case-insensitive aramada sıra
  const lcMap: Record<string, string> = {};
  for (const k of Object.keys(record)) lcMap[k.toLowerCase()] = k;
  for (const c of candidates) {
    const real = lcMap[c.toLowerCase()];
    if (real !== undefined) {
      const v = record[real];
      if (v !== undefined && v !== null && v !== '') return v;
    }
  }
  return undefined;
}

// Kayıt içinde indeksli alanları sayı sırasına göre toplar.
// `prefix${i}` ve `prefix${i}${suffix}` formlarını dener.
// Örn. prefix="picture" suffix="Path" → picture1Path..picture8Path
function pickIndexedSeries(
  record: Record<string, unknown>,
  prefixes: readonly string[],
  maxIndex = 25,
  suffixes: readonly string[] = [''],
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const lcMap: Record<string, string> = {};
  for (const k of Object.keys(record)) lcMap[k.toLowerCase()] = k;

  for (let i = 1; i <= maxIndex; i++) {
    for (const p of prefixes) {
      for (const sfx of suffixes) {
        const lc = `${p}${i}${sfx}`.toLowerCase();
        const real = lcMap[lc];
        if (!real) continue;
        const s = asString(record[real]);
        if (s && URL_REGEX.test(s) && !seen.has(s)) {
          seen.add(s);
          out.push(s);
        }
      }
    }
  }
  return out;
}

// Kategoriler için olası tüm yolları dener: hiyerarşik (main/sub), tek path
// string ("a > b > c"), kategori1/kategori2/... indeksli alanlar.
// Feed HICBIR kategori alani vermediginde (entafix "MASTER XML" gibi feed'ler
// urunlerin yarisina product_type koymaz) urun ADINDAN kaba kategori cikarir.
// SON CARE: yalnizca pickCategoryPath'in tum alan-tabanli adimlari bos donerse
// cagrilir. SPESIFIK kaliplar once (yanlis eslesme olmasin); hicbiri tutmazsa
// null -> urun yine kategorisiz kalir (onceki davranis korunur).
function classifyNameToCategory(name: string): string | null {
  // Türkçe locale büyük 'I' -> noktasız 'ı' yapar; anahtar kelime noktalı 'i'
  // ile eşleşmez ("Interkomu" -> "ınterkomu"). fold(): hem metni hem anahtarı
  // ASCII'ye indirger (aksan/nokta duyarsız eşleşme). Dönüş değerleri Türkçe kalır.
  const fold = (x: string) =>
    x
      .toLocaleLowerCase('tr')
      .replace(/ı/g, 'i').replace(/İ/g, 'i').replace(/ş/g, 's')
      .replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c');
  const s = fold(name);
  const any = (...ks: string[]) => ks.some((k) => s.includes(fold(k)));
  const both = (a: string, b: string) => s.includes(fold(a)) && s.includes(fold(b));
  if (any('intercom', 'interkom') && any('kask', 'motosiklet', 'motorsiklet')) return 'Kask İnterkom';
  if (both('kask', 'kulaklık')) return 'Kask İnterkom';
  if (any('aksiyon kamera', 'action kamera')) return 'Aksiyon Kamerası';
  if (both('güvenlik', 'kamera')) return 'Güvenlik Kamerası';
  if (both('çocuk', 'kamera')) return 'Çocuk Kamerası';
  if (any('araç içi kamera', 'araç kamera') || both('araç', 'kamera')) return 'Araç Kamerası';
  if (any(' kamera', 'kamerası', 'selfie', 'vlog')) return 'Mini Kamera';
  if (any('nostal', 'retro radyo', 'gramofon', 'gramafon', 'pikap', 'plak çalar', 'plaklar çalar', 'müzik kutu', 'radyo')) return 'Nostaljik Radyo';
  if (any('karaoke', 'hoparlör', 'speaker', 'amfi')) return 'Bluetooth Hoparlör';
  if (any('kulaklık', 'airpod', 'tws')) return 'Bluetooth Kulaklık';
  if (any('araç şarj', 'çakmaklık')) return 'Araç Şarj Cihazı';
  if (both('şarj', 'kablo')) return 'Şarj Kablosu';
  if (any('şarj adaptör', 'şarj başlığı', 'şarj başl', 'şarj alet', 'duvar şarj', 'hızlı şarj adapt', 'şarj cihaz')) return 'Şarj Adaptörü';
  if (any('powerbank', 'power bank', 'taşınabilir şarj')) return 'Powerbank';
  if (any('vantilatör', ' fan', 'fanı')) return 'El Fanı';
  if (any('masaj')) return 'Masaj Aleti';
  if (any('drone')) return 'Drone';
  if (both('akü', 'takviye')) return 'Akü Takviye';
  if (any('sivrisinek', 'sineksavar') || both('sinek', 'öldür') || both('böcek', 'öldür')) return 'Sinek Öldürücü';
  if (any('nemlendirici')) return 'Hava Nemlendirici';
  if (any('difüzör', 'difüzer') || both('aroma', 'koku')) return 'Aroma Difüzör';
  if (any('projeksiyon')) return 'Mini Projeksiyon';
  if (any('akıllı saat')) return 'Akıllı Saat';
  if (any('tablet')) return 'Tablet';
  if (any('astronot')) return 'Dekoratif Aydınlatma';
  return null;
}

function pickCategoryPath(record: Record<string, unknown>): string[] {
  const lcMap: Record<string, string> = {};
  for (const k of Object.keys(record)) lcMap[k.toLowerCase()] = k;

  // 0) >>> ayırıcılı tam path varsa direkt kullan (bazı feed'ler bunu kullanır).
  // Bu alanlar hem ayrık hierarchy hem tam path sunar; tam path leaf'i de içerir
  // → her zaman daha derindir. hasHierarchy kontrolünden önce çalışır.
  for (const key of [
    'category_path',
    'kategori_path',
    'category',
    'Category',
    'kategori',
    'Kategori',
  ]) {
    const real = lcMap[key.toLowerCase()];
    if (!real) continue;
    const s = asString(record[real]);
    if (s && s.includes('>>>')) {
      const parts = s
        .split(/[>/|]+/g)
        .map((seg) => normalizeCategoryName(seg))
        .filter(Boolean);
      if (parts.length > 1) return parts;
    }
  }

  // 1) Hiyerarşik alanlar — mainCategory > category > subCategory > leaf.
  // Eğer item bu alanları kullanıyorsa, daha spesifik bir path veriyor demek.
  // (bazı feed'ler için)
  const HIERARCHY_KEYS_ORDERED = [
    'mainCategory',
    'main_category',
    'parentCategory',
    'parent_category',
    'parentCategoryName',
    'parent_category_name',
    'parentCategoryCode',
    'parent_category_code',
    'subCategory',
    'sub_category',
    'altKategori',
    'alt_kategori',
    // Petshop tarzı: <kategori_adi> üst kategori adıdır, <altkategori> ile çift.
    'kategori_adi',
    'kategori_ad',
    'kategoriAdi',
    'subSubCategory',
    'leafCategory',
    'categoryName',
    'category_name',
    'categoryCode',
    'category_code',
  ];
  const hasHierarchy = HIERARCHY_KEYS_ORDERED.some(
    (k) => lcMap[k.toLowerCase()] !== undefined,
  );

  if (hasHierarchy) {
    const hierarchy: string[] = [];
    // Sıra: main → category → sub → subSub → leaf.
    // NOT: *Code alanları (parentCategoryCode, categoryCode) HAM TEDARİKÇİ
    // KODUDUR — eşleştirme için kullanılır, kategori adı olarak gösterilmez.
    // Bu yüzden buradaki iterasyondan dışarıda tutulur; yalnızca isim alanları
    // hierarchy'ye dahil edilir.
    for (const key of [
      'mainCategory',
      'main_category',
      'parentCategory',
      'parent_category',
      'parentCategoryName',
      'parent_category_name',
      'category',
      'Category',
      'kategori',
      'Kategori',
      // Petshop tarzı: <kategori_adi> üst kategori — <altkategori>'den önce.
      'kategori_adi',
      'kategori_ad',
      'kategoriAdi',
      'categoryName',
      'category_name',
      'subCategory',
      'sub_category',
      'altKategori',
      'alt_kategori',
      'subSubCategory',
      'leafCategory',
    ]) {
      const real = lcMap[key.toLowerCase()];
      if (!real) continue;
      const s = asString(record[real]);
      if (s) {
        const norm = normalizeCategoryName(s);
        if (norm && !hierarchy.includes(norm)) hierarchy.push(norm);
      }
    }
    if (hierarchy.length) return hierarchy;
  }

  // 2) Tek-string path kandidatları (içinde > / | ile ayrılmış)
  const single = asString(
    pickField(record, [
      'urun_kategori_path',
      'kategori_path',
      'category_path',
      'urun_kategori',
      'Category',
      'category',
      'kategori',
      'Kategori',
      'categories',
    ]),
  );
  if (single) {
    const parts = single
      .split(/[>/|]+/g)
      .map((s) => normalizeCategoryName(s))
      .filter(Boolean);
    if (parts.length) return parts;
  }

  // 3) kategori1, kategori2, kategori3, ... veya category1, category2, ...
  const indexed: string[] = [];
  for (let i = 1; i <= 10; i++) {
    for (const p of ['kategori', 'category', 'cat']) {
      const lc = `${p}${i}`.toLowerCase();
      const real = lcMap[lc];
      if (!real) continue;
      const s = asString(record[real]);
      if (s) indexed.push(normalizeCategoryName(s));
    }
  }
  if (indexed.length) return indexed.filter(Boolean);

  // 4) Google Merchant / RSS feed'leri: <product_type>. Tek serbest-metin tur
  // ("Bluetooth Kulaklik") veya " > " ile hiyerarsik olabilir. EN SON fallback —
  // yalnizca yukaridaki kategori alanlarinin HICBIRI yoksa devreye girer, bu
  // yuzden kendi kategori alani olan mevcut feed'leri etkilemez. NOT:
  // google_product_category bilerek kullanilmaz (Google'in Ingilizce/numerik
  // taksonomisi); saticinin kendi Turkce product_type'i esas alinir.
  const productType = asString(
    pickField(record, ['product_type', 'productType', 'g:product_type']),
  );
  if (productType) {
    const parts = productType
      .split(/[>/|]+/g)
      .map((s) => normalizeCategoryName(s))
      .filter(Boolean);
    if (parts.length) return parts;
  }

  // 5) SON CARE: hicbir kategori alani yok -> urun adindan sinifla.
  const nm = asString(pickField(record, NAME_KEYS));
  if (nm) {
    const cat = classifyNameToCategory(nm);
    if (cat) return [normalizeCategoryName(cat)];
  }

  return [];
}

// Belirli aday alanlardan tax rate'ini parse eder. Hem "20", "20%", "0.20",
// hem de "<g:rate>20.0</g:rate>" gibi gömülü içerikleri yakalar.
function pickTaxRate(record: Record<string, unknown>): number | undefined {
  const raw = asString(
    pickField(record, [
      'KDVOrani',
      'kdv_orani',
      'kdvOrani',
      'urun_kdv',
      'kdv',
      'KDV',
      'TaxRate',
      'tax_rate',
      'tax',
      'vat',
    ]),
  );
  if (!raw) return undefined;
  const m = TAX_RATE_REGEX.exec(raw);
  if (m) return Number(m[1]);
  const n = toNumber(raw, NaN);
  if (!Number.isFinite(n)) return undefined;
  // 0-1 arası gelirse yüzdeye çevir (0.20 → 20)
  return n <= 1 ? Math.round(n * 100) : n;
}

// Bilinen item tag adayları — büyük tedarikçi formatları için fast path.
const ITEM_CANDIDATES = [
  'product',
  'Product',
  'PRODUCT',
  'urun',
  'Urun',
  'URUN',
  'item',
  'Item',
  'ITEM',
  'entry',
  'Entry',
  'Mal',
  'mal',
  'Stok',
  'stok',
  'mamul',
  'Mamul',
  'Article',
  'article',
  'prd',
  'Prd',
] as const;

// Bilinen root wrapper'ları (catalog, products vb.).
const ROOT_CANDIDATES = [
  'urunler',
  'Urunler',
  'URUNLER',
  'urun_listesi',
  'urun_kataloglari',
  'products',
  'Products',
  'PRODUCTS',
  'productList',
  'product_list',
  'items',
  'Items',
  'rss',
  'feed',
  'root',
  'Root',
  'data',
  'catalog',
  'Catalog',
  'kataloglar',
  'stoklar',
  'Stoklar',
] as const;

function lcMapOf(record: Record<string, unknown>): Record<string, string> {
  const m: Record<string, string> = {};
  for (const k of Object.keys(record)) m[k.toLowerCase()] = k;
  return m;
}

/**
 * İç içe fiyat container'larının skalar çocuklarını üst seviyeye taşır
 * (üzerine yazmadan). Örn. ebijuteri:
 *   <fiyat><bayi_fiyati>16.5</bayi_fiyati><son_kullanici>89.9</son_kullanici>
 *          <para_birimi>TL</para_birimi></fiyat>
 * Bu yapıda bayi_fiyati üst seviyede bulunamaz; container'ı düzleştirince
 * mevcut fiyat ÖNCELİK listesi (bayi_fiyati > ...) ve para_birimi yakalanır.
 * Düz (nested olmayan) feed'lerde kayıt aynen döner — diğer tedarikçiler etkilenmez.
 */
const PRICE_CONTAINER_KEYS = [
  'fiyat',
  'fiyatlar',
  'fiyatlandirma',
  'price',
  'prices',
  'pricing',
];
function liftPriceContainers(
  r: Record<string, unknown>,
): Record<string, unknown> {
  const lc = lcMapOf(r);
  let merged: Record<string, unknown> | null = null;
  for (const ck of PRICE_CONTAINER_KEYS) {
    const realKey = lc[ck];
    if (!realKey) continue;
    const v = r[realKey];
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if (!merged) merged = { ...r };
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (!(k in merged) && (typeof val === 'string' || typeof val === 'number')) {
          merged[k] = val;
        }
      }
    }
  }
  return merged ?? r;
}

// Bir node içinde, "item benzeri" en kalabalık array'i bul.
// Heuristic: array değeri ve içeriği object olan en uzun child wins.
function findLargestItemArray(
  node: Record<string, unknown>,
): Record<string, unknown>[] | null {
  let best: Record<string, unknown>[] | null = null;
  for (const v of Object.values(node)) {
    if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'object') {
      if (!best || v.length > best.length) {
        best = v as Record<string, unknown>[];
      }
    }
  }
  return best;
}

// XML'i parse edilmiş köke indirir; ilk olası "ürün listesi" array'ini bulur.
// 3 strateji (sırayla):
//  1) Bilinen item tag fast-path (root içinde direkt item)
//  2) Bilinen root wrapper içinde bilinen item tag
//  3) Heuristic: node tree içinde "en kalabalık array of objects" — DFS
function findItemArray(doc: unknown): Record<string, unknown>[] {
  if (!doc || typeof doc !== 'object') return [];
  const root = doc as Record<string, unknown>;

  // 1) Root'un kendisi item array'ini içeriyor mu
  for (const itemKey of ITEM_CANDIDATES) {
    if (itemKey in root) {
      const v = root[itemKey];
      if (Array.isArray(v)) return v as Record<string, unknown>[];
      if (v && typeof v === 'object')
        return [v as Record<string, unknown>];
    }
  }

  // 2) Bilinen root wrapper içinde bilinen item
  const rootLcMap = lcMapOf(root);
  for (const rootKey of ROOT_CANDIDATES) {
    const real = rootLcMap[rootKey.toLowerCase()];
    if (!real) continue;
    const wrapper = root[real];
    if (!wrapper || typeof wrapper !== 'object') continue;
    const w = wrapper as Record<string, unknown>;
    const wMap = lcMapOf(w);
    for (const itemKey of ITEM_CANDIDATES) {
      const itReal = wMap[itemKey.toLowerCase()];
      if (!itReal) continue;
      const v = w[itReal];
      if (Array.isArray(v)) return v as Record<string, unknown>[];
      if (v && typeof v === 'object')
        return [v as Record<string, unknown>];
    }
  }

  // RSS / Atom: <rss><channel><item>...
  const rss = root.rss as Record<string, unknown> | undefined;
  if (rss?.channel) {
    const channel = rss.channel as Record<string, unknown>;
    const items = channel.item;
    if (Array.isArray(items)) return items as Record<string, unknown>[];
    if (items && typeof items === 'object')
      return [items as Record<string, unknown>];
  }

  // 3) Heuristic — DFS ile bilinen item tag veya en kalabalık array-of-objects'ı bul.
  // Bilinmeyen format için fallback (örn. <Magaza><Mal>..., <root><data><items><item>...).
  // Max derinlik 8 — pratik feed'lerde yeterli, runaway koruması.
  const ITEM_LC = new Set(ITEM_CANDIDATES.map((c) => c.toLowerCase()));
  const visit = (
    n: Record<string, unknown>,
    depth: number,
  ): Record<string, unknown>[] | null => {
    if (depth > 8) return null;

    // 3a) Bu seviyede bilinen item tag var mı (single object dahil)?
    for (const [k, v] of Object.entries(n)) {
      if (!ITEM_LC.has(k.toLowerCase())) continue;
      if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'object') {
        return v as Record<string, unknown>[];
      }
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        return [v as Record<string, unknown>];
      }
    }

    // 3b) En kalabalık array-of-objects bu seviyede.
    const local = findLargestItemArray(n);
    if (local && local.length >= 1) return local;

    // 3c) Recurse — child object'ler.
    let best: Record<string, unknown>[] | null = null;
    for (const v of Object.values(n)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const found = visit(v as Record<string, unknown>, depth + 1);
        if (found && (!best || found.length > best.length)) best = found;
      }
    }
    return best;
  };

  const found = visit(root, 0);
  return found ?? [];
}

// SKU + ad olası alan isimleri.
const SKU_KEYS = [
  'UrunKartiID',
  'urun_karti_id',
  'urunKartiID',
  'urun_ID',
  'urun_id',
  'urun_kodu',
  'urunkodu',
  'sku',
  'SKU',
  'productCode',
  'ProductCode',
  'product_code',
  'kod',
  'code',
  'Code',
  'stockCode',
  'stock_code',
  'id',
  'ID',
  'productId',
  'ProductId',
  'product_id',
  'mpn',
  'MPN',
  'barkodno',
  'barkod',
  'barcode',
  'Barcode',
  'BarkodNo',
] as const;

const NAME_KEYS = [
  'urun_adi',
  'urun_ad',
  'urunadi',
  'name',
  'Name',
  'productName',
  'ProductName',
  'product_name',
  'baslik',
  'Baslik',
  'title',
  'Title',
  'urun_ismi',
  'label',
  'Label',
  'product_label',
  'productLabel',
  // EWS tarzÄ±: <ModelName> ürün adı olarak kullanılıyor
  'ModelName',
  'model_name',
  'modelName',
  // Generic Türkçe kısa isimlendirmeler
  'ad',
  'Ad',
  'AD',
  // ebijuteri vb.: <adi> ürün adı olarak kullanılıyor
  'adi',
  'Adi',
  'ADI',
  'urunAdi',
  'UrunAdi',
  'isim',
  'İsim',
  'isimleri',
  'urunIsmi',
  'urunIsim',
] as const;

const BRAND_KEYS = [
  'marka',
  'Marka',
  'urun_marka',
  'urun_marka_ad',
  'brand',
  'Brand',
  'manufacturer',
  'Manufacturer',
  // Otomotiv tarzÄ±: <Manufacture> (yazım çeşidi)
  'Manufacture',
  'manufacture',
] as const;

const MODEL_KEYS = [
  'urun_model',
  'model',
  'Model',
  // EWS: <ModelNumber> model bilgisi
  'ModelNumber',
  'model_number',
  'modelNumber',
] as const;

const DESC_KEYS = [
  'urun_aciklama',
  'aciklama',
  'Aciklama',
  'description',
  'Description',
  'detay',
  'Detay',
  'detaylar',
  'details',
  'Details',
  'ozellikler',
  'urunaciklamasi',
  'urun_detay',
  'long_description',
  'urunOzellikleri',
  'urun_ozellikleri',
] as const;

const BARCODE_KEYS = [
  'urun_barkod',
  'barkod',
  'Barkod',
  'barcode',
  'Barcode',
  'barcod',
  'ean',
  'EAN',
  'gtin',
  'GTIN',
  'BARKOD',
  // Otomotiv tarzÄ±: <BarCode>
  'BarCode',
  'bar_code',
  // Petshop tarzı: <barkodno> hem stok kodu hem barkod olarak kullanılır;
  // externalCode'a düşmesi (PRODUCT_CODE_KEYS) ile çelişmez, barcode alanı
  // da aynı değerle doldurulur.
  'barkodno',
] as const;

const STOCK_KEYS = [
  'urun_stok',
  'stok',
  'Stok',
  // ebijuteri vb.: <miktar> stok adedi olarak kullanılıyor
  'miktar',
  'Miktar',
  'MIKTAR',
  'urun_miktar',
  'adet',
  'Adet',
  'quantity',
  'Quantity',
  'qty',
  'stockAmount',
  'stock_amount',
  'stockQty',
  'stock_qty',
  'stock',
  'Stock',
  // Otomotiv tarzÄ±: <UnitInStock>
  'UnitInStock',
  'unit_in_stock',
  'unitInStock',
] as const;

// Fiyat öncelikleri: bayi/özel fiyat varsa onu tercih et, sonra liste fiyatı.
// price2 (KDV hariç), price3 (KDV dahil) formatı bazı feed'lerde kullanılır;
// genelde price2 = bayi/iskontolu, price3 = liste — price2'yi tercih ediyoruz.
const PRICE_KEYS_PRIORITY = [
  'bayifiyat',
  'bayiFiyat',
  'BayiFiyat',
  // EWS / xmlbankasi: <xml_bayii_alis_fiyati> — açıkça "bayilik alış fiyatı".
  // En üstte tutuyoruz: liste fiyatı vs. bayi fiyatı varsa daima bayiyi tercih et.
  'xml_bayii_alis_fiyati',
  'bayii_alis_fiyati',
  'bayi_alis_fiyati',
  'alis_fiyati',
  'alisFiyati',
  'urun_fiyat_bayi_ozel',
  'urun_fiyat_bayi',
  'bayi_fiyati',
  'bayi_fiyat',
  'cost_price',
  'urun_fiyat',
  'fiyat',
  'Fiyat',
  'fiyati_1',
  'fiyati_2',
  'fiyat1',
  'fiyat2',
  'price1',
  'price2',
  'price3',
  'price4',
  'satis_fiyati',
  'price',
  'Price',
  'salePrice',
  'sale_price',
  'list_price',
] as const;

const CURRENCY_KEYS = [
  'urun_doviz',
  'doviz',
  'para_birimi',
  // Bazı feed'ler PascalCase <ParaBirimi> kullanıyor (snake_case
  // 'para_birimi' ile eşleşmez çünkü pickField alt çizgiyi normalize etmez).
  'ParaBirimi',
  'paraBirimi',
  'currency',
  'Currency',
  'currencyCode',
  'currencyAbbr',
  'currency_abbr',
  'currencyShortCode',
  // Bazı feed'ler systemCurrency / system_currency tag'i kullanıyor.
  'systemCurrency',
  'system_currency',
  // EWS / xmlbankasi: <CurrencyType> alanını para birimi için kullanıyor.
  'CurrencyType',
  'currency_type',
  'currencyType',
] as const;

// Tek görsel kandidatları (ana resim) — ürünün öne çıkan görseli.
const MAIN_IMAGE_KEYS = [
  'ana_resim',
  'anaResim',
  'main_image',
  'mainImage',
  'image',
  'Image',
  'resim',
  'Resim',
  'productImage',
  'ProductImage',
  'urun_resim',
  'urun_resmi',
  'photo',
  'foto',
  'thumbnail',
  // EWS: <ImageURL> ana görseli temsil ediyor
  'ImageURL',
  'image_url',
  'imageUrl',
  'imageURL',
  // Google Merchant / RSS feed'leri (entafix "MASTER XML" vb.): <image_link>.
  // Değeri tüm görselleri virgülle ayırıp tek alanda taşıyabilir — aşağıdaki
  // ana-görsel çıkarımı virgüle göre böler.
  'image_link',
  'imageLink',
] as const;

// Çoklu görsel için indeksli alan prefix'leri.
const IMAGE_SERIES_PREFIXES = [
  'ek_resimler',
  'ek_resim',
  'urun_resim',
  'image',
  'Image',
  'resim',
  'photo',
  'picture',
  'Picture',
  'foto',
  'gorsel',
] as const;

// İndeksli görsellerin sonuna eklenen suffix'ler. picture1Path, image1url gibi.
const IMAGE_SERIES_SUFFIXES = [
  '',
  'Path',
  'path',
  'URL',
  'Url',
  'url',
  'Src',
  'src',
] as const;

// Görseller bazı feed'lerde TEK bir parent tag altında gruplanır:
//   <Resimler><Resim1>url</Resim1><Resim2>url</Resim2></Resimler>   (softtr)
//   <Images><Image>url</Image><Image>url</Image></Images>
// fast-xml-parser bunu { Resimler: { Resim1, Resim2, ... } } / { Images: { Image: [...] } }
// yapar; URL'ler üst seviyede DEĞİL container'ın içindedir. pickIndexedSeries ve
// MAIN_IMAGE_KEYS yalnız üst seviyeye baktığı için bu yapı hiç görsel üretmez.
// Bu container tag'lerinin İÇİNDEKİ tüm URL değerlerini ayrıca toplarız.
const IMAGE_CONTAINER_KEYS = [
  // ebijuteri vb.: <resim><resim1>..</resim1><resim2>..</resim2></resim> (TEKİL container).
  // collectUrlsDeep string'i de güvenle işler → düz <resim>url</resim> bozulmaz.
  'resim',
  'Resim',
  'Resimler',
  'resimler',
  'resimleri',
  'urun_resimleri',
  'urunResimleri',
  'Gorseller',
  'gorseller',
  'gorselleri',
  'Images',
  'images',
  'Pictures',
  'pictures',
  'Photos',
  'photos',
  'Fotograflar',
  'fotograflar',
  'imageList',
  'image_list',
  'resim_listesi',
] as const;

// Bir container değeri (object/array) içindeki tüm http(s) URL'lerini sıralı toplar.
// İndeksli child'lar (Resim1, Resim2, ...) numaraya göre sıralanır; geri kalan
// her seviye DFS ile taranır. Attribute (@_) ve boş değerler atlanır.
function collectUrlsDeep(
  value: unknown,
  out: string[],
  seen: Set<string>,
  depth = 0,
): void {
  if (depth > 4 || value === undefined || value === null) return;
  if (typeof value === 'string') {
    const s = value.trim();
    if (s && URL_REGEX.test(s) && !seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectUrlsDeep(v, out, seen, depth + 1);
    return;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => !k.startsWith('@_'))
      .sort((a, b) => {
        const na = parseInt((a.match(/\d+/) ?? ['0'])[0], 10);
        const nb = parseInt((b.match(/\d+/) ?? ['0'])[0], 10);
        return na - nb;
      });
    for (const k of keys) collectUrlsDeep(obj[k], out, seen, depth + 1);
  }
}

@Injectable()
export class XmlParserService {
  private readonly logger = new Logger(XmlParserService.name);

  // Backward-compatible — yalnızca ürün listesi döndürür.
  parse(xml: string): ParsedProduct[] {
    return this.parseDetailed(xml).items;
  }

  // Drop classification + total candidates ile detaylı sonuç.
  // Ingest service bu API üzerinden ne kadar drop, hangi nedenle olduğunu
  // log'lar (telemetri). Future-proof: yeni drop kategorileri eklemek için
  // DropStats genişletilir, ingest tarafında ayrı sayaç olur.
  parseDetailed(xml: string): ParseResult {
    const dropped: DropStats = {
      missingSku: 0,
      missingName: 0,
      missingPrice: 0,
      invalidPriceFormat: 0,
      duplicateSkuInFeed: 0,
      malformed: 0,
    };
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      trimValues: true,
      parseTagValue: false,
      parseAttributeValue: false,
      // CDATA'yı text olarak yorumla — fast-xml-parser default davranışı.
    });
    // Parse hatasında sessizce boş dönmek (eski davranış) ingest pipeline'ına
    // "feed boş" sinyali gibi geçiyordu; downstream stale-deactivation tüm
    // katalogu pasifleştirebiliyordu (#H-Wipe). Artık parse hatası bilinçli
    // olarak yukarıya fırlıyor — ingest service feed'i fail-skip eder, mevcut
    // katalog dokunulmaz kalır.
    let doc: unknown;
    try {
      doc = parser.parse(xml);
    } catch (err) {
      const message = (err as Error).message;
      this.logger.error(`xml-parser: XML parse failed — ${message}`);
      throw new Error(`XML parse failed: ${message}`);
    }

    const items = findItemArray(doc);
    if (!items.length) {
      this.logger.warn(
        `xml-parser: hiç item bulunamadı — root anahtarları: ${Object.keys(
          (doc as Record<string, unknown>) ?? {},
        )
          .slice(0, 10)
          .join(',')}`,
      );
      return { items: [], dropped, totalCandidates: 0 };
    }

    const out: ParsedProduct[] = [];
    // externalCode → out[] içindeki indeks. Aynı externalCode tekrar gelirse
    // "ilk-kazanır" YERİNE stoğu yüksek olanı tutarız: bazı feed'ler aynı ürünü
    // hem 0-stoklu (ölü) hem dolu-stoklu (canlı) kopya olarak listeliyor; eski
    // mantık ölü kopyayı tutup ürünü haksız yere stoksuz gösteriyordu.
    const indexByCode = new Map<string, number>();
    for (const r of items) {
      try {
        const result = this.mapRecord(r);
        if (result.kind === 'ok') {
          const product = result.product;
          const existingIdx = indexByCode.get(product.externalCode);
          if (existingIdx !== undefined) {
            dropped.duplicateSkuInFeed++;
            // Daha yüksek stoklu kopya geldiyse mevcut kaydın yerine koy
            // (fiyat/isim/görsel de canlı kopyadan gelir). Eşitlikte ilk kalır.
            if (product.stock > out[existingIdx].stock) {
              out[existingIdx] = product;
            }
            continue;
          }
          indexByCode.set(product.externalCode, out.length);
          out.push(product);
        } else {
          // Drop reason'ı sayaca yaz.
          switch (result.reason) {
            case 'MISSING_SKU':
              dropped.missingSku++;
              break;
            case 'MISSING_NAME':
              dropped.missingName++;
              break;
            case 'MISSING_PRICE':
              dropped.missingPrice++;
              break;
            case 'INVALID_PRICE_FORMAT':
              dropped.invalidPriceFormat++;
              break;
          }
        }
      } catch (err) {
        dropped.malformed++;
        this.logger.warn(
          `skip malformed product: ${(err as Error).message}`,
        );
      }
    }

    const totalDropped =
      dropped.missingSku +
      dropped.missingName +
      dropped.missingPrice +
      dropped.invalidPriceFormat +
      dropped.duplicateSkuInFeed +
      dropped.malformed;
    if (totalDropped > 0) {
      this.logger.log(
        `xml-parser drops: total=${items.length} imported=${out.length} dropped=${totalDropped} ` +
          `[missingSku=${dropped.missingSku} missingName=${dropped.missingName} ` +
          `missingPrice=${dropped.missingPrice} invalidPriceFormat=${dropped.invalidPriceFormat} ` +
          `duplicateSkuInFeed=${dropped.duplicateSkuInFeed} malformed=${dropped.malformed}]`,
      );
    }

    return { items: out, dropped, totalCandidates: items.length };
  }

  // Adaptif mapping — drop reason ile birlikte sonuç döner.
  // SKU ve name zorunlu; price 0 ise drop edilir. Diğerleri opsiyonel.
  private mapRecord(
    r: Record<string, unknown>,
  ):
    | { kind: 'ok'; product: ParsedProduct }
    | {
        kind: 'drop';
        reason:
          | 'MISSING_SKU'
          | 'MISSING_NAME'
          | 'MISSING_PRICE'
          | 'INVALID_PRICE_FORMAT';
      } {
    const externalCode = asString(pickField(r, SKU_KEYS));
    const name = asString(pickField(r, NAME_KEYS));
    if (!externalCode) return { kind: 'drop', reason: 'MISSING_SKU' };
    if (!name) return { kind: 'drop', reason: 'MISSING_NAME' };

    const brand = asString(pickField(r, BRAND_KEYS));
    const model = asString(pickField(r, MODEL_KEYS));
    const description = asString(pickField(r, DESC_KEYS));
    const barcode = asString(pickField(r, BARCODE_KEYS));
    const stock = toInt(pickField(r, STOCK_KEYS));

    // Fiyat öncelik sırası: bayi özel > bayi > liste. İç içe <fiyat> container'ı
    // (ebijuteri vb.) skalar çocukları üst seviyeye taşınarak desteklenir.
    const priceRec = liftPriceContainers(r);
    let costPrice = 0;
    let priceFieldFound = false;
    let priceParseFailed = false;
    for (const key of PRICE_KEYS_PRIORITY) {
      const raw = pickField(priceRec, [key]);
      // Container'ın kendisi (obje) yanlışlıkla eşleşirse atla — skaler bekleriz.
      if (
        raw !== undefined &&
        raw !== null &&
        raw !== '' &&
        typeof raw !== 'object'
      ) {
        priceFieldFound = true;
        const n = toNumber(raw, NaN);
        if (Number.isFinite(n) && n > 0) {
          costPrice = n;
          break;
        }
        priceParseFailed = true;
      }
    }
    if (costPrice === 0) {
      // Fiyat alanı vardı ama parse edilemedi → format hatası.
      // Hiçbir fiyat alanı yoksa missing kabul et.
      if (priceFieldFound && priceParseFailed) {
        return { kind: 'drop', reason: 'INVALID_PRICE_FORMAT' };
      }
      return { kind: 'drop', reason: 'MISSING_PRICE' };
    }

    // XML'de para birimi alanı VARSA normalize edilir (TL→TRY); YOKSA boş bırakılır
    // ki feed-seviyesi (feedCurrency) fallback'i devreye girebilsin. "Boş = TRY"
    // varsayımı normalizeCost/storedCurrency tarafında p.currency || feedCurrency
    // önceliğiyle çözülür.
    const currencyRaw = asString(pickField(priceRec, CURRENCY_KEYS));
    const currency = currencyRaw ? normalizeCurrency(currencyRaw) : '';
    const taxRate = pickTaxRate(r);
    const categoryPath = pickCategoryPath(r);

    // Görseller: önce ana resim, sonra ek seriler.
    const images: ParsedImage[] = [];
    const seen = new Set<string>();
    // Ana görsel alanı. Google Merchant / RSS feed'leri (entafix vb.) TÜM
    // görselleri tek alanda virgülle ayırıp verebilir (image_link="url1,url2,...").
    // Klasik tek-URL'li feed'lerde comma yoktur → tek eleman kalır (regresyon yok).
    // Her parça URL_REGEX ile doğrulanır; bozuk/boş parçalar sessizce atlanır.
    const main = asString(pickField(r, MAIN_IMAGE_KEYS));
    if (main) {
      for (const part of main.split(',')) {
        const u = part.trim();
        if (u && URL_REGEX.test(u) && !seen.has(u)) {
          seen.add(u);
          images.push({ url: u, position: images.length });
        }
      }
    }

    const series = pickIndexedSeries(
      r,
      IMAGE_SERIES_PREFIXES,
      25,
      IMAGE_SERIES_SUFFIXES,
    );
    for (const url of series) {
      if (seen.has(url)) continue;
      seen.add(url);
      images.push({ url, position: images.length });
    }

    // Nested container'lar (ör. <Resimler><Resim1>...). Üst seviyede indeks
    // alanı olmadığı için yukarıdaki adımlar yakalayamaz; container içini tara.
    const lc = lcMapOf(r);
    for (const ck of IMAGE_CONTAINER_KEYS) {
      const real = lc[ck.toLowerCase()];
      if (!real) continue;
      const containerUrls: string[] = [];
      collectUrlsDeep(r[real], containerUrls, seen, 0);
      for (const url of containerUrls) {
        images.push({ url, position: images.length });
      }
    }

    // http → https yükseltme. Platform https; http görseller tarayıcıda
    // mixed-content olarak engellenir VEYA showcase allowlist'i (https-only)
    // tarafından elenir. Host https desteklemiyorsa görsel http'de de
    // gösterilemezdi → regresyon yok, yalnız iyileşme. Upgrade sonrası tekrar
    // dedup et (aynı path'in http+https hâli çakışabilir) ve pozisyonu yenile.
    const finalImages: ParsedImage[] = [];
    const seenFinal = new Set<string>();
    for (const img of images) {
      const url = img.url.startsWith('http://')
        ? `https://${img.url.slice('http://'.length)}`
        : img.url;
      if (seenFinal.has(url)) continue;
      seenFinal.add(url);
      finalImages.push({ url, position: finalImages.length });
    }

    // Görsel hiç yoksa finalImages[] boş kalır — IngestService bunu null kabul eder.

    return {
      kind: 'ok',
      product: {
        externalCode,
        name,
        brand,
        model,
        description,
        barcode,
        costPrice,
        currency,
        stock,
        taxRate,
        categoryPath,
        images: finalImages,
      },
    };
  }
}

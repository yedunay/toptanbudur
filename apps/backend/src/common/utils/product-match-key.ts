/**
 * Çapraz-tedarikçi ürün eşleştirme anahtarı (Vitrin/Satın-Alma ayrımı).
 *
 * computeNameKey (name-key.ts) BİLİNÇLİ olarak çok katıdır ("tek harf farkı
 * bile = farklı ürün") ve TÜM katalog dedup'ında kullanılır — onu gevşetmek
 * 60K üründe yan etki yapar. Bu util, SADECE çapraz-tedarikçi eşleştirme
 * katmanı (ProductMatchGroup) için daha akıllı, ama yine GÜVENLİ bir anahtar
 * üretir:
 *
 *  - Barkod: bazı tedarikçiler barkoda sabit bir önek ekler (ör. XXXXX+EAN13),
 *    bazıları ham EAN13 verir → son 13 hane (çekirdek GTIN) bire bir eşleşir.
 *  - İsim: İphone/iPhone (p) ve Türkçe İ/ı farkları normalize edilir.
 *  - Model imzası: numara + (pro max / pro / plus / ultra / mini / max / se /
 *    fe / lite / air) ANAHTARA gömülür. Böylece AYNI barkod ama FARKLI model
 *    (ör. Smart 9 ↔ Hot 50i, Tab A9 ↔ A11, 13 Pro ↔ 13 Pro Max) farklı anahtar
 *    üretir ve ASLA birleşmez.
 *
 * NOT: Tedarikçiye özel marka öneki temizliği burada YAPILMAZ; bu iş
 * tedarikçi-bazlı SupplierTextRule (admin → Tedarikçi → Metin Kuralları)
 * sistemine aittir.
 */

const TR_FOLD: Record<string, string> = {
  İ: 'i',
  I: 'i',
  ı: 'i',
  Ş: 's',
  ş: 's',
  Ğ: 'g',
  ğ: 'g',
  Ü: 'u',
  ü: 'u',
  Ö: 'o',
  ö: 'o',
  Ç: 'c',
  ç: 'c',
};

/** Türkçe özel harfleri ASCII'ye katlar (toLowerCase'in TR tuhaflıklarından kaçınmak için ÖNCE çağrılır). */
function trFold(s: string): string {
  return s.replace(/[İIıŞşĞğÜüÖöÇç]/g, (c) => TR_FOLD[c] ?? c);
}

/**
 * Barkodun çekirdek EAN'ı: yalnız rakamlar, ≥13 ise son 13 hane.
 * "ARB068683140692650" → "8683140692650"; "8683140692650" → "8683140692650".
 */
export function eanCore(barcode: string | null | undefined): string {
  const digits = (barcode ?? '').replace(/\D/g, '');
  return digits.length >= 13 ? digits.slice(-13) : digits;
}

/**
 * Eşleştirme için normalize edilmiş isim: TR-fold → lowercase → harf/rakam
 * dışını boşluğa indir → boşlukları tekille.
 */
export function normName(name: string | null | undefined): string {
  const s = trFold(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9+]+/g, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

const MODEL_QUALIFIERS = [
  'pro max',
  'pro',
  'plus',
  'ultra',
  'mini',
  'max',
  'se',
  'fe',
  'lite',
  'air',
] as const;

/**
 * Model imzası: (sıralı sayılar)#(sıralı niteleyiciler). "pro max" varsa "pro"
 * ve "max" düşülür (çift sayılmasın). normName çıktısı üzerinde çalışır.
 */
export function signature(normalizedName: string): string {
  const nums = (normalizedName.match(/\d+/g) ?? []).slice().sort();
  const quals = new Set<string>();
  for (const q of MODEL_QUALIFIERS) {
    const re = new RegExp(`\\b${q.replace(/ /g, '\\s')}\\b`);
    if (re.test(normalizedName)) quals.add(q);
  }
  if (quals.has('pro max')) {
    quals.delete('pro');
    quals.delete('max');
  }
  const qsorted = [...quals].sort();
  return `${nums.join(',')}#${qsorted.join(',')}`;
}

export type MatchKeyKind = 'ean' | 'name';

export interface MatchKeyResult {
  /** Gruplama anahtarı. Aynı anahtar = aynı ürün adayı. */
  key: string;
  /** 'ean' = barkod köprülü (güçlü), 'name' = barkodsuz isim tabanlı. */
  kind: MatchKeyKind;
  /** Çekirdek EAN (kind='name' ise boş). */
  ean: string;
  /** Normalize isim. */
  norm: string;
  /** Model imzası. */
  sig: string;
}

/**
 * Bir ürünün eşleştirme anahtarını üretir.
 *  - Barkod ≥8 haneli ise: "${eanCore}|${signature}" (model imzası gömülü).
 *  - Aksi halde: "name:${normName}".
 */
export function matchKey(
  barcode: string | null | undefined,
  name: string | null | undefined,
): MatchKeyResult {
  const ean = eanCore(barcode);
  const norm = normName(name);
  const sig = signature(norm);
  if (ean.length >= 8) {
    return { key: `${ean}|${sig}`, kind: 'ean', ean, norm, sig };
  }
  return { key: `name:${norm}`, kind: 'name', ean: '', norm, sig };
}

export type MatchConfidence =
  | 'high'
  | 'medium_ean'
  | 'medium_name'
  | 'low_fuzzy';

/**
 * Bir grubun güven seviyesi:
 *  - EAN anahtarı + tüm üyelerin normalize ismi de eşit → 'high'
 *  - EAN anahtarı ama isimler farklı → 'medium_ean'
 *  - İsim anahtarı (barkodsuz) → 'medium_name'
 */
export function groupConfidence(
  members: ReadonlyArray<{ barcode: string | null; name: string }>,
): MatchConfidence {
  if (members.length === 0) return 'medium_name';
  const keys = members.map((m) => matchKey(m.barcode, m.name));
  const isEan = keys.every((k) => k.kind === 'ean');
  if (!isEan) return 'medium_name';
  const norms = new Set(keys.map((k) => k.norm));
  return norms.size === 1 ? 'high' : 'medium_ean';
}

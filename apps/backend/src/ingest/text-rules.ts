/**
 * text-rules.ts
 *
 * Pure functions — no DB access, no side effects.
 *
 * Tedarikçi bazlı metin kuralları (SupplierTextRule) ürün adı ve/veya
 * açıklamasına uygulanan literal (regex DEĞİL) SİL/DEĞİŞTİR dönüşümleridir.
 * Hem ingest (yeni ürünler) hem recompute (mevcut ürünler) aynı fonksiyonu
 * çağırır → mağaza + çıkış XML tek kaynaktan deterministik temizlenir.
 *
 * Eşleşme: düz metin + opsiyonel `caseInsensitive` ve `wholeWord` (\b...\b).
 * search literal alındığı için regex meta-karakterleri escape edilir.
 */

export interface TextRule {
  search: string;
  replacement: string;
  applyToName: boolean;
  applyToDescription: boolean;
  caseInsensitive: boolean;
  wholeWord: boolean;
  enabled: boolean;
  sortOrder: number;
}

/**
 * Regex meta-karakterlerini escape eder — `search` literal düz metin olarak
 * ele alınır (regex desteği yok, kullanıcı kararı).
 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Verilen metne, ilgili alana (name | description) uygulanabilir, etkin
 * kuralları `sortOrder` sırasıyla zincirleme uygular.
 *
 * Hiç uygulanabilir kural yoksa metin OLDUĞU GİBİ döner (gerçek no-op) —
 * kuralsız tedarikçilerin açıklama formatı korunur. Aksi halde sonuçta
 * oluşan çift boşluklar sıkıştırılır ve baş/son boşluk kırpılır.
 *
 * Not: Boş `name` koruması burada DEĞİL, çağıran tarafta yapılır
 * (bkz. ingest.service / recompute) çünkü "boş sonuç" yalnız `name` için hatalıdır.
 */
export function applyTextRules(
  text: string,
  rules: TextRule[],
  field: 'name' | 'description',
): string {
  const sorted = rules
    .filter(
      (r) =>
        r.enabled &&
        Boolean(r.search) &&
        (field === 'name' ? r.applyToName : r.applyToDescription),
    )
    .sort((a, b) => a.sortOrder - b.sortOrder);

  // Uygulanabilir kural yoksa metni hiç dokunmadan döndür (no-op).
  if (sorted.length === 0) return text;

  let out = text;
  for (const r of sorted) {
    let pattern = escapeRegExp(r.search);
    if (r.wholeWord) pattern = `\\b${pattern}\\b`;
    const flags = 'g' + (r.caseInsensitive ? 'i' : '');
    out = out.replace(new RegExp(pattern, flags), r.replacement);
  }

  // Kaldırılan ifadelerin bıraktığı çift boşlukları sıkıştır + trim.
  out = out.replace(/[ \t]{2,}/g, ' ').trim();
  return out;
}

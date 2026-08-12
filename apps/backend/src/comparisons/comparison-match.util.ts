/**
 * Eşleştirme motoru — SAF fonksiyonlar (DB'siz, test edilebilir).
 * Python rakip-analizi motorunun kanıtlı sezgileri buraya taşındı:
 *  - Barkod (EAN) önce: tedarikçi ön-eki temizlenip \d{12,14} çekirdeği bulunur.
 *  - Sonra İSİM: marka öneki (cleanupWords) atılır → birebir isim = OTO.
 *  - Fuzzy (token/Jaccard, ≥2 anlamlı ortak kelime, 2.5x fiyat kapısı) → BEKLEYEN.
 * Kullanıcı kuralı: yalnız barkod + %100 birebir isim OTO; gerisi elle onay.
 */

const TR: Record<string, string> = {
  ı: 'i', İ: 'i', ş: 's', Ş: 's', ğ: 'g', Ğ: 'g',
  ü: 'u', Ü: 'u', ö: 'o', Ö: 'o', ç: 'c', Ç: 'c',
};
const trFold = (s: string): string => s.replace(/[ıİşŞğĞüÜöÖçÇ]/g, (c) => TR[c] ?? c);

/** TR-normalize + küçük harf + alfanümerik-dışını boşluğa. ®'den sonrasını alır. */
export function fold(s: string | null | undefined): string {
  let x = s ?? '';
  if (x.includes('®')) x = x.split('®').pop() ?? '';
  return trFold(x)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** İlk 12-14 haneli rakam dizisi (en uzunu) — tedarikçi ön-ekli barkodları kurtarır. */
export function eanOf(...vals: (string | null | undefined)[]): string | null {
  for (const v of vals) {
    if (!v) continue;
    const runs = String(v).match(/\d{12,14}/g);
    if (runs && runs.length) return runs.reduce((a, b) => (b.length > a.length ? b : a));
  }
  return null;
}

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Rakip adından cleanupWords (önek/kelime) temizler; kaç kelime silindiğini de döner. */
export function stripCleanup(name: string, words: string[] | null | undefined): { cleaned: string; hit: boolean } {
  let x = name ?? '';
  let hit = false;
  for (const w of words ?? []) {
    if (!w) continue;
    const re = new RegExp(esc(w), 'gi');
    if (re.test(x)) hit = true;
    x = x.replace(re, ' ');
  }
  x = x.replace(/\s+/g, ' ').trim();
  return { cleaned: x, hit };
}

const tokens = (folded: string): Set<string> => new Set(folded.split(' ').filter(Boolean));

export interface OurProduct {
  id: string;
  name: string;
  barcode: string | null;
  gross: number; // KDV dahil satış (kıyas için)
  stock: number;
}

export interface OurIndex {
  eanIdx: Map<string, string[]>; // ean -> [productId]
  nameExact: Map<string, string[]>; // folded name -> [productId]
  inv: Map<string, string[]>; // token(len>=3) -> [rowIdx]
  rows: { id: string; toks: Set<string>; gross: number; stock: number }[];
  byId: Map<string, { id: string; toks: Set<string>; gross: number; stock: number }>;
}

/** Bizim aktif ürünlerden eşleştirme indeksi kurar (RAM'de; ~100K ürün sorun değil). */
export function buildIndex(products: OurProduct[]): OurIndex {
  const eanIdx = new Map<string, string[]>();
  const nameExact = new Map<string, string[]>();
  const inv = new Map<string, string[]>();
  const rows: OurIndex['rows'] = [];
  const byId = new Map<string, OurIndex['rows'][number]>();
  products.forEach((p, i) => {
    const fn = fold(p.name);
    const toks = tokens(fn);
    const row = { id: p.id, toks, gross: p.gross, stock: p.stock };
    rows.push(row);
    byId.set(p.id, row);
    const e = eanOf(p.barcode);
    if (e) (eanIdx.get(e) ?? eanIdx.set(e, []).get(e)!).push(p.id);
    if (fn) (nameExact.get(fn) ?? nameExact.set(fn, []).get(fn)!).push(p.id);
    for (const t of toks) if (t.length >= 3) (inv.get(t) ?? inv.set(t, []).get(t)!).push(String(i));
  });
  return { eanIdx, nameExact, inv, rows, byId };
}

const bestByPrice = (ids: string[], idx: OurIndex): string => {
  const cand = ids.map((id) => idx.byId.get(id)!).filter(Boolean);
  const inStock = cand.filter((c) => c.stock > 0);
  const pool = inStock.length ? inStock : cand;
  return pool.reduce((a, b) => (b.gross < a.gross ? b : a)).id;
};

export interface MatchInput {
  name: string;
  barcode: string | null;
  externalCode: string | null;
  cleanupWords: string[] | null;
}
export interface MatchOut {
  productId: string;
  status: 'auto' | 'pending';
  confidence: number;
  matchedBy: 'ean' | 'name' | 'prefix';
}

/** Bir rakip ürünü bizimkilerle eşler. null = bizde yok (eşleşme bulunamadı). */
export function matchOne(c: MatchInput, idx: OurIndex): MatchOut | null {
  // 1) BARKOD → OTO (kesin)
  const e = eanOf(c.barcode, c.externalCode);
  if (e && idx.eanIdx.has(e)) {
    return { productId: bestByPrice(idx.eanIdx.get(e)!, idx), status: 'auto', confidence: 100, matchedBy: 'ean' };
  }
  // 2) İSİM birebir (cleanupWords sonrası) → OTO
  const { cleaned, hit } = stripCleanup(c.name, c.cleanupWords);
  const fn = fold(cleaned);
  if (fn && idx.nameExact.has(fn)) {
    return { productId: bestByPrice(idx.nameExact.get(fn)!, idx), status: 'auto', confidence: 99, matchedBy: hit ? 'prefix' : 'name' };
  }
  // 3) İSİM (CONTAINMENT) → BEKLEYEN (elle onay). Kullanıcı kuralı:
  //    - Önek/sonek eklentileri (ör. "TC …"), büyük/küçük harf, boşluk sayısı TOLERE.
  //    - ÇEKİRDEK isim aynı olmalı: küçük tarafın anlamlı (len>=3) kelimelerinin
  //      TAMAMI büyük tarafta geçmeli (subset). Tek ortak kelimeyle EŞLEŞME YOK.
  //    - Güven = Dice yüzdesi (aynı çekirdek → %100; ne kadar fazla ek kelime, o kadar düşük).
  const ct = tokens(fn);
  const csig = new Set([...ct].filter((t) => t.length >= 3));
  if (csig.size < 2) return null; // rakip adı en az 2 anlamlı kelime
  const sig = [...csig]
    .filter((t) => (idx.inv.get(t)?.length ?? 0) > 0)
    .sort((a, b) => (idx.inv.get(a)!.length) - (idx.inv.get(b)!.length));
  if (!sig.length) return null;
  const pool = new Set<string>();
  for (const t of sig.slice(0, 3)) for (const ri of idx.inv.get(t) ?? []) pool.add(ri);
  const cDigits = new Set([...ct].filter((t) => /\d/.test(t))); // sayı içeren kelimeler (model/ölçü)
  let best: { id: string; conf: number; gross: number } | null = null;
  for (const ri of pool) {
    const r = idx.rows[Number(ri)];
    const psig = new Set([...r.toks].filter((t) => t.length >= 3));
    if (psig.size < 2) continue; // bizim ad da en az 2 anlamlı kelime
    const cSmaller = csig.size <= psig.size;
    const small = cSmaller ? csig : psig;
    const large = cSmaller ? psig : csig;
    if (small.size < 2) continue;
    if (!subset(small, large)) continue; // ÇEKİRDEK içerme şartı
    // Sayı tutarlılığı: İKİSİNDE de sayı varsa (ör. "model 2" vs "model 3",
    // "3x2.5" vs "3x1.5"), küçük küme diğerinde geçmeli. Tek tarafta sayı =
    // adet/ölçü öneki (ör. "2 Adet X" vs "X") → tolere edilir.
    const rDigits = new Set([...r.toks].filter((t) => /\d/.test(t)));
    if (cDigits.size && rDigits.size) {
      const [ds, dl] = cDigits.size <= rDigits.size ? [cDigits, rDigits] : [rDigits, cDigits];
      if (!subset(ds, dl)) continue;
    }
    const conf = Math.round((2 * small.size) / (csig.size + psig.size) * 100); // Dice (içerme → ortak = small)
    if (!best || conf > best.conf || (conf === best.conf && r.gross < best.gross)) best = { id: r.id, conf, gross: r.gross };
  }
  if (best) return { productId: best.id, status: 'pending', confidence: best.conf, matchedBy: 'name' };
  return null;
}

const subset = (a: Set<string>, b: Set<string>): boolean => {
  for (const x of a) if (!b.has(x)) return false;
  return true;
};

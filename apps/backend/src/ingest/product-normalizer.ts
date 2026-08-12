/**
 * product-normalizer.ts
 *
 * Pure functions — no DB access, no side effects.
 * Applied once per product (create path in ingest, or bootstrap on startup).
 * After normalization the product is flagged (contentNormalizedAt) and these
 * fields are frozen forever: name, model, description, barcode, publicBarcode,
 * internalCode.
 *
 * Two rules:
 *  1. ALL-CAPS name → Turkish Title Case
 *  2. "ÜRÜNLER ADET FİYATIDIR." dedup + sentence-case (only when present)
 */

// ─── Turkish character maps ───────────────────────────────────────────────────

const TR_LOWER: Readonly<Record<string, string>> = {
  I: 'ı',
  İ: 'i',
  Ş: 'ş',
  Ğ: 'ğ',
  Ç: 'ç',
  Ö: 'ö',
  Ü: 'ü',
};

const TR_UPPER: Readonly<Record<string, string>> = {
  i: 'İ',
  ı: 'I',
  ş: 'Ş',
  ğ: 'Ğ',
  ç: 'Ç',
  ö: 'Ö',
  ü: 'Ü',
};

function trLower(ch: string): string {
  return TR_LOWER[ch] ?? ch.toLowerCase();
}

function trUpper(ch: string): string {
  return TR_UPPER[ch] ?? ch.toUpperCase();
}

// ─── Rule 1: ALL-CAPS name → Title Case ──────────────────────────────────────

/**
 * Returns true when every letter in `str` is uppercase (Turkish-aware).
 * Strings with no letters return false.
 */
function isAllCaps(str: string): boolean {
  if (!/[a-zA-ZşğçöüıiŞĞÇÖÜİI]/.test(str)) return false;
  return !/[a-zşğçöüiı]/.test(str);
}

/**
 * Converts an ALL-CAPS product name to Turkish Title Case.
 * Tokens that contain a digit (e.g. "128GB", "5G", "A25") are kept as-is
 * because they are technical specs, not plain words.
 *
 * Tedarikçiye özel istenmeyen kelime/kod temizliği burada YAPILMAZ; bu iş
 * tedarikçi-bazlı SupplierTextRule (admin → Tedarikçi → Metin Kuralları)
 * sistemine aittir.
 */
export function normalizeProductName(name: string): string {
  if (!isAllCaps(name)) return name;

  return name
    .split(/(\s+)/)
    .map((token) => {
      if (/^\s+$/.test(token)) return token;
      if (/\d/.test(token)) return token; // technical token — keep original
      const lower = Array.from(token).map(trLower).join('');
      if (!lower) return lower;
      return trUpper(lower[0]) + lower.slice(1);
    })
    .join('');
}

// ─── Rule 2: "ÜRÜNLER ADET FİYATIDIR." dedup ─────────────────────────────────

const ADET_RAW = 'ÜRÜNLER ADET FİYATIDIR.';
const ADET_NORMALISED = 'Ürünler adet fiyatıdır.';
// Escaped for use in RegExp
const ADET_RE = new RegExp(ADET_RAW.replace(/\./g, '\\.'), 'g');

/**
 * If `desc` contains ADET_RAW one or more times:
 *  - replaces the first occurrence with ADET_NORMALISED
 *  - removes all subsequent occurrences
 *  - collapses triple+ newlines that result from the removals
 * Returns `desc` unchanged when the phrase is absent.
 */
function normaliseAdetPhrase(desc: string): string {
  if (!desc.includes(ADET_RAW)) return desc;

  let firstReplaced = false;
  let result = desc.replace(ADET_RE, () => {
    if (!firstReplaced) {
      firstReplaced = true;
      return ADET_NORMALISED;
    }
    return '';
  });

  result = result.replace(/\n{3,}/g, '\n\n').trim();
  return result;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Normalizes a product name.
 * Safe to call on already-normalized names (returns input unchanged).
 */
export { normalizeProductName as normalizeProductNameExport };

/**
 * Normalizes a product description:
 *  1. ÜRÜNLER ADET FİYATIDIR. dedup (only if present)
 */
export function normalizeProductDescription(desc: string | null): string | null {
  if (!desc) return null;
  return normaliseAdetPhrase(desc);
}

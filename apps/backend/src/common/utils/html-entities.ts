/**
 * Minimal HTML entity decoder — özellikle XML feed'inden gelen ürün açıklamaları
 * için. Üçüncü parti `he` veya `html-entities` paketine ihtiyaç duymaz.
 *
 * Kapsam:
 *   - Yaygın named entity'ler (&amp; &lt; &gt; &quot; &apos; &#39; &nbsp;)
 *   - Türkçe karakter named entity'leri (&Ouml; &uuml; &Ccedil; &ccedil;
 *     &#350; → Ş, &#351; → ş, &#286; → Ğ, &#287; → ğ, &#304; → İ, &#305; → ı)
 *   - Numeric decimal entity'ler  (&#NNN;)
 *   - Numeric hex entity'ler       (&#xHH; / &#XHH;)
 *
 * `decodeHtmlEntities("&Ouml;ld&uuml;r&uuml;c&uuml;")` → `"Öldürücü"`.
 * Girdi `null`/`undefined`/string olmayan değerler değiştirilmeden döner.
 */

const NAMED_ENTITY_MAP: Record<string, string> = {
  // Yaygın
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  copy: '©',
  reg: '®',
  trade: '™',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  laquo: '«',
  raquo: '»',
  ldquo: '“',
  rdquo: '”',
  lsquo: '‘',
  rsquo: '’',
  bull: '•',

  // Avrupa aksanlı (TR ekosisteminde feed'lerde görülür)
  Auml: 'Ä',
  auml: 'ä',
  Aacute: 'Á',
  aacute: 'á',
  Eacute: 'É',
  eacute: 'é',
  Iacute: 'Í',
  iacute: 'í',
  Oacute: 'Ó',
  oacute: 'ó',
  Uacute: 'Ú',
  uacute: 'ú',
  Agrave: 'À',
  agrave: 'à',
  Egrave: 'È',
  egrave: 'è',
  Igrave: 'Ì',
  igrave: 'ì',
  Ograve: 'Ò',
  ograve: 'ò',
  Ugrave: 'Ù',
  ugrave: 'ù',
  Acirc: 'Â',
  acirc: 'â',
  Ecirc: 'Ê',
  ecirc: 'ê',
  Icirc: 'Î',
  icirc: 'î',
  Ocirc: 'Ô',
  ocirc: 'ô',
  Ucirc: 'Û',
  ucirc: 'û',
  Atilde: 'Ã',
  atilde: 'ã',
  Ntilde: 'Ñ',
  ntilde: 'ñ',
  Otilde: 'Õ',
  otilde: 'õ',
  szlig: 'ß',

  // Türkçe için kritik glyph'ler — bazı sistemler özel entity adları kullanır
  Ouml: 'Ö',  // Ö
  ouml: 'ö',  // ö
  Uuml: 'Ü',  // Ü
  uuml: 'ü',  // ü
  Ccedil: 'Ç', // Ç
  ccedil: 'ç', // ç
};

/**
 * Tek bir entity referansını decode eder. `&amp;` → `&`, `&#214;` → `Ö`,
 * `&#xD6;` → `Ö`. Çözemediği entity'leri olduğu gibi döner (bilgi kaybı yok).
 */
function decodeOne(entity: string): string {
  // Numeric: &#xNN; veya &#NN;
  if (entity.startsWith('&#') && entity.endsWith(';')) {
    const inner = entity.slice(2, -1);
    let codePoint: number | null = null;
    if (inner.length > 0) {
      if (inner[0] === 'x' || inner[0] === 'X') {
        const n = parseInt(inner.slice(1), 16);
        if (Number.isFinite(n)) codePoint = n;
      } else {
        const n = parseInt(inner, 10);
        if (Number.isFinite(n)) codePoint = n;
      }
    }
    if (codePoint != null && codePoint >= 0 && codePoint <= 0x10ffff) {
      try {
        return String.fromCodePoint(codePoint);
      } catch {
        return entity;
      }
    }
    return entity;
  }

  // Named: &name;
  if (entity.startsWith('&') && entity.endsWith(';')) {
    const name = entity.slice(1, -1);
    const mapped = NAMED_ENTITY_MAP[name];
    if (mapped !== undefined) return mapped;
  }
  return entity;
}

/**
 * Bir string içindeki tüm `&...;` entity'lerini decode eder. Hex/decimal
 * numeric ve yaygın+TR named entity'leri kapsar. Tanınmayan entity'ler
 * korunur (idempotent — iki kez çağrılması güvenli).
 */
export function decodeHtmlEntities<T extends string | null | undefined>(
  input: T,
): T {
  if (input == null) return input;
  if (typeof input !== 'string') return input;
  // Hızlı çıkış: hiç '&' yoksa entity bulunamaz.
  if (input.indexOf('&') < 0) return input as T;
  // `&` ile başlayıp `;` ile biten en uzun olası entity:
  // - numeric: &#x[0-9a-fA-F]+; veya &#[0-9]+;
  // - named:   &[a-zA-Z][a-zA-Z0-9]+;  (en fazla ~10 char)
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]{1,10});/g, (m) =>
    decodeOne(m),
  ) as T;
}

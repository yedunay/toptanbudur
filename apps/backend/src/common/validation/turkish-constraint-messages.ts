/**
 * class-validator constraint key → Türkçe mesaj template eşlemesi.
 *
 * Her template fonksiyonu, label (Türkçe alan adı) ve constraints
 * (decorator argümanları, ör. `MinLength(8)` için `[8]`) alır ve
 * son kullanıcıya gösterilecek tek satırlık Türkçe mesaj üretir.
 *
 * Buradaki anahtarlar class-validator tarafından çalışma zamanında
 * üretilen `constraint` adlarıyla birebir eşleşir.
 */
export type ConstraintMessageBuilder = (
  label: string,
  constraints: readonly unknown[] | undefined,
  isEach: boolean,
) => string;

const formatList = (values: readonly unknown[] | undefined): string => {
  if (!values || values.length === 0) return '';
  return values
    .map((v) => {
      if (v === null || v === undefined) return '';
      if (Array.isArray(v)) return v.join(', ');
      if (typeof v === 'object') {
        try {
          return Object.values(v as Record<string, unknown>).join(', ');
        } catch {
          return String(v);
        }
      }
      return String(v);
    })
    .filter((s) => s.length > 0)
    .join(', ');
};

const each = (label: string, isEach: boolean): string =>
  isEach ? `${label} alanındaki her bir öğe` : label;

const TEMPLATES: Readonly<Record<string, ConstraintMessageBuilder>> = {
  // Genel
  isDefined: (l, _c, e) => `${each(l, e)} belirtilmelidir`,
  isNotEmpty: (l, _c, e) => `${each(l, e)} boş olamaz`,
  isEmpty: (l, _c, e) => `${each(l, e)} boş olmalıdır`,
  isOptional: (l, _c, e) => `${each(l, e)} geçersiz`,

  // Tipler
  isString: (l, _c, e) => `${each(l, e)} metin olmalıdır`,
  isNumber: (l, _c, e) => `${each(l, e)} sayı olmalıdır`,
  isInt: (l, _c, e) => `${each(l, e)} tam sayı olmalıdır`,
  isDecimal: (l, _c, e) => `${each(l, e)} ondalıklı sayı olmalıdır`,
  isNumberString: (l, _c, e) => `${each(l, e)} sayı biçiminde olmalıdır`,
  isBoolean: (l, _c, e) => `${each(l, e)} doğru/yanlış olmalıdır`,
  isBooleanString: (l, _c, e) => `${each(l, e)} doğru/yanlış olmalıdır`,
  isObject: (l, _c, e) => `${each(l, e)} nesne olmalıdır`,
  isArray: (l, _c, e) => `${each(l, e)} dizi olmalıdır`,
  isDate: (l, _c, e) => `${each(l, e)} geçerli bir tarih olmalıdır`,
  isDateString: (l, _c, e) => `${each(l, e)} geçerli bir tarih olmalıdır`,
  isEnum: (l, c, e) => {
    const list = formatList(c);
    return list
      ? `${each(l, e)} şunlardan biri olmalıdır: ${list}`
      : `${each(l, e)} geçersiz değer`;
  },

  // Sayısal sınırlar
  min: (l, c, e) => `${each(l, e)} en az ${String(c?.[0] ?? '')} olmalıdır`,
  max: (l, c, e) => `${each(l, e)} en fazla ${String(c?.[0] ?? '')} olmalıdır`,
  isPositive: (l, _c, e) => `${each(l, e)} pozitif olmalıdır`,
  isNegative: (l, _c, e) => `${each(l, e)} negatif olmalıdır`,
  isDivisibleBy: (l, c, e) =>
    `${each(l, e)} ${String(c?.[0] ?? '')} sayısına tam bölünebilmelidir`,

  // Uzunluk
  minLength: (l, c, e) =>
    `${each(l, e)} en az ${String(c?.[0] ?? '')} karakter olmalıdır`,
  maxLength: (l, c, e) =>
    `${each(l, e)} en fazla ${String(c?.[0] ?? '')} karakter olmalıdır`,
  length: (l, c, e) => {
    const min = c?.[0];
    const max = c?.[1];
    if (min !== undefined && max !== undefined) {
      return `${each(l, e)} ${String(min)}–${String(max)} karakter arasında olmalıdır`;
    }
    if (min !== undefined) {
      return `${each(l, e)} en az ${String(min)} karakter olmalıdır`;
    }
    return `${each(l, e)} geçersiz uzunlukta`;
  },
  isLength: (l, c, e) => {
    const min = c?.[0];
    const max = c?.[1];
    if (min !== undefined && max !== undefined) {
      return `${each(l, e)} ${String(min)}–${String(max)} karakter arasında olmalıdır`;
    }
    if (min !== undefined) {
      return `${each(l, e)} en az ${String(min)} karakter olmalıdır`;
    }
    return `${each(l, e)} geçersiz uzunlukta`;
  },

  // Format
  isEmail: (l, _c, e) => `${each(l, e)} geçerli bir e-posta olmalıdır`,
  isUrl: (l, _c, e) => `${each(l, e)} geçerli bir URL olmalıdır`,
  isUUID: (l, _c, e) => `${each(l, e)} geçerli bir UUID olmalıdır`,
  isPhoneNumber: (l, _c, e) => `${each(l, e)} geçerli bir telefon numarası olmalıdır`,
  isMobilePhone: (l, _c, e) =>
    `${each(l, e)} geçerli bir cep telefonu numarası olmalıdır`,
  isCreditCard: (l, _c, e) => `${each(l, e)} geçerli bir kart numarası olmalıdır`,
  isIBAN: (l, _c, e) => `${each(l, e)} geçerli bir IBAN olmalıdır`,
  isPostalCode: (l, _c, e) => `${each(l, e)} geçerli bir posta kodu olmalıdır`,
  isAlpha: (l, _c, e) => `${each(l, e)} yalnızca harf içermelidir`,
  isAlphanumeric: (l, _c, e) =>
    `${each(l, e)} yalnızca harf ve rakam içermelidir`,
  isAscii: (l, _c, e) => `${each(l, e)} yalnızca ASCII karakter içermelidir`,
  isLowercase: (l, _c, e) => `${each(l, e)} küçük harf olmalıdır`,
  isUppercase: (l, _c, e) => `${each(l, e)} büyük harf olmalıdır`,
  matches: (l, _c, e) => `${each(l, e)} geçersiz biçimde`,
  isJSON: (l, _c, e) => `${each(l, e)} geçerli bir JSON olmalıdır`,
  isJWT: (l, _c, e) => `${each(l, e)} geçerli bir JWT olmalıdır`,
  isHexColor: (l, _c, e) => `${each(l, e)} geçerli bir renk kodu olmalıdır`,
  isIP: (l, _c, e) => `${each(l, e)} geçerli bir IP adresi olmalıdır`,

  // Karşılaştırma
  isIn: (l, c, e) => {
    const list = formatList(c);
    return list
      ? `${each(l, e)} şunlardan biri olmalıdır: ${list}`
      : `${each(l, e)} geçersiz değer`;
  },
  isNotIn: (l, c, e) => {
    const list = formatList(c);
    return list
      ? `${each(l, e)} şu değerlerden biri olamaz: ${list}`
      : `${each(l, e)} geçersiz değer`;
  },
  equals: (l, c, e) =>
    `${each(l, e)} ${String(c?.[0] ?? '')} değerine eşit olmalıdır`,
  notEquals: (l, c, e) =>
    `${each(l, e)} ${String(c?.[0] ?? '')} değerine eşit olmamalıdır`,

  // Diziler
  arrayMinSize: (l, c, _e) =>
    `${l} en az ${String(c?.[0] ?? '')} öğe içermelidir`,
  arrayMaxSize: (l, c, _e) =>
    `${l} en fazla ${String(c?.[0] ?? '')} öğe içerebilir`,
  arrayContains: (l, c, _e) => {
    const list = formatList(c);
    return list ? `${l} şu değerleri içermelidir: ${list}` : `${l} eksik değer içeriyor`;
  },
  arrayNotContains: (l, c, _e) => {
    const list = formatList(c);
    return list
      ? `${l} şu değerleri içermemelidir: ${list}`
      : `${l} yasak değer içeriyor`;
  },
  arrayNotEmpty: (l, _c, _e) => `${l} boş olamaz`,
  arrayUnique: (l, _c, _e) => `${l} alanındaki öğeler benzersiz olmalıdır`,

  // Nested
  nestedValidation: (l, _c, e) => `${each(l, e)} geçersiz`,
  whitelistValidation: (l, _c, _e) => `${l} alanı kabul edilmiyor`,
};

const FALLBACK: ConstraintMessageBuilder = (l, _c, e) =>
  `${each(l, e)} geçersiz`;

/**
 * Verilen constraint key için Türkçe mesajı üretir.
 *
 * @param constraintKey class-validator constraint adı (örn. `isEmail`)
 * @param label Türkçeleştirilmiş alan adı (PROPERTY_LABELS_TR'den)
 * @param constraints decorator argümanları (örn. MinLength(8) → [8])
 * @param isEach `each: true` decorator'larında dizi içi öğeler için true
 */
export function buildTurkishMessage(
  constraintKey: string,
  label: string,
  constraints: readonly unknown[] | undefined,
  isEach: boolean,
): string {
  const builder = TEMPLATES[constraintKey] ?? FALLBACK;
  return builder(label, constraints, isEach);
}

/**
 * class-validator'ın varsayılan İngilizce mesajlarını yakalayan kalıplar.
 * Inline `message: 'foo'` olmadığında üretilen default mesajlar bu
 * kalıplara uyar; uyuyorsa Türkçe template ile değiştirilmelidir.
 */
const ENGLISH_DEFAULT_PATTERNS: readonly RegExp[] = [
  /^.* must be /i,
  /^.* should not be /i,
  /^.* must not be /i,
  /^.* must contain /i,
  /^.* must match /i,
  /^each value in /i,
  /^.* must be longer than /i,
  /^.* must be shorter than /i,
  /^.* must be one of /i,
  /^.* must be a /i,
  /^.* must be an /i,
  /^.* is not /i,
  /^.* must equal /i,
];

/**
 * Verilen mesajın class-validator'ın default İngilizce mesajı olup
 * olmadığını tahmin eder. Eğer öyleyse Türkçeleştirilmelidir;
 * değilse (kullanıcının kendi inline mesajı) olduğu gibi bırakılır.
 */
export function isDefaultEnglishMessage(message: string): boolean {
  if (!message) return false;
  return ENGLISH_DEFAULT_PATTERNS.some((re) => re.test(message));
}

/**
 * Default İngilizce mesajdan constraint argümanlarını ($constraint1,
 * $constraint2, ...) çıkartır.
 *
 * class-validator `ValidationError.constraints` üzerinde sadece üretilmiş
 * mesaj string'ini sunar; orijinal decorator argümanları (örn. `Max(100)`
 * için `100`) ValidationError'a iliştirilmez. Bu yüzden Türkçe template'i
 * sayı ile doldurabilmek için sayıyı default mesajdan parse etmemiz gerekir.
 *
 * Map'lenmemiş bir constraint key gelirse boş dizi dönülür ve template
 * ham sayıyı atlamak yerine boşluk üretmemek için bunu fallback ile
 * idare eder.
 */
const CONSTRAINT_VALUE_PATTERNS: Readonly<Record<string, RegExp>> = {
  // Sayısal sınırlar — tek değer.
  max: /must not be greater than (-?\d+(?:\.\d+)?)/i,
  min: /must not be less than (-?\d+(?:\.\d+)?)/i,
  isDivisibleBy: /must be divisible by (-?\d+(?:\.\d+)?)/i,

  // String uzunluk — tek değer.
  maxLength: /must be shorter than or equal to (\d+) characters/i,
  minLength: /must be longer than or equal to (\d+) characters/i,

  // Dizi boyut — tek değer.
  arrayMaxSize: /must contain no more than (\d+) elements/i,
  arrayMinSize: /must contain at least (\d+) elements/i,

  // equals / notEquals — tek değer (string olabilir).
  equals: /must be equal to (.+)$/i,
  notEquals: /should not be equal to (.+)$/i,
};

/**
 * Length / isLength iki değer döndürür (min, max). Bunlar üç farklı
 * default mesaj üretebildiği için ayrı parse edilir.
 */
const LENGTH_BOTH = /must be longer than or equal to (\d+) and shorter than or equal to (\d+) characters/i;

export function extractConstraintsFromMessage(
  constraintKey: string,
  message: string,
): readonly unknown[] {
  if (!message) return [];

  // Length / isLength — iki değerli kalıp önce denenir.
  if (constraintKey === 'isLength' || constraintKey === 'length') {
    const both = LENGTH_BOTH.exec(message);
    if (both) return [Number(both[1]), Number(both[2])];
    const onlyMin = /must be longer than or equal to (\d+) characters/i.exec(message);
    if (onlyMin) return [Number(onlyMin[1])];
    const onlyMax = /must be shorter than or equal to (\d+) characters/i.exec(
      message,
    );
    if (onlyMax) return [undefined, Number(onlyMax[1])];
    return [];
  }

  const pattern = CONSTRAINT_VALUE_PATTERNS[constraintKey];
  if (!pattern) return [];

  const match = pattern.exec(message);
  if (!match) return [];

  const raw = match[1];
  if (raw === undefined) return [];

  const num = Number(raw);
  return [Number.isNaN(num) ? raw : num];
}

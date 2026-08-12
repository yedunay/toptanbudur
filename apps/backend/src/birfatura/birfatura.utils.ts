import { Prisma } from '@prisma/client';

/**
 * BirFatura tarih formatı: "dd.MM.yyyy HH:mm:ss" (Türkiye TZ).
 *
 * Sunucu UTC çalışsa bile BirFatura'ya Europe/Istanbul lokal saatiyle
 * yollarız — fatura tarihinin Türk tüketici/firma için tutarlı olması
 * gerek. JS'in Intl.DateTimeFormat tz-aware olduğu için bunu kullanıyoruz.
 */
const TR_FORMATTER = new Intl.DateTimeFormat('tr-TR', {
  timeZone: 'Europe/Istanbul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

export function formatTrDate(d: Date): string {
  const parts = TR_FORMATTER.formatToParts(d);
  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? '00';
  // Intl bazen "24" döner gece yarısı için, "00" beklenen — normalize
  let hour = get('hour');
  if (hour === '24') hour = '00';
  return `${get('day')}.${get('month')}.${get('year')} ${hour}:${get('minute')}:${get('second')}`;
}

/**
 * BirFatura TR tarih-saat formatı (`dd.MM.yyyy HH:mm:ss`) için tek kanonik regex.
 *
 * §12.5 / §13 "Saat 24+ regex" düzeltmesi: saat **0-23** ile sınırlı; 24+ reddedilir.
 * Plan'ın taslak parçası `(\d|1\d|2[0-3])` sıfır-dolgulu saatleri ("08", "09")
 * eşlemediği için (BirFatura saatleri sıfır-dolgulu `HH` gönderir) niyeti birebir
 * koruyan ama dolgulu/tek-haneli her ikisini de kabul eden `([01]?\d|2[0-3])`
 * kullanılır. Gün/ay/dakika/saniye plan kapsamında değil → eski esneklik korunur.
 *
 * Yakalama grupları (sıra korunur): 1=gün 2=ay 3=yıl 4=saat 5=dakika 6=saniye.
 * Hem `parseTrDate` hem `OrdersRequestDto` doğrulaması bu sabiti kullanır (DRY).
 */
export const TR_DATETIME_REGEX =
  /^(\d{1,2})\.(\d{1,2})\.(\d{4})\s+([01]?\d|2[0-3]):(\d{1,2}):(\d{1,2})$/;

/**
 * "01.11.2019 00:00:00" → Date (Europe/Istanbul olarak yorumlanır).
 * BirFatura `/api/orders/` body'sinde startDateTime/endDateTime bu formatta.
 */
export function parseTrDate(s: string): Date {
  const m = s.match(TR_DATETIME_REGEX);
  if (!m) {
    throw new Error(`Invalid Turkish date format: ${s}`);
  }
  const [, d, mo, y, h, mi, se] = m;
  // Europe/Istanbul = UTC+3 (yıl boyu sabit, DST yok 2016'dan beri).
  const iso = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}T${h.padStart(2, '0')}:${mi.padStart(2, '0')}:${se.padStart(2, '0')}+03:00`;
  return new Date(iso);
}

/**
 * Birim KDV'siz fiyattan KDV dahil fiyatı türet (precision korur).
 * Örn: vatAdd(83.33, 20) → 99.996 (BirFatura yuvarlamadan number bekliyor).
 */
export function vatAdd(net: Prisma.Decimal, vatRate: number): Prisma.Decimal {
  return net.mul(100 + vatRate).div(100);
}

/**
 * KDV dahil fiyattan KDV hariç (matrah) fiyatı türet — `vatAdd`'in tersi.
 * Örn: vatRemove(4.80, 20) → 4.00 (paketleme "Kargo Bedeli" matrahı).
 * Konsolide fatura motorunda paketleme birim ücreti (KDV dahil kabul edilen
 * `pricing.packagingUnitFee`) matraha ayrıştırılırken kullanılır (§2).
 */
export function vatRemove(
  incl: Prisma.Decimal,
  vatRate: number,
): Prisma.Decimal {
  return incl.mul(100).div(100 + vatRate);
}

/**
 * Telefon numarasından rakam dışı tüm karakterleri temizle.
 * "+90 (532) 123-45-67" → "905321234567"
 */
export function sanitizePhone(phone: string | null | undefined): string {
  if (!phone) return '';
  return phone.replace(/[^\d]/g, '');
}

/**
 * Country code → Türkçe ülke adı.
 */
export function countryToTurkish(code: string | null | undefined): string {
  if (!code) return 'Türkiye';
  const upper = code.toUpperCase();
  if (upper === 'TR') return 'Türkiye';
  return code;
}

/**
 * humanOrderNo (örn "61000042") → BirFatura long.
 * humanOrderNo NOT NULL olduğu için her zaman parse edilebilir; yine de
 * defansif: NaN dönerse 0.
 */
export function humanOrderNoToLong(humanOrderNo: string): number {
  const n = Number(humanOrderNo);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Boş/whitespace string'i null'a indirger ("" yerine null taşı). Sistem
 * sınırında (BirFatura JSON, snapshot) boş alanları normalize etmek için.
 */
export function nz(value: string | null | undefined): string | null {
  const t = value?.trim();
  return t ? t : null;
}

/**
 * Sayısal olmayan ID (uuid/cuid) → integer. BirFatura'nın `ProductId`/
 * `CustomerId` long alanları sayısal ister; cuid/uuid'lerimizi deterministik
 * 31-bit pozitif bir tamsayıya indiriyoruz (çakışma riski faturada önemsiz,
 * yalnız referans alanı). Hem legacy per-order hem konsolide mapper kullanır.
 */
export function hashStringToInt(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = (hash << 5) - hash + s.charCodeAt(i);
    hash |= 0; // 32-bit signed
  }
  return Math.abs(hash);
}

/**
 * Decimal/string/number → number. BirFatura tutarları **yuvarlanmamış** ister;
 * `Number(d.toString())` precision'ı korur (parseFloat değil, toString üzerinden).
 */
export function decimalToNumber(d: Prisma.Decimal | string | number): number {
  if (d instanceof Prisma.Decimal) return Number(d.toString());
  return typeof d === 'number' ? d : Number(d);
}

/**
 * Bir tarihi Europe/Istanbul ay anahtarına çevirir: `YYYY-MM`.
 * Konsolide fatura batch'leri `periodEnd` ayına göre gruplanırken kullanılır;
 * admin paneli + bayi "Faturalarım" aynı anahtarı paylaşır (DRY).
 */
export function istanbulMonthKey(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(d);
  const year = parts.find((p) => p.type === 'year')?.value ?? '0000';
  const month = parts.find((p) => p.type === 'month')?.value ?? '00';
  return `${year}-${month}`;
}

/**
 * Bir tarihi insan-okur TR ay etiketine çevirir: "Haziran 2026"
 * (Europe/Istanbul). Bayi sipariş detayındaki "bu sipariş <ay yıl> toplu
 * faturasına dahildir" ifadesi ile admin/bayi liste başlıkları bunu kullanır.
 */
export function istanbulMonthLabel(d: Date): string {
  return new Intl.DateTimeFormat('tr-TR', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric',
    month: 'long',
  }).format(d);
}

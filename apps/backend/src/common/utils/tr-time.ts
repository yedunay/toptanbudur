/**
 * Türkiye saati (Europe/Istanbul) — TÜM gün-sınırı ve tarih-filtresi hesapları
 * için TEK kaynak. Sunucu UTC'de çalışsa bile gün sınırları DAİMA Türkiye yerel
 * gününe göre belirlenir. "Dün 00:00'dan bugüne" gibi bir filtre, kullanıcının
 * kafasındaki TR takvim günüyle birebir aynı olmalıdır.
 *
 * Neden bu modül? Önceden her servis kendi UTC+3 hesabını ya da hiç hesap
 * yapmadan `new Date("YYYY-MM-DD")` (= UTC gece yarısı) kullanıyordu. Bu iki
 * hataya yol açıyordu:
 *   1) Başlangıç günü 3 saat kırpılıyor (TR 00:00–03:00 düşüyor).
 *   2) `type="date"` ile seçilen bitiş günü, gün BAŞINA (00:00) sabitlendiği
 *      için o günün neredeyse tamamı eleniyordu ("bugüne kadar" → bugünü saymaz).
 *
 * Çözüm: tarih metnini TR takvim gününe çevir, başlangıcı dahil, bitişi de
 * **gün sonu dahil** (yarı-açık üst sınır = ertesi TR günü başı, `lt`) yap.
 *
 * Ofseti sabit yazmak yerine `Intl`'den hesaplıyoruz; Türkiye 2016'dan beri
 * sabit UTC+3 (DST yok) ama kural değişirse bu modül kendiliğinden doğru kalır.
 */

export const TR_TIME_ZONE = 'Europe/Istanbul';

const trPartsFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TR_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

export interface TrParts {
  year: number;
  /** 1-tabanlı ay (Ocak = 1). */
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** Bir UTC anını Türkiye duvar-saati takvim parçalarına çevirir. */
export function trParts(d: Date): TrParts {
  const map: Record<string, string> = {};
  for (const p of trPartsFormatter.formatToParts(d)) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  let hour = Number(map.hour);
  // Bazı ortamlar gece yarısını 24 olarak üretir; 0'a normalize et.
  if (hour === 24) hour = 0;
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour,
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

/**
 * Verilen anı içeren TR gününün 00:00:00'ına karşılık gelen UTC `Date` anını
 * döner. (Dashboard'daki `startOfDayIstanbul` ile aynı mantık.)
 */
export function trStartOfDay(d: Date): Date {
  const { year, month, day, hour, minute, second } = trParts(d);
  // d'yi SANİYEYE floor et: trParts milisaniye taşımadığı için, d'nin ms'i
  // offset hesabına sızıp gün başını 00:00:00.xxx yapıyordu (gün-sınırı
  // karşılaştırmaları + tarih-aralığı filtreleri bundan etkilenir). ms'i çıkar.
  const dSec = d.getTime() - d.getMilliseconds();
  const offsetMs =
    Date.UTC(year, month - 1, day, hour, minute, second) - dSec;
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0) - offsetMs);
}

/**
 * TR takviminde `days` gün ekler/çıkarır ve sonucun gün başlangıcını döner.
 * Hedef günün öğlenine gidip snap'leyerek olası bir DST sıçramasına karşı da
 * dayanıklıdır (geçişler gece olur, öğlen asla belirsiz değildir).
 */
export function trAddDays(d: Date, days: number): Date {
  const noonish = new Date(
    trStartOfDay(d).getTime() + days * 86_400_000 + 12 * 3_600_000,
  );
  return trStartOfDay(noonish);
}

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Kullanıcıdan gelen tarih değerini (genelde `type="date"` → "YYYY-MM-DD";
 * saat içeren ISO de kabul) o değerin ait olduğu TR gününün **başlangıcına**
 * (00:00 TR, UTC anı olarak) çevirir. Geçersiz/boş ise `null`.
 */
export function trDayStart(value: string | Date | null | undefined): Date | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : trStartOfDay(value);
  }
  const trimmed = value.trim();
  const m = DATE_ONLY_RE.exec(trimmed);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const da = Number(m[3]);
    // O takvim gününün öğlenini UTC kabul edip TR gün başına snap'le. TR=UTC+3
    // olduğundan öğlen-UTC daima aynı TR takvim gününe düşer → güvenli.
    const noonUtc = new Date(Date.UTC(y, mo - 1, da, 12, 0, 0));
    if (Number.isNaN(noonUtc.getTime())) return null;
    return trStartOfDay(noonUtc);
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return trStartOfDay(parsed);
}

/**
 * Bitiş günü için **yarı-açık üst sınır**: değerin ait olduğu TR gününün ertesi
 * gününün başlangıcı (00:00 TR). Prisma'da `lt` ile kullanılır → bitiş günü
 * tam olarak DAHİL edilir. Geçersiz/boş ise `null`.
 */
export function trDayEndExclusive(
  value: string | Date | null | undefined,
): Date | null {
  const start = trDayStart(value);
  return start ? trAddDays(start, 1) : null;
}

export interface TrDateRange {
  gte?: Date;
  lt?: Date;
}

/**
 * `from`/`to` tarih metinlerinden Prisma `createdAt` filtresi üretir.
 * - `from`: TR gün başı (dahil)
 * - `to`:   TR gün SONU dahil (yarı-açık üst sınır = ertesi TR günü başı, `lt`)
 *
 * İkisi de yoksa `undefined` döner (çağıran taraf filtreyi hiç eklemez).
 */
export function trDateRange(
  from?: string | Date | null,
  to?: string | Date | null,
): TrDateRange | undefined {
  const gte = trDayStart(from);
  const lt = trDayEndExclusive(to);
  if (!gte && !lt) return undefined;
  const range: TrDateRange = {};
  if (gte) range.gte = gte;
  if (lt) range.lt = lt;
  return range;
}

/** Verilen anı içeren TR ayının ilk gününün 00:00 TR anını (UTC olarak) döner. */
export function trStartOfMonth(d: Date): Date {
  const { year, month } = trParts(d);
  // Ayın 1'inin öğlenini UTC kabul edip TR gün başına snap'le (TR=UTC+3 → güvenli).
  return trStartOfDay(new Date(Date.UTC(year, month - 1, 1, 12, 0, 0)));
}

/** Verilen anın TR takvim gününü "YYYY-MM-DD" olarak döner (gün-bazlı gruplama). */
export function trDateKey(d: Date): string {
  const { year, month, day } = trParts(d);
  return `${String(year).padStart(4, '0')}-${String(month).padStart(
    2,
    '0',
  )}-${String(day).padStart(2, '0')}`;
}

/** Bugünün TR takvim tarihini "YYYY-MM-DD" döner (dosya adı damgaları vb.). */
export function trTodayKey(now: Date = new Date()): string {
  return trDateKey(now);
}

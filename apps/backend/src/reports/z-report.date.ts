/**
 * Z raporu — tarih yardımcıları.
 *
 * Rapor dönemi "dün 00:00 – 23:59" olarak tanımlanır ama sunucu UTC'de
 * çalışsa bile gün sınırları **Europe/Istanbul**'a göre belirlenmelidir.
 * Türkiye sabit UTC+3 (DST yok) olduğundan ofset kaymadan hesaplanabilir.
 */
import { Z_REPORT_TIMEZONE_OFFSET_MIN } from './z-report.constants';
import { ReportPeriod } from './z-report.types';

/**
 * Verilen `now` anına göre bir önceki Europe/Istanbul gününün
 * `[00:00:00.000, 23:59:59.999]` aralığını UTC `Date` nesneleri olarak döner.
 *
 * @param now referans an (test edilebilirlik için parametre)
 */
export function getYesterdayPeriod(now: Date = new Date()): ReportPeriod {
  const offsetMs = Z_REPORT_TIMEZONE_OFFSET_MIN * 60_000;

  // `now`'u Istanbul duvar-saatine taşı, oradan gün başını bul.
  const istanbulNow = new Date(now.getTime() + offsetMs);
  const istanbulMidnightToday = Date.UTC(
    istanbulNow.getUTCFullYear(),
    istanbulNow.getUTCMonth(),
    istanbulNow.getUTCDate(),
  );

  // Dünün Istanbul 00:00'ı (duvar-saati) → gerçek UTC için ofseti geri çıkar.
  const fromUtcMs = istanbulMidnightToday - 24 * 60 * 60 * 1000 - offsetMs;
  const from = new Date(fromUtcMs);
  const to = new Date(fromUtcMs + 24 * 60 * 60 * 1000 - 1);

  // Etiket: dünün Istanbul tarihini gün/ay/yıl olarak yaz.
  const istanbulYesterday = new Date(
    istanbulMidnightToday - 24 * 60 * 60 * 1000,
  );
  const dd = String(istanbulYesterday.getUTCDate()).padStart(2, '0');
  const mm = String(istanbulYesterday.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = istanbulYesterday.getUTCFullYear();

  return { from, to, label: `${dd}.${mm}.${yyyy}` };
}

/**
 * Bir dönemi gün bazında kaydırır (ör. `-1` = önceki gün, `-7` = geçen hafta
 * aynı gün). Türkiye sabit UTC+3 olduğundan 24 saatlik aritmetik güvenlidir.
 */
export function shiftPeriod(period: ReportPeriod, days: number): ReportPeriod {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const from = new Date(period.from.getTime() + days * DAY_MS);
  const to = new Date(period.to.getTime() + days * DAY_MS);

  const offsetMs = Z_REPORT_TIMEZONE_OFFSET_MIN * 60_000;
  const istanbulDay = new Date(from.getTime() + offsetMs);
  const dd = String(istanbulDay.getUTCDate()).padStart(2, '0');
  const mm = String(istanbulDay.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = istanbulDay.getUTCFullYear();

  return { from, to, label: `${dd}.${mm}.${yyyy}` };
}

const WEEKDAYS_TR = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'] as const;
const WEEKDAYS_TR_LONG = [
  'Pazar',
  'Pazartesi',
  'Salı',
  'Çarşamba',
  'Perşembe',
  'Cuma',
  'Cumartesi',
] as const;

/** Dönemin (Istanbul günü) kısa Türkçe gün adı, ör. "Cum". */
export function weekdayShortTr(period: ReportPeriod): string {
  const offsetMs = Z_REPORT_TIMEZONE_OFFSET_MIN * 60_000;
  const istanbulDay = new Date(period.from.getTime() + offsetMs);
  return WEEKDAYS_TR[istanbulDay.getUTCDay()];
}

/** Dönemin (Istanbul günü) uzun Türkçe gün adı, ör. "Cumartesi". */
export function weekdayLongTr(period: ReportPeriod): string {
  const offsetMs = Z_REPORT_TIMEZONE_OFFSET_MIN * 60_000;
  const istanbulDay = new Date(period.from.getTime() + offsetMs);
  return WEEKDAYS_TR_LONG[istanbulDay.getUTCDay()];
}

/**
 * Türkiye saati (TRT) yardımcıları — konsolide fatura dondurma için.
 *
 * Sabit **UTC+3** kullanılır: Türkiye 2016'dan beri yaz saati (DST) uygulamaz,
 * yani yıl boyunca ofset sabittir. Bu, `birfatura.utils.ts` içindeki
 * `formatTrDate`/`parseTrDate` ile **aynı** varsayımdır → modül genelinde tek
 * tarih konvansiyonu.
 *
 * Neden Intl yerine sabit ofset? Dondurma kararı (`periodEnd` = ayın 25'i 00:00
 * TRT) ve cron guard'ı (bugünün TRT günü == kesim günü mü?) deterministik ve
 * test edilebilir olmalı; sabit ofset hem basit hem de doğru.
 */

/** TRT = UTC+3 (sabit). */
const TR_OFFSET_MS = 3 * 60 * 60 * 1000;

interface TrtParts {
  year: number;
  /** 0-tabanlı ay (Ocak = 0). */
  month: number;
  /** Ayın günü (1-31). */
  day: number;
}

/** Bir UTC anını TRT takvim parçalarına (yıl/ay/gün) çevirir. */
function trtParts(d: Date): TrtParts {
  const shifted = new Date(d.getTime() + TR_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
  };
}

/**
 * Verilen anın bulunduğu TRT gününün **başlangıcı** (00:00:00 TRT) olarak
 * `Date` döner. Batch `periodEnd` (= OrderDate, `@@unique` anahtar parçası) ve
 * `frozenAt` günü hesaplamasında kullanılır.
 */
export function startOfDayIstanbul(d: Date): Date {
  const { year, month, day } = trtParts(d);
  return new Date(Date.UTC(year, month, day, 0, 0, 0, 0) - TR_OFFSET_MS);
}

/** Verilen anın TRT ayındaki gününü (1-31) döner — cron kesim-günü guard'ı. */
export function istanbulDayOfMonth(d: Date): number {
  return trtParts(d).day;
}

/**
 * TRT takviminde ay ekler/çıkarır ve sonucun **gün başlangıcını** döner.
 * `periodStart` (önceki kesim etiketi) için kullanılır; gün taşması (örn. 31 →
 * kısa ay) JS `Date` davranışına bırakılır (yalnız etiket, kesim günü ≤ 28).
 */
export function addMonthsIstanbul(d: Date, months: number): Date {
  const { year, month, day } = trtParts(d);
  return new Date(Date.UTC(year, month + months, day, 0, 0, 0, 0) - TR_OFFSET_MS);
}

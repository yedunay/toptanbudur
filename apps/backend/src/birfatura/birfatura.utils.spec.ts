import { TR_DATETIME_REGEX, parseTrDate, formatTrDate } from './birfatura.utils';

/**
 * Faz 5 — §12.5 / §13 "Saat 24+ regex" düzeltmesi.
 * Tek kanonik `TR_DATETIME_REGEX` hem `parseTrDate` hem `OrdersRequestDto`
 * doğrulamasını besler. Saat **0-23** kabul; 24+ reddedilir. Sıfır-dolgulu
 * ("08") ve tek-haneli ("8") saatlerin İKİSİ de geçerli olmalı (BirFatura
 * sıfır-dolgulu HH gönderir).
 */

describe('TR_DATETIME_REGEX — saat 0-23 (§12.5)', () => {
  it('sıfır-dolgulu saatleri kabul eder (08, 09)', () => {
    expect(TR_DATETIME_REGEX.test('25.06.2026 08:00:00')).toBe(true);
    expect(TR_DATETIME_REGEX.test('25.06.2026 09:30:15')).toBe(true);
    expect(TR_DATETIME_REGEX.test('25.06.2026 00:00:00')).toBe(true);
  });

  it('tek-haneli saati kabul eder (8)', () => {
    expect(TR_DATETIME_REGEX.test('1.6.2026 8:5:9')).toBe(true);
  });

  it('sınır saatleri kabul eder (19, 20, 23)', () => {
    expect(TR_DATETIME_REGEX.test('25.06.2026 19:00:00')).toBe(true);
    expect(TR_DATETIME_REGEX.test('25.06.2026 20:00:00')).toBe(true);
    expect(TR_DATETIME_REGEX.test('25.06.2026 23:59:59')).toBe(true);
  });

  it('saat 24+ değerlerini reddeder (24, 25, 99)', () => {
    expect(TR_DATETIME_REGEX.test('25.06.2026 24:00:00')).toBe(false);
    expect(TR_DATETIME_REGEX.test('25.06.2026 25:00:00')).toBe(false);
    expect(TR_DATETIME_REGEX.test('25.06.2026 99:00:00')).toBe(false);
  });

  it('biçimsiz girdileri reddeder', () => {
    expect(TR_DATETIME_REGEX.test('2026-06-25 21:00:00')).toBe(false);
    expect(TR_DATETIME_REGEX.test('25.06.2026')).toBe(false);
    expect(TR_DATETIME_REGEX.test('gecersiz-tarih')).toBe(false);
  });
});

describe('parseTrDate — Europe/Istanbul (UTC+3)', () => {
  it('sıfır-dolgulu saati doğru yorumlar (UTC+3 → UTC)', () => {
    // 21:00 +03:00 = 18:00 UTC
    expect(parseTrDate('25.06.2026 21:00:00').toISOString()).toBe(
      '2026-06-25T18:00:00.000Z',
    );
  });

  it('sabah sıfır-dolgulu saati ("08") parse eder (önceki regex bunu bozardı)', () => {
    expect(parseTrDate('25.06.2026 08:00:00').toISOString()).toBe(
      '2026-06-25T05:00:00.000Z',
    );
  });

  it('saat 24+ için hata fırlatır', () => {
    expect(() => parseTrDate('25.06.2026 24:00:00')).toThrow();
  });

  it('biçimsiz girdi için hata fırlatır', () => {
    expect(() => parseTrDate('gecersiz')).toThrow();
  });
});

describe('formatTrDate — gece yarısı normalizasyonu', () => {
  it('round-trip: parse → format aynı saati korur', () => {
    const d = parseTrDate('25.06.2026 21:00:00');
    expect(formatTrDate(d)).toBe('25.06.2026 21:00:00');
  });
});

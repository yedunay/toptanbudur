import { getYesterdayPeriod } from './z-report.date';

/**
 * Türkiye sabit UTC+3 olduğundan gün sınırları kaymadan hesaplanmalı.
 * Tüm beklentiler `from` = dünün Istanbul 00:00'ı (UTC olarak 21:00 önceki gün),
 * `to` = dünün Istanbul 23:59:59.999'u.
 */
describe('getYesterdayPeriod', () => {
  it('returns yesterday Istanbul day boundaries as UTC dates', () => {
    // 2026-05-15 09:30 UTC → Istanbul 12:30, 15 Mayıs. Dün = 14 Mayıs.
    const period = getYesterdayPeriod(new Date('2026-05-15T09:30:00.000Z'));

    // 14 May 00:00 Istanbul = 13 May 21:00 UTC
    expect(period.from.toISOString()).toBe('2026-05-13T21:00:00.000Z');
    // 14 May 23:59:59.999 Istanbul = 14 May 20:59:59.999 UTC
    expect(period.to.toISOString()).toBe('2026-05-14T20:59:59.999Z');
    expect(period.label).toBe('14.05.2026');
  });

  it('rolls the day correctly when UTC is still the previous date', () => {
    // 2026-05-15 22:00 UTC → Istanbul 01:00, 16 Mayıs. Dün = 15 Mayıs.
    const period = getYesterdayPeriod(new Date('2026-05-15T22:00:00.000Z'));

    expect(period.from.toISOString()).toBe('2026-05-14T21:00:00.000Z');
    expect(period.to.toISOString()).toBe('2026-05-15T20:59:59.999Z');
    expect(period.label).toBe('15.05.2026');
  });

  it('handles month boundaries', () => {
    // 2026-06-01 05:00 UTC → Istanbul 08:00, 1 Haziran. Dün = 31 Mayıs.
    const period = getYesterdayPeriod(new Date('2026-06-01T05:00:00.000Z'));

    expect(period.from.toISOString()).toBe('2026-05-30T21:00:00.000Z');
    expect(period.to.toISOString()).toBe('2026-05-31T20:59:59.999Z');
    expect(period.label).toBe('31.05.2026');
  });

  it('handles year boundaries', () => {
    // 2026-01-01 10:00 UTC → Istanbul 13:00, 1 Ocak. Dün = 31 Aralık 2025.
    const period = getYesterdayPeriod(new Date('2026-01-01T10:00:00.000Z'));

    expect(period.from.toISOString()).toBe('2025-12-30T21:00:00.000Z');
    expect(period.to.toISOString()).toBe('2025-12-31T20:59:59.999Z');
    expect(period.label).toBe('31.12.2025');
  });

  it('spans exactly one day minus a millisecond', () => {
    const period = getYesterdayPeriod(new Date('2026-05-15T09:30:00.000Z'));
    const spanMs = period.to.getTime() - period.from.getTime();
    expect(spanMs).toBe(24 * 60 * 60 * 1000 - 1);
  });
});

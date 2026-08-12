import {
  addMonthsIstanbul,
  istanbulDayOfMonth,
  startOfDayIstanbul,
} from './trt-date';

/**
 * TRT (UTC+3, DST yok) tarih yardımcıları. Kritik nokta: kesim kararı UTC
 * gününe değil **Türkiye gününe** göre verilmeli — gece yarısı civarı UTC ile
 * TRT farklı güne düşebilir.
 */
describe('trt-date — Türkiye saati yardımcıları (sabit UTC+3)', () => {
  describe('startOfDayIstanbul', () => {
    it('gün ortası anı → o TRT gününün 00:00 (UTC-3 = bir önceki gün 21:00Z)', () => {
      const at = new Date('2026-06-05T10:00:00.000Z'); // TRT 13:00
      expect(startOfDayIstanbul(at).toISOString()).toBe(
        '2026-06-04T21:00:00.000Z',
      );
    });

    it('TRT günü UTC gününden ileri olduğunda doğru günü seçer', () => {
      // UTC 2026-06-05 21:30 → TRT 2026-06-06 00:30 → gün başı 06-06 00:00 TRT.
      const at = new Date('2026-06-05T21:30:00.000Z');
      expect(startOfDayIstanbul(at).toISOString()).toBe(
        '2026-06-05T21:00:00.000Z',
      );
    });

    it('zaten gün başı olan an idempotenttir', () => {
      const midnightTrt = new Date('2026-06-24T21:00:00.000Z'); // 06-25 00:00 TRT
      expect(startOfDayIstanbul(midnightTrt).toISOString()).toBe(
        '2026-06-24T21:00:00.000Z',
      );
    });
  });

  describe('istanbulDayOfMonth', () => {
    it('TRT ayının gününü döner', () => {
      expect(istanbulDayOfMonth(new Date('2026-06-05T10:00:00.000Z'))).toBe(5);
    });

    it('UTC hâlâ 24 iken TRT 25 ise 25 döner (kesim guard kritik durum)', () => {
      // UTC 2026-06-24 22:00 → TRT 2026-06-25 01:00.
      expect(istanbulDayOfMonth(new Date('2026-06-24T22:00:00.000Z'))).toBe(25);
    });

    it('UTC 25 iken TRT hâlâ 24 ise 24 döner', () => {
      // UTC 2026-06-25 00:30 → TRT yok; tersi: UTC 2026-06-24 20:00 → TRT 23:00 → 24.
      expect(istanbulDayOfMonth(new Date('2026-06-24T20:00:00.000Z'))).toBe(24);
    });
  });

  describe('addMonthsIstanbul', () => {
    it('periodEnd (TRT gün başı) → bir önceki kesim (periodStart)', () => {
      const periodEnd = startOfDayIstanbul(new Date('2026-06-25T08:00:00.000Z'));
      const periodStart = addMonthsIstanbul(periodEnd, -1);
      // 06-25 00:00 TRT → 05-25 00:00 TRT = 05-24 21:00Z.
      expect(periodStart.toISOString()).toBe('2026-05-24T21:00:00.000Z');
    });

    it('yıl sınırını aşar (Ocak − 1 = önceki yıl Aralık)', () => {
      const periodEnd = startOfDayIstanbul(new Date('2026-01-25T08:00:00.000Z'));
      const periodStart = addMonthsIstanbul(periodEnd, -1);
      expect(periodStart.toISOString()).toBe('2025-12-24T21:00:00.000Z');
    });
  });
});

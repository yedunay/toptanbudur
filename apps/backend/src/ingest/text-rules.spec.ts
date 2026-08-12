import { applyTextRules, TextRule } from './text-rules';

// Test yardımcısı: tek kuralı default değerlerle üretir, override edilebilir.
function rule(partial: Partial<TextRule>): TextRule {
  return {
    search: '',
    replacement: '',
    applyToName: true,
    applyToDescription: true,
    caseInsensitive: true,
    wholeWord: false,
    enabled: true,
    sortOrder: 0,
    ...partial,
  };
}

describe('applyTextRules', () => {
  describe('sil (replacement boş)', () => {
    it('aranan ifadeyi siler ve boşluğu sıkıştırır', () => {
      const rules = [rule({ search: 'Marka' })];
      expect(applyTextRules('Marka Telefon Kılıfı', rules, 'name')).toBe(
        'Telefon Kılıfı',
      );
    });

    it('parantezli kodu siler (literal — regex meta escape edilir)', () => {
      const rules = [rule({ search: '(1234)', wholeWord: false })];
      expect(applyTextRules('Kılıf (1234) Siyah', rules, 'name')).toBe(
        'Kılıf Siyah',
      );
    });

    it('aranan ifade yoksa metni değiştirmez (ama trim/squeeze uygular)', () => {
      const rules = [rule({ search: 'Marka' })];
      expect(applyTextRules('Temiz İsim', rules, 'name')).toBe('Temiz İsim');
    });
  });

  describe('değiştir (replacement dolu)', () => {
    it('aranan ifadeyi yeni ifadeyle değiştirir', () => {
      const rules = [rule({ search: 'Marka', replacement: 'Uygun' })];
      expect(applyTextRules('Marka Telefon', rules, 'name')).toBe(
        'Uygun Telefon',
      );
    });

    it('tüm tekrarları değiştirir (global)', () => {
      const rules = [rule({ search: 'X', replacement: 'Y' })];
      expect(applyTextRules('X aX bX', rules, 'name')).toBe('Y aY bY');
    });
  });

  describe('caseInsensitive', () => {
    it('true iken büyük/küçük harf farkını yok sayar', () => {
      const rules = [rule({ search: 'marka', caseInsensitive: true })];
      expect(applyTextRules('MARKA Kılıf', rules, 'name')).toBe('Kılıf');
    });

    it('false iken yalnız birebir eşleşeni siler', () => {
      const rules = [rule({ search: 'marka', caseInsensitive: false })];
      expect(applyTextRules('MARKA Kılıf', rules, 'name')).toBe(
        'MARKA Kılıf',
      );
    });
  });

  describe('wholeWord', () => {
    it('true iken yalnız tam kelimeyi eşler', () => {
      const rules = [rule({ search: 'Marka', wholeWord: true })];
      expect(applyTextRules('Marka X', rules, 'name')).toBe('X');
    });

    it('true iken kelime içi eşleşmeye dokunmaz', () => {
      const rules = [rule({ search: 'Marka', wholeWord: true })];
      expect(applyTextRules('Markalift Kılıf', rules, 'name')).toBe(
        'Markalift Kılıf',
      );
    });

    it('false iken kelime içi eşleşmeyi de siler', () => {
      const rules = [rule({ search: 'Marka', wholeWord: false })];
      expect(applyTextRules('Markalift', rules, 'name')).toBe('lift');
    });
  });

  describe('alan seçimi (name / description)', () => {
    it('applyToName=false ise name alanında uygulanmaz', () => {
      const rules = [rule({ search: 'X', applyToName: false })];
      expect(applyTextRules('X kaldi', rules, 'name')).toBe('X kaldi');
    });

    it('applyToDescription=false ise description alanında uygulanmaz', () => {
      const rules = [rule({ search: 'X', applyToDescription: false })];
      expect(applyTextRules('X kaldi', rules, 'description')).toBe('X kaldi');
    });

    it('aynı kural yalnız seçili alana uygulanır', () => {
      const rules = [
        rule({ search: 'Marka', applyToName: true, applyToDescription: false }),
      ];
      expect(applyTextRules('Marka Kılıf', rules, 'name')).toBe('Kılıf');
      expect(applyTextRules('Marka açıklama', rules, 'description')).toBe(
        'Marka açıklama',
      );
    });
  });

  describe('enabled / no-op', () => {
    it('enabled=false kural uygulanmaz', () => {
      const rules = [rule({ search: 'X', enabled: false })];
      expect(applyTextRules('X kaldi', rules, 'name')).toBe('X kaldi');
    });

    it('uygulanabilir kural yokken metni AYNEN korur (squeeze/trim bile yok)', () => {
      // Çift boşluklu açıklama — kural yoksa hiç dokunulmamalı (format korunur).
      const text = 'Açıklama  satırı\n\n  girintili';
      expect(applyTextRules(text, [], 'description')).toBe(text);
    });

    it('search boş kural atlanır', () => {
      const rules = [rule({ search: '' })];
      const text = 'Çift  boşluk';
      expect(applyTextRules(text, rules, 'name')).toBe(text);
    });
  });

  describe('zincirleme kurallar (sortOrder)', () => {
    it('kurallar sortOrder sırasıyla uygulanır', () => {
      const rules = [
        rule({ search: 'B', replacement: 'C', sortOrder: 1 }),
        rule({ search: 'A', replacement: 'B', sortOrder: 0 }),
      ];
      // önce A→B (A→B), sonra B→C → ilk A da C olur
      expect(applyTextRules('A', rules, 'name')).toBe('C');
    });

    it('birden fazla sil kuralı birlikte uygulanır', () => {
      const rules = [
        rule({ search: 'Marka', sortOrder: 0 }),
        rule({ search: '(1234)', sortOrder: 1 }),
      ];
      expect(applyTextRules('Marka Kılıf (1234)', rules, 'name')).toBe(
        'Kılıf',
      );
    });
  });

  describe('idempotentlik', () => {
    it('sil kuralı iki kez uygulanınca aynı sonucu verir', () => {
      const rules = [rule({ search: 'Marka' })];
      const once = applyTextRules('Marka Kılıf', rules, 'name');
      const twice = applyTextRules(once, rules, 'name');
      expect(twice).toBe(once);
    });

    it('değiştir kuralı NON-idempotent olabilir (ham kaynaktan re-apply gerekçesi)', () => {
      // A→AB kuralı zaten dönüşmüş metne tekrar uygulanırsa yanlış büyür.
      // Bu yüzden recompute HAM kaynaktan (rawFeedName) yapılır.
      const rules = [rule({ search: 'A', replacement: 'AB' })];
      const once = applyTextRules('A', rules, 'name'); // "AB"
      const twice = applyTextRules(once, rules, 'name'); // "ABB"
      expect(once).toBe('AB');
      expect(twice).toBe('ABB');
      expect(twice).not.toBe(once);
    });
  });

  describe('boş isim koruması (çağıran taraf sorumluluğu)', () => {
    it('isim tamamen silinirse fonksiyon boş string döndürür', () => {
      // applyTextRules boş dönebilir; çağıran taraf `|| base` ile korur.
      const rules = [rule({ search: 'Marka' })];
      expect(applyTextRules('Marka', rules, 'name')).toBe('');
    });
  });
});

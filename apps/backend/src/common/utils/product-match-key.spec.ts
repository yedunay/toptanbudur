import {
  eanCore,
  normName,
  signature,
  matchKey,
  groupConfidence,
} from './product-match-key';

describe('product-match-key', () => {
  describe('eanCore', () => {
    it('tedarikçi barkod önekini soyup çekirdek EAN13 verir', () => {
      expect(eanCore('SUP8683140692650')).toBe('8683140692650');
    });
    it('ham EAN13 aynen kalır', () => {
      expect(eanCore('8683140692650')).toBe('8683140692650');
    });
    it('önekli ↔ ham çekirdek EAN köprüsü eşit', () => {
      expect(eanCore('SUP8683140692650')).toBe(eanCore('8683140692650'));
    });
    it('kısa/boş barkod', () => {
      expect(eanCore('050536520190')).toBe('050536520190'); // 12 hane → aynen
      expect(eanCore('')).toBe('');
      expect(eanCore(null)).toBe('');
    });
  });

  describe('normName', () => {
    it('İphone/iPhone (p) ve TR İ farkını birler', () => {
      expect(normName('Apple İphone 12 Kılıf')).toBe(
        normName('Apple iPhone 12 Kılıf'),
      );
    });
    it('4g/4G ve renk büyük/küçük harf farkı', () => {
      expect(normName('Samsung Galaxy A15 4g Kılıf - Siyah')).toBe(
        normName('Samsung Galaxy A15 4G Kılıf - siyah'),
      );
    });
  });

  describe('signature — model koruması', () => {
    it('13 Pro ≠ 13 Pro Max', () => {
      expect(signature(normName('Apple iPhone 13 Pro Kılıf'))).not.toBe(
        signature(normName('Apple iPhone 13 Pro Max Kılıf')),
      );
    });
    it('pro max, pro/max çift saymaz ama plus farklıdır', () => {
      expect(signature(normName('iPhone 15 Plus'))).not.toBe(
        signature(normName('iPhone 15 Pro Max')),
      );
    });
  });

  describe('matchKey — gerçek pozitifler', () => {
    const cases: Array<[string, string, string, string]> = [
      [
        'SUP8683140692650',
        'Samsung Galaxy S24 Ultra Kılıf Kart Şeffaf Silikon - Şeffaf',
        '8683140692650',
        'Samsung Galaxy S24 Ultra Kılıf Kart Şeffaf Silikon - Şeffaf',
      ],
      [
        'SUP8683140321079',
        'Apple İphone 12 Kılıf Element Silikon - Gümüş',
        '8683140321079',
        'Apple iPhone 12 Kılıf Element Silikon - Gümüş',
      ],
      [
        'SUP8683140692704',
        'Xiaomi Redmi 13c Kılıf Kart Şeffaf Silikon - Şeffaf',
        '8683140692704',
        'Xiaomi Redmi 13C Kılıf Kart Şeffaf Silikon - Şeffaf',
      ],
    ];
    it.each(cases)(
      'Tedarikçi A(%s) ↔ Tedarikçi B aynı anahtar',
      (aBc, aName, bBc, bName) => {
        expect(matchKey(aBc, aName).key).toBe(matchKey(bBc, bName).key);
      },
    );
  });

  describe('matchKey — aynı barkod FARKLI model (asla birleşmemeli)', () => {
    const negatives: Array<[string, string, string, string]> = [
      [
        'SUP8683140857141',
        'İnfinix Smart 9 Kılıf Auto Focus Karbon Kapak - Siyah',
        '8683140857141',
        'İnfinix Hot 50i 4G Kılıf Auto Focus Karbon Kapak - Siyah',
      ],
      [
        'SUP8683140602987',
        'Xiaomi Redmi Note 12 Pro 5g Kılıf Montreal Yüzüklü Silikon Kapak - Yeşil',
        '8683140602987',
        'Xiaomi Poco X5 Pro 5G Kılıf Montreal Yüzüklü Silikon Kapak - Yeşil',
      ],
      [
        'SUP8683140657697',
        'Samsung Galaxy Tab A9 Plus Kılıf Amazing Tablet Kapak - Siyah',
        '8683140657697',
        'Samsung Galaxy Tab A11 Plus Kılıf Amazing Tablet Kapak - Siyah',
      ],
    ];
    it.each(negatives)(
      'barkod aynı (%s) ama model farklı → farklı anahtar',
      (aBc, aName, bBc, bName) => {
        // Barkod (eanCore) eşit olsa bile model imzası anahtarı ayırmalı.
        expect(eanCore(aBc)).toBe(eanCore(bBc));
        expect(matchKey(aBc, aName).key).not.toBe(matchKey(bBc, bName).key);
      },
    );
  });

  describe('groupConfidence', () => {
    it('EAN + isim eşit → high', () => {
      expect(
        groupConfidence([
          { barcode: 'SUP8683140692650', name: 'Samsung Galaxy S24 Ultra Kılıf' },
          { barcode: '8683140692650', name: 'Samsung Galaxy S24 Ultra Kılıf' },
        ]),
      ).toBe('high');
    });
    it('EAN eşit ama isim farklı → medium_ean', () => {
      expect(
        groupConfidence([
          {
            barcode: 'SUP8683140729844',
            name: 'Apple İphone 12 Kılıf Magsafe Kapak - Turuncu',
          },
          {
            barcode: '8683140729844',
            name: 'Apple iPhone 12 Kılıf Star Magsafe Kapak - Turuncu',
          },
        ]),
      ).toBe('medium_ean');
    });
    it('barkodsuz isim eşleşmesi → medium_name', () => {
      expect(
        groupConfidence([
          { barcode: null, name: 'Bir Ürün' },
          { barcode: '', name: 'Bir Ürün' },
        ]),
      ).toBe('medium_name');
    });
  });
});

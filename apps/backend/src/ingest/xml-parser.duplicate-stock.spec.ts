import { XmlParserService } from './xml-parser.service';

/**
 * Regresyon: Toptanbudur (ve benzeri) feed'ler aynı ürünü İKİ kez listeliyor —
 * biri ölü/pasif kopya (active=0, quantity=0), biri canlı (active=1, quantity=20),
 * ikisi de AYNI productCode (=externalCode) ile. Eski "ilk-kazanır" dedup ölü
 * kopyayı tutup 20 stoklu canlıyı atıyordu → ürün haksız yere stoksuz görünüyor,
 * dışa giden XML feed'inden (stock>0 filtresi) tamamen düşüyordu.
 *
 * Çözüm: aynı externalCode tekrar gelirse stoğu YÜKSEK olan kopya tutulur.
 *
 * ÖNEMLİ: feed'in `<active>` alanı YORUMLANMAZ. bazı canlı tedarikçiler
 * ürünlerini `active=0` ile yolluyor; active=0'ı "satma" diye yorumlamak onların
 * tüm kataloğunu gizlerdi. Dolayısıyla düzeltme yalnız STOK karşılaştırmasına
 * dayanır — Toptanbudur'un ölü kopyaları zaten qty=0 olduğu için canlı qty=20'ye
 * kaybeder; active alanına dokunmaya gerek yok.
 */
describe('XmlParserService — duplicate productCode stock-wins dedup', () => {
  const svc = new XmlParserService();

  // Gerçek Toptanbudur yapısı: aynı productCode iki kez, farklı active/quantity.
  const dupFeed = (firstActive: number, firstQty: number, secondActive: number, secondQty: number) => `<?xml version="1.0"?>
    <products>
      <product>
        <productCode>45733</productCode>
        <name><![CDATA[Apple iPhone 14 Pro Max Live Diamond Magsafe Kapak - Şeffaf]]></name>
        <price>118.73</price>
        <active>${firstActive}</active>
        <quantity>${firstQty}</quantity>
      </product>
      <product>
        <productCode>45733</productCode>
        <name><![CDATA[Apple iPhone 14 Pro Max Live Diamond Magsafe Kapak - Şeffaf]]></name>
        <price>118.73</price>
        <active>${secondActive}</active>
        <quantity>${secondQty}</quantity>
      </product>
    </products>`;

  it('ölü kopya (qty=0) ÖNCE gelse bile 20 stoklu kopyayı tutar', () => {
    const r = svc.parseDetailed(dupFeed(0, 0, 1, 20));
    expect(r.items).toHaveLength(1);
    expect(r.items[0].externalCode).toBe('45733');
    expect(r.items[0].stock).toBe(20); // 0 DEĞİL — bug bu satırı koruyor
    expect(r.dropped.duplicateSkuInFeed).toBe(1);
  });

  it('20 stoklu kopya ÖNCE gelse de 0 stoklu kopyaya ezdirmez', () => {
    const r = svc.parseDetailed(dupFeed(1, 20, 0, 0));
    expect(r.items).toHaveLength(1);
    expect(r.items[0].stock).toBe(20);
    expect(r.dropped.duplicateSkuInFeed).toBe(1);
  });

  it('aynı kod 3 kez [0, 5, 20] gelse en yükseği (20) kazanır', () => {
    const xml = `<?xml version="1.0"?>
      <products>
        <product><productCode>X1</productCode><name>Kılıf</name><price>10</price><quantity>0</quantity></product>
        <product><productCode>X1</productCode><name>Kılıf</name><price>10</price><quantity>5</quantity></product>
        <product><productCode>X1</productCode><name>Kılıf</name><price>10</price><quantity>20</quantity></product>
      </products>`;
    const r = svc.parseDetailed(xml);
    expect(r.items).toHaveLength(1);
    expect(r.items[0].stock).toBe(20);
    expect(r.dropped.duplicateSkuInFeed).toBe(2);
  });

  it('eşit stoklu tekrarlarda ilk kayıt korunur (mevcut davranış)', () => {
    const xml = `<?xml version="1.0"?>
      <products>
        <product><productCode>DUP</productCode><name>Ilk</name><price>10</price><quantity>3</quantity></product>
        <product><productCode>DUP</productCode><name>Ikinci</name><price>11</price><quantity>3</quantity></product>
      </products>`;
    const r = svc.parseDetailed(xml);
    expect(r.items).toHaveLength(1);
    expect(r.items[0].name).toContain('Ilk');
    expect(r.dropped.duplicateSkuInFeed).toBe(1);
  });

  // ── Canlı feed güvenliği — global active-skip foot-gun'ı bir daha eklenmesin ──
  it('tek başına active=0 olan STOKLU ürünü ASLA gizlemez (active yorumlanmaz)', () => {
    const xml = `<?xml version="1.0"?>
      <products>
        <product><productCode>ITD1</productCode><name>Tedarikçi Ürünü</name><price>50</price><active>0</active><quantity>20</quantity></product>
      </products>`;
    const out = svc.parse(xml);
    expect(out).toHaveLength(1); // DROP edilmedi
    expect(out[0].stock).toBe(20); // stoğu korundu — feed'de görünür
  });

  it('active=0 + quantity=0 tekil ürün normal şekilde stoksuz gelir (yapay drop yok)', () => {
    const xml = `<?xml version="1.0"?>
      <products>
        <product><productCode>OOS1</productCode><name>Stoksuz</name><price>50</price><active>0</active><quantity>0</quantity></product>
      </products>`;
    const r = svc.parseDetailed(xml);
    expect(r.items).toHaveLength(1);
    expect(r.items[0].stock).toBe(0);
  });

  // Gerçek Toptanbudur blok yapısı: üst seviye <quantity> + iç içe
  // <variants><variant><quantity>. Üst seviye stok okunmalı (nested DEĞİL).
  it('iç içe <variants> bloğu olan gerçek yapıda üst-seviye stoğu doğru kazanır', () => {
    const xml = `<?xml version="1.0"?>
      <products>
        <product>
          <id>32898</id><productCode>45733</productCode>
          <name><![CDATA[Apple iPhone 14 Pro Max Live Diamond Magsafe Kapak - Şeffaf]]></name>
          <price>118.73</price><active>0</active><quantity>0</quantity>
          <variants><variant><name1>model</name1><value1>iPhone 14 Pro Max</value1><quantity>0</quantity></variant></variants>
        </product>
        <product>
          <id>103280</id><productCode>45733</productCode>
          <name><![CDATA[Apple iPhone 14 Pro Max Live Diamond Magsafe Kapak - Şeffaf]]></name>
          <price>118.73</price><active>1</active><quantity>20</quantity>
          <variants><variant><name1>model</name1><value1>iPhone 14 Pro Max</value1><quantity>20</quantity></variant></variants>
        </product>
      </products>`;
    const r = svc.parseDetailed(xml);
    expect(r.items).toHaveLength(1);
    expect(r.items[0].externalCode).toBe('45733');
    expect(r.items[0].stock).toBe(20);
  });
});

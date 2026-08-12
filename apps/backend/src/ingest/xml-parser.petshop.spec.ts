import { XmlParserService } from './xml-parser.service';

// Petshop tarzı feed örneği. Gerçek feed'de:
//   <bayifiyat>   → bayilik alış fiyatı (BİZİM ALIŞ FİYATIMIZ — yüksek öncelik)
//   <fiyat>       → tedarikçi liste fiyatı (perakende — kullanılmamalı)
//   <kategori_adi> + <altkategori> → kategori hiyerarşisi
//   <barkodno>    → barkod
//   <resim>       → ana görsel (CDATA + URL etrafında boşluklar olabilir)
//   <marka>       → marka
//   <stok>        → adet
const PETSHOP_XML = `<?xml version="1.0" encoding="utf-8"?>
<urunler>
  <urun>
    <kategori_adi><![CDATA[ Kedi Ürünleri ]]></kategori_adi>
    <altkategori><![CDATA[ Kedi Tırmalaması ]]></altkategori>
    <urun_adi><![CDATA[ 2 Katlı Kedi Tırmalama Tahtası mavi ve pembe ]]></urun_adi>
    <barkodno>5534</barkodno>
    <fiyat>568.00</fiyat>
    <bayifiyat>420.00</bayifiyat>
    <resim><![CDATA[ https://ornek-tedarikci.example/gorsel/item_84_0g73z.jpg ]]></resim>
    <stok>2</stok>
    <marka><![CDATA[ Diğer ]]></marka>
  </urun>
  <urun>
    <kategori_adi><![CDATA[ Köpek Ürünleri ]]></kategori_adi>
    <altkategori><![CDATA[ Köpek Maması ]]></altkategori>
    <urun_adi><![CDATA[ Premium Köpek Maması 5kg ]]></urun_adi>
    <barkodno>9988</barkodno>
    <fiyat>900.00</fiyat>
    <bayifiyat>650.00</bayifiyat>
    <resim><![CDATA[ https://ornek-tedarikci.example/gorsel/item_999.jpg ]]></resim>
    <stok>0</stok>
    <marka><![CDATA[ ProBrand ]]></marka>
  </urun>
</urunler>`;

describe('XmlParserService — Petshop tarzı adapter', () => {
  const svc = new XmlParserService();

  it('parses two Petshop tarzı products', () => {
    const out = svc.parse(PETSHOP_XML);
    expect(out).toHaveLength(2);
  });

  it('uses <bayifiyat> as costPrice (NOT <fiyat>)', () => {
    const [first, second] = svc.parse(PETSHOP_XML);
    expect(first.costPrice).toBe(420);
    expect(second.costPrice).toBe(650);
  });

  it('uses <barkodno> as externalCode (no SKU field in feed)', () => {
    const [first, second] = svc.parse(PETSHOP_XML);
    expect(first.externalCode).toBe('5534');
    expect(second.externalCode).toBe('9988');
  });

  it('maps <barkodno> to barcode field', () => {
    const [first] = svc.parse(PETSHOP_XML);
    expect(first.barcode).toBe('5534');
  });

  it('builds categoryPath as [kategori_adi, altkategori]', () => {
    const [first, second] = svc.parse(PETSHOP_XML);
    expect(first.categoryPath).toEqual(['Kedi Ürünleri', 'Kedi Tırmalaması']);
    expect(second.categoryPath).toEqual(['Köpek Ürünleri', 'Köpek Maması']);
  });

  it('trims CDATA whitespace from <urun_adi>', () => {
    const [first] = svc.parse(PETSHOP_XML);
    expect(first.name).toBe('2 Katlı Kedi Tırmalama Tahtası mavi ve pembe');
  });

  it('trims CDATA whitespace from <marka>', () => {
    const [first, second] = svc.parse(PETSHOP_XML);
    expect(first.brand).toBe('Diğer');
    expect(second.brand).toBe('ProBrand');
  });

  it('maps <resim> to images[0].url and trims surrounding whitespace', () => {
    const [first] = svc.parse(PETSHOP_XML);
    expect(first.images.length).toBeGreaterThan(0);
    expect(first.images[0].url).toBe(
      'https://ornek-tedarikci.example/gorsel/item_84_0g73z.jpg',
    );
  });

  it('maps <stok> to stock (including 0)', () => {
    const [first, second] = svc.parse(PETSHOP_XML);
    expect(first.stock).toBe(2);
    expect(second.stock).toBe(0);
  });

  it('leaves currency empty when XML provides none (ingest feedCurrency fallback → TRY)', () => {
    // Parser artık yokken "TRY" varsaymaz; boş bırakır. Efektif para birimi
    // ingest tarafında (p.currency || feedCurrency || 'TRY') ile çözülür.
    const [first] = svc.parse(PETSHOP_XML);
    expect(first.currency).toBe('');
  });
});

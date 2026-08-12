import { XmlParserService } from './xml-parser.service';

// Otomotiv tarzı XML feed örneği. Gerçek feed'de;
//   <Price>      → KDV hariç bayi fiyatı
//   <KDVPrice>   → KDV dahil fiyat (kullanılmamalı)
//   <ParentCategoryName> + <CategoryName>
//   <Manufacture>
//   <UnitInStock>
//   <BarCode>
const AUTOPARTS_XML = `<?xml version="1.0" encoding="utf-8"?>
<root>
  <product>
    <SKU>ARB-1001</SKU>
    <Name>Sample Cargo Carrier</Name>
    <ParentCategoryName>Aksesuar</ParentCategoryName>
    <CategoryName>Bagaj Aksesuarları</CategoryName>
    <ParentCategoryCode>P-100</ParentCategoryCode>
    <CategoryCode>C-200</CategoryCode>
    <Manufacture>Thule</Manufacture>
    <Price>1250.00</Price>
    <KDVPrice>1500.00</KDVPrice>
    <UnitInStock>7</UnitInStock>
    <BarCode>8690000000017</BarCode>
    <Currency>TRY</Currency>
  </product>
  <product>
    <SKU>ARB-1002</SKU>
    <Name>Stoksuz Ürün</Name>
    <ParentCategoryName>Aksesuar</ParentCategoryName>
    <CategoryName>Diğer</CategoryName>
    <Manufacture>NoName</Manufacture>
    <Price>500</Price>
    <UnitInStock>0</UnitInStock>
  </product>
</root>`;

// EWS / xmlbankasi tarzı XML feed örneği. Gerçek feed'de;
//   <xml_bayii_alis_fiyati> → bayilik alış fiyatı (ana fiyat)
//   <CurrencyType>          → para birimi
//   <ModelName>             → ürün adı
//   <ModelNumber>           → model numarası
//   <ImageURL>              → ana görsel
//   <KDVOrani>              → KDV oranı (0-1 veya 0-100 olabilir)
const EWS_XML = `<?xml version="1.0" encoding="utf-8"?>
<root>
  <Urun>
    <UrunKartiID>EWS-5500</UrunKartiID>
    <ModelName>EWS Test Ürünü</ModelName>
    <ModelNumber>EWS-MDL-1</ModelNumber>
    <Marka>EWS</Marka>
    <ParentCategoryName>Elektrik</ParentCategoryName>
    <CategoryName>Devre Kesici</CategoryName>
    <xml_bayii_alis_fiyati>2450.50</xml_bayii_alis_fiyati>
    <CurrencyType>TRY</CurrencyType>
    <KDVOrani>0.20</KDVOrani>
    <ImageURL>https://cdn.example.com/p/ews-5500.jpg</ImageURL>
    <Stok>15</Stok>
    <Barkod>8690999999017</Barkod>
  </Urun>
  <Urun>
    <UrunKartiID>EWS-5501</UrunKartiID>
    <ModelName>İkinci Ürün</ModelName>
    <ModelNumber>EWS-MDL-2</ModelNumber>
    <Marka>EWS</Marka>
    <ParentCategoryName>Elektrik</ParentCategoryName>
    <CategoryName>Sigorta</CategoryName>
    <xml_bayii_alis_fiyati>180</xml_bayii_alis_fiyati>
    <CurrencyType>USD</CurrencyType>
    <KDVOrani>20</KDVOrani>
    <ImageURL>https://cdn.example.com/p/ews-5501.jpg</ImageURL>
    <Stok>0</Stok>
  </Urun>
</root>`;

describe('XmlParserService — Otomotiv tarzÄ± adapter', () => {
  const svc = new XmlParserService();

  it('parses two autoparts products with required fields', () => {
    const out = svc.parse(AUTOPARTS_XML);
    expect(out).toHaveLength(2);
  });

  it('uses <Price> (KDV hariç) as costPrice, ignoring <KDVPrice>', () => {
    const [first] = svc.parse(AUTOPARTS_XML);
    expect(first.externalCode).toBe('ARB-1001');
    expect(first.costPrice).toBe(1250);
  });

  it('builds categoryPath as [ParentCategoryName, CategoryName]', () => {
    const [first] = svc.parse(AUTOPARTS_XML);
    expect(first.categoryPath).toEqual(['Aksesuar', 'Bagaj Aksesuarları']);
  });

  it('maps Manufacture to brand', () => {
    const [first] = svc.parse(AUTOPARTS_XML);
    expect(first.brand).toBe('Thule');
  });

  it('maps UnitInStock to stock (>0 when in stock)', () => {
    const [first, second] = svc.parse(AUTOPARTS_XML);
    expect(first.stock).toBe(7);
    expect(second.stock).toBe(0);
  });

  it('maps BarCode to barcode', () => {
    const [first] = svc.parse(AUTOPARTS_XML);
    expect(first.barcode).toBe('8690000000017');
  });
});

describe('XmlParserService — EWS / xmlbankasi adapter', () => {
  const svc = new XmlParserService();

  it('parses two EWS products with required fields', () => {
    const out = svc.parse(EWS_XML);
    expect(out).toHaveLength(2);
  });

  it('uses <xml_bayii_alis_fiyati> as costPrice (HIGH priority)', () => {
    const [first, second] = svc.parse(EWS_XML);
    expect(first.externalCode).toBe('EWS-5500');
    expect(first.costPrice).toBe(2450.5);
    expect(second.costPrice).toBe(180);
  });

  it('maps <ModelName> to product name', () => {
    const [first] = svc.parse(EWS_XML);
    expect(first.name).toBe('EWS Test Ürünü');
  });

  it('maps <ModelNumber> to model field', () => {
    const [first] = svc.parse(EWS_XML);
    expect(first.model).toBe('EWS-MDL-1');
  });

  it('maps <ImageURL> to images[0].url', () => {
    const [first] = svc.parse(EWS_XML);
    expect(first.images.length).toBeGreaterThan(0);
    expect(first.images[0].url).toBe('https://cdn.example.com/p/ews-5500.jpg');
  });

  it('maps <CurrencyType> to currency code', () => {
    const [first, second] = svc.parse(EWS_XML);
    expect(first.currency).toBe('TRY');
    expect(second.currency).toBe('USD');
  });

  it('normalizes 0-1 tax rate to percentage (0.20 -> 20)', () => {
    const [first] = svc.parse(EWS_XML);
    expect(first.taxRate).toBe(20);
  });

  it('keeps tax rate as-is when already a percentage (20 -> 20)', () => {
    const [, second] = svc.parse(EWS_XML);
    expect(second.taxRate).toBe(20);
  });
});

// Generic + future-proof parsing: bilinmeyen format / TR sayı / duplicate SKU /
// drop classification için tasarlanan davranışları doğrular.
describe('XmlParserService — generic & resilience', () => {
  const svc = new XmlParserService();

  it('detects items inside a deeply-nested unknown root', () => {
    const xml = `<?xml version="1.0"?>
      <root><data><items>
        <item><SKU>D1</SKU><Name>Deep</Name><Price>50</Price></item>
      </items></data></root>`;
    const out = svc.parse(xml);
    expect(out).toHaveLength(1);
    expect(out[0].externalCode).toBe('D1');
  });

  it('detects items via heuristic when root/item tags are unknown', () => {
    const xml = `<?xml version="1.0"?>
      <Magaza>
        <Mal><kod>X1</kod><ad>Bilinmeyen Tag 1</ad><fiyat>22</fiyat></Mal>
        <Mal><kod>X2</kod><ad>Bilinmeyen Tag 2</ad><fiyat>33</fiyat></Mal>
      </Magaza>`;
    const out = svc.parse(xml);
    expect(out).toHaveLength(2);
    expect(out.map((p) => p.externalCode).sort()).toEqual(['X1', 'X2']);
  });

  it('parses TR thousands+decimal "1.234,56" as 1234.56', () => {
    const xml = `<?xml version="1.0"?>
      <urunler><urun>
        <sku>TR1</sku><name>TR Format</name><price>1.234,56 TL</price>
      </urun></urunler>`;
    const [p] = svc.parse(xml);
    expect(p.costPrice).toBe(1234.56);
  });

  it('parses EN thousands+decimal "1,234.56" as 1234.56', () => {
    const xml = `<?xml version="1.0"?>
      <products><product>
        <sku>EN1</sku><name>EN Format</name><price>1,234.56 USD</price>
      </product></products>`;
    const [p] = svc.parse(xml);
    expect(p.costPrice).toBe(1234.56);
  });

  it('reports duplicate SKU drops in DropStats', () => {
    const xml = `<?xml version="1.0"?>
      <Products>
        <Product><SKU>DUP-1</SKU><Name>İlk</Name><Price>10</Price></Product>
        <Product><SKU>DUP-1</SKU><Name>Aynı</Name><Price>11</Price></Product>
        <Product><SKU>DUP-2</SKU><Name>Tek</Name><Price>12</Price></Product>
      </Products>`;
    const r = svc.parseDetailed(xml);
    expect(r.totalCandidates).toBe(3);
    expect(r.items).toHaveLength(2);
    expect(r.dropped.duplicateSkuInFeed).toBe(1);
  });

  it('classifies missing SKU/name/price drops separately', () => {
    const xml = `<?xml version="1.0"?>
      <Products>
        <Product><Name>Sadece İsim</Name><Price>10</Price></Product>
        <Product><SKU>K-1</SKU><Price>10</Price></Product>
        <Product><SKU>K-2</SKU><Name>Fiyatsız</Name></Product>
        <Product><SKU>K-3</SKU><Name>Geçerli</Name><Price>15</Price></Product>
      </Products>`;
    const r = svc.parseDetailed(xml);
    expect(r.items).toHaveLength(1);
    expect(r.dropped.missingSku).toBe(1);
    expect(r.dropped.missingName).toBe(1);
    expect(r.dropped.missingPrice).toBe(1);
  });

  it('parses a single-item feed (object, not array) without dropping it', () => {
    const xml = `<?xml version="1.0"?>
      <Products>
        <Product><SKU>S1</SKU><ModelName>Tek Ürün</ModelName><Price>100</Price></Product>
      </Products>`;
    const out = svc.parse(xml);
    expect(out).toHaveLength(1);
    expect(out[0].externalCode).toBe('S1');
  });
});

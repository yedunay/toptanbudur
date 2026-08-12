import {
  mapBatchToBirfaturaOrder,
  resolveLineProductCode,
  resolveLineProductId,
  resolveLineBarcode,
  customerSafeFallbackCode,
  type BatchMemberItem,
  type BatchMemberOrder,
  type BatchSnapshotForMap,
  type MapBatchOptions,
} from './batch-mapper';
import { hashStringToInt } from '../birfatura.utils';

/**
 * Faz 4 — konsolide batch → BirFatura `/api/orders/` eşleyici testleri
 * (birfatura.md §6 #3 / §11 / §11.1). SAF fonksiyon — DB yok.
 */

const OPTIONS: MapBatchOptions = {
  salesChannel: 'Toptan Budur',
  defaultTc: '11111111111',
};

/** Kurumsal (vergiNo dolu) bayi batch'i — temel fixture. */
function makeBatch(
  overrides: Partial<BatchSnapshotForMap> = {},
): BatchSnapshotForMap {
  return {
    birfaturaOrderId: BigInt(9_000_000_042),
    periodEnd: new Date('2026-06-25T17:59:59.000Z'),
    paymentType: 'cari',
    billingName: 'Bayi A.Ş.',
    billingCompanyTitle: 'Bayi Anonim Şirketi',
    billingVergiNo: '1234567890',
    billingVergiDairesi: 'Kadıköy V.D.',
    billingTcNo: null,
    billingEmail: 'bayi@example.com',
    billingPhone: '0216 555 11 22',
    billingMobilePhone: '+90 (532) 111-22-33',
    billingAddressLine: 'Caferağa Mah. No:1',
    billingDistrict: 'Kadıköy',
    billingCity: 'İstanbul',
    productsTotalTaxExcluding: '460',
    productsTotalTaxIncluding: '552',
    totalPaidTaxExcluding: '460',
    totalPaidTaxIncluding: '552',
    ...overrides,
  };
}

function makeItem(overrides: Partial<BatchMemberItem> = {}): BatchMemberItem {
  return {
    productId: 'p1',
    productSlug: 'urun-1',
    productName: 'Ürün 1',
    unitPrice: '80',
    qty: 3,
    product: { id: 'cuid-p1', internalCode: 'STK-001', publicBarcode: 'TBDR-1' },
    ...overrides,
  };
}

/** İki üye siparişli (3 + 2 adet) temel batch üyeleri. */
function makeMembers(): BatchMemberOrder[] {
  return [
    { humanOrderNo: '61000001', packagingCost: '14.40', items: [makeItem()] },
    {
      humanOrderNo: '61000002',
      packagingCost: '9.60',
      items: [
        makeItem({
          productId: 'p2',
          productSlug: 'urun-2',
          productName: 'Ürün 2',
          unitPrice: '100',
          qty: 2,
          product: { id: 'cuid-p2', internalCode: null, publicBarcode: 'TBDR-2' },
        }),
      ],
    },
  ];
}

describe('resolveLineProductCode — müşteriye-güvenli kod (§11 spec sapması)', () => {
  it('internalCode varsa "Stok Kodu" olarak onu döner', () => {
    expect(
      resolveLineProductCode(
        makeItem({
          product: { id: 'c', internalCode: 'STK-99', publicBarcode: 'TBDR-X' },
        }),
      ),
    ).toBe('STK-99');
  });

  it('internalCode yoksa publicBarcode fallback', () => {
    expect(
      resolveLineProductCode(
        makeItem({
          product: { id: 'c', internalCode: null, publicBarcode: 'TBDR-X' },
        }),
      ),
    ).toBe('TBDR-X');
  });

  it('internalCode boşluk ise (nz trim) publicBarcode fallback', () => {
    expect(
      resolveLineProductCode(
        makeItem({
          product: { id: 'c', internalCode: '   ', publicBarcode: 'TBDR-X' },
        }),
      ),
    ).toBe('TBDR-X');
  });

  it('snapshot canlı koddan ÖNCE gelir (tarihsel sabitlik — "Stok Kodu" sabit)', () => {
    expect(
      resolveLineProductCode(
        makeItem({
          internalCodeSnapshot: 'TBDR-OLD',
          product: { id: 'c', internalCode: 'TBDR-NEW', publicBarcode: 'TBDR-X' },
        }),
      ),
    ).toBe('TBDR-OLD');
  });

  it('ürün hard-delete (product null) olsa bile internalCodeSnapshot kullanılır (slug DEĞİL)', () => {
    expect(
      resolveLineProductCode(
        makeItem({
          productSlug: 'silinmis-urun-slug',
          internalCodeSnapshot: 'TBDR-777',
          product: null,
        }),
      ),
    ).toBe('TBDR-777');
  });

  it('internalCode hiç yok ama publicBarcodeSnapshot var → onu kullanır', () => {
    expect(
      resolveLineProductCode(
        makeItem({
          productSlug: 'silinmis',
          internalCodeSnapshot: null,
          publicBarcodeSnapshot: 'PB-555',
          product: null,
        }),
      ),
    ).toBe('PB-555');
  });

  it('KRİTİK: hiçbir kod/snapshot yoksa productSlug ASLA basılmaz → temiz STK fallback', () => {
    const code = resolveLineProductCode(
      makeItem({
        productSlug: 'huawei-mediapad-t3-kilif-murdum-ark36706',
        internalCodeSnapshot: null,
        publicBarcodeSnapshot: null,
        product: null,
      }),
    );
    expect(code).not.toBe('huawei-mediapad-t3-kilif-murdum-ark36706');
    expect(code).toMatch(/^STK-\d{6}$/);
    // Deterministik: aynı ürün her zaman aynı kodu alır.
    expect(code).toBe(
      customerSafeFallbackCode(
        makeItem({ productSlug: 'huawei-mediapad-t3-kilif-murdum-ark36706' }),
      ),
    );
  });

  it('hard-delete (product null) + snapshot yok → yine STK fallback (slug DEĞİL)', () => {
    const code = resolveLineProductCode(
      makeItem({ productSlug: 'silinmis', product: null }),
    );
    expect(code).toMatch(/^STK-\d{6}$/);
    expect(code).not.toBe('silinmis');
  });
});

describe('resolveLineBarcode — legacy fatura Barcode alanı (ham tedarikçi barkodu ASLA)', () => {
  it('publicBarcodeSnapshot önce', () => {
    expect(
      resolveLineBarcode(
        makeItem({
          publicBarcodeSnapshot: 'PB-1',
          product: { id: 'c', internalCode: 'x', publicBarcode: 'PB-LIVE' },
        }),
      ),
    ).toBe('PB-1');
  });

  it('snapshot yoksa canlı publicBarcode', () => {
    expect(
      resolveLineBarcode(
        makeItem({
          publicBarcodeSnapshot: null,
          product: { id: 'c', internalCode: 'x', publicBarcode: 'PB-LIVE' },
        }),
      ),
    ).toBe('PB-LIVE');
  });

  it('hiçbiri yoksa null (ham tedarikçi barkodu sızdırılmaz)', () => {
    expect(
      resolveLineBarcode(
        makeItem({ publicBarcodeSnapshot: null, product: null }),
      ),
    ).toBeNull();
  });
});

describe('resolveLineProductId — sayısal id (cuid/uuid → hash)', () => {
  it('product.id varsa onun hash’i', () => {
    expect(resolveLineProductId(makeItem({ product: { id: 'cuid-x', internalCode: null, publicBarcode: null } }))).toBe(
      hashStringToInt('cuid-x'),
    );
  });

  it('product yoksa productId fallback', () => {
    expect(resolveLineProductId(makeItem({ productId: 'pid-9', product: null }))).toBe(
      hashStringToInt('pid-9'),
    );
  });

  it('product ve productId yoksa productSlug fallback', () => {
    expect(
      resolveLineProductId(
        makeItem({ productId: null, productSlug: 'slug-z', product: null }),
      ),
    ).toBe(hashStringToInt('slug-z'));
  });

  it('daima pozitif tamsayı', () => {
    const id = resolveLineProductId(makeItem());
    expect(Number.isInteger(id)).toBe(true);
    expect(id).toBeGreaterThanOrEqual(0);
  });
});

describe('mapBatchToBirfaturaOrder — sipariş başlığı', () => {
  it('OrderId = Number(birfaturaOrderId) (BigInt değil)', () => {
    const out = mapBatchToBirfaturaOrder(makeBatch(), makeMembers(), OPTIONS);
    expect(out.OrderId).toBe(9_000_000_042);
    expect(typeof out.OrderId).toBe('number');
  });

  it('OrderCode = tek temiz dönem etiketi (virgüllü liste YOK)', () => {
    const out = mapBatchToBirfaturaOrder(makeBatch(), makeMembers(), OPTIONS);
    // Sipariş no'ları artık her satırda (ProductName öneki); üstte virgüllü liste yok.
    expect(out.OrderCode).toEqual(expect.stringContaining('Toplu Fatura'));
    expect(String(out.OrderCode)).not.toContain(',');
  });

  it('OrderDate = periodEnd TR formatında (dd.MM.yyyy HH:mm:ss)', () => {
    const out = mapBatchToBirfaturaOrder(makeBatch(), makeMembers(), OPTIONS);
    expect(out.OrderDate).toMatch(/^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}:\d{2}$/);
    expect(out.OrderDate).toBe('25.06.2026 20:59:59');
  });

  it('SalesChannelWebSite = options.salesChannel', () => {
    const out = mapBatchToBirfaturaOrder(makeBatch(), makeMembers(), OPTIONS);
    expect(out.SalesChannelWebSite).toBe('Toptan Budur');
  });

  it('Currency=TRY, CurrencyRate=1', () => {
    const out = mapBatchToBirfaturaOrder(makeBatch(), makeMembers(), OPTIONS);
    expect(out.Currency).toBe('TRY');
    expect(out.CurrencyRate).toBe(1);
  });
});

describe('mapBatchToBirfaturaOrder — ödeme tipi', () => {
  it('card → PaymentTypeId 1', () => {
    const out = mapBatchToBirfaturaOrder(
      makeBatch({ paymentType: 'card' }),
      makeMembers(),
      OPTIONS,
    );
    expect(out.PaymentTypeId).toBe(1);
  });

  it('cari (card değil) → PaymentTypeId 2', () => {
    const out = mapBatchToBirfaturaOrder(
      makeBatch({ paymentType: 'cari' }),
      makeMembers(),
      OPTIONS,
    );
    expect(out.PaymentTypeId).toBe(2);
  });
});

describe('mapBatchToBirfaturaOrder — OrderDetails', () => {
  it('her üye kalemi için 1 satır (paketleme gömülü, ayrı satır YOK)', () => {
    const out = mapBatchToBirfaturaOrder(makeBatch(), makeMembers(), OPTIONS);
    const details = out.OrderDetails as Record<string, unknown>[];
    // 2 ürün satırı — ayrı "Kargo Bedeli" satırı YOK (paketleme matraha gömülü).
    expect(details).toHaveLength(2);
  });

  it('ürün satırı 8 zorunlu alanı eksiksiz taşır', () => {
    const out = mapBatchToBirfaturaOrder(makeBatch(), makeMembers(), OPTIONS);
    const line = (out.OrderDetails as Record<string, unknown>[])[0];
    expect(Object.keys(line).sort()).toEqual(
      [
        'ProductCode',
        'ProductId',
        'ProductName',
        'ProductQuantity',
        'ProductQuantityType',
        'ProductUnitPriceTaxExcluding',
        'ProductUnitPriceTaxIncluding',
        'VatRate',
      ].sort(),
    );
  });

  it('kalem sırası düzleştirmede korunur (üye sırası)', () => {
    const out = mapBatchToBirfaturaOrder(makeBatch(), makeMembers(), OPTIONS);
    const details = out.OrderDetails as Record<string, unknown>[];
    // ProductName önünde sipariş no gömülü: "<humanOrderNo> · <ürün adı>".
    expect(details[0].ProductName).toBe('61000001 · Ürün 1');
    expect(details[0].ProductCode).toBe('STK-001');
    expect(details[0].ProductQuantity).toBe(3);
    expect(details[1].ProductName).toBe('61000002 · Ürün 2');
    expect(details[1].ProductCode).toBe('TBDR-2'); // internalCode null → publicBarcode
    expect(details[1].ProductQuantity).toBe(2);
  });

  it('ürün satırı §2 fiyatı: 80 net + 4 paketleme → excl 84, incl 100.80, KDV 20', () => {
    const out = mapBatchToBirfaturaOrder(makeBatch(), makeMembers(), OPTIONS);
    const line = (out.OrderDetails as Record<string, unknown>[])[0];
    expect(line.VatRate).toBe(20);
    expect(line.ProductUnitPriceTaxExcluding).toBeCloseTo(84, 4);
    expect(line.ProductUnitPriceTaxIncluding).toBeCloseTo(100.8, 4);
    expect(line.ProductQuantityType).toBe('Adet');
  });

  it('ayrı "Kargo Bedeli" satırı YOK — paketleme her ürün matrahına gömülü', () => {
    const out = mapBatchToBirfaturaOrder(makeBatch(), makeMembers(), OPTIONS);
    const details = out.OrderDetails as Record<string, unknown>[];
    expect(details.some((d) => d.ProductName === 'Kargo Bedeli')).toBe(false);
    // Her ürün satırının matrahı +4.00 içerir (80 → 84).
    expect(details[0].ProductUnitPriceTaxExcluding).toBeCloseTo(84, 4);
  });
});

describe('mapBatchToBirfaturaOrder — tutarlar (donmuş snapshot, §6 #3)', () => {
  it('top-level tutarlar batch snapshot’tan (yuvarlama yok)', () => {
    const out = mapBatchToBirfaturaOrder(
      makeBatch({
        productsTotalTaxExcluding: '460.5',
        productsTotalTaxIncluding: '552.6',
        totalPaidTaxExcluding: '460.5',
        totalPaidTaxIncluding: '552.6',
      }),
      makeMembers(),
      OPTIONS,
    );
    expect(out.ProductsTotalTaxExcluding).toBeCloseTo(460.5, 4);
    expect(out.ProductsTotalTaxIncluding).toBeCloseTo(552.6, 4);
    expect(out.TotalPaidTaxExcluding).toBeCloseTo(460.5, 4);
    expect(out.TotalPaidTaxIncluding).toBeCloseTo(552.6, 4);
  });

  it('İndirim ve kargo başlık toplamları 0 (§2: indirim matraha gömülü)', () => {
    const out = mapBatchToBirfaturaOrder(makeBatch(), makeMembers(), OPTIONS);
    expect(out.DiscountTotalTaxExcluding).toBe(0);
    expect(out.DiscountTotalTaxIncluding).toBe(0);
    expect(out.ShippingChargeTotalTaxExcluding).toBe(0);
    expect(out.ShippingChargeTotalTaxIncluding).toBe(0);
  });
});

describe('mapBatchToBirfaturaOrder — vergi kimliği', () => {
  it('kurumsal (vergiNo dolu) → TaxNo + TaxOffice, SSNTCNo yok', () => {
    const out = mapBatchToBirfaturaOrder(makeBatch(), makeMembers(), OPTIONS);
    expect(out.TaxNo).toBe('1234567890');
    expect(out.TaxOffice).toBe('Kadıköy V.D.');
    expect(out.SSNTCNo).toBeUndefined();
  });

  it('kurumsal ama vergi dairesi boş → TaxNo var, TaxOffice yok', () => {
    const out = mapBatchToBirfaturaOrder(
      makeBatch({ billingVergiDairesi: null }),
      makeMembers(),
      OPTIONS,
    );
    expect(out.TaxNo).toBe('1234567890');
    expect(out.TaxOffice).toBeUndefined();
  });

  it('bireysel (vergiNo yok) → SSNTCNo = billingTcNo, TaxNo yok', () => {
    const out = mapBatchToBirfaturaOrder(
      makeBatch({ billingVergiNo: null, billingTcNo: '22222222222' }),
      makeMembers(),
      OPTIONS,
    );
    expect(out.SSNTCNo).toBe('22222222222');
    expect(out.TaxNo).toBeUndefined();
    expect(out.TaxOffice).toBeUndefined();
  });

  it('bireysel + TC boş → defaultTc fallback', () => {
    const out = mapBatchToBirfaturaOrder(
      makeBatch({ billingVergiNo: null, billingTcNo: null }),
      makeMembers(),
      OPTIONS,
    );
    expect(out.SSNTCNo).toBe('11111111111');
  });
});

describe('mapBatchToBirfaturaOrder — adres & iletişim & shipping', () => {
  it('Town = district; yoksa city; ikisi de yoksa "-"', () => {
    expect(
      mapBatchToBirfaturaOrder(makeBatch(), makeMembers(), OPTIONS).BillingTown,
    ).toBe('Kadıköy');
    expect(
      mapBatchToBirfaturaOrder(
        makeBatch({ billingDistrict: null }),
        makeMembers(),
        OPTIONS,
      ).BillingTown,
    ).toBe('İstanbul');
    expect(
      mapBatchToBirfaturaOrder(
        makeBatch({ billingDistrict: null, billingCity: null }),
        makeMembers(),
        OPTIONS,
      ).BillingTown,
    ).toBe('-');
  });

  it('Shipping = Billing (bayi faturası, ayrı teslimat yok)', () => {
    const out = mapBatchToBirfaturaOrder(makeBatch(), makeMembers(), OPTIONS);
    expect(out.ShippingName).toBe(out.BillingName);
    expect(out.ShippingAddress).toBe(out.BillingAddress);
    expect(out.ShippingTown).toBe(out.BillingTown);
    expect(out.ShippingCity).toBe(out.BillingCity);
  });

  it('Email = billingEmail (§7: BirFatura bu adrese yollar)', () => {
    expect(
      mapBatchToBirfaturaOrder(makeBatch(), makeMembers(), OPTIONS).Email,
    ).toBe('bayi@example.com');
  });

  it('Email yoksa boş string (null değil)', () => {
    expect(
      mapBatchToBirfaturaOrder(
        makeBatch({ billingEmail: null }),
        makeMembers(),
        OPTIONS,
      ).Email,
    ).toBe('');
  });

  it('telefon rakam dışı temizlenir', () => {
    const out = mapBatchToBirfaturaOrder(makeBatch(), makeMembers(), OPTIONS);
    expect(out.BillingMobilePhone).toBe('905321112233');
    expect(out.BillingPhone).toBe('02165551122');
  });
});

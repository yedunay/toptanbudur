import { Prisma } from '@prisma/client';
import { PreviewService } from './preview.service';

/**
 * Faz 6 — Önizleme motoru testleri (birfatura.md §8 "önizleme = kesilen fatura").
 *
 * Doğrulanan davranış:
 *  - (müşteri, ödeme tipi) gruplama → her grup tek fatura.
 *  - Tekli (customerId) vs toplu (hepsi) kapsam.
 *  - Uygun sipariş yoksa boş sonuç (DB yazımı yok).
 *  - BirFatura "Order" objesi: OrderId=0 (önizleme), OrderCode tek dönem etiketi,
 *    OrderDetails = ürün satırları (paketleme ücreti her ürün matrahına gömülü).
 *  - Kurumsal → TaxNo set / SSNTCNo yok; bireysel → SSNTCNo set / TaxNo yok.
 *  - §2 motoru tutarları (KDV %20, paketleme matraha +4.00 gömülü) birebir.
 */

type AnyOrder = Record<string, any>;

/** Order.item fixture kurucusu (mapper'ın gerektirdiği select alt kümesi). */
function item(
  productSlug: string,
  productName: string,
  unitPrice: string,
  qty: number,
  internalCode: string | null = null,
): AnyOrder {
  return {
    productId: `pid-${productSlug}`,
    productSlug,
    productName,
    unitPrice: new Prisma.Decimal(unitPrice),
    qty,
    product: {
      id: `pid-${productSlug}`,
      internalCode,
      publicBarcode: `BC-${productSlug}`,
    },
  };
}

/** Tam billing snapshot alanlarını null ile doldur (order'da yoksa Customer fallback). */
function emptyBilling(): AnyOrder {
  return {
    billingName: null,
    billingCompanyTitle: null,
    billingVergiNo: null,
    billingVergiDairesi: null,
    billingTcNo: null,
    billingEmail: null,
    billingPhone: null,
    billingMobilePhone: null,
    billingAddressLine: null,
    billingDistrict: null,
    billingCity: null,
    billingPostal: null,
  };
}

/** Order fixture kurucusu. */
function order(
  id: string,
  customerId: string,
  paymentType: string,
  humanOrderNo: string,
  items: AnyOrder[],
  customer: AnyOrder,
): AnyOrder {
  // Paketleme = 4.80 × adet (KDV hariç düz) — gerçek siparişteki gibi → fatura +4.80/adet.
  const totalQty = items.reduce((a, it) => a + ((it.qty as number) ?? 0), 0);
  return {
    id,
    customerId,
    tenantId: 't1',
    paymentType,
    humanOrderNo,
    status: 'shipped',
    packagingCost: (4.8 * totalQty).toFixed(2),
    ...emptyBilling(),
    customer,
    items,
  };
}

/** Bireysel müşteri (vergiNo yok → SSNTCNo akışı). */
function individualCustomer(name: string, tcKimlik: string | null): AnyOrder {
  return {
    name,
    companyTitle: null,
    vergiNo: null,
    vergiDairesi: null,
    tcKimlik,
    email: 'birey@example.com',
    phone: '05551112233',
    contactPhone: null,
    contactEmail: null,
    companyAddress: 'Adres 1',
  };
}

/** Kurumsal müşteri (vergiNo var → TaxNo akışı). */
function corporateCustomer(companyTitle: string, vergiNo: string): AnyOrder {
  return {
    name: 'İletişim Kişisi',
    companyTitle,
    vergiNo,
    vergiDairesi: 'Kadıköy',
    tcKimlik: null,
    email: 'kurumsal@example.com',
    phone: '02161112233',
    contactPhone: null,
    contactEmail: null,
    companyAddress: 'Kurumsal Adres',
  };
}

/**
 * Sahte PrismaService — `order.findMany` fixture'ları döndürür; where.customerId
 * bir string ise (tekli kapsam) ona göre filtreler (eligibleOrdersWhere semantiği).
 */
function makePrisma(orders: AnyOrder[]) {
  return {
    order: {
      findMany: jest.fn(async (args: any) => {
        const cid = args?.where?.customerId;
        const filtered =
          typeof cid === 'string'
            ? orders.filter((o) => o.customerId === cid)
            : orders;
        // orderBy humanOrderNo asc — fixture'ları stabil sırala.
        return [...filtered].sort((a, b) =>
          a.humanOrderNo.localeCompare(b.humanOrderNo),
        );
      }),
    },
  };
}

const settingsStub = {
  getString: jest.fn(async () => '4.8'),
} as any;

const configStub = {
  get: jest.fn(() => undefined),
} as any;

function makeService(orders: AnyOrder[]): PreviewService {
  return new PreviewService(makePrisma(orders) as any, settingsStub, configStub);
}

describe('PreviewService (Faz 6 — önizleme motoru)', () => {
  // o1: cA bireysel, card, [P1 x2 @100]
  const cA = individualCustomer('Ahmet Yılmaz', '12345678901');
  // o3: cB kurumsal, card, [P3 x3 @30]
  const cB = corporateCustomer('ACME A.Ş.', '1234567890');

  const o1 = order('o1', 'cA', 'card', '61000001', [
    item('p1', 'Ürün 1', '100', 2, 'STOK-1'),
  ], cA);
  const o2 = order('o2', 'cA', 'cari', '61000002', [
    item('p2', 'Ürün 2', '50', 1, 'STOK-2'),
  ], cA);
  const o3 = order('o3', 'cB', 'card', '61000003', [
    item('p3', 'Ürün 3', '30', 3, 'STOK-3'),
  ], cB);

  const allOrders = [o1, o2, o3];
  const asOf = new Date('2026-06-21T09:00:00+03:00');

  it('uygun siparişleri (müşteri, ödeme tipi) gruplarına ayırır — 3 fatura', async () => {
    const svc = makeService(allOrders);
    const res = await svc.preview({ asOf });

    expect(res.isPreview).toBe(true);
    expect(res.scope).toBe('all');
    expect(res.customerId).toBeNull();
    expect(res.invoiceCount).toBe(3); // (cA,card) (cA,cari) (cB,card)
    expect(res.orderCount).toBe(3);

    const keys = res.invoices.map((i) => `${i.customerId}-${i.paymentType}`);
    expect(keys.sort()).toEqual(['cA-card', 'cA-cari', 'cB-card']);
  });

  it('tekli kapsam: sadece verilen müşterinin gruplarını üretir', async () => {
    const svc = makeService(allOrders);
    const res = await svc.preview({ customerId: 'cA', asOf });

    expect(res.scope).toBe('single');
    expect(res.customerId).toBe('cA');
    expect(res.invoiceCount).toBe(2); // (cA,card) (cA,cari)
    expect(res.invoices.every((i) => i.customerId === 'cA')).toBe(true);
  });

  it('uygun sipariş yoksa boş sonuç döner (DB yazımı yok)', async () => {
    const svc = makeService([]);
    const res = await svc.preview({ asOf });

    expect(res.invoiceCount).toBe(0);
    expect(res.orderCount).toBe(0);
    expect(res.invoices).toEqual([]);
  });

  it('BirFatura Order: OrderId=0 (önizleme), OrderCode tek dönem etiketi, OrderDetails = yalnız ürün (paketleme gömülü)', async () => {
    const svc = makeService([o1]);
    const res = await svc.preview({ customerId: 'cA', asOf });
    const inv = res.invoices[0];
    const bf = inv.birfaturaOrder as AnyOrder;

    expect(bf.OrderId).toBe(0);
    expect(bf.OrderCode).toEqual(expect.stringContaining('Toplu Fatura'));
    // Yalnız 1 ürün satırı — ayrı "Kargo Bedeli" satırı YOK (paketleme matraha gömülü).
    expect((bf.OrderDetails as unknown[]).length).toBe(1);
    expect(bf.SalesChannelWebSite).toBe('Toptan Budur');
    expect(bf.PaymentTypeId).toBe(1); // card
  });

  it('birden çok üye sipariş tek faturada birleşir (numaralar satırda, OrderCode tek etiket)', async () => {
    // Aynı müşteri+ödeme tipinde 2 sipariş tek gruba düşer.
    const o1b = order('o1b', 'cA', 'card', '61000010', [
      item('p9', 'Ürün 9', '10', 1, 'STOK-9'),
    ], cA);
    const svc = makeService([o1, o1b]);
    const res = await svc.preview({ customerId: 'cA', asOf });

    expect(res.invoiceCount).toBe(1);
    const inv = res.invoices[0];
    expect(inv.orderCount).toBe(2);
    expect(inv.orderCodes).toEqual(['61000001', '61000010']);
    // Üst OrderCode artık virgüllü liste değil; sipariş no'ları satırlarda görünür.
    expect((inv.birfaturaOrder as AnyOrder).OrderCode).toEqual(
      expect.stringContaining('Toplu Fatura'),
    );
  });

  it('kurumsal müşteri → TaxNo set, SSNTCNo yok', async () => {
    const svc = makeService([o3]);
    const res = await svc.preview({ customerId: 'cB', asOf });
    const inv = res.invoices[0];
    const bf = inv.birfaturaOrder as AnyOrder;

    expect(inv.isCorporate).toBe(true);
    expect(bf.TaxNo).toBe('1234567890');
    expect(bf.TaxOffice).toBe('Kadıköy');
    expect(bf.SSNTCNo).toBeUndefined();
  });

  it('bireysel müşteri → SSNTCNo set, TaxNo yok', async () => {
    const svc = makeService([o1]);
    const res = await svc.preview({ customerId: 'cA', asOf });
    const inv = res.invoices[0];
    const bf = inv.birfaturaOrder as AnyOrder;

    expect(inv.isCorporate).toBe(false);
    expect(bf.SSNTCNo).toBe('12345678901');
    expect(bf.TaxNo).toBeUndefined();
  });

  it('§2 motoru tutarları: paketleme her ürün matrahına gömülü (+4.00), ayrı satır YOK', async () => {
    const svc = makeService([o1]); // P1 x2 @100 (KDV hariç)
    const res = await svc.preview({ customerId: 'cA', asOf });
    const inv = res.invoices[0];

    // Matrah/adet = 100 + 4 = 104, dahil 124.80. 2 adet → 208 hariç, 249.60 dahil.
    // (Toplam eski "ayrı paketleme satırı" modeliyle birebir aynı; yalnız sunum değişti.)
    expect(inv.productsTotalTaxExcluding).toBeCloseTo(208, 4);
    expect(inv.productsTotalTaxIncluding).toBeCloseTo(249.6, 4);
    expect(inv.totalPaidTaxExcluding).toBeCloseTo(208, 4);
    expect(inv.totalPaidTaxIncluding).toBeCloseTo(249.6, 4);
    expect(inv.totalQuantity).toBe(2);

    // Tek satır: ürün (paketleme matraha gömülü). Ayrı "Kargo Bedeli" satırı YOK.
    expect(inv.lines.length).toBe(1);
    const productLine = inv.lines[0];
    expect(productLine.isPackaging).toBe(false);
    expect(productLine.productCode).toBe('STOK-1');
    expect(productLine.unitPriceTaxExcluding).toBeCloseTo(104, 4);
    expect(productLine.unitPriceTaxIncluding).toBeCloseTo(124.8, 4);
    expect(productLine.lineTotalTaxIncluding).toBeCloseTo(249.6, 4);
  });

  it('cari ödeme tipi → PaymentTypeId 2 / "Cari Bakiye" etiketi', async () => {
    const svc = makeService([o2]);
    const res = await svc.preview({ customerId: 'cA', asOf });
    const inv = res.invoices[0];

    expect(inv.paymentType).toBe('cari');
    expect(inv.paymentTypeId).toBe(2);
    expect(inv.paymentTypeLabel).toBe('Cari Bakiye');
    expect((inv.birfaturaOrder as AnyOrder).PaymentTypeId).toBe(2);
  });
});

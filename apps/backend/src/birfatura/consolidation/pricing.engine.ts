import { Prisma } from '@prisma/client';
import { vatAdd, vatRemove } from '../birfatura.utils';

/**
 * Konsolide (toplu) fatura fiyat & KDV motoru — birfatura.md §2.
 *
 * Tek doğruluk kaynağı: hem freeze (snapshot) hem `/api/orders/` (BirFatura'ya
 * gönderilen JSON) hem de önizleme **aynı** bu motoru çağırır → tutar her yerde
 * birebir aynı (§8 "önizleme = kesilen fatura").
 *
 * Kesin kurallar (§1/§2):
 *  - matrah = `OrderItem.unitPrice` (zaten bayi-indirimli net). **Çarpan YOK.**
 *  - KDV sabit **%20** (ürün `taxRate` OKUNMAZ).
 *  - İndirim faturada ayrı satır DEĞİL (Discount* = 0); indirimli fiyat matrahtır.
 *  - Paketleme AYRI SATIR DEĞİL (bayi talebi): her siparişin GERÇEK paketleme
 *    ücreti (order.packagingCost) o siparişin ürün matrahlarına PER-UNIT gömülür
 *    (`orderPackagingUnitExcl`). Böylece fatura toplamı = bayinin ödediği (Σ order.total)
 *    BİREBİR — paketlemesiz/farklı eski siparişlerde FAZLA yazmaz. "Kargo Bedeli"
 *    diye ayrı kalem YOK.
 *  - Tüm para `Prisma.Decimal`, **yuvarlanmadan** taşınır (gönderimde
 *    `Number(d.toString())`).
 */

/** §2: KDV sabit %20 — ürün taxRate'i bilinçli olarak okunmaz. */
export const CONSOLIDATION_VAT_RATE = 20;

/**
 * Paketleme "Kargo Bedeli" satırı sabitleri (§2 / §11.1).
 * `ProductId` ve `ProductQuantityType` BirFatura'da ZORUNLU — gönderilmezse
 * kalem reddedilir. `ProductCode` boş string gider (Go faturasında stok kodu
 * boş görünür) ama JSON'da alan MEVCUTTUR.
 */
export const PACKAGING_PRODUCT_ID = 999000001;
export const PACKAGING_PRODUCT_CODE = '';
export const PACKAGING_PRODUCT_NAME = 'Kargo Bedeli';
export const PACKAGING_QUANTITY_TYPE = 'Adet';

/** Varsayılan paketleme birim ücreti (KDV dahil) — AppSetting yoksa fallback. */
export const DEFAULT_PACKAGING_UNIT_FEE = '4.8';

/** Decimal'e güvenli çevrim (number | string | Decimal kabul eder). */
type DecimalInput = Prisma.Decimal | string | number;

function toDecimal(value: DecimalInput): Prisma.Decimal {
  return value instanceof Prisma.Decimal
    ? value
    : new Prisma.Decimal(value);
}

/** Motora giren tek bir ürün kalemi (matrah = unitPrice + paketleme, KDV hariç). */
export interface PricingItemInput {
  /** Bayi-indirimli net birim fiyat (KDV hariç) — `OrderItem.unitPrice`. */
  unitPrice: DecimalInput;
  /** Adet — `OrderItem.qty`. */
  qty: number;
  /**
   * Bu kalemin ait olduğu siparişin BİRİM BAŞINA paketleme matrahı (KDV hariç) —
   * `orderPackagingUnitExcl(order.packagingCost, siparişToplamAdet)`. Verilirse
   * her kaleme bu eklenir (sipariş-bazlı GERÇEK paketleme). Verilmezse 2. parametre
   * `packagingUnitFee`'den düz hesaplanır (geriye dönük uyumluluk).
   */
  packagingUnitExcl?: DecimalInput;
}

/**
 * Bir siparişin BİRİM BAŞINA paketleme matrahını (KDV hariç) verir. `packagingCost`
 * KDV-hariç düz ücrettir ve sipariş toplamına KDV'siz eklenmiştir; faturadaki
 * KDV-dahil yansıması packagingCost'a eşit olsun (fatura = bayinin ödediği) diye
 * matrah = packagingCost / 1.20, sipariş adedine bölünür. Paketlemesiz/0 → 0.
 */
export function orderPackagingUnitExcl(
  packagingCost: DecimalInput | null | undefined,
  orderTotalQty: number,
): Prisma.Decimal {
  if (packagingCost == null || orderTotalQty <= 0) return new Prisma.Decimal(0);
  return vatRemove(toDecimal(packagingCost), CONSOLIDATION_VAT_RATE).div(
    orderTotalQty,
  );
}

/**
 * KART KOMİSYONU gömme (işletme kuralı — faturada AYRI KALEM DEĞİL):
 * `Order.cardCommissionAmount` (KDV DAHİL brüt; örn. %3) önce KDV'sizleştirilir
 * (÷1.20), sonra siparişin ürün kalemlerine MATRAH PAYINA GÖRE ORANSAL
 * dağıtılır ve her kalem için BİRİM BAŞINA matrah eklentisi döndürülür
 * (girdi sırasıyla). Son kaleme kalan yedirilir → Σ payı = komisyonNet
 * BİREBİR, böylece fatura toplamı (net+KDV) karttan çekilen tutarla kuruşu
 * kuruşuna eşittir. Komisyonsuz (cari) siparişte sıfırlar döner.
 *
 * Örn. 1.200 TL sipariş + 36 komisyon → komisyonNet 30; kalemler 600/300
 * matrahlı ise paylar 20/10 → birimler +10/+10 → fatura 1.236,00.
 */
export function orderCommissionUnitExclShares(
  cardCommissionAmount: DecimalInput | null | undefined,
  items: ReadonlyArray<{ unitPrice: DecimalInput; qty: number }>,
): Prisma.Decimal[] {
  const zeros = items.map(() => new Prisma.Decimal(0));
  if (cardCommissionAmount == null || items.length === 0) return zeros;
  const commissionNet = vatRemove(
    toDecimal(cardCommissionAmount),
    CONSOLIDATION_VAT_RATE,
  );
  if (commissionNet.lessThanOrEqualTo(0)) return zeros;
  const lineNets = items.map((it) => toDecimal(it.unitPrice).mul(it.qty));
  const productsNet = lineNets.reduce(
    (a, b) => a.add(b),
    new Prisma.Decimal(0),
  );
  if (productsNet.lessThanOrEqualTo(0)) return zeros;
  let assigned = new Prisma.Decimal(0);
  return items.map((it, i) => {
    let share: Prisma.Decimal;
    if (i === items.length - 1) {
      // Kalan son kaleme — oransal payların toplamı komisyonNet'i birebir tutsun.
      share = commissionNet.sub(assigned);
    } else {
      share = commissionNet.mul(lineNets[i]).div(productsNet);
      assigned = assigned.add(share);
    }
    return it.qty > 0 ? share.div(it.qty) : new Prisma.Decimal(0);
  });
}

/** Fiyatlandırılmış ürün satırı (kalem başına). */
export interface PricedProductLine {
  qty: number;
  vatRate: number;
  unitPriceTaxExcluding: Prisma.Decimal;
  unitPriceTaxIncluding: Prisma.Decimal;
  lineTotalTaxExcluding: Prisma.Decimal;
  lineTotalTaxIncluding: Prisma.Decimal;
}

/** Fiyatlandırılmış "Kargo Bedeli" paketleme satırı (batch'te tek). */
export interface PricedPackagingLine {
  productId: number;
  productCode: string;
  productName: string;
  productQuantityType: string;
  qty: number;
  vatRate: number;
  unitPriceTaxExcluding: Prisma.Decimal;
  unitPriceTaxIncluding: Prisma.Decimal;
  lineTotalTaxExcluding: Prisma.Decimal;
  lineTotalTaxIncluding: Prisma.Decimal;
}

/** Motor çıktısı — satırlar + batch toplamları. */
export interface BatchPricing {
  /** Ürün satırları (matrah = unitPrice + paketleme eklentisi), girdi sırasıyla. */
  productLines: PricedProductLine[];
  /** Toplam ürün adedi (Σ item.qty). */
  totalQty: number;
  productsTotalTaxExcluding: Prisma.Decimal;
  productsTotalTaxIncluding: Prisma.Decimal;
  /** §2: TotalPaid = ProductsTotal (paketleme satır olarak içinde, çift sayım yok). */
  totalPaidTaxExcluding: Prisma.Decimal;
  totalPaidTaxIncluding: Prisma.Decimal;
}

/**
 * §2 motoru: ürün kalemleri + paketleme birim ücretinden konsolide satırları ve
 * batch toplamlarını üretir. Saf fonksiyon, yan etki yok, yuvarlama yok.
 *
 * @param items ürün kalemleri (her biri matrah=unitPrice + qty)
 * @param packagingUnitFee paketleme birim ücreti (KDV DAHIL; örn 4.80) —
 *   `pricing.packagingUnitFee` AppSetting değeri
 */
export function computeBatchPricing(
  items: ReadonlyArray<PricingItemInput>,
  packagingUnitFee: DecimalInput = 0,
): BatchPricing {
  const vatRate = CONSOLIDATION_VAT_RATE;

  // Paketleme AYRI SATIR DEĞİL: her ürünün matrahına PER-UNIT eklenir (KDV-dahil
  // yansıması = ödenen). ÖNCELİK: kalemin `packagingUnitExcl`'i (sipariş-bazlı
  // GERÇEK paketleme) — eski/paketlemesiz siparişte 0 olur, fazla yazmaz. Yoksa
  // 2. parametre `packagingUnitFee`'den düz hesap (geriye dönük uyumluluk).
  const flatAddExcl = vatRemove(toDecimal(packagingUnitFee), vatRate);

  const productLines: PricedProductLine[] = items.map((item) => {
    const addExcl =
      item.packagingUnitExcl !== undefined
        ? toDecimal(item.packagingUnitExcl)
        : flatAddExcl;
    const unitExcl = toDecimal(item.unitPrice).add(addExcl);
    const unitIncl = vatAdd(unitExcl, vatRate);
    return {
      qty: item.qty,
      vatRate,
      unitPriceTaxExcluding: unitExcl,
      unitPriceTaxIncluding: unitIncl,
      lineTotalTaxExcluding: unitExcl.mul(item.qty),
      lineTotalTaxIncluding: unitIncl.mul(item.qty),
    };
  });

  const totalQty = items.reduce((acc, item) => acc + item.qty, 0);

  const productsTotalTaxExcluding = productLines.reduce(
    (acc, line) => acc.add(line.lineTotalTaxExcluding),
    new Prisma.Decimal(0),
  );
  const productsTotalTaxIncluding = productLines.reduce(
    (acc, line) => acc.add(line.lineTotalTaxIncluding),
    new Prisma.Decimal(0),
  );

  return {
    productLines,
    totalQty,
    productsTotalTaxExcluding,
    productsTotalTaxIncluding,
    // §2: Products + Shipping(0) − Discount(0) = TotalPaid. Paketleme matraha gömülü.
    totalPaidTaxExcluding: productsTotalTaxExcluding,
    totalPaidTaxIncluding: productsTotalTaxIncluding,
  };
}

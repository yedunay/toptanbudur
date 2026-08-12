import { Prisma } from '@prisma/client';
import { computeBatchPricing, CONSOLIDATION_VAT_RATE } from './pricing.engine';

/** Test kısayolu — Decimal → number (toBeCloseTo karşılaştırması için). */
const n = (d: Prisma.Decimal) => Number(d.toString());

describe('computeBatchPricing — konsolide fiyat & KDV motoru (§2)', () => {
  // pricing.packagingUnitFee (KDV dahil 4.80) → her ürün matrahına +4.00 eklenir.
  const PACKAGING_FEE = '4.8';

  describe('ürün satırı matrahı — paketleme (matrah +4.00) HER ürüne gömülü', () => {
    it('indirimli ürün: unitPrice=80 → matrah 84 (80+4), dahil 100.80, KDV %20', () => {
      const { productLines } = computeBatchPricing(
        [{ unitPrice: '80', qty: 1 }],
        PACKAGING_FEE,
      );

      expect(productLines).toHaveLength(1);
      const line = productLines[0];
      expect(line.vatRate).toBe(20);
      expect(n(line.unitPriceTaxExcluding)).toBeCloseTo(84, 4);
      expect(n(line.unitPriceTaxIncluding)).toBeCloseTo(100.8, 4);
      expect(n(line.lineTotalTaxExcluding)).toBeCloseTo(84, 4);
      expect(n(line.lineTotalTaxIncluding)).toBeCloseTo(100.8, 4);
    });

    it('indirimsiz ürün: unitPrice=100 → matrah 104, dahil 124.80', () => {
      const { productLines } = computeBatchPricing(
        [{ unitPrice: '100', qty: 1 }],
        PACKAGING_FEE,
      );

      const line = productLines[0];
      expect(n(line.unitPriceTaxExcluding)).toBeCloseTo(104, 4);
      expect(n(line.unitPriceTaxIncluding)).toBeCloseTo(124.8, 4);
    });

    it('adet > 1: eklenti PER-UNIT (unitPrice=80 × 3 → matrah 84/adet, satır 252/302.40)', () => {
      const { productLines } = computeBatchPricing(
        [{ unitPrice: '80', qty: 3 }],
        PACKAGING_FEE,
      );

      const line = productLines[0];
      expect(line.qty).toBe(3);
      expect(n(line.unitPriceTaxExcluding)).toBeCloseTo(84, 4);
      expect(n(line.lineTotalTaxExcluding)).toBeCloseTo(252, 4); // 84 × 3
      expect(n(line.lineTotalTaxIncluding)).toBeCloseTo(302.4, 4); // 100.80 × 3
    });

    it('KDV daima 20 — ürün taxRate okunmaz (§2)', () => {
      const { productLines } = computeBatchPricing(
        [{ unitPrice: '50', qty: 1 }],
        PACKAGING_FEE,
      );
      expect(productLines[0].vatRate).toBe(CONSOLIDATION_VAT_RATE);
      expect(productLines[0].vatRate).toBe(20);
    });

    it('ondalıklı net yuvarlanmadan korunur (83.33 + 4 = 87.33 → 104.796)', () => {
      const { productLines } = computeBatchPricing(
        [{ unitPrice: '83.33', qty: 1 }],
        PACKAGING_FEE,
      );
      expect(n(productLines[0].unitPriceTaxExcluding)).toBeCloseTo(87.33, 4);
      expect(n(productLines[0].unitPriceTaxIncluding)).toBeCloseTo(104.796, 4);
    });

    it('ayrı "Kargo Bedeli" satırı YOK — packaging alanı dönmez', () => {
      const result = computeBatchPricing(
        [{ unitPrice: '80', qty: 1 }],
        PACKAGING_FEE,
      );
      expect(
        (result as unknown as Record<string, unknown>).packaging,
      ).toBeUndefined();
      expect(result.productLines).toHaveLength(1); // yalnız ürün satırı
    });

    it('eklenti = paketleme KDV-dahil / 1.20 (4.80 → +4.00); fee 6.00 → +5.00', () => {
      const a = computeBatchPricing([{ unitPrice: '100', qty: 1 }], '4.8');
      expect(n(a.productLines[0].unitPriceTaxExcluding)).toBeCloseTo(104, 4); // 100 + 4
      const b = computeBatchPricing([{ unitPrice: '100', qty: 1 }], '6.0');
      expect(n(b.productLines[0].unitPriceTaxExcluding)).toBeCloseTo(105, 4); // 100 + 6/1.2
    });
  });

  describe('batch toplamları (§2) — toplam DEĞİŞMEZ (paketleme matraha gömülü)', () => {
    it('80×3 + 100×2 (+4/adet): ProductsTotal 460 hariç / 552 dahil', () => {
      // matrah: 84×3 + 104×2 = 252 + 208 = 460
      // dahil:  100.80×3 + 124.80×2 = 302.40 + 249.60 = 552
      const result = computeBatchPricing(
        [
          { unitPrice: '80', qty: 3 },
          { unitPrice: '100', qty: 2 },
        ],
        PACKAGING_FEE,
      );

      expect(n(result.productsTotalTaxExcluding)).toBeCloseTo(460, 4);
      expect(n(result.productsTotalTaxIncluding)).toBeCloseTo(552, 4);
    });

    it('TotalPaid = ProductsTotal (Shipping=0, Discount=0)', () => {
      const result = computeBatchPricing(
        [{ unitPrice: '80', qty: 1 }],
        PACKAGING_FEE,
      );
      expect(n(result.totalPaidTaxExcluding)).toBeCloseTo(
        n(result.productsTotalTaxExcluding),
        4,
      );
      expect(n(result.totalPaidTaxIncluding)).toBeCloseTo(
        n(result.productsTotalTaxIncluding),
        4,
      );
    });

    it('Products + Shipping(0) − Discount(0) = TotalPaid birebir (BirFatura reddetmez)', () => {
      const result = computeBatchPricing(
        [
          { unitPrice: '80', qty: 3 },
          { unitPrice: '100', qty: 2 },
        ],
        PACKAGING_FEE,
      );
      expect(n(result.totalPaidTaxExcluding)).toBeCloseTo(
        n(result.productsTotalTaxExcluding),
        4,
      );
      expect(n(result.totalPaidTaxIncluding)).toBeCloseTo(
        n(result.productsTotalTaxIncluding),
        4,
      );
    });
  });

  describe('girdi türleri & kenar durumlar', () => {
    it('Decimal / string / number girdileri eşdeğer sonuç verir', () => {
      const asString = computeBatchPricing([{ unitPrice: '80', qty: 1 }], '4.8');
      const asNumber = computeBatchPricing([{ unitPrice: 80, qty: 1 }], 4.8);
      const asDecimal = computeBatchPricing(
        [{ unitPrice: new Prisma.Decimal('80'), qty: 1 }],
        new Prisma.Decimal('4.8'),
      );

      expect(n(asString.productsTotalTaxIncluding)).toBeCloseTo(
        n(asNumber.productsTotalTaxIncluding),
        4,
      );
      expect(n(asNumber.productsTotalTaxIncluding)).toBeCloseTo(
        n(asDecimal.productsTotalTaxIncluding),
        4,
      );
    });

    it('boş kalem listesi: ürün satırı yok, qty 0, toplam 0', () => {
      const result = computeBatchPricing([], PACKAGING_FEE);
      expect(result.productLines).toHaveLength(0);
      expect(result.totalQty).toBe(0);
      expect(n(result.productsTotalTaxExcluding)).toBeCloseTo(0, 4);
      expect(n(result.productsTotalTaxIncluding)).toBeCloseTo(0, 4);
    });

    it('ürün satırı sırası girdiyle birebir korunur (matrah +4)', () => {
      const { productLines } = computeBatchPricing(
        [
          { unitPrice: '10', qty: 1 },
          { unitPrice: '20', qty: 1 },
          { unitPrice: '30', qty: 1 },
        ],
        PACKAGING_FEE,
      );
      expect(n(productLines[0].unitPriceTaxExcluding)).toBeCloseTo(14, 4);
      expect(n(productLines[1].unitPriceTaxExcluding)).toBeCloseTo(24, 4);
      expect(n(productLines[2].unitPriceTaxExcluding)).toBeCloseTo(34, 4);
    });
  });
});

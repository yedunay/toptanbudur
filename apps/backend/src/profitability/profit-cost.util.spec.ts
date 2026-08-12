import {
  calcItemSupplyCost,
  calcItemCollectedKdv,
  calcSupplyKdvPortion,
  calcCardCommissionSpread,
  composeCentralProfit,
} from './profit-cost.util';

/**
 * muhasebe.md Faz 1B — merkezî kâr bileşenleri (saf parçalar).
 *
 * Doğrulama #2: "merkezî kâr çıktısı = net gelir(KDV hariç) − net maliyet
 * (ekstra+indirim dahil) + (%3−%2,79)×total; paketleme kâra dahil; KDV ayrı
 * satır. Aynı sipariş hem KDV-dahil brüt marj hem KDV-hariç net kâr verir."
 *
 * Değişmez (invariant): grossMarginKdvIncl − netKdv = netProfitKdvExcl.
 */
describe('profit-cost.util — merkezî kâr bileşenleri', () => {
  describe('calcItemCollectedKdv', () => {
    it('ürün cirosundan tahsil edilen satış KDV (qty dahil)', () => {
      // 100 TL (KDV hariç) × 2 adet × %20 = 40
      expect(calcItemCollectedKdv(100, 2, 20)).toBeCloseTo(40, 6);
    });

    it('Prisma Decimal benzeri string fiyatı da kabul eder', () => {
      expect(calcItemCollectedKdv('100', 2, 20)).toBeCloseTo(40, 6);
    });
  });

  describe('calcSupplyKdvPortion', () => {
    it('KDV-dahil alış maliyetinden gömülü KDV payını çıkarır', () => {
      // supplyCost 129.6 (KDV dahil), oran %20 → 129.6 × 0.2/1.2 = 21.6
      expect(calcSupplyKdvPortion(129.6, 20)).toBeCloseTo(21.6, 6);
    });

    it('oran 0 ise KDV payı 0', () => {
      expect(calcSupplyKdvPortion(100, 0)).toBe(0);
    });

    it('oran verilmezse %20 varsayar', () => {
      expect(calcSupplyKdvPortion(120)).toBeCloseTo(20, 6);
    });
  });

  describe('calcCardCommissionSpread', () => {
    it('kart ödemesinde (müşteri − gerçek) oran farkı × total', () => {
      // (%3 − %2,79) × 260 = 0.0021 × 260 = 0.546
      const spread = calcCardCommissionSpread({
        paymentType: 'card',
        total: 260,
        customerRate: 3,
        realRate: 2.79,
      });
      expect(spread).toBeCloseTo(0.546, 6);
    });

    it('tutar snapshot varsa onu kullanır (orana düşmez)', () => {
      const spread = calcCardCommissionSpread({
        paymentType: 'card',
        total: 260,
        customerAmount: 7.8, // %3 × 260
        realAmount: 7.254, // %2,79 × 260
      });
      expect(spread).toBeCloseTo(0.546, 6);
    });

    it('geçmiş sipariş: gerçek oran yoksa aktif POS oranına düşer (karar #2)', () => {
      const spread = calcCardCommissionSpread({
        paymentType: 'card',
        total: 260,
        customerRate: 3,
        realRate: null,
        fallbackRealRate: 2.79,
      });
      expect(spread).toBeCloseTo(0.546, 6);
    });

    it('kart dışı ödemede fark 0', () => {
      expect(
        calcCardCommissionSpread({
          paymentType: 'cari',
          total: 260,
          customerRate: 3,
          realRate: 2.79,
        }),
      ).toBe(0);
    });
  });

  describe('composeCentralProfit — uçtan uca worked example', () => {
    // Sipariş: 1 ürün (100 TL KDV-hariç × 2 adet, satış KDV %20),
    // paketleme 10 TL × 2 (KDV'siz saf kâr), alış 60 TL × 2 %10 indirim,
    // alış KDV %20, tedarikçi ekMaliyet 5 TL, kart %3 / gerçek %2,79, total 260.
    const collectedKdv = calcItemCollectedKdv(100, 2, 20); // 40
    // TEK KAYNAK modeli: indirim artık costPrice'a gömülüdür (ingest tarafında),
    // config'de ayrı indirim alanı yoktur. 60 TL'nin %10 indirimli net hâli =
    // 54 TL'yi doğrudan costPrice olarak veriyoruz (sonuç aynı: 129.6).
    const supplyCost = calcItemSupplyCost(54, 2, {
      purchaseVatRate: 20,
    }); // 54 × 1.2 × 2 = 129.6
    const paidKdv = calcSupplyKdvPortion(supplyCost, 20); // 21.6

    const revenue = 100 * 2 * 1.2 + 10 * 2; // 240 + 20 = 260
    const cost = supplyCost + 5; // 129.6 + 5 = 134.6
    const cardCommissionSpread = calcCardCommissionSpread({
      paymentType: 'card',
      total: 260,
      customerRate: 3,
      realRate: 2.79,
    }); // 0.546

    const central = composeCentralProfit({
      revenue,
      cost,
      collectedKdv,
      paidKdv,
      cardCommissionSpread,
    });

    it('KDV-dahil brüt marj = (gelir − maliyet) + komisyon farkı', () => {
      // (260 − 134.6) + 0.546 = 125.946
      expect(central.grossMarginKdvIncl).toBeCloseTo(125.946, 6);
    });

    it('net KDV = tahsil edilen − ödenen (ayrı satır)', () => {
      // 40 − 21.6 = 18.4
      expect(central.netKdv).toBeCloseTo(18.4, 6);
    });

    it('KDV-hariç net kâr = net gelir − net maliyet + komisyon farkı', () => {
      // net gelir(220) − net maliyet(113) + 0.546 = 107.546
      const netRevenueExcl = revenue - collectedKdv; // 220
      const netCostExcl = cost - paidKdv; // 113
      expect(netRevenueExcl - netCostExcl + cardCommissionSpread).toBeCloseTo(
        107.546,
        6,
      );
      expect(central.netProfitKdvExcl).toBeCloseTo(107.546, 6);
    });

    it('değişmez: brüt marj − net KDV = net kâr', () => {
      expect(central.grossMarginKdvIncl - central.netKdv).toBeCloseTo(
        central.netProfitKdvExcl,
        9,
      );
    });

    it('paketleme net kâra dahil (KDV taşımaz)', () => {
      // Paketleme olmasaydı net kâr 20 TL daha düşük olurdu.
      const withoutPackaging = composeCentralProfit({
        revenue: revenue - 20,
        cost,
        collectedKdv, // paketleme KDV'siz → collectedKdv değişmez
        paidKdv,
        cardCommissionSpread,
      });
      expect(
        central.netProfitKdvExcl - withoutPackaging.netProfitKdvExcl,
      ).toBeCloseTo(20, 6);
    });
  });
});

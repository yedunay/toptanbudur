// ──────────────────────────────────────────────────────────────────────────
//  GERÇEK ALIŞ MALİYETİ — tek kaynak (single source of truth)
//
//  "Karlılık Analizi → Tedarikçi Ayarları" ekranındaki formülün birebir
//  implementasyonu. Hem kâr raporları (admin-profitability, profit-calculator,
//  admin-supplier-current-account) hem de tedarikçi BAKİYE düşümü
//  (supplier-account.deductForOrderByCostTx) bu fonksiyonları kullanır.
//
//  Formül:
//    kalem maliyeti = (maliyetFiyatı × (1 + AlışKDV%) − indirim) × qty
//    ekMaliyet      = SİPARİŞ BAŞINA BİR KEZ (tedarikçi başına)
//
//  ekMaliyet (kargo/ambalaj/hizmet bedeli) 13.06.2026 mutabakatında kanıtlandı:
//  Go (+5) ve Pati (+25) bu bedeli sipariş başına BİR KEZ tahsil ediyor, adet
//  veya kalem başına DEĞİL. Bu yüzden kalem formülünün içinde değil,
//  calcOrderExtraCost ile sipariş düzeyinde eklenir.
//
//  ── CÜZDAN ↔ RAPOR İLİŞKİSİ (ÖNEMLİ) ──────────────────────────────────────
//  • Tedarikçi CÜZDAN düşümü (supplier-account): yalnızca tedarikçiden FİİLEN
//    alınan kalemler/adetler. Depodan gönderilen, depoda aktif rezerve olan
//    ve bayiler-arası iade (dealer_return) kalemleri düşmez (supplierUnitQty=0).
//    Yani cüzdan = "şu an tedarikçiye borçlu olduğumuz nakit".
//  • Kâr RAPORLARI: ekonomik kâr için TÜM kalemlerin mal maliyetini sayar
//    (depo malının da bir alış maliyeti vardır). AMA sipariş-başı ekMaliyet
//    (tedarikçi kargo bedeli) yalnızca o tedarikçiden fiilen alım yapılan
//    siparişlere eklenir (supplierUnitQty(item) > 0 ile) — olmayan bir
//    sevkiyatın kargo bedeli yazılmaz.
//  Sonuç: pür-tedarikçi siparişlerde cüzdan = rapor maliyeti; depo
//  karışan siparişlerde rapor mal maliyetini ekonomik olarak içerir, cüzdan
//  içermez. İki rakam BİLİNÇLİ farklı şeyleri ölçer.
// ──────────────────────────────────────────────────────────────────────────

/**
 * Tedarikçi başına alış-maliyeti ayarı — TEK KAYNAK: Supplier.
 * Eski ProfitabilityConfig (purchaseKdvRate/discount/extraCostTL) kaldırıldı;
 * indirim artık ingest'te costPrice'a gömülü (çift sayım yok). Burada yalnız
 * KDV oranı kalır (net costPrice'ı tedarikçiye ödenen brüt'e çevirmek için).
 */
export interface ProfitCostConfig {
  /** Supplier.purchaseVatRate — alış KDV oranı (10/20). */
  purchaseVatRate?: number | null;
}

/** Kalemin fulfillment/house-stock alanları (eligibility için). */
export interface ItemFulfillmentFields {
  fulfillmentSource?: string | null;
  houseStockDispatchedAt?: Date | string | null;
  houseStockReservedQty?: number | null;
  houseStockReservedUntil?: Date | string | null;
}

/** Prisma Decimal / string / number / null → number (güvenli dönüşüm). */
export function toNum(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'string') return parseFloat(v) || 0;
  if (typeof v === 'number') return v;
  // Prisma Decimal nesnesi
  if (typeof (v as { toString?: () => string }).toString === 'function') {
    return parseFloat((v as { toString: () => string }).toString()) || 0;
  }
  return 0;
}

/**
 * Bir kalemin TEDARİKÇİDEN fiilen alınan adet sayısı. "Ya hep ya hiç"
 * mantığı: depoya rezerve edilen kalem tedarikçi siparişinden KOMPLE
 * çıkarılır.
 *
 * SÜRESİZ TUTMA (29.04.2026 kararı): reservedQty > 0 olan kalem — dispatch
 * edilmiş olsun olmasın, "reservedUntil" geçmiş olsun olmasın — tedarikçiden
 * ASLA otomatik alınmaz. Rezervasyon yalnızca depo sahibi panelde "Tedarikçiye
 * Devret" dediğinde reservedQty=0 yapılarak kalkar. Böylece 03:00 otomatik
 * serbest bırakma kaldırıldıktan sonra bot, evden gönderilecek/gönderilen
 * ürünü bir daha satın almaz (re-buy bug fix).
 *  - fulfillmentSource !== 'supplier' (dealer_return) → 0
 *  - reservedQty > 0 (herhangi bir durum) → 0
 *  - rezervasyon yok → qty
 * `now` artık kullanılmaz; imza geriye dönük uyumluluk için korunur.
 */
export function supplierUnitQty(
  item: ItemFulfillmentFields & { qty: number },
  _now?: number,
): number {
  if (item.fulfillmentSource && item.fulfillmentSource !== 'supplier') return 0;
  // Depo rezervasyonu aktifse (reservedQty > 0) kalem tedarikçiden alınmaz —
  // süreye/dispatch'e bakılmaz. Rezervasyon yalnızca kullanıcı "Tedarikçiye
  // Devret" dediğinde (reservedQty=0) kalkar.
  if ((item.houseStockReservedQty ?? 0) > 0) return 0;
  return item.qty;
}

/** Sipariş içinde bu tedarikçiden FİİLEN alım yapılan (≥1 adet) kalem var mı? */
export function orderHasSupplierPurchase(
  items: Array<ItemFulfillmentFields & { qty: number }>,
  now?: number,
): boolean {
  return items.some((it) => supplierUnitQty(it, now) > 0);
}

/**
 * Bir sipariş kaleminin tedarikçiye ödenen maliyetini döndürür (qty dahil
 * toplam, sipariş-başı ekMaliyet HARİÇ). Config yoksa default: KDV %20,
 * indirim yok. qty parametresi çağırana bırakılır (rapor = item.qty,
 * cüzdan = supplierUnitQty).
 *
 * KDV KAYNAĞI — BİLİNÇLİ KARAR: Alış KDV oranı tedarikçi başına
 * `ProfitabilityConfig.purchaseKdvRate` (admin "Tedarikçi Ayarları"nda set
 * eder), ürünün kendi `Product.taxRate`'i DEĞİL. Sebep: (1) 13.06.2026
 * mutabakatı tüm tedarikçilerde alımın düz %20 KDV ile kapandığını kanıtladı;
 * (2) feed'den gelen Product.taxRate verisi kirli (canlıda 355 üründe %100,
 * 201 üründe %0 gibi geçersiz değerler var) — körü körüne kullanmak cüzdanı
 * 2 katı düşürür. Bir tedarikçinin gerçekten ürün-kategorisi bazında KDV
 * faturaladığı DOĞRULANIRSA, o tedarikçinin config.purchaseKdvRate'i değil,
 * burada sanitize edilmiş (yalnız {0,1,8,10,18,20} kabul) product taxRate
 * okunmalı — bu, tedarikçinin fatura politikasını bilmeyi gerektiren bir
 * iş kararıdır, otomatikleştirilmez.
 */
export function calcItemSupplyCost(
  costPrice: unknown,
  qty: number,
  config: ProfitCostConfig | null | undefined,
): number {
  const baseCost = toNum(costPrice);
  const kdvRate = config?.purchaseVatRate ?? 20;
  // TEK KAYNAK: costPrice zaten indirimli NET alış (ingest'te hesaplanır).
  // Tedarikçiye ÖDENEN tutar = net × (1 + KDV oranı) (brüt, KDV dahil).
  // Ayrı indirim YOK (eski ProfitabilityConfig indirimi kaldırıldı — çift sayım).
  return baseCost * (1 + kdvRate / 100) * qty;
}

/**
 * @deprecated TEK KAYNAK modelde sipariş-başı ek maliyet (eski
 * ProfitabilityConfig.extraCostTL) yok — maliyet tamamen costPrice'tan türer.
 * Geriye dönük uyumluluk için her zaman 0 döner; çağrılar kademeli temizlenir.
 */
export function calcOrderExtraCost(
  _config?: ProfitCostConfig | null | undefined,
): number {
  return 0;
}

// ──────────────────────────────────────────────────────────────────────────
//  MERKEZÎ KÂR BİLEŞENLERİ (muhasebe.md Faz 1B) — saf, test edilebilir parçalar
//
//  Değişmez (invariant): grossMarginKdvIncl − netKdv = netProfitKdvExcl
//  (composeCentralProfit yapısı gereği her zaman sağlar).
//
//  KDV atfı kararı:
//   • Satış KDV'si (collectedKdv): yalnız ÜRÜN cirosundan (unitPrice×qty×oran).
//     Paketleme ücreti KDV'siz saf kâr sayılır → collectedKdv'ye girmez, net
//     kârda tam kalır. Self kargo pass-through KDV'siz.
//   • Alış KDV'si (paidKdv): yalnız ürün alış maliyetinden (calcSupplyKdvPortion).
//     Tedarikçi-başı ekMaliyet ve kargo KDV atfı taşımaz (net kârdan tam düşer).
// ──────────────────────────────────────────────────────────────────────────

/** Bir kalemde MÜŞTERİDEN tahsil edilen satış KDV'si (qty dahil). */
export function calcItemCollectedKdv(
  unitPrice: unknown,
  qty: number,
  saleKdvRate: number,
): number {
  return toNum(unitPrice) * qty * (saleKdvRate / 100);
}

/**
 * Bir kalemin alış maliyetine GÖMÜLÜ (KDV-dahil tutardan içeri alınmış) KDV
 * payı. supplyCost = calcItemSupplyCost çıktısı (KDV dahil, indirim uygulanmış).
 * İndirim KDV'yi oransal düşürdüğü için pay = supplyCost × r/(1+r), r=oran/100.
 */
export function calcSupplyKdvPortion(
  supplyCost: number,
  purchaseKdvRate?: number | null,
): number {
  const r = (purchaseKdvRate ?? 20) / 100;
  if (r <= 0) return 0;
  return supplyCost * (r / (1 + r));
}

/**
 * Paketleme/hizmet ücretinin KDV-DAHİL tutarından İÇERİ alınmış KDV payı.
 * Kullanıcı kararı (2026-06-24): paketleme ücreti müşteriye KDV-DAHİL yansır
 * (KDV-hariç saf kâr DEĞİL). Bayi ürünü maliyetine alıp tüm kârı bu ücrette
 * elde ettiğimiz modelde, ücretin KDV'si tahsil edilen satış KDV'sine girer →
 * KDV farkında görünür ve net kârdan düşülür. pay = ücret × r/(1+r), r=oran/100.
 */
export function calcPackagingKdvPortion(
  packagingTotal: number,
  saleKdvRate?: number | null,
): number {
  const r = (saleKdvRate ?? 20) / 100;
  if (r <= 0) return 0;
  return packagingTotal * (r / (1 + r));
}

/** Kart komisyon farkı (kâr) hesabı için girdi. */
export interface CardCommissionSpreadInput {
  /** 'card' değilse fark 0. */
  paymentType?: string | null;
  /** Sipariş matrahı (komisyon hariç total). */
  total: unknown;
  /** Müşteriden alınan komisyon tutarı snapshot'ı (varsa). */
  customerAmount?: unknown;
  /** Müşteri komisyon ORANI snapshot'ı (Order.cardCommissionRate). */
  customerRate?: unknown;
  /** POS'a ödenen gerçek komisyon tutarı snapshot'ı (varsa). */
  realAmount?: unknown;
  /** Gerçek komisyon ORANI snapshot'ı (Order.cardCommissionRateActual). */
  realRate?: unknown;
  /** Snapshot yoksa müşteri oranı fallback (aktif PosProvider.customerCommissionRate). */
  fallbackCustomerRate?: unknown;
  /** Snapshot yoksa gerçek oran fallback (aktif PosProvider.commissionRate) — karar #2. */
  fallbackRealRate?: unknown;
}

/**
 * Kart komisyon farkı = müşteriden alınan komisyon − POS'a ödenen gerçek
 * komisyon. Tutar snapshot'ı varsa onu, yoksa oran×total kullanır; geçmiş
 * siparişte gerçek oran yoksa şu anki aktif PosProvider oranına düşer
 * (muhasebe.md karar #2). Kart dışı ödemede 0.
 */
export function calcCardCommissionSpread(
  input: CardCommissionSpreadInput,
): number {
  if (input.paymentType !== 'card') return 0;
  const total = toNum(input.total);
  const customerCommission =
    input.customerAmount != null
      ? toNum(input.customerAmount)
      : (toNum(input.customerRate ?? input.fallbackCustomerRate) / 100) * total;
  const posCost =
    input.realAmount != null
      ? toNum(input.realAmount)
      : (toNum(input.realRate ?? input.fallbackRealRate) / 100) * total;
  return customerCommission - posCost;
}

/** composeCentralProfit girdisi (sipariş düzeyinde toplanmış parçalar). */
export interface CentralProfitParts {
  /** KDV-dahil toplam gelir (ürün KDV-dahil + paketleme + self kargo). */
  revenue: number;
  /** KDV-dahil toplam maliyet (alış KDV-dahil + ekMaliyet + self kargo). */
  cost: number;
  /** Tahsil edilen satış KDV'si toplamı. */
  collectedKdv: number;
  /** Alışta ödenen KDV toplamı. */
  paidKdv: number;
  /** Kart komisyon farkı (kâr). */
  cardCommissionSpread: number;
}

/** Merkezî kâr çıktısı (muhasebe.md karar #1: üç satır birlikte). */
export interface CentralProfit {
  /** KDV-dahil brüt marj = (gelir − maliyet) + komisyon farkı. */
  grossMarginKdvIncl: number;
  /** Net KDV = tahsil edilen − ödenen (ayrı satır). */
  netKdv: number;
  /** KDV-hariç net kâr = brüt marj − net KDV (merkezî kâr çıktısı). */
  netProfitKdvExcl: number;
}

/**
 * Sipariş düzeyinde toplanmış parçalardan merkezî kârı oluşturur. Değişmez:
 * grossMarginKdvIncl − netKdv = netProfitKdvExcl (yapı gereği daima sağlar).
 */
export function composeCentralProfit(p: CentralProfitParts): CentralProfit {
  const grossMarginKdvIncl = p.revenue - p.cost + p.cardCommissionSpread;
  const netKdv = p.collectedKdv - p.paidKdv;
  const netProfitKdvExcl = grossMarginKdvIncl - netKdv;
  return { grossMarginKdvIncl, netKdv, netProfitKdvExcl };
}

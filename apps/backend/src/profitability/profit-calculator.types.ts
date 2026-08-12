/**
 * Karlılık hesaplama — paylaşılan tipler.
 *
 * Hem admin karlılık analizi endpoint'i hem de günlük Z raporu bu motoru
 * kullanır; "ciro / maliyet / kâr" için tek doğruluk kaynağı burasıdır.
 */

/** OrderItem.costPriceSnapshot yoksa düşülen güncel DB değeri ile birlikte
 *  tedarikçi bazlı karlılık ayarları. */
export interface ProfitConfig {
  supplierId: string;
  purchaseKdvRate: number;
  discountType: string;
  discountValue: string | number;
  extraCostTL: string | number;
}

/** Tek bir tedarikçi için kırılım. */
export interface SupplierBreakdown {
  supplierId: string;
  supplierName: string;
  revenue: number;
  cost: number;
  profit: number;
  margin: number;
  orderCount: number;
  itemCount: number;
}

/** Tek bir sipariş için ciro/maliyet/kâr kırılımı (Z raporu bayi analizi). */
export interface OrderProfitRow {
  orderId: string;
  humanOrderNo: string;
  customerId: string | null;
  customerName: string;
  revenue: number;
  cost: number;
  profit: number;
  itemCount: number;
}

/** `calculate()` çıktısı — bir dönem için toplam karlılık özeti. */
export interface ProfitResult {
  totalRevenue: number;
  totalCost: number;
  totalProfit: number;
  /** Yüzde (0–100). Ciro 0 ise 0. */
  margin: number;
  orderCount: number;
  itemCount: number;
  /** Maliyet snapshot'ı 0/boş olan kalem adedi — kâr "tahmini" uyarısı için. */
  zeroCostItemCount: number;
  bySupplier: SupplierBreakdown[];
}

/** `calculate()` opsiyonları. */
export interface CalculateOptions {
  /** Tek tedarikçiye daralt. */
  supplierId?: string;
  /**
   * Ciroya/maliyete dahil edilecek sipariş statüleri.
   *
   * `pending` OrderStatus'u kaldırıldıktan sonra hem admin karlılığı hem de
   * Z raporu aynı listeyi kullanır: iptal/iade hariç akıştaki tüm statüler.
   * Verilmezse `DEFAULT_PROFIT_STATUSES` kullanılır.
   */
  statuses?: readonly string[];
}

/** Karlılık & ciro hesaplamasına dahil sipariş statüleri. */
export const DEFAULT_PROFIT_STATUSES = [
  'paid',
  'preparing',
  'shipped',
] as const;

/** Z raporu iş kuralı — iptal/iade dışında her şey ciroya dahil. */
export const Z_REPORT_STATUSES = [
  'paid',
  'preparing',
  'shipped',
] as const;

/**
 * Günlük Z raporu — tipler.
 */
import { SupplierBreakdown } from '../profitability/profit-calculator.types';

/** Rapor dönemi — `[from, to]` dahil aralık (Europe/Istanbul gün sınırları). */
export interface ReportPeriod {
  /** Dönem başı — dünün 00:00:00.000'i. */
  from: Date;
  /** Dönem sonu — dünün 23:59:59.999'u. */
  to: Date;
  /** İnsan-okur tarih etiketi, ör. "14.05.2026". */
  label: string;
}

/** Bir sipariş statüsü için adet + ciro kırılımı. */
export interface StatusBreakdownRow {
  status: string;
  orderCount: number;
  revenue: number;
}

/** Ödeme tipi (`card` / `cari` / bilinmiyor) için adet + ciro kırılımı. */
export interface PaymentTypeBreakdownRow {
  /** `card`, `cari` veya `unknown`. */
  paymentType: string;
  orderCount: number;
  revenue: number;
}

/** CSV ekine yazılan tek sipariş satırı. */
export interface OrderCsvRow {
  humanOrderNo: string;
  createdAt: Date;
  status: string;
  customerName: string;
  paymentType: string;
  itemCount: number;
  /** KDV hariç ürün toplamı. */
  subtotal: number;
  kdvAmount: number;
  /** KDV dahil — ciroya yazılan tutar. */
  total: number;
  /**
   * Kalem bazlı kâr (ciroya dahil siparişlerde dolu; iptal/iade satırlarında
   * null — bu siparişler için maliyet hesaplanmaz).
   */
  profit: number | null;
}

/** Trend grafiğindeki tek gün (rapor günü dahil son 8 gün). */
export interface TrendDay {
  /** "12.07.2026" biçiminde gün etiketi. */
  label: string;
  /** Kısa Türkçe gün adı, ör. "Cum". */
  weekday: string;
  /** Net ciro (kısmi iadeler düşülmüş). */
  revenue: number;
  orderCount: number;
  /** Raporun ait olduğu gün mü (grafikte vurgulanır). */
  isReportDay: boolean;
}

/** Karşılaştırma günü (dün öncesi / geçen hafta aynı gün) özeti. */
export interface DayComparison {
  label: string;
  /** Net ciro (kısmi iadeler düşülmüş). */
  revenue: number;
  /** Net kâr (net ciro − maliyet). */
  profit: number;
  orderCount: number;
}

/** Bayi (müşteri) bazlı günlük kırılım satırı. */
export interface CustomerBreakdownRow {
  customerName: string;
  orderCount: number;
  itemCount: number;
  /** Net ciro (o güne düşen kısmi iadeler düşülmüş). */
  revenue: number;
  /** Net kâr. */
  profit: number;
}

/** Saat dilimi (Europe/Istanbul) bazlı sipariş yoğunluğu. */
export interface HourlyRow {
  /** 0–23 (Istanbul duvar saati). */
  hour: number;
  orderCount: number;
  revenue: number;
}

/** "Günün rekoru" tek sipariş vurgusu. */
export interface OrderHighlight {
  humanOrderNo: string;
  customerName: string;
  /** Tutar (en yüksek sipariş için ciro, en kârlı sipariş için kâr). */
  value: number;
}

/**
 * Z raporunun tüm veri yükü. `ZReportService` üretir; `ZReportBuilder`
 * bundan HTML + CSV türetir.
 */
export interface ZReportData {
  tenantId: string;
  period: ReportPeriod;
  /** KDV dahil toplam ciro (iptal/iade hariç tüm statüler). */
  totalRevenue: number;
  /** Tedarikçi bazlı alış maliyeti toplamı. */
  totalCost: number;
  /** `totalRevenue - totalCost` (ürün kârı; kart komisyon kârı HARİÇ). */
  totalProfit: number;
  /**
   * §3.7 — KART KOMİSYON KÂRI: müşteriden alınan komisyon (%3) ile POS'a ödenen
   * gerçek komisyon (~%2,79) arasındaki fark. AYRI kalem — üründen bağımsız ek
   * kâr. Yalnız her iki snapshot'ı (amount + actual) dolu kart siparişlerinden.
   */
  cardCommissionProfit: number;
  /** Kâr marjı yüzdesi (0–100). Ciro 0 ise 0. */
  margin: number;
  /** Döneme düşen benzersiz sipariş adedi. */
  orderCount: number;
  /** Döneme düşen toplam kalem adedi. */
  itemCount: number;
  /** Maliyet snapshot'ı 0 olan kalem adedi — kâr "tahmini" uyarısı için. */
  zeroCostItemCount: number;
  /** İptal edilen sipariş adedi (ciroya dahil değil, bilgi amaçlı). */
  cancelledCount: number;
  /** İade edilen sipariş adedi (ciroya dahil değil, bilgi amaçlı). */
  refundedCount: number;
  /** Ortalama sepet tutarı — net ciro / sipariş adedi (sipariş yoksa 0). */
  avgOrderValue: number;
  /** Bir önceki günün özeti — delta rozetleri bundan hesaplanır. */
  prevDay: DayComparison;
  /** Geçen hafta aynı günün özeti. */
  weekAgo: DayComparison;
  /** Rapor günü dahil son 8 günün ciro/sipariş trendi (eski → yeni). */
  trend: TrendDay[];
  /** Ciroya göre azalan ilk 5 bayi (net ciro + net kâr). */
  topCustomers: CustomerBreakdownRow[];
  /** Sipariş düşen saatler (Istanbul), saat sırasına göre. */
  hourly: HourlyRow[];
  /** Günün en yüksek tutarlı siparişi (sipariş yoksa null). */
  biggestOrder: OrderHighlight | null;
  /** Günün en kârlı siparişi (sipariş yoksa null). */
  mostProfitableOrder: OrderHighlight | null;
  statusBreakdown: StatusBreakdownRow[];
  paymentTypeBreakdown: PaymentTypeBreakdownRow[];
  /** Kâra göre azalan sıralı tedarikçi kırılımı. */
  bySupplier: SupplierBreakdown[];
  /** CSV eki için sipariş satırları. */
  orders: OrderCsvRow[];
}

/** `ZReportBuilder.build()` çıktısı. */
export interface BuiltZReport {
  subject: string;
  html: string;
  csv: { filename: string; content: Buffer };
}

export interface CustomerProfile {
  id: string;
  email: string;
  name: string;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  birthDate?: string | null;
  language?: string | null;
  timezone?: string | null;
  companyTitle?: string | null;
  vergiNo?: string | null;
  vergiDairesi?: string | null;
  mersisNumber?: string | null;
  companyAddress?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  profileCompleted?: boolean;
  createdAt?: string | null;
  // E-posta bildirim tercihleri (opsiyonel sipariş maillerini aç/kapat)
  orderConfirmEmailEnabled?: boolean;
  orderStatusEmailEnabled?: boolean;
  vacationMode?: boolean;
  vacationStartedAt?: string | null;
}

export interface CustomerAddress {
  id: string;
  title: string;
  fullName: string;
  phone: string;
  line1: string;
  line2?: string | null;
  district: string;
  city: string;
  postalCode: string;
  country?: string | null;
  isDefault?: boolean;
  isDefaultShipping?: boolean;
  isDefaultBilling?: boolean;
}

export type AddressInput = Omit<CustomerAddress, "id">;

export interface OrderTrackingEvent {
  status: string;
  label?: string;
  description?: string | null;
  occurredAt: string;
}

export interface OrderItemDetail {
  id?: string;
  productId?: string;
  productSlug?: string | null;
  productName: string;
  imageUrl?: string | null;
  qty: number;
  unitPrice: number;
}

export interface OrderAddressSnapshot {
  fullName: string;
  phone: string;
  line1: string;
  line2?: string | null;
  district: string;
  city: string;
  postalCode: string;
  country?: string | null;
}

export interface OrderDetail {
  id: string;
  number?: string | null;
  status: string;
  total: number;
  subtotal?: number;
  kdvAmount?: number | null;
  kdvRate?: number | null;
  shippingCost?: number;
  /** Paketleme ücreti (KDV-hariç) — snapshot. */
  packagingCost?: number | null;
  /** Sipariş anındaki birim başı paketleme ücreti. */
  packagingUnitFee?: number | null;
  currency: string;
  createdAt: string;
  /** Müşteri ismi — Bayi'nin kendi son müşterisi (teslimat adıyla karışmaz). */
  endCustomerName?: string | null;
  items: OrderItemDetail[];
  shippingAddress?: OrderAddressSnapshot | null;
  billingAddress?: OrderAddressSnapshot | null;
  paymentMethod?: string | null;
  paymentStatus?: string | null;
  /**
   * Bu siparişe ait tahsilat makbuzu var mı? Yalnızca kredi kartıyla ödenmiş
   * siparişlerde backend tarafından true döner — "Tahsilat makbuzu" butonu
   * için kullanılır.
   */
  hasReceipt?: boolean;
  /** Kart komisyon oranı (%) — Decimal string olarak serileşir. */
  cardCommissionRate?: string | number | null;
  /** Kart komisyon tutarı — yalnızca kartlı ödemede dolu. */
  cardCommissionAmount?: number | null;
  /** Cari ödeme öncesi bakiye (yalnızca cari_balance ödemede dolu). */
  cariPreviousBalance?: number | null;
  /** Cari ödeme sonrası kalan bakiye. */
  cariNewBalance?: number | null;
  /** Cariden düşülen tutar (= sipariş tutarı). */
  cariDeducted?: number | null;
  trackingNumber?: string | null;
  carrier?: string | null;
  carrierTrackingUrl?: string | null;
  trackingEvents?: OrderTrackingEvent[];
  /** Satış kanalı (self/other) — onay ekranı rozeti için. */
  marketplace?: string | null;
  /** Bayinin pazaryeri sisteminde girdiği teslimat/kargo barkod numarası. */
  cargoBarcode?: string | null;
  /** Siparişin faturalandığı an (ISO) — toplu fatura kesildiğinde dolar. */
  invoicedAt?: string | null;
  /**
   * Bu siparişin dahil olduğu aylık toplu fatura (varsa). BirFatura entegrasyonu
   * ile "sipariş başına fatura" yerine "bayi başına aylık tek fatura" modeline
   * geçildi — sipariş kesim gününde dondurulan toplu faturaya iliştirilir.
   */
  invoiceBatch?: OrderInvoiceBatch | null;
}

// -----------------------------------------------------------------------------
// TOPLU FATURA (consolidated monthly invoice) — pure types.
// Backend `customer/invoices/customer-invoices.service.ts` DTO'larını birebir
// yansıtır. Hem server hem client tarafından güvenle import edilebilir.
// -----------------------------------------------------------------------------

/** Prisma `InvoiceBatchStatus` enum'unun birebir aynası (lowercase). */
export type InvoiceBatchStatus = "frozen" | "invoiced" | "cancelled";

/** Sipariş detayına gömülen toplu fatura özeti. */
export interface OrderInvoiceBatch {
  id: string;
  status: InvoiceBatchStatus;
  periodStart: string;
  periodEnd: string;
  /** "Haziran 2026" gibi İstanbul saatine göre okunabilir ay etiketi. */
  monthLabel: string;
  invoiceUrl: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  invoicedAt: string | null;
}

/** "Faturalarım" listesindeki tek bir toplu fatura satırı. */
export interface DealerInvoiceBatchRow {
  id: string;
  paymentType: string;
  paymentTypeLabel: string;
  periodStart: string;
  periodEnd: string;
  status: InvoiceBatchStatus;
  orderCount: number;
  productsTotalTaxExcluding: number;
  productsTotalTaxIncluding: number;
  totalPaidTaxExcluding: number;
  totalPaidTaxIncluding: number;
  invoiceUrl: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  invoicedAt: string | null;
  createdAt: string;
}

/** Aya göre gruplanmış toplu fatura listesi. */
export interface DealerInvoiceMonthGroup {
  month: string;
  monthLabel: string;
  batchCount: number;
  totalTaxIncluding: number;
  batches: DealerInvoiceBatchRow[];
}

export interface DealerInvoiceListResponse {
  months: DealerInvoiceMonthGroup[];
  batchCount: number;
}

/** Toplu faturanın kapsadığı tek bir sipariş. */
export interface DealerInvoiceBatchMember {
  id: string;
  humanOrderNo: string;
  status: string;
  shippedAt: string | null;
  invoicedAt: string | null;
  quantity: number;
  itemCount: number;
  totalTaxIncluding: number;
}

/** Toplu faturanın tek bir kalem (ürün/paketleme) satırı. */
export interface DealerInvoiceBatchLine {
  /** Bu satırın ait olduğu siparişin no'su (humanOrderNo, önek yok). */
  orderCode: string;
  productCode: string;
  productName: string;
  quantity: number;
  vatRate: number;
  unitPriceTaxExcluding: number;
  unitPriceTaxIncluding: number;
  lineTotalTaxExcluding: number;
  lineTotalTaxIncluding: number;
  isPackaging: boolean;
}

/** Tek bir toplu faturanın tüm detayları. */
export interface DealerInvoiceBatchDetail extends DealerInvoiceBatchRow {
  monthLabel: string;
  totalQuantity: number;
  members: DealerInvoiceBatchMember[];
  lines: DealerInvoiceBatchLine[];
}

// -----------------------------------------------------------------------------
// CARI BALANCE / STATEMENT — pure types (no server-only).
// Bu tipler hem server hem client tarafından güvenle import edilebilir.
// Müşteri tarafında tedarikçi/alış/kâr/KDV farkı bilgisi YOKTUR.
// -----------------------------------------------------------------------------

export type LedgerEntryType = "TOPUP" | "ORDER_PAYMENT" | "REFUND" | string;
export type TopupStatus = "PENDING" | "APPROVED" | "REJECTED" | string;
export type TopupMethod = "bank_transfer" | "card" | string;

export interface BalanceLedgerEntry {
  id: string;
  type: LedgerEntryType;
  amount: number;
  balanceAfter: number;
  description: string | null;
  createdAt: string;
  orderId: string | null;
  topupId: string | null;
  humanOrderNo: string | null;
  humanTopupNo: string | null;
  topupStatus: TopupStatus | null;
  /** Yükleme yöntemi — 'bank_transfer' | 'card' (eski kayıtlarda null). */
  topupMethod?: TopupMethod | null;
  /**
   * Hediye bakiye kaydı mı? true ise hareket "🎁 Hediye Bakiye" olarak
   * etiketlenir (type teknik olarak ADJUSTMENT'tır).
   */
  isGift?: boolean;
  /**
   * Bu kart yüklemesine ait tahsilat makbuzu var mı? Yalnızca kartla yapılmış
   * yüklemelerde true olur; küçük makbuz ikonu için kullanılır.
   */
  hasReceipt?: boolean;
}

export interface CariStatementQuery {
  from?: string;
  to?: string;
  type?: "TOPUP" | "ORDER_PAYMENT" | "REFUND" | "ADJUSTMENT";
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface CariStatementMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface CariStatementResponse {
  success: boolean;
  data: BalanceLedgerEntry[];
  meta: CariStatementMeta;
}

export interface CariStatementSummaryData {
  currentBalance: number;
  totalLoaded: number;
  totalSpent: number;
  pendingTopupCount: number;
}

export interface CariStatementSummaryResponse {
  success: boolean;
  data: CariStatementSummaryData;
}

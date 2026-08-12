export type TicketStatus = "NEW" | "READ" | "REPLIED" | "ARCHIVED";

// Yeni talep açarken yalnız kargo/iptal/iade/diger sunulur (kullanıcı kararı
// 2026-08-01); kalan değerler ESKİ kayıtların görüntülenmesi için duruyor.
export type TicketCategory =
  | "kargo"
  | "iptal"
  | "iade"
  | "diger"
  | "siparis"
  | "fatura"
  | "teknik"
  | "odeme"
  | "urun"
  | "hesap";

export type MetricTone = "blue" | "green" | "orange" | "purple";

export type TabKey = "all" | "open" | "replied" | "closed";

export interface TicketAttachment {
  id: string;
  filename: string;
  mimetype: string;
  size: number;
  url: string | null;
  createdAt: string;
}

export interface OrderSnapshotItem {
  id: string;
  name: string;
  slug: string;
  qty: number;
  unitPrice: string;
  imageUrl: string | null;
}

export interface OrderSnapshot {
  orderId: string;
  humanOrderNo: string;
  recipientName: string;
  marketplace: string | null;
  cargoCompany: string | null;
  cargoBarcode: string | null;
  total: string;
  currency: string;
  createdAt: string;
  items: OrderSnapshotItem[];
}

export interface Ticket {
  id: string;
  subject: string | null;
  body: string;
  status: TicketStatus;
  adminNote: string | null;
  /** Threaded chat konuşma id'si — varsa tam mesaj geçmişi ChatThread ile yüklenir. */
  conversationId?: string | null;
  /** Backend'in stabil türettiği talep numarası (örn. AB-2026-ABC123). */
  ticketNo?: string | null;
  /** Müşteriye gösterilebilir sipariş + kargo + ürün özeti. Maliyet/tedarikçi alanı içermez. */
  orderSnapshot?: OrderSnapshot | null;
  kind: string | null;
  category: string | null;
  orderId: string | null;
  orderNumber: string | null;
  marketplace: string | null;
  carrier: string | null;
  trackingCode: string | null;
  createdAt: string;
  updatedAt: string;
  attachments?: TicketAttachment[];
  /** İADE akışı durumu — yalnız category='iade' taleplerinde dolu. */
  returnStatus?:
    | "REQUESTED"
    | "APPROVED"
    | "SHIPPED_BACK"
    | "REJECTED"
    | "FINALIZED"
    | null;
  /** Admin onayında iletilen iade adresi (müşteri panelinde de gösterilir). */
  returnAddress?: string | null;
  /** Müşterinin "Ürünü Kargoya Verdim" dediği an. */
  returnShippedAt?: string | null;
}

export interface SupportMetric {
  key: string;
  title: string;
  value: string;
  description: string;
  tone: MetricTone;
}

export interface TicketTableItem {
  id: string;
  ticketNo: string;
  subject: string;
  description: string;
  category: string;
  categoryKey: string;
  status: TicketStatus;
  statusLabel: string;
  updatedAt: string;
  updatedBy: string;
  createdAt: string;
  /** İlk ürünün görseli — talep listesinde önizleme için. */
  productImageUrl: string | null;
  /** İlk ürünün adı — görsel alt metni ve etiket için. */
  productName: string | null;
  /** Siparişin son müşterisi — talep listesinde gösterilir. */
  recipientName: string | null;
  /** Talebe bağlı toplam ürün adedi (1'den fazlaysa "+N" rozeti). */
  itemCount: number;
  /** Müşterinin talebi kendisi kapatabilmesi için kullanılır (yalnız açık talepler). */
  canClose: boolean;
}

export interface SupportSummaryItem {
  label: string;
  count: number;
  percentage: number;
  tone: MetricTone | "gray";
}

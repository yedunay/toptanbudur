export type AccountMenuKey =
  | "overview"
  | "orders"
  | "balance"
  | "current-account"
  | "invoices"
  | "support"
  | "settings"
  | "logout";

export type MetricTone = "blue" | "green" | "orange" | "purple";

/** Satış kanalı — backend MARKETPLACE_VALUES ile birebir aynı. */
export type MarketplaceKey = "self" | "other";

export type CargoKey = "aras" | "surat" | "ptt" | "dhl" | "yurtici";

// Müşteriye gösterilen sade aşamalar (lib/order-customer-status.ts tek kaynağı).
// "Teslim edildi" / "Kargoda" gibi ara/detay ifadeler müşteriye gösterilmez.
export type OrderStatus =
  | "Sipariş Alındı"
  | "Hazırlanıyor"
  | "Kargoya Verildi"
  | "İptal Edildi"
  | "İade Edildi";

export interface AccountUser {
  initials: string;
  name: string;
  companyName: string;
  verified: boolean;
}

export interface OrderMetric {
  title: string;
  value: string;
  description: string;
  tone: MetricTone;
  sparkline: number[];
}

export interface OrderItem {
  id: string;
  productImageTone: MetricTone;
  imageUrl: string | null;
  date: string;
  time: string;
  orderNumber: string;
  /** Müşteri ismi — Bayi'nin kendi son müşterisi. Boşsa "—". */
  endCustomerName: string;
  productName: string;
  productVariant: string;
  marketplace: MarketplaceKey;
  marketplaceBarcode: string;
  cargo: CargoKey;
  status: OrderStatus;
  amount: string;
  /**
   * Bu siparişe ait tahsilat makbuzu var mı? Yalnızca kredi kartıyla ödenmiş
   * siparişlerde true olur — satırda küçük makbuz ikonu gösterilir.
   */
  hasReceipt: boolean;
}

export interface MarketplaceDistributionItem {
  marketplace: MarketplaceKey;
  count: number;
  percentage: string;
  pct: number;
}

export interface CargoDistributionItem {
  cargo: CargoKey;
  count: number;
  percentage: string;
  pct: number;
}

export interface TopProductItem {
  id: string;
  rank: number;
  name: string;
  quantity: string;
}

export interface RecentUpdateItem {
  id: string;
  title: string;
  orderNumber: string;
  date: string;
  tone: MetricTone;
}

export interface OrderSummary {
  totalOrders: string;
  deliveredOrders: string;
  pendingOrders: string;
  monthlySalesAmount: string;
}

export interface StatusCounts {
  total: number;
  preparing: number;
  shipped: number;
  cancelled: number;
  refunded: number;
}

export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface AccountOrdersPageData {
  user: AccountUser;
  metrics: OrderMetric[];
  orders: OrderItem[];
  orderSummary: OrderSummary;
  marketplaceDistribution: MarketplaceDistributionItem[];
  cargoDistribution: CargoDistributionItem[];
  topProducts: TopProductItem[];
  recentUpdates: RecentUpdateItem[];
  statusCounts: StatusCounts;
  pagination: PaginationMeta;
}

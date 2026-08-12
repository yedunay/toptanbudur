export type AccountMenuKey =
  | "overview"
  | "orders"
  | "balance"
  | "support"
  | "settings"
  | "logout";

export type MetricTone = "blue" | "green" | "orange" | "purple";

// Müşteriye gösterilen sade aşamalar (lib/order-customer-status.ts tek kaynağı).
export type OrderStatus =
  | "Sipariş Alındı"
  | "Hazırlanıyor"
  | "Kargoya Verildi"
  | "İptal Edildi"
  | "İade Edildi";

export type MoneyDirection = "positive" | "negative" | "neutral";

export interface AccountUser {
  initials: string;
  name: string;
  companyName: string;
  verified: boolean;
}

export interface OverviewMetric {
  title: string;
  value: string;
  description: string;
  tone: MetricTone;
  sparkline: number[];
}

export interface QuickAction {
  id: string;
  title: string;
  description: string;
  tone: MetricTone;
  href: string;
}

export interface RecentOrder {
  id: string;
  orderNumber: string;
  date: string;
  status: OrderStatus;
  amount: string;
}

export interface BalanceMovement {
  id: string;
  date: string;
  transactionType: string;
  amount: string;
  direction: MoneyDirection;
  status: "Başarılı";
}

export interface Announcement {
  id: string;
  title: string;
  description: string;
  date: string;
  tone: MetricTone;
}

export interface OrderFlowStep {
  id: string;
  label: string;
  count: string;
  tone: MetricTone;
}

export interface OrderDistributionRow {
  label: string;
  value: number;
  tone: MetricTone;
}

export interface AccountOverviewPageData {
  user: AccountUser;
  updatedAt: string;
  metrics: OverviewMetric[];
  quickActions: QuickAction[];
  recentOrders: RecentOrder[];
  balanceMovements: BalanceMovement[];
  announcements: Announcement[];
  orderFlow: OrderFlowStep[];
  orderDistribution: OrderDistributionRow[];
}

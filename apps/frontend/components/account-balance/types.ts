export type MoneyDirection = "positive" | "negative" | "neutral";

export type BalanceStatus =
  | "Başarılı"
  | "Tamamlandı"
  | "Onaylandı"
  | "Beklemede"
  | "Reddedildi";

export type BalanceMetricTone = "green" | "blue" | "orange" | "purple";

export interface BalanceMetric {
  title: string;
  value: string;
  description?: string;
  tone: BalanceMetricTone;
  sparkline: number[];
}

export interface BankAccountInfo {
  bankName: string;
  accountHolder: string;
  iban: string;
  branch: string;
  reference: string;
  isActive: boolean;
}

export interface BalanceHistoryItem {
  id: string;
  date: string;
  transactionType: string;
  description: string;
  paymentMethod: string;
  amount: string;
  direction: MoneyDirection;
  status: BalanceStatus;
  referenceNo: string;
  /** İlgili sipariş kimliği (varsa). Sipariş detayına link için kullanılır. */
  orderId?: string | null;
  /** İnsan-okunur sipariş numarası (varsa). */
  humanOrderNo?: string | null;
  /** İlgili kart yükleme kimliği (varsa). Makbuz indirme linki için kullanılır. */
  topupId?: string | null;
  /**
   * Bu satıra ait tahsilat makbuzu var mı? Yalnızca kartla yapılmış cari
   * yüklemelerde true olur; küçük makbuz ikonu için kullanılır.
   */
  hasReceipt?: boolean;
}

export interface RecentMovement {
  id: string;
  title: string;
  date: string;
  amount: string;
  direction: MoneyDirection;
}

export interface SuggestionItem {
  id: string;
  title: string;
  description: string;
  tone: BalanceMetricTone;
}

export interface BalanceSummary {
  availableBalance: string;
  blockedAmount: string;
  monthlyTopUp: string;
  monthlyUsage: string;
}

export interface UsageSummary {
  usedLastThirtyDays: string;
  averageOrderDeduction: string;
  lastTopUp: string;
  lastTopUpDate: string;
  bars: number[];
}

/**
 * HEDİYE BAKİYE kampanya rozeti — müşteriye hediye bakiye tanımlandıysa ana
 * bakiye kartında büyük harflerle "HEDİYE BAKİYE" gösterilir.
 */
export interface GiftBadge {
  /** Ömür boyu tanımlanan toplam hediye (formatlı, ör. "250,00 ₺"). */
  totalLabel: string;
  /** Kaç kez hediye tanımlandı. */
  count: number;
}

export interface AccountBalancePageData {
  updatedAt: string;
  metrics: BalanceMetric[];
  mainBalance: string;
  mainTrend: number[];
  bankAccounts: BankAccountInfo[];
  usageSummary: UsageSummary;
  balanceSummary: BalanceSummary;
  history: BalanceHistoryItem[];
  recentMovements: RecentMovement[];
  suggestions: SuggestionItem[];
  historyDateRange: string;
  /** Hediye bakiye tanımlanmışsa kampanya rozeti; yoksa null. */
  gift: GiftBadge | null;
}

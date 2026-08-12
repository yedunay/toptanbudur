// Müşteri tarafı tipler — burada `supplierName`, `costPrice`, `profit`,
// `vatDifference` gibi hassas alanlar OLMAMALI. Bunlar yalnızca admin tarafına
// aittir (apps/admin/src/features/supplier-current-account).

export type CurrentAccountTransactionType =
  | "TOPUP"
  | "ORDER_PAYMENT"
  | "REFUND"
  | "ADJUSTMENT";

export interface CurrentAccountStatementRow {
  id: string;
  dateIso: string;
  type: CurrentAccountTransactionType;
  description: string;
  humanOrderNo: string | null;
  /** İlgili sipariş kimliği (varsa). Sipariş detayına link için kullanılır. */
  orderId: string | null;
  /** Bakiye girişi (TOPUP / REFUND / pozitif ADJUSTMENT). Diğer durumlarda `null`. */
  loadedAmount: number | null;
  /** Bakiye düşümü (ORDER_PAYMENT / negatif ADJUSTMENT). Diğer durumlarda `null`. */
  spentAmount: number | null;
  /** İlgili hareket sonrası bakiye (CariLedger.balanceAfter snapshot). */
  balance: number;
}

export interface CurrentAccountSummary {
  currentBalance: number;
  totalLoaded: number;
  totalSpent: number;
  pendingTopupCount: number;
}

export interface CurrentAccountPageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface CurrentAccountFilters {
  from?: string;
  to?: string;
  type?: CurrentAccountTransactionType | "";
  search?: string;
}

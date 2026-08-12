import "server-only";

import { cookies } from "next/headers";
import type {
  BalanceLedgerEntry,
  CariStatementMeta,
  CariStatementQuery,
  CariStatementResponse,
  CariStatementSummaryData,
  CariStatementSummaryResponse,
  DealerInvoiceBatchDetail,
  DealerInvoiceListResponse,
  LedgerEntryType,
  TopupStatus,
} from "./customer-types";

// Re-export shared types so existing consumers that import from
// "@/lib/customer-api" keep compiling. New client code MUST import these
// from "@/lib/customer-types" directly to avoid pulling in server-only deps.
export type {
  BalanceLedgerEntry,
  CariStatementMeta,
  CariStatementQuery,
  CariStatementResponse,
  CariStatementSummaryData,
  CariStatementSummaryResponse,
  DealerInvoiceBatchDetail,
  DealerInvoiceListResponse,
  LedgerEntryType,
  TopupStatus,
};

const SESSION_COOKIE_NAME = "tb_session";
const API_BASE =
  process.env.TB_API_BASE ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:4000";

export interface OverviewCustomer {
  id: string;
  name: string;
  email: string;
  xmlToken: string | null;
  cariBalance: number;
}

export interface OverviewMetrics {
  cariBalance: number;
  last30DaysOrderCount: number;
  pendingOrderCount: number;
  // `shipped` artık terminal teslimat statüsü — biz tedarikçiyiz; kargoya
  // teslim sonrası akış (`delivered`) backend'den kaldırıldı. Bu sayı "tamamlanan
  // / teslim edilen" sipariş olarak yorumlanır.
  shippedOrderCount: number;
  cancelledOrderCount: number;
  refundedOrderCount: number;
  totalOrderCount: number;
}

export interface OverviewOrderFlow {
  received: number;
  preparing: number;
  shipped: number;
  cancelled: number;
  refunded: number;
}

export interface OverviewRecentOrder {
  id: string;
  humanOrderNo: string | null;
  status: string;
  total: number;
  currency: string;
  createdAt: string;
}

export interface OverviewBalanceMovement {
  id: string;
  type: string;
  amount: number;
  direction: "positive" | "negative";
  balanceAfter: number;
  description: string | null;
  createdAt: string;
}

export interface OverviewResponse {
  success: boolean;
  data: {
    customer: OverviewCustomer;
    metrics: OverviewMetrics;
    orderFlow: OverviewOrderFlow;
    recentOrders: OverviewRecentOrder[];
    balanceMovements: OverviewBalanceMovement[];
    last7DaysOrderCounts: number[];
  };
}

export interface OrdersListItem {
  id: string;
  humanOrderNo: string | null;
  status: string;
  /**
   * Bu siparişe ait tahsilat makbuzu var mı? Yalnızca kredi kartıyla ödenmiş
   * siparişlerde true olur; sipariş satırındaki küçük makbuz ikonu için.
   */
  hasReceipt: boolean;
  total: number;
  subtotal: number | null;
  kdvAmount: number | null;
  currency: string;
  marketplace: string | null;
  cargoCompany: string | null;
  cargoBarcode: string | null;
  /** Müşteri ismi — Bayi'nin kendi son müşterisi (teslimat adıyla karışmaz). */
  endCustomerName: string | null;
  trackingNumber: string | null;
  items: {
    id: string;
    slug: string;
    name: string;
    qty: number;
    unitPrice: number;
    imageUrl: string | null;
  }[];
  createdAt: string;
  updatedAt: string;
}

export interface OrdersListResponse {
  success: boolean;
  data: OrdersListItem[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface OrdersSummaryResponse {
  success: boolean;
  data: {
    totalOrders: number;
    shippedOrders: number;
    pendingOrders: number;
    cancelledOrders: number;
    refundedOrders: number;
    totalAmount: number;
  };
}

export interface OrdersDashboardResponse {
  success: boolean;
  data: {
    marketplaceDistribution: {
      marketplace: string;
      count: number;
      percentage: number;
    }[];
    topProducts: {
      rank: number;
      productSlug: string;
      productName: string;
      qty: number;
    }[];
    recentUpdates: {
      id: string;
      humanOrderNo: string | null;
      status: string;
      updatedAt: string;
    }[];
    monthlySalesAmount: number;
    dailyOrderCounts: number[];
    dailySalesAmounts: number[];
  };
}

export interface OrderDetailResponse {
  success: boolean;
  data: {
    id: string;
    humanOrderNo: string | null;
    status: string;
    total: number;
    subtotal: number | null;
    kdvAmount: number | null;
    kdvRate: number | null;
    packagingCost: number | null;
    packagingUnitFee: number | null;
    currency: string;
    marketplace: string | null;
    cargoCompany: string | null;
    cargoBarcode: string | null;
    /** Müşteri ismi — Bayi'nin kendi son müşterisi (teslimat adıyla karışmaz). */
    endCustomerName: string | null;
    trackingNumber: string | null;
    items: {
      id: string;
      slug: string;
      name: string;
      price: number;
      priceOriginal: number | null;
      discountPercent: number | null;
      qty: number;
    }[];
    timeline: {
      id: string;
      status: string;
      description: string | null;
      location: string | null;
      occurredAt: string;
    }[];
    createdAt: string;
    updatedAt: string;
  };
}

export interface ListOrdersQuery {
  page?: number;
  limit?: number;
  sort?: "createdAt:desc" | "createdAt:asc" | "total:desc" | "total:asc";
  status?: string;
  search?: string;
  marketplace?: string;
  cargoCompany?: string;
  dateFrom?: string;
  dateTo?: string;
}

async function authedFetch<T>(path: string): Promise<T | null> {
  const store = await cookies();
  const session = store.get(SESSION_COOKIE_NAME);
  if (!session?.value) return null;

  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "GET",
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${session.value}`,
        accept: "application/json",
      },
      cache: "no-store",
    });
    if (!res.ok) {
      // H-55: Sessizce null dönmek prod'da debug imkânsız hale getiriyordu.
      // Çağıran kodun UI fallback'i değişmesin diye null sözleşmesini koruyoruz;
      // sadece sunucu logu eklendi.
      console.warn(
        `[customer-api] authedFetch non-OK path=${path} status=${res.status}`,
      );
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    console.warn(
      `[customer-api] authedFetch threw path=${path} err=${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return null;
  }
}

export async function fetchOverview(): Promise<OverviewResponse | null> {
  return authedFetch<OverviewResponse>("/api/me/overview");
}

export async function fetchOrdersList(
  query: ListOrdersQuery = {},
): Promise<OrdersListResponse | null> {
  const params = new URLSearchParams();
  if (query.page) params.set("page", String(query.page));
  if (query.limit) params.set("limit", String(query.limit));
  if (query.sort) params.set("sort", query.sort);
  if (query.status) params.set("status", query.status);
  if (query.search) params.set("search", query.search);
  if (query.marketplace) params.set("marketplace", query.marketplace);
  if (query.cargoCompany) params.set("cargoCompany", query.cargoCompany);
  if (query.dateFrom) params.set("dateFrom", query.dateFrom);
  if (query.dateTo) params.set("dateTo", query.dateTo);
  const qs = params.toString();
  const path = qs ? `/api/me/orders?${qs}` : "/api/me/orders";
  return authedFetch<OrdersListResponse>(path);
}

export async function fetchOrdersSummary(): Promise<OrdersSummaryResponse | null> {
  return authedFetch<OrdersSummaryResponse>("/api/me/orders/summary");
}

export async function fetchOrdersDashboard(): Promise<OrdersDashboardResponse | null> {
  return authedFetch<OrdersDashboardResponse>("/api/me/orders/dashboard");
}

export async function fetchOrderDetail(
  orderId: string,
): Promise<OrderDetailResponse | null> {
  const safe = encodeURIComponent(orderId);
  return authedFetch<OrderDetailResponse>(`/api/me/orders/${safe}`);
}

// -----------------------------------------------------------------------------
// CARI BALANCE (Bakiyem)
// -----------------------------------------------------------------------------

// LedgerEntryType, TopupStatus, BalanceLedgerEntry: see "./customer-types".

export interface BalanceResponse {
  success: boolean;
  data: {
    balance: number;
    currency: string;
  };
}

export interface BalanceLedgerResponse {
  success: boolean;
  data: BalanceLedgerEntry[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface BalanceTopupBank {
  id: string;
  bankName: string;
  accountName: string;
  iban: string;
}

export interface BalanceTopupEntry {
  id: string;
  humanTopupNo: string | null;
  amount: number;
  status: TopupStatus;
  customerNote: string | null;
  adminNote: string | null;
  requestedAt: string;
  decidedAt: string | null;
  bankAccount: BalanceTopupBank | null;
}

export interface BalanceTopupsResponse {
  success: boolean;
  data: BalanceTopupEntry[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface BalanceBankAccount {
  id: string;
  bankName: string;
  accountName: string;
  iban: string;
  branchCode: string | null;
  accountNo: string | null;
  note: string | null;
}

export interface BalanceBankAccountsResponse {
  success: boolean;
  data: BalanceBankAccount[];
}

export interface BalancePaginationQuery {
  page?: number;
  pageSize?: number;
}

export interface BalanceLedgerQuery extends BalancePaginationQuery {
  type?: "TOPUP" | "ORDER_PAYMENT" | "REFUND" | "ADJUSTMENT" | string;
  status?: "PENDING" | "APPROVED" | "REJECTED" | string;
  from?: string;
  to?: string;
}

export interface BalanceSummaryResponse {
  success: boolean;
  data: {
    balance: number;
    currency: string;
    monthly: {
      topupSum: number;
      topupCount: number;
      usageSum: number;
      usageCount: number;
    };
    last30Days: {
      usageSum: number;
      usageCount: number;
    };
    lifetime: {
      topupSum: number;
      topupCount: number;
      usageSum: number;
      orderDeductionCount: number;
    };
    pendingTopup: {
      sum: number;
      count: number;
    };
    /** HEDİYE BAKİYE özeti — ömür boyu tanımlanan hediye + son hediye. */
    gift?: {
      total: number;
      count: number;
      lastAmount: number | null;
      lastAt: string | null;
    };
    lastTopup: {
      id: string;
      humanTopupNo: string | null;
      amount: number;
      createdAt: string;
      description: string | null;
    } | null;
    lastOrderPayment: {
      id: string;
      amount: number;
      createdAt: string;
      description: string | null;
    } | null;
  };
}

export async function fetchBalance(): Promise<BalanceResponse | null> {
  return authedFetch<BalanceResponse>("/api/me/cari-balance");
}

export async function fetchBalanceSummary(): Promise<BalanceSummaryResponse | null> {
  return authedFetch<BalanceSummaryResponse>("/api/me/cari-balance/summary");
}

export async function fetchBalanceLedger(
  query: BalanceLedgerQuery = {},
): Promise<BalanceLedgerResponse | null> {
  const params = new URLSearchParams();
  if (query.page) params.set("page", String(query.page));
  if (query.pageSize) params.set("pageSize", String(query.pageSize));
  if (query.type) params.set("type", query.type);
  if (query.status) params.set("status", query.status);
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  const qs = params.toString();
  const path = qs
    ? `/api/me/cari-balance/ledger?${qs}`
    : "/api/me/cari-balance/ledger";
  return authedFetch<BalanceLedgerResponse>(path);
}

export async function fetchBalanceTopups(
  query: BalancePaginationQuery = {},
): Promise<BalanceTopupsResponse | null> {
  const params = new URLSearchParams();
  if (query.page) params.set("page", String(query.page));
  if (query.pageSize) params.set("pageSize", String(query.pageSize));
  const qs = params.toString();
  const path = qs
    ? `/api/me/cari-balance/topups?${qs}`
    : "/api/me/cari-balance/topups";
  return authedFetch<BalanceTopupsResponse>(path);
}

export async function fetchBankAccounts(): Promise<BalanceBankAccountsResponse | null> {
  return authedFetch<BalanceBankAccountsResponse>(
    "/api/me/cari-balance/bank-accounts",
  );
}

// -----------------------------------------------------------------------------
// CARI STATEMENT (Cari Hesap Ekstresi — /hesabim/cari)
// Müşteri tarafı; tedarikçi/alış/kâr/KDV farkı bilgisi İÇERMEZ.
// Types: see "./customer-types" (CariStatementQuery, CariStatementResponse,
// CariStatementSummaryResponse).
// -----------------------------------------------------------------------------

export async function fetchCariStatement(
  q: CariStatementQuery = {},
): Promise<CariStatementResponse | null> {
  const params = new URLSearchParams();
  if (q.page) params.set("page", String(q.page));
  if (q.pageSize) params.set("pageSize", String(q.pageSize));
  if (q.type) params.set("type", q.type);
  if (q.from) params.set("from", q.from);
  if (q.to) params.set("to", q.to);
  if (q.search) params.set("search", q.search);
  const qs = params.toString();
  return authedFetch<CariStatementResponse>(
    `/api/me/cari-balance/statement${qs ? `?${qs}` : ""}`,
  );
}

export async function fetchCariStatementSummary(): Promise<CariStatementSummaryResponse | null> {
  return authedFetch<CariStatementSummaryResponse>(
    "/api/me/cari-balance/statement/summary",
  );
}

// -----------------------------------------------------------------------------
// TOPLU FATURA (Faturalarım — /hesabim/faturalarim)
// BirFatura entegrasyonu: "sipariş başına fatura" yerine "bayi başına aylık tek
// fatura" modeli. Types: see "./customer-types" (DealerInvoice*).
// -----------------------------------------------------------------------------

export interface MyInvoicesResponse {
  success: boolean;
  data: DealerInvoiceListResponse;
}

export interface MyInvoiceDetailResponse {
  success: boolean;
  data: DealerInvoiceBatchDetail;
}

export async function fetchMyInvoices(): Promise<MyInvoicesResponse | null> {
  return authedFetch<MyInvoicesResponse>("/api/me/invoices");
}

export async function fetchMyInvoiceDetail(
  id: string,
): Promise<MyInvoiceDetailResponse | null> {
  const safe = encodeURIComponent(id);
  return authedFetch<MyInvoiceDetailResponse>(`/api/me/invoices/${safe}`);
}

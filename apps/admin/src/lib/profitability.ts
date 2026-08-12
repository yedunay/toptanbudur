import { apiFetch } from "./auth";

export interface ProfitabilityQuery {
  dateFrom?: string;
  dateTo?: string;
  supplierId?: string;
}

export interface SupplierProfit {
  supplierId: string;
  supplierName: string;
  revenue: number;
  cost: number;
  profit: number;
  margin: number;
  orderCount: number;
  itemCount: number;
}

export interface DailyTrendPoint {
  date: string;
  revenue: number;
  cost: number;
  profit: number;
  orderCount: number;
}

export interface ProfitabilityAnalysis {
  period: { from: string; to: string };
  summary: {
    revenue: number;
    cost: number;
    profit: number;
    margin: number;
    orderCount: number;
    itemCount: number;
    prevRevenue: number;
    prevProfit: number;
    prevMargin: number;
  };
  bySupplier: SupplierProfit[];
  dailyTrend: DailyTrendPoint[];
  zeroCostItemCount: number;
}

export interface SupplierOrderRow {
  id: string;
  humanOrderNo: string;
  status: string;
  customerName: string | null;
  revenue: number;
  cost: number;
  profit: number;
  margin: number;
  itemCount: number;
  createdAt: string;
}

export interface TopProductRow {
  productId: string | null;
  productName: string;
  sku: string | null;
  qty: number;
  revenue: number;
  cost: number;
  profit: number;
  margin: number;
}

export interface SupplierDetail {
  supplier: { id: string; name: string };
  period: { from: string; to: string };
  summary: {
    revenue: number;
    cost: number;
    profit: number;
    margin: number;
    orderCount: number;
    itemCount: number;
    prevRevenue: number;
    prevProfit: number;
    prevMargin: number;
  };
  dailyTrend: DailyTrendPoint[];
  topProducts: TopProductRow[];
  orders: SupplierOrderRow[];
}

// NOT: Tedarikçi alış/KDV/indirim ayarları (eski ProfitabilityConfig + ilgili
// GET/PUT /configs endpoint'leri) kaldırıldı. TEK KAYNAK artık tedarikçi formu
// (SupplierFormPage → Supplier alanları). Karlılık ekranı yalnız okuma/analiz.

function buildQs(query: ProfitabilityQuery): string {
  const p = new URLSearchParams();
  if (query.dateFrom) p.set("dateFrom", query.dateFrom);
  if (query.dateTo) p.set("dateTo", query.dateTo);
  if (query.supplierId) p.set("supplierId", query.supplierId);
  const s = p.toString();
  return s ? `?${s}` : "";
}

export async function fetchProfitabilityAnalysis(
  query: ProfitabilityQuery,
): Promise<ProfitabilityAnalysis> {
  return apiFetch(`/admin/profitability/analysis${buildQs(query)}`);
}

export async function fetchSupplierDetail(
  supplierId: string,
  query: ProfitabilityQuery,
): Promise<SupplierDetail> {
  return apiFetch(
    `/admin/profitability/suppliers/${supplierId}${buildQs(query)}`,
  );
}

export function buildExportUrl(query: ProfitabilityQuery): string {
  const API_BASE =
    (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api";
  return `${API_BASE}/admin/profitability/analysis/export${buildQs(query)}`;
}

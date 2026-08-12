import { apiFetch } from "./auth";

export interface AnalyticsTopProduct {
  id: string;
  name: string;
  quantity: number;
  revenue: number;
}

export interface AnalyticsSummary {
  todayOrders: number;
  todayRevenue: number;
  newDealers7d: number;
  topProduct: AnalyticsTopProduct | null;
  totalProducts: number;
  categoryCount: number;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
}

interface SummaryEnvelope {
  success: boolean;
  data: AnalyticsSummary;
}

export async function fetchAnalyticsSummary(): Promise<AnalyticsSummary> {
  const res = await apiFetch<SummaryEnvelope>("/admin/analytics/summary");
  return res.data;
}

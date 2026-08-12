import { apiFetch } from "./auth";

export interface DashboardTodayBlock {
  orders: number;
  revenue: number;
  avgBasket: number;
  refundRate: number;
  deltaOrdersPct: number | null;
  deltaRevenuePct: number | null;
}

export interface DashboardTrendPoint {
  date: string;
  orders: number;
  revenue: number;
}

export interface DashboardCatalogBlock {
  activeProducts: number;
  totalProducts: number;
  categories: number;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
}

export interface DashboardDealersBlock {
  newDealers7d: number;
  activeDealers: number;
  totalDealers: number;
  pendingApplications: number;
}

export interface DashboardAlertsBlock {
  pendingOrders: number;
  pendingRefunds: number;
  atCustomerStock: number;
  lowStockSkus: number;
  failedFeeds: number;
}

export interface DashboardTopProduct {
  id: string;
  name: string;
  qty: number;
  revenue: number;
}

export interface DashboardTopDealer {
  id: string;
  name: string;
  orders: number;
  revenue: number;
}

export interface DashboardTopCategory {
  id: string;
  name: string;
  revenue: number;
}

export interface DashboardFeedHealth {
  supplierId: string;
  supplierName: string;
  feedName: string;
  lastSyncedAt: string | null;
  status: "ok" | "warn" | "fail";
  error: string | null;
}

export interface DashboardOverview {
  generatedAt: string;
  today: DashboardTodayBlock;
  trend30d: DashboardTrendPoint[];
  catalog: DashboardCatalogBlock;
  dealers: DashboardDealersBlock;
  alerts: DashboardAlertsBlock;
  top: {
    products7d: DashboardTopProduct[];
    dealers30d: DashboardTopDealer[];
    categories30d: DashboardTopCategory[];
  };
  systemHealth: {
    feeds: DashboardFeedHealth[];
  };
}

interface OverviewEnvelope {
  success: boolean;
  data: DashboardOverview;
}

export async function fetchDashboardOverview(): Promise<DashboardOverview> {
  const res = await apiFetch<OverviewEnvelope>("/admin/dashboard/overview");
  return res.data;
}

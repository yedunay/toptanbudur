export interface SupplierOption {
  id: string;
  name: string;
}

export interface TedarikciCariQuery {
  from?: string;
  to?: string;
  supplierId?: string;
  search?: string;
  paymentType?: "cari" | "card";
  kdvRate?: 1 | 10 | 20;
  page?: number;
  pageSize?: number;
}

export interface TedarikciCariSummary {
  totalPurchaseAmount: number;
  totalSalesAmount: number;
  totalGrossProfit: number;
  totalVatDifference: number;
  netProfit: number;
  orderCount: number;
  itemCount: number;
}

export interface SupplierProfitDistributionItem {
  supplierId: string;
  supplierName: string;
  profitAmount: number;
  percent: number;
}

export interface SupplierSalesTotalItem {
  supplierId: string;
  supplierName: string;
  totalPurchaseAmount: number;
  totalSalesAmount: number;
}

export interface MonthlyTrendPoint {
  date: string;
  purchaseAmount: number;
  salesAmount: number;
  profitAmount: number;
}

export interface TedarikciCariRow {
  id: string;
  dateIso: string;
  supplierId: string;
  supplierName: string;
  description: string;
  productPurchasePrice: number;
  salePrice: number;
  profit: number;
  vatDifference: number;
  humanOrderNo: string;
  customerId: string | null;
  customerName: string | null;
  customerEmail: string | null;
  qty: number;
  saleKdvRate: number;
  purchaseKdvRate: number;
  paymentType: string | null;
}

export interface TedarikciCariMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface TedarikciCariResponse {
  suppliers: SupplierOption[];
  summary: TedarikciCariSummary;
  profitDistribution: SupplierProfitDistributionItem[];
  salesTotalsBySupplier: SupplierSalesTotalItem[];
  monthlyTrend: MonthlyTrendPoint[];
  rows: TedarikciCariRow[];
  meta: TedarikciCariMeta;
}

import type { ServerCustomer } from "@/lib/auth-server";
import type {
  OrdersDashboardResponse,
  OrdersListResponse,
  OrdersSummaryResponse,
} from "@/lib/customer-api";
import type {
  AccountOrdersPageData,
  AccountUser,
  CargoDistributionItem,
  CargoKey,
  MarketplaceDistributionItem,
  MarketplaceKey,
  MetricTone,
  OrderItem,
  OrderMetric,
  OrderStatus,
  OrderSummary,
  PaginationMeta,
  RecentUpdateItem,
  StatusCounts,
  TopProductItem,
} from "./types";
import {
  deriveCustomerOrderView,
  CUSTOMER_STAGE_LABEL,
} from "@/lib/order-customer-status";

const currencyFormatter = new Intl.NumberFormat("tr-TR", {
  style: "currency",
  currency: "TRY",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const integerFormatter = new Intl.NumberFormat("tr-TR", {
  maximumFractionDigits: 0,
});

const percentFormatter = new Intl.NumberFormat("tr-TR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const dateFormatter = new Intl.DateTimeFormat("tr-TR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "Europe/Istanbul",
});

const shortDateFormatter = new Intl.DateTimeFormat("tr-TR", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "Europe/Istanbul",
});

const timeFormatter = new Intl.DateTimeFormat("tr-TR", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Istanbul",
});

const TONE_CYCLE: MetricTone[] = ["blue", "green", "orange", "purple"];

const MARKETPLACE_KEYS: ReadonlyArray<MarketplaceKey> = ["self", "other"];

const CARGO_KEYS: ReadonlyArray<CargoKey> = ["aras", "surat", "ptt", "dhl", "yurtici"];

function buildInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "AB";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatCurrency(amount: number): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  return currencyFormatter.format(safe).replace("₺", "").trim() + " TL";
}

function formatPercent(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  return `%${percentFormatter.format(safe)}`;
}

function formatDate(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return dateFormatter.format(date);
}

function formatShortDate(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return shortDateFormatter.format(date);
}

function formatTime(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return timeFormatter.format(date);
}

function formatDateTime(value: string | Date): string {
  return `${formatDate(value)} ${formatTime(value)}`;
}

// Liste ve sipariş detayı AYNI tek kaynaktan (deriveCustomerOrderView) türer;
// böylece ikisi asla çelişmez. "shipped" müşteriye ancak 96 saat dolunca
// "Kargoya Verildi" gösterilir, öncesinde "Hazırlanıyor". "Teslim edildi"
// ifadesi müşteriye GÖSTERİLMEZ (KESKİN KURAL — sade akış).
function mapOrdersStatus(
  status: string,
  createdAt?: string | Date | null,
): OrderStatus {
  const { stage } = deriveCustomerOrderView(status, createdAt ?? null);
  return CUSTOMER_STAGE_LABEL[stage] as OrderStatus;
}

function statusTone(status: OrderStatus): MetricTone {
  switch (status) {
    case "Kargoya Verildi":
      return "green";
    case "İptal Edildi":
      return "orange";
    case "İade Edildi":
      return "purple";
    default:
      return "blue"; // Sipariş Alındı, Hazırlanıyor
  }
}

// Tanınmayan/boş kanal (ör. eski kayıtlar) "Diğer Satış Kanalı"na düşer.
function coerceMarketplace(value: string | null): MarketplaceKey {
  if (!value) return "other";
  const lower = value.toLowerCase().trim();
  const found = MARKETPLACE_KEYS.find((m) => m === lower);
  return found ?? "other";
}

function coerceCargo(value: string | null): CargoKey {
  if (!value) return "aras";
  const lower = value.toLowerCase().trim();
  if (lower.includes("surat") || lower.includes("sürat")) return "surat";
  if (lower.includes("yurtici") || lower.includes("yurtiçi")) return "yurtici";
  if (lower.includes("ptt")) return "ptt";
  if (lower.includes("dhl")) return "dhl";
  if (lower.includes("aras")) return "aras";
  const direct = CARGO_KEYS.find((c) => c === lower);
  return direct ?? "aras";
}

function ensureNonZeroSparkline(values: number[]): number[] {
  if (!values || values.length === 0) return [1, 1, 1, 1, 1, 1, 1];
  if (values.every((v) => !v)) return [1, 1, 1, 1, 1, 1, 1];
  return values.map((v) => (Number.isFinite(v) && v >= 0 ? v : 0));
}

function deriveOrderTone(index: number): MetricTone {
  return TONE_CYCLE[index % TONE_CYCLE.length];
}

function buildItemDescriptor(item: {
  name: string;
  qty: number;
}): { productName: string; productVariant: string } {
  const productName = item.name.trim() || "Ürün";
  return {
    productName,
    productVariant: `${integerFormatter.format(item.qty)} adet`,
  };
}

function buildOrderItem(
  o: OrdersListResponse["data"][number],
  index: number,
): OrderItem {
  const first = o.items[0];
  const descriptor = first
    ? buildItemDescriptor(first)
    : { productName: "Çoklu ürün", productVariant: "—" };
  const status = mapOrdersStatus(o.status, o.createdAt);
  return {
    id: o.id,
    productImageTone: deriveOrderTone(index),
    imageUrl: first?.imageUrl ?? null,
    date: formatShortDate(o.createdAt),
    time: formatTime(o.createdAt),
    orderNumber: o.humanOrderNo ?? o.id.slice(0, 8).toUpperCase(),
    endCustomerName: o.endCustomerName?.trim() || "—",
    productName: descriptor.productName,
    productVariant: descriptor.productVariant,
    marketplace: coerceMarketplace(o.marketplace),
    marketplaceBarcode: o.cargoBarcode ?? o.trackingNumber ?? "—",
    cargo: coerceCargo(o.cargoCompany),
    status,
    amount: formatCurrency(o.total),
    hasReceipt: o.hasReceipt ?? false,
  };
}

function buildMetrics(
  summary: OrdersSummaryResponse["data"],
  dashboard: OrdersDashboardResponse["data"],
): OrderMetric[] {
  const dailyOrders = ensureNonZeroSparkline(dashboard.dailyOrderCounts);
  const dailySales = ensureNonZeroSparkline(dashboard.dailySalesAmounts);
  const topProduct = dashboard.topProducts[0];

  return [
    {
      title: "Toplam Sipariş",
      value: integerFormatter.format(summary.totalOrders),
      description: `Aylık satış: ${formatCurrency(dashboard.monthlySalesAmount)}`,
      tone: "blue",
      sparkline: dailyOrders,
    },
    {
      title: "Toplam Satış Tutarı",
      value: formatCurrency(summary.totalAmount),
      description: "Tüm zamanlar",
      tone: "green",
      sparkline: dailySales,
    },
    {
      title: "Kargoya Verilen Sipariş",
      value: integerFormatter.format(summary.shippedOrders),
      description: "Başarıyla tamamlandı",
      tone: "purple",
      sparkline: dailyOrders,
    },
    {
      title: "Bekleyen Sipariş",
      value: integerFormatter.format(summary.pendingOrders),
      description: "İşlem bekliyor",
      tone: "orange",
      sparkline: dailyOrders,
    },
    {
      title: "En Çok Alınan Ürün",
      value: topProduct?.productName ?? "—",
      description: topProduct
        ? `${integerFormatter.format(topProduct.qty)} adet`
        : "Henüz veri yok",
      tone: "blue",
      sparkline: dailyOrders,
    },
  ];
}

function buildSummary(
  summary: OrdersSummaryResponse["data"],
  dashboard: OrdersDashboardResponse["data"],
): OrderSummary {
  return {
    totalOrders: integerFormatter.format(summary.totalOrders),
    deliveredOrders: integerFormatter.format(summary.shippedOrders),
    pendingOrders: integerFormatter.format(summary.pendingOrders),
    monthlySalesAmount: formatCurrency(dashboard.monthlySalesAmount),
  };
}

// Backend ham kanal değerlerine göre gruplar; birden fazla ham değer aynı
// kanala (ör. eski kayıtlar → "other") düşebildiği için burada TEKRAR
// birleştirilir — aksi halde listede/grafikte aynı kanal iki satır olur.
function buildMarketplaceDistribution(
  dashboard: OrdersDashboardResponse["data"],
): MarketplaceDistributionItem[] {
  const merged = new Map<MarketplaceKey, { count: number; pct: number }>();
  for (const m of dashboard.marketplaceDistribution) {
    const key = coerceMarketplace(m.marketplace);
    const prev = merged.get(key) ?? { count: 0, pct: 0 };
    merged.set(key, {
      count: prev.count + m.count,
      pct: prev.pct + (Number.isFinite(m.percentage) ? m.percentage : 0),
    });
  }
  return Array.from(merged.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .map(([marketplace, v]) => ({
      marketplace,
      count: v.count,
      percentage: formatPercent(v.pct),
      pct: v.pct,
    }));
}

function buildCargoDistribution(
  orders: OrdersListResponse["data"],
): CargoDistributionItem[] {
  const counts: Partial<Record<CargoKey, number>> = {};
  for (const o of orders) {
    const key = coerceCargo(o.cargoCompany);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  const total = orders.length || 1;
  return (Object.entries(counts) as [CargoKey, number][])
    .sort((a, b) => b[1] - a[1])
    .map(([cargo, count]) => {
      const pct = (count / total) * 100;
      return { cargo, count, percentage: formatPercent(pct), pct };
    });
}

function buildTopProducts(
  dashboard: OrdersDashboardResponse["data"],
): TopProductItem[] {
  return dashboard.topProducts.map((p) => ({
    id: p.productSlug || `tp-${p.rank}`,
    rank: p.rank,
    name: p.productName,
    quantity: `${integerFormatter.format(p.qty)} adet`,
  }));
}

function recentUpdateTitle(status: string): string {
  const normalized = status.toLowerCase();
  switch (normalized) {
    case "delivered":
    case "shipped":
      return "Siparişiniz kargoya verildi";
    case "preparing":
      return "Siparişiniz hazırlanıyor";
    case "cancelled":
      return "Sipariş iptal edildi";
    case "returned":
      return "İade işlemi başlatıldı";
    case "pending":
    default:
      return "Yeni sipariş alındı";
  }
}

function recentUpdateTone(status: string): MetricTone {
  return statusTone(mapOrdersStatus(status));
}

function buildRecentUpdates(
  dashboard: OrdersDashboardResponse["data"],
): RecentUpdateItem[] {
  // KURAL: "kargoya verildi" (shipped/delivered) güncellemeleri müşteri
  // akışında GÖSTERİLMEZ — bu feed olayın zamanını (updatedAt = kargoya
  // veriliş anı) sızdırır ve müşteri ne zaman kargoya verildiğini bilmemeli.
  // Kargoya verilme durumu sipariş listesindeki rozette (TARİHSİZ) görünür.
  return dashboard.recentUpdates
    .filter((u) => {
      const s = (u.status ?? "").toLowerCase();
      return s !== "shipped" && s !== "delivered";
    })
    .map((u) => ({
      id: u.id,
      title: recentUpdateTitle(u.status),
      orderNumber: u.humanOrderNo ?? u.id.slice(0, 8).toUpperCase(),
      date: formatDateTime(u.updatedAt),
      tone: recentUpdateTone(u.status),
    }));
}

function buildUser(customer: ServerCustomer): AccountUser {
  const name = (customer.name?.trim() || customer.email).trim();
  return {
    initials: buildInitials(name),
    name,
    companyName: name,
    verified: true,
  };
}

export function mapOrders(
  list: OrdersListResponse,
  summary: OrdersSummaryResponse,
  dashboard: OrdersDashboardResponse,
  customer: ServerCustomer,
): AccountOrdersPageData {
  return {
    user: buildUser(customer),
    metrics: buildMetrics(summary.data, dashboard.data),
    orders: list.data.map((o, i) => buildOrderItem(o, i)),
    orderSummary: buildSummary(summary.data, dashboard.data),
    marketplaceDistribution: buildMarketplaceDistribution(dashboard.data),
    cargoDistribution: buildCargoDistribution(list.data),
    topProducts: buildTopProducts(dashboard.data),
    recentUpdates: buildRecentUpdates(dashboard.data),
    statusCounts: {
      total: summary.data.totalOrders,
      preparing: summary.data.pendingOrders,
      shipped: summary.data.shippedOrders,
      cancelled: summary.data.cancelledOrders,
      refunded: summary.data.refundedOrders,
    },
    pagination: {
      total: list.meta.total,
      page: list.meta.page,
      limit: list.meta.limit,
      totalPages: list.meta.totalPages,
    },
  };
}

export function buildOrdersFallback(
  customer: ServerCustomer,
): AccountOrdersPageData {
  const emptySpark = [1, 1, 1, 1, 1, 1, 1];
  const zero = "0";
  const zeroAmount = formatCurrency(0);

  const fallbackMetric = (
    title: string,
    description: string,
    tone: MetricTone,
    value: string = zero,
  ): OrderMetric => ({
    title,
    value,
    description,
    tone,
    sparkline: emptySpark,
  });

  return {
    user: buildUser(customer),
    metrics: [
      fallbackMetric("Toplam Sipariş", "Henüz sipariş yok", "blue"),
      fallbackMetric("Toplam Satış Tutarı", "Tüm zamanlar", "green", zeroAmount),
      fallbackMetric("Kargoya Verilen Sipariş", "Başarıyla tamamlandı", "purple"),
      fallbackMetric("Bekleyen Sipariş", "İşlem bekliyor", "orange"),
      fallbackMetric("En Çok Alınan Ürün", "Henüz veri yok", "blue", "—"),
    ],
    orders: [],
    orderSummary: {
      totalOrders: zero,
      deliveredOrders: zero,
      pendingOrders: zero,
      monthlySalesAmount: zeroAmount,
    },
    marketplaceDistribution: [],
    cargoDistribution: [],
    topProducts: [],
    recentUpdates: [],
    statusCounts: { total: 0, preparing: 0, shipped: 0, cancelled: 0, refunded: 0 },
    pagination: { total: 0, page: 1, limit: 20, totalPages: 0 },
  };
}

export { formatCurrency, formatDate, formatTime, formatDateTime };

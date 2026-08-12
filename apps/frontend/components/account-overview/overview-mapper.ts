import type { ServerCustomer } from "@/lib/auth-server";
import type { OverviewResponse } from "@/lib/customer-api";
import type {
  AccountOverviewPageData,
  AccountUser,
  Announcement,
  BalanceMovement,
  MetricTone,
  MoneyDirection,
  OrderDistributionRow,
  OrderFlowStep,
  OrderStatus,
  OverviewMetric,
  QuickAction,
  RecentOrder,
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

const dateTimeFormatter = new Intl.DateTimeFormat("tr-TR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const timeFormatter = new Intl.DateTimeFormat("tr-TR", {
  hour: "2-digit",
  minute: "2-digit",
});

const dateFormatter = new Intl.DateTimeFormat("tr-TR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const QUICK_ACTIONS: QuickAction[] = [
  {
    id: "balance",
    title: "Bakiye Yükle",
    description: "Hızlı bakiye yükleme",
    tone: "green",
    href: "/hesabim/bakiyem",
  },
  {
    id: "orders",
    title: "Siparişlerimi Gör",
    description: "Tüm siparişlerinizi inceleyin",
    tone: "blue",
    href: "/hesabim/siparislerim",
  },
  {
    id: "support",
    title: "Destek Talebi",
    description: "Ekibimize ulaşın",
    tone: "orange",
    href: "/hesabim/destek",
  },
];

const PLACEHOLDER_ANNOUNCEMENTS: Announcement[] = [
  {
    id: "a2",
    title: "Mayıs Kampanyaları Başladı!",
    description:
      "Seçili ürün gruplarında özel fiyatlar ve avantajları kaçırmayın.",
    date: "04.05.2026",
    tone: "orange",
  },
  {
    id: "a3",
    title: "İade Süreçlerinde Hızlı Çözüm",
    description:
      "İade taleplerinizi hızlı sonuçlandırıyoruz. Detaylar için tıklayın.",
    date: "02.05.2026",
    tone: "blue",
  },
];

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

function formatSignedCurrency(
  amount: number,
  direction: "positive" | "negative",
): string {
  const abs = Math.abs(amount);
  const formatted = formatCurrency(abs);
  return direction === "positive" ? `+${formatted}` : `-${formatted}`;
}

function formatDateTime(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return dateTimeFormatter.format(date).replace(",", "");
}

function formatUpdatedAt(now: Date): string {
  return `Bugün ${timeFormatter.format(now)}`;
}

function formatDateOnly(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return dateFormatter.format(date);
}

// Genel bakış da sipariş detayı/listesi ile AYNI tek kaynağı kullanır — müşteri
// "shipped"i ancak 96 saat dolunca "Kargoya Verildi" görür; "Teslim edildi"
// ifadesi müşteriye gösterilmez.
function mapOverviewOrderStatus(
  status: string,
  createdAt?: string | Date | null,
): OrderStatus {
  const { stage } = deriveCustomerOrderView(status, createdAt ?? null);
  return CUSTOMER_STAGE_LABEL[stage] as OrderStatus;
}

function ensureNonZeroSparkline(values: number[]): number[] {
  if (!values || values.length === 0) return [1, 1, 1, 1, 1, 1, 1];
  if (values.every((v) => !v)) return [1, 1, 1, 1, 1, 1, 1];
  return values.map((v) => (Number.isFinite(v) && v >= 0 ? v : 0));
}

function buildSparklineFromTotal(total: number, base: number[]): number[] {
  const safe = ensureNonZeroSparkline(base);
  if (total <= 0) return safe;
  const max = Math.max(...safe);
  if (max <= 0) return safe;
  return safe.map((v) => Math.max(1, Math.round((v / max) * total)));
}

function buildMetrics(
  data: OverviewResponse["data"],
): OverviewMetric[] {
  const series = ensureNonZeroSparkline(data.last7DaysOrderCounts);
  const totalRecent = series.reduce((acc, n) => acc + n, 0);

  return [
    {
      title: "Cari Bakiye",
      value: formatCurrency(data.metrics.cariBalance),
      description: "Anlık güncel bakiye",
      tone: "green",
      sparkline: buildSparklineFromTotal(
        Math.max(1, Math.round(data.metrics.cariBalance / 1000)),
        series,
      ),
    },
    {
      title: "Son 30 Gün Sipariş",
      value: integerFormatter.format(data.metrics.last30DaysOrderCount),
      description: `Son 7 gün: ${integerFormatter.format(totalRecent)}`,
      tone: "blue",
      sparkline: series,
    },
    {
      title: "Bekleyen Sipariş",
      value: integerFormatter.format(data.metrics.pendingOrderCount),
      description: "Kargoya hazır bekliyor",
      tone: "orange",
      sparkline: buildSparklineFromTotal(
        data.metrics.pendingOrderCount,
        series,
      ),
    },
    {
      // `shipped` müşteri modelinde terminal statüdür ve müşteriye "Kargoya
      // Verildi" olarak gösterilir. "Teslim edildi" ifadesi kullanılmaz.
      title: "Tamamlanan Sipariş",
      value: integerFormatter.format(data.metrics.shippedOrderCount),
      description: "Toplam kargoya verilen",
      tone: "green",
      sparkline: buildSparklineFromTotal(
        data.metrics.shippedOrderCount,
        series,
      ),
    },
  ];
}

function buildOrderFlow(
  data: OverviewResponse["data"],
): OrderFlowStep[] {
  const fmt = (n: number) => `${integerFormatter.format(n)} sipariş`;
  // Müşteri akışı: Sipariş Alındı → Hazırlanıyor → Kargoya Verildi.
  // "Teslim edildi" ifadesi müşteriye gösterilmez (sade akış).
  return [
    {
      id: "f1",
      label: "Sipariş Alındı",
      count: fmt(data.orderFlow.received),
      tone: "blue",
    },
    {
      id: "f2",
      label: "Hazırlanıyor",
      count: fmt(data.orderFlow.preparing),
      tone: "orange",
    },
    {
      id: "f3",
      label: "Kargoya Verildi",
      count: fmt(data.orderFlow.shipped),
      tone: "green",
    },
  ];
}

function buildRecentOrders(
  data: OverviewResponse["data"],
): RecentOrder[] {
  return data.recentOrders.map((o) => ({
    id: o.id,
    orderNumber: o.humanOrderNo ?? o.id.slice(0, 8).toUpperCase(),
    date: formatDateTime(o.createdAt),
    status: mapOverviewOrderStatus(o.status, o.createdAt),
    amount: formatCurrency(o.total),
  }));
}

function balanceTransactionLabel(type: string): string {
  const normalized = type.toUpperCase();
  switch (normalized) {
    case "TOPUP":
    case "DEPOSIT":
    case "CREDIT":
      return "Bakiye Yüklemesi";
    case "ORDER":
    case "ORDER_DEDUCTION":
    case "DEBIT":
      return "Sipariş Kesintisi";
    case "REFUND":
      return "İade Geri Ödemesi";
    case "ADJUSTMENT":
      return "Bakiye Düzeltme";
    default:
      return type;
  }
}

function buildBalanceMovements(
  data: OverviewResponse["data"],
): BalanceMovement[] {
  return data.balanceMovements.map((b) => {
    const direction: MoneyDirection = b.direction;
    return {
      id: b.id,
      date: formatDateTime(b.createdAt),
      transactionType:
        b.description?.trim() || balanceTransactionLabel(b.type),
      amount: formatSignedCurrency(b.amount, b.direction),
      direction,
      status: "Başarılı",
    };
  });
}

function buildUser(
  customer: ServerCustomer,
  apiCustomer: OverviewResponse["data"]["customer"],
): AccountUser {
  const name = (apiCustomer.name || customer.name || customer.email).trim();
  const companyName = (apiCustomer.name || customer.name || "").trim() || name;
  return {
    initials: buildInitials(name),
    name,
    companyName,
    verified: true,
  };
}

export function mapOverview(
  response: OverviewResponse,
  customer: ServerCustomer,
): AccountOverviewPageData {
  const { data } = response;
  return {
    user: buildUser(customer, data.customer),
    updatedAt: formatUpdatedAt(new Date()),
    metrics: buildMetrics(data),
    quickActions: QUICK_ACTIONS,
    recentOrders: buildRecentOrders(data),
    balanceMovements: buildBalanceMovements(data),
    announcements: PLACEHOLDER_ANNOUNCEMENTS,
    orderFlow: buildOrderFlow(data),
    orderDistribution: [
      { label: "Hazırlanıyor", value: data.metrics.pendingOrderCount, tone: "blue" },
      // shipped müşteriye "Kargoya Verildi" olarak gösterilir (tek terminal statü).
      { label: "Kargoya Verildi", value: data.metrics.shippedOrderCount, tone: "green" },
      { label: "İptal", value: data.orderFlow.cancelled, tone: "orange" },
      { label: "İade", value: data.metrics.refundedOrderCount, tone: "purple" },
    ],
  };
}

export function buildOverviewFallback(
  customer: ServerCustomer,
): AccountOverviewPageData {
  const displayName = customer.name?.trim() || customer.email;
  const emptySpark = [1, 1, 1, 1, 1, 1, 1];
  const zero = "0";
  const zeroAmount = formatCurrency(0);
  const fallbackMetric = (
    title: string,
    description: string,
    tone: MetricTone,
  ): OverviewMetric => ({
    title,
    value: zero,
    description,
    tone,
    sparkline: emptySpark,
  });
  return {
    user: {
      initials: buildInitials(displayName),
      name: displayName,
      companyName: displayName,
      verified: true,
    },
    updatedAt: formatUpdatedAt(new Date()),
    metrics: [
      {
        title: "Cari Bakiye",
        value: zeroAmount,
        description: "Anlık güncel bakiye",
        tone: "green",
        sparkline: emptySpark,
      },
      fallbackMetric("Son 30 Gün Sipariş", "Henüz sipariş yok", "blue"),
      fallbackMetric("Bekleyen Sipariş", "Kargoya hazır bekliyor", "orange"),
      fallbackMetric("Tamamlanan Sipariş", "Toplam kargoya verilen", "green"),
    ],
    quickActions: QUICK_ACTIONS,
    recentOrders: [],
    balanceMovements: [],
    announcements: PLACEHOLDER_ANNOUNCEMENTS,
    orderFlow: [
      { id: "f1", label: "Sipariş Alındı", count: "0 sipariş", tone: "blue" },
      {
        id: "f2",
        label: "Hazırlanıyor",
        count: "0 sipariş",
        tone: "orange",
      },
      {
        id: "f3",
        label: "Kargoya Verildi",
        count: "0 sipariş",
        tone: "green",
      },
    ],
    orderDistribution: [
      { label: "Hazırlanıyor", value: 0, tone: "blue" },
      { label: "Kargoya Verildi", value: 0, tone: "green" },
      { label: "İptal", value: 0, tone: "orange" },
      { label: "İade", value: 0, tone: "purple" },
    ],
  };
}

export { formatCurrency, formatDateTime, formatDateOnly };

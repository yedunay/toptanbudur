import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatAmount } from "../../../lib/format";
import type {
  MonthlyTrendPoint,
  SupplierProfitDistributionItem,
  SupplierSalesTotalItem,
} from "../types";

interface TedarikciCariChartsProps {
  profitDistribution: SupplierProfitDistributionItem[];
  monthlyTrend: MonthlyTrendPoint[];
  salesTotalsBySupplier: SupplierSalesTotalItem[];
}

const DONUT_COLORS = [
  "#2563eb",
  "#10b981",
  "#f97316",
  "#a855f7",
  "#0ea5e9",
  "#ef4444",
  "#14b8a6",
  "#eab308",
];

const AXIS_TICK = { fill: "#64748b", fontSize: 12 };
const COMPACT_TRY = new Intl.NumberFormat("tr-TR", {
  style: "currency",
  currency: "TRY",
  notation: "compact",
  maximumFractionDigits: 1,
});

function formatCompactTRY(value: number): string {
  try {
    return COMPACT_TRY.format(value);
  } catch {
    return `${Math.round(value)} ₺`;
  }
}

function formatTrendDate(iso: string): string {
  if (!iso) return "";
  // Backend ISO format expected (YYYY-MM-DD or YYYY-MM). Render as TR short month/year.
  const parts = iso.split("-");
  if (parts.length >= 2) {
    const year = parts[0];
    const month = parts[1];
    const months = [
      "Oca",
      "Şub",
      "Mar",
      "Nis",
      "May",
      "Haz",
      "Tem",
      "Ağu",
      "Eyl",
      "Eki",
      "Kas",
      "Ara",
    ];
    const idx = Math.max(0, Math.min(11, Number(month) - 1));
    return `${months[idx]} ${year.slice(2)}`;
  }
  return iso;
}

interface ChartCardProps {
  title: string;
  children: React.ReactNode;
  className?: string;
}

function ChartCard({
  title,
  children,
  className = "",
}: ChartCardProps): React.ReactElement {
  return (
    <article
      className={`flex flex-col gap-3 rounded-2xl border border-[var(--color-border)] bg-white p-4 shadow-sm ${className}`}
    >
      <header className="text-sm font-semibold text-[var(--color-text)]">
        {title}
      </header>
      <div className="min-h-[260px] flex-1">{children}</div>
    </article>
  );
}

export function TedarikciCariCharts({
  profitDistribution,
  monthlyTrend,
  salesTotalsBySupplier,
}: TedarikciCariChartsProps): React.ReactElement {
  const topSalesSuppliers = [...salesTotalsBySupplier]
    .sort((a, b) => b.totalSalesAmount - a.totalSalesAmount)
    .slice(0, 5);

  const maxSales = topSalesSuppliers.reduce(
    (max, s) => (s.totalSalesAmount > max ? s.totalSalesAmount : max),
    0,
  );

  const hasProfitData = profitDistribution.some((p) => p.profitAmount > 0);
  const hasTrendData = monthlyTrend.length > 0;
  const hasTopSalesData = topSalesSuppliers.length > 0;

  return (
    <section
      aria-label="Tedarikçi cari grafikler"
      className="grid grid-cols-1 gap-4 lg:grid-cols-3"
    >
      <ChartCard title="Tedarikçi Bazlı Kâr Dağılımı">
        {hasProfitData ? (
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie
                data={profitDistribution}
                dataKey="profitAmount"
                nameKey="supplierName"
                innerRadius={50}
                outerRadius={90}
                paddingAngle={2}
              >
                {profitDistribution.map((entry, index) => (
                  <Cell
                    key={entry.supplierId}
                    fill={DONUT_COLORS[index % DONUT_COLORS.length]}
                  />
                ))}
              </Pie>
              <Tooltip
                formatter={(value) =>
                  formatAmount(typeof value === "number" ? value : Number(value) || 0)
                }
                labelFormatter={(label) => String(label)}
              />
              <Legend
                verticalAlign="bottom"
                height={36}
                wrapperStyle={{ fontSize: 12 }}
              />
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <EmptyState label="Bu dönem için kâr verisi yok" />
        )}
      </ChartCard>

      <ChartCard title="Aylık Trend (Alış / Satış / Kâr)">
        {hasTrendData ? (
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart
              data={monthlyTrend}
              margin={{ top: 10, right: 16, left: 0, bottom: 0 }}
            >
              <defs>
                <linearGradient id="trendPurchase" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#2563eb" stopOpacity={0.45} />
                  <stop offset="95%" stopColor="#2563eb" stopOpacity={0.05} />
                </linearGradient>
                <linearGradient id="trendSales" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.45} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0.05} />
                </linearGradient>
                <linearGradient id="trendProfit" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f97316" stopOpacity={0.45} />
                  <stop offset="95%" stopColor="#f97316" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis
                dataKey="date"
                tick={AXIS_TICK}
                tickFormatter={formatTrendDate}
              />
              <YAxis tick={AXIS_TICK} tickFormatter={formatCompactTRY} />
              <Tooltip
                formatter={(value) =>
                  formatAmount(typeof value === "number" ? value : Number(value) || 0)
                }
                labelFormatter={(label) => formatTrendDate(String(label))}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Area
                type="monotone"
                dataKey="purchaseAmount"
                name="Alış"
                stroke="#2563eb"
                fill="url(#trendPurchase)"
                strokeWidth={2}
              />
              <Area
                type="monotone"
                dataKey="salesAmount"
                name="Satış"
                stroke="#10b981"
                fill="url(#trendSales)"
                strokeWidth={2}
              />
              <Area
                type="monotone"
                dataKey="profitAmount"
                name="Kâr"
                stroke="#f97316"
                fill="url(#trendProfit)"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <EmptyState label="Trend verisi yok" />
        )}
      </ChartCard>

      <ChartCard title="Tedarikçi Satış Toplamları (Top 5)">
        {hasTopSalesData ? (
          <ul className="flex flex-col gap-3">
            {topSalesSuppliers.map((s, idx) => {
              const pct =
                maxSales > 0 ? (s.totalSalesAmount / maxSales) * 100 : 0;
              const color = DONUT_COLORS[idx % DONUT_COLORS.length];
              return (
                <li key={s.supplierId} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span
                      className="truncate font-medium text-[var(--color-text)]"
                      title={s.supplierName}
                    >
                      {s.supplierName}
                    </span>
                    <span className="tabular-nums text-slate-600">
                      {formatAmount(s.totalSalesAmount)}
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${pct}%`,
                        backgroundColor: color,
                      }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState label="Satış verisi yok" />
        )}
      </ChartCard>
    </section>
  );
}

function EmptyState({ label }: { label: string }): React.ReactElement {
  return (
    <div className="flex h-full min-h-[200px] items-center justify-center text-sm text-slate-400">
      {label}
    </div>
  );
}

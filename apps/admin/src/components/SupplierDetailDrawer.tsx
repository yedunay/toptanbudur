import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  fetchSupplierDetail,
  type ProfitabilityQuery,
  type DailyTrendPoint,
  type SupplierOrderRow,
  type TopProductRow,
} from "../lib/profitability";
import { formatTRY } from "../lib/products";

interface Props {
  supplierId: string;
  supplierName: string;
  query: ProfitabilityQuery;
  onClose: () => void;
}

function pct(current: number, prev: number): string {
  if (prev === 0) return current > 0 ? "+∞" : "—";
  const d = ((current - prev) / Math.abs(prev)) * 100;
  return (d >= 0 ? "+" : "") + d.toFixed(1) + "%";
}

function pctClass(current: number, prev: number): string {
  if (prev === 0) return "text-slate-400";
  return current >= prev ? "text-emerald-600" : "text-red-500";
}

function marginColor(m: number): string {
  if (m >= 25) return "text-emerald-600";
  if (m >= 10) return "text-amber-600";
  return "text-red-500";
}

function statusBadge(status: string): { label: string; cls: string } {
  const map: Record<string, { label: string; cls: string }> = {
    paid: { label: "Ödendi", cls: "bg-blue-50 text-blue-700" },
    preparing: { label: "Hazırlanıyor", cls: "bg-indigo-50 text-indigo-700" },
    shipped: { label: "Kargoya Verildi", cls: "bg-amber-50 text-amber-700" },
    cancelled: { label: "İptal", cls: "bg-red-50 text-red-700" },
    refunded: { label: "İade", cls: "bg-red-50 text-red-700" },
  };
  return (
    map[status] ?? { label: status, cls: "bg-slate-100 text-slate-600" }
  );
}

function formatDateTimeTR(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDateTR(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("tr-TR", {
    day: "2-digit",
    month: "2-digit",
  });
}

function TrendChart({ points }: { points: DailyTrendPoint[] }) {
  if (points.length === 0) {
    return (
      <div className="h-32 flex items-center justify-center text-xs text-slate-400">
        Bu dönemde günlük veri yok
      </div>
    );
  }

  const w = 720;
  const h = 140;
  const padX = 8;
  const padY = 16;
  const innerW = w - padX * 2;
  const innerH = h - padY * 2;

  const maxRevenue = Math.max(...points.map((p) => p.revenue), 1);
  const maxProfit = Math.max(...points.map((p) => Math.abs(p.profit)), 1);
  const maxVal = Math.max(maxRevenue, maxProfit);

  const step = points.length > 1 ? innerW / (points.length - 1) : 0;
  const xy = (val: number, i: number): [number, number] => [
    padX + i * step,
    padY + innerH - (val / maxVal) * innerH,
  ];

  const revenuePath = points
    .map((p, i) => {
      const [x, y] = xy(p.revenue, i);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const profitPath = points
    .map((p, i) => {
      const [x, y] = xy(p.profit, i);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const revenueArea =
    revenuePath +
    ` L${(padX + (points.length - 1) * step).toFixed(1)},${(padY + innerH).toFixed(1)}` +
    ` L${padX.toFixed(1)},${(padY + innerH).toFixed(1)} Z`;

  return (
    <div className="relative w-full overflow-hidden rounded-xl bg-gradient-to-br from-slate-50 to-white border border-[var(--color-border)] p-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          Günlük Trend
        </p>
        <div className="flex items-center gap-3 text-[11px] text-slate-500">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[var(--color-brand-navy)]" />
            Gelir
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            Net Kar
          </span>
        </div>
      </div>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        className="w-full h-32"
      >
        <defs>
          <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-brand-navy)" stopOpacity="0.25" />
            <stop offset="100%" stopColor="var(--color-brand-navy)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={revenueArea} fill="url(#revGrad)" />
        <path
          d={revenuePath}
          fill="none"
          stroke="var(--color-brand-navy)"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <path
          d={profitPath}
          fill="none"
          stroke="#10b981"
          strokeWidth="2"
          strokeDasharray="3 3"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {points.map((p, i) => {
          const [x, y] = xy(p.revenue, i);
          return (
            <circle
              key={p.date}
              cx={x}
              cy={y}
              r="2.5"
              fill="white"
              stroke="var(--color-brand-navy)"
              strokeWidth="1.5"
            />
          );
        })}
      </svg>
      <div className="flex justify-between text-[10px] text-slate-400 mt-1 px-1">
        <span>{formatDateTR(points[0].date)}</span>
        {points.length > 1 ? (
          <span>{formatDateTR(points[points.length - 1].date)}</span>
        ) : null}
      </div>
    </div>
  );
}

function KpiTile({
  label,
  value,
  delta,
  deltaClass,
  accent,
}: {
  label: string;
  value: string;
  delta?: string;
  deltaClass?: string;
  accent: "navy" | "emerald" | "amber" | "slate";
}) {
  const accentMap = {
    navy: "from-[var(--color-brand-navy)]/8 to-transparent text-[var(--color-brand-navy)]",
    emerald: "from-emerald-500/10 to-transparent text-emerald-700",
    amber: "from-amber-500/10 to-transparent text-amber-700",
    slate: "from-slate-200/40 to-transparent text-slate-700",
  } as const;
  return (
    <div
      className={`relative rounded-xl border border-[var(--color-border)] bg-gradient-to-br ${accentMap[accent]} p-4`}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
        {label}
      </p>
      <p className="text-xl font-bold leading-none tabular-nums">{value}</p>
      {delta ? (
        <p className={`mt-1.5 text-[11px] font-medium ${deltaClass}`}>
          {delta} <span className="text-slate-400">vs. önceki dönem</span>
        </p>
      ) : null}
    </div>
  );
}

function OrderRow({ o }: { o: SupplierOrderRow }) {
  const s = statusBadge(o.status);
  return (
    <tr className="border-b border-[var(--color-border)] hover:bg-slate-50/70 transition-colors">
      <td className="py-2.5 px-3 text-xs font-mono text-slate-600">
        {o.humanOrderNo}
      </td>
      <td className="py-2.5 px-3 text-xs text-slate-500 tabular-nums">
        {formatDateTimeTR(o.createdAt)}
      </td>
      <td className="py-2.5 px-3 text-xs">
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${s.cls}`}>
          {s.label}
        </span>
      </td>
      <td className="py-2.5 px-3 text-xs text-slate-600 max-w-[180px] truncate">
        {o.customerName ?? "—"}
      </td>
      <td className="py-2.5 px-3 text-xs text-right tabular-nums text-slate-400">
        {o.itemCount}
      </td>
      <td className="py-2.5 px-3 text-xs text-right tabular-nums text-slate-700">
        {formatTRY(o.revenue)}
      </td>
      <td className="py-2.5 px-3 text-xs text-right tabular-nums text-slate-500">
        {formatTRY(o.cost)}
      </td>
      <td className="py-2.5 px-3 text-xs text-right tabular-nums font-semibold text-emerald-700">
        {formatTRY(o.profit)}
      </td>
      <td className={`py-2.5 px-3 text-xs text-right tabular-nums font-semibold ${marginColor(o.margin)}`}>
        {o.margin.toFixed(1)}%
      </td>
    </tr>
  );
}

function ProductRow({ p, rank }: { p: TopProductRow; rank: number }) {
  return (
    <tr className="border-b border-[var(--color-border)] hover:bg-slate-50/70 transition-colors">
      <td className="py-2.5 px-3 text-xs font-mono text-slate-400 w-8">
        {rank}
      </td>
      <td className="py-2.5 px-3 text-xs">
        <div className="font-medium text-slate-800 line-clamp-1">
          {p.productName}
        </div>
        {p.sku ? (
          <div className="text-[10px] font-mono text-slate-400 mt-0.5">
            {p.sku}
          </div>
        ) : null}
      </td>
      <td className="py-2.5 px-3 text-xs text-right tabular-nums text-slate-500">
        {p.qty}
      </td>
      <td className="py-2.5 px-3 text-xs text-right tabular-nums text-slate-700">
        {formatTRY(p.revenue)}
      </td>
      <td className="py-2.5 px-3 text-xs text-right tabular-nums font-semibold text-emerald-700">
        {formatTRY(p.profit)}
      </td>
      <td className={`py-2.5 px-3 text-xs text-right tabular-nums font-semibold ${marginColor(p.margin)}`}>
        {p.margin.toFixed(1)}%
      </td>
    </tr>
  );
}

export default function SupplierDetailDrawer({
  supplierId,
  supplierName,
  query,
  onClose,
}: Props) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["profitability", "supplier", supplierId, query],
    queryFn: () => fetchSupplierDetail(supplierId, query),
  });

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const s = data?.summary;

  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Kapat"
        onClick={onClose}
        className="flex-1 bg-slate-900/40 backdrop-blur-sm"
      />
      <aside className="w-full max-w-5xl bg-slate-50 shadow-2xl overflow-y-auto">
        {/* Header */}
        <header className="sticky top-0 z-10 bg-white border-b border-[var(--color-border)] px-6 py-4 flex items-center justify-between">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Tedarikçi Karlılığı
            </p>
            <h2 className="text-lg font-bold text-[var(--color-brand-navy)] truncate">
              {data?.supplier.name ?? supplierName}
            </h2>
            {data ? (
              <p className="text-[11px] text-slate-500 mt-0.5">
                {new Date(data.period.from).toLocaleDateString("tr-TR")} —{" "}
                {new Date(data.period.to).toLocaleDateString("tr-TR")}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-9 w-9 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-colors"
            aria-label="Kapat"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </header>

        <div className="p-6 space-y-6">
          {error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              Veri yüklenemedi.{" "}
              <button
                type="button"
                onClick={() => refetch()}
                className="underline"
              >
                Tekrar dene
              </button>
            </div>
          ) : null}

          {/* KPI grid */}
          {isLoading || !s ? (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[...Array(4)].map((_, i) => (
                <div
                  key={i}
                  className="h-24 rounded-xl border border-[var(--color-border)] bg-white animate-pulse"
                />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <KpiTile
                label="Gelir"
                value={formatTRY(s.revenue)}
                delta={pct(s.revenue, s.prevRevenue)}
                deltaClass={pctClass(s.revenue, s.prevRevenue)}
                accent="navy"
              />
              <KpiTile
                label="Maliyet"
                value={formatTRY(s.cost)}
                accent="slate"
              />
              <KpiTile
                label="Net Kar"
                value={formatTRY(s.profit)}
                delta={pct(s.profit, s.prevProfit)}
                deltaClass={pctClass(s.profit, s.prevProfit)}
                accent="emerald"
              />
              <KpiTile
                label="Marj"
                value={s.margin.toFixed(1) + "%"}
                delta={pct(s.margin, s.prevMargin)}
                deltaClass={pctClass(s.margin, s.prevMargin)}
                accent="amber"
              />
            </div>
          )}

          {/* Mini stats */}
          {s ? (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="rounded-xl bg-white border border-[var(--color-border)] px-4 py-3 flex items-baseline justify-between">
                <span className="text-xs text-slate-500">Sipariş Sayısı</span>
                <span className="text-base font-semibold tabular-nums text-[var(--color-brand-navy)]">
                  {s.orderCount.toLocaleString("tr-TR")}
                </span>
              </div>
              <div className="rounded-xl bg-white border border-[var(--color-border)] px-4 py-3 flex items-baseline justify-between">
                <span className="text-xs text-slate-500">Kalem Sayısı</span>
                <span className="text-base font-semibold tabular-nums text-[var(--color-brand-navy)]">
                  {s.itemCount.toLocaleString("tr-TR")}
                </span>
              </div>
              <div className="rounded-xl bg-white border border-[var(--color-border)] px-4 py-3 flex items-baseline justify-between">
                <span className="text-xs text-slate-500">Sipariş Başına Kar</span>
                <span className="text-base font-semibold tabular-nums text-emerald-700">
                  {formatTRY(s.orderCount > 0 ? s.profit / s.orderCount : 0)}
                </span>
              </div>
              <div className="rounded-xl bg-white border border-[var(--color-border)] px-4 py-3 flex items-baseline justify-between">
                <span className="text-xs text-slate-500">Kalem Başına Kar</span>
                <span className="text-base font-semibold tabular-nums text-emerald-700">
                  {formatTRY(s.itemCount > 0 ? s.profit / s.itemCount : 0)}
                </span>
              </div>
            </div>
          ) : null}

          {/* Trend */}
          {data ? <TrendChart points={data.dailyTrend} /> : null}

          {/* Top Products */}
          {data?.topProducts && data.topProducts.length > 0 ? (
            <section className="rounded-xl bg-white border border-[var(--color-border)] overflow-hidden">
              <div className="px-5 py-3 border-b border-[var(--color-border)] flex items-center justify-between">
                <h3 className="text-sm font-semibold text-[var(--color-brand-navy)]">
                  En Karlı Ürünler
                </h3>
                <span className="text-[10px] text-slate-400 uppercase tracking-wider">
                  Top {data.topProducts.length}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-50/60">
                    <tr className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 border-b border-[var(--color-border)]">
                      <th className="py-2 px-3 text-left w-8">#</th>
                      <th className="py-2 px-3 text-left">Ürün</th>
                      <th className="py-2 px-3 text-right">Adet</th>
                      <th className="py-2 px-3 text-right">Gelir</th>
                      <th className="py-2 px-3 text-right">Net Kar</th>
                      <th className="py-2 px-3 text-right">Marj</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topProducts.map((p, i) => (
                      <ProductRow
                        key={(p.productId ?? p.productName) + "-" + i}
                        p={p}
                        rank={i + 1}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {/* Orders */}
          {data?.orders && data.orders.length > 0 ? (
            <section className="rounded-xl bg-white border border-[var(--color-border)] overflow-hidden">
              <div className="px-5 py-3 border-b border-[var(--color-border)] flex items-center justify-between">
                <h3 className="text-sm font-semibold text-[var(--color-brand-navy)]">
                  Siparişler
                </h3>
                <span className="text-[10px] text-slate-400 uppercase tracking-wider">
                  {data.orders.length} sipariş
                </span>
              </div>
              <div className="overflow-x-auto max-h-[480px]">
                <table className="w-full">
                  <thead className="bg-slate-50/60 sticky top-0">
                    <tr className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 border-b border-[var(--color-border)]">
                      <th className="py-2 px-3 text-left">Sipariş</th>
                      <th className="py-2 px-3 text-left">Tarih</th>
                      <th className="py-2 px-3 text-left">Durum</th>
                      <th className="py-2 px-3 text-left">Müşteri</th>
                      <th className="py-2 px-3 text-right">Kalem</th>
                      <th className="py-2 px-3 text-right">Gelir</th>
                      <th className="py-2 px-3 text-right">Maliyet</th>
                      <th className="py-2 px-3 text-right">Kar</th>
                      <th className="py-2 px-3 text-right">Marj</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.orders.map((o) => (
                      <OrderRow key={o.id} o={o} />
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : !isLoading && data ? (
            <div className="rounded-xl bg-white border border-[var(--color-border)] p-10 text-center text-sm text-slate-400">
              Bu dönem için bu tedarikçinin siparişi yok.
            </div>
          ) : null}
        </div>
      </aside>
    </div>
  );
}

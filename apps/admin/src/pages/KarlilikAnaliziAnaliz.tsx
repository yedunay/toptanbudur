import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  fetchProfitabilityAnalysis,
  buildExportUrl,
  type ProfitabilityQuery,
  type SupplierProfit,
  type DailyTrendPoint,
} from "../lib/profitability";
import { formatTRY } from "../lib/products";
import { getToken } from "../lib/auth";
import SupplierDetailDrawer from "../components/SupplierDetailDrawer";

function pct(current: number, prev: number): string {
  if (prev === 0) return current > 0 ? "+∞" : "—";
  const d = ((current - prev) / Math.abs(prev)) * 100;
  return (d >= 0 ? "+" : "") + d.toFixed(1) + "%";
}

function pctTone(current: number, prev: number): "up" | "down" | "flat" {
  if (prev === 0) return "flat";
  if (current > prev) return "up";
  if (current < prev) return "down";
  return "flat";
}

function formatCompact(n: number): string {
  if (Math.abs(n) >= 1_000_000)
    return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (Math.abs(n) >= 1_000)
    return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  return n.toFixed(0);
}

interface KpiHeroProps {
  label: string;
  value: string;
  delta: string;
  tone: "up" | "down" | "flat";
  accent: "navy" | "emerald" | "amber" | "violet";
  icon: React.ReactNode;
  sparkline?: DailyTrendPoint[];
  metric?: "revenue" | "profit" | "cost";
}

function KpiHero({
  label,
  value,
  delta,
  tone,
  accent,
  icon,
  sparkline,
  metric,
}: KpiHeroProps) {
  const accentMap = {
    navy: {
      bg: "from-[#0a1f44] via-[#10306d] to-[#1a3a82]",
      glow: "bg-blue-400/20",
      ring: "ring-blue-300/30",
    },
    emerald: {
      bg: "from-emerald-700 via-emerald-600 to-teal-500",
      glow: "bg-emerald-300/20",
      ring: "ring-emerald-200/30",
    },
    amber: {
      bg: "from-amber-600 via-orange-500 to-rose-500",
      glow: "bg-amber-300/20",
      ring: "ring-amber-200/30",
    },
    violet: {
      bg: "from-violet-700 via-purple-600 to-fuchsia-500",
      glow: "bg-purple-300/20",
      ring: "ring-purple-200/30",
    },
  } as const;
  const a = accentMap[accent];

  const toneCls =
    tone === "up"
      ? "bg-white/15 text-emerald-200"
      : tone === "down"
        ? "bg-white/15 text-rose-200"
        : "bg-white/10 text-white/70";
  const toneArrow = tone === "up" ? "▲" : tone === "down" ? "▼" : "·";

  return (
    <div
      className={`group relative overflow-hidden rounded-2xl bg-gradient-to-br ${a.bg} text-white shadow-lg ring-1 ${a.ring} transition-transform duration-300 hover:-translate-y-0.5 hover:shadow-xl`}
    >
      <div
        className={`absolute -top-12 -right-12 h-40 w-40 rounded-full blur-3xl ${a.glow}`}
        aria-hidden="true"
      />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.12),transparent_60%)]" />

      <div className="relative p-5 flex flex-col gap-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/70">
              {label}
            </p>
            <p className="mt-2 text-3xl font-bold tracking-tight tabular-nums leading-none">
              {value}
            </p>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 backdrop-blur-sm ring-1 ring-white/20">
            {icon}
          </div>
        </div>

        <div className="flex items-center justify-between">
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${toneCls}`}
          >
            <span aria-hidden="true">{toneArrow}</span>
            {delta}
          </span>
          <span className="text-[10px] uppercase tracking-wider text-white/50">
            önceki dönem
          </span>
        </div>

        {sparkline && sparkline.length > 1 && metric ? (
          <MiniSpark points={sparkline} metric={metric} />
        ) : null}
      </div>
    </div>
  );
}

function MiniSpark({
  points,
  metric,
}: {
  points: DailyTrendPoint[];
  metric: "revenue" | "profit" | "cost";
}) {
  const w = 220;
  const h = 36;
  const vals = points.map((p) => p[metric]);
  const min = Math.min(...vals, 0);
  const max = Math.max(...vals, 1);
  const range = max - min || 1;
  const stepX = points.length > 1 ? w / (points.length - 1) : 0;
  const coords = vals.map((v, i) => {
    const x = i * stepX;
    const y = h - ((v - min) / range) * h;
    return [x, y] as const;
  });
  const linePath = coords
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");
  const areaPath = `${linePath} L${w},${h} L0,${h} Z`;
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="h-9 w-full"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`spark-${metric}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="rgba(255,255,255,0.45)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#spark-${metric})`} />
      <path
        d={linePath}
        fill="none"
        stroke="rgba(255,255,255,0.95)"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TrendChart({ data }: { data: DailyTrendPoint[] }) {
  if (data.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-slate-400">
        Trend için yeterli veri yok.
      </div>
    );
  }
  const w = 800;
  const h = 220;
  const padLeft = 56;
  const padRight = 16;
  const padTop = 16;
  const padBottom = 32;
  const innerW = w - padLeft - padRight;
  const innerH = h - padTop - padBottom;

  const revVals = data.map((d) => d.revenue);
  const profitVals = data.map((d) => d.profit);
  const max = Math.max(...revVals, ...profitVals, 1);
  const min = Math.min(...profitVals, 0);
  const range = max - min || 1;

  const stepX = data.length > 1 ? innerW / (data.length - 1) : 0;
  const xAt = (i: number) => padLeft + i * stepX;
  const yAt = (v: number) => padTop + (1 - (v - min) / range) * innerH;

  const revPath = data
    .map((d, i) => `${i === 0 ? "M" : "L"}${xAt(i)},${yAt(d.revenue)}`)
    .join(" ");
  const areaPath = `${revPath} L${xAt(data.length - 1)},${padTop + innerH} L${xAt(0)},${padTop + innerH} Z`;
  const profitPath = data
    .map((d, i) => `${i === 0 ? "M" : "L"}${xAt(i)},${yAt(d.profit)}`)
    .join(" ");
  // 7 günlük HAREKETLİ ORTALAMA (kâr) — günlük dalgalanmayı yumuşatır.
  const MA_WINDOW = 7;
  const profitMaPath = data
    .map((_, i) => {
      const slice = profitVals.slice(Math.max(0, i - MA_WINDOW + 1), i + 1);
      const avg = slice.reduce((a, b) => a + b, 0) / slice.length;
      return `${i === 0 ? "M" : "L"}${xAt(i)},${yAt(avg)}`;
    })
    .join(" ");

  const tickCount = 4;
  const ticks = Array.from({ length: tickCount + 1 }, (_, i) => {
    const v = min + (range * i) / tickCount;
    return { v, y: yAt(v) };
  });

  const labelStep = Math.max(1, Math.ceil(data.length / 6));
  const xLabels = data
    .map((d, i) => ({ i, d }))
    .filter(({ i }) => i % labelStep === 0 || i === data.length - 1);

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="w-full"
      role="img"
      aria-label="Günlük gelir ve kar trendi"
    >
      <defs>
        <linearGradient id="trend-rev-area" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="rgba(16, 48, 109, 0.22)" />
          <stop offset="100%" stopColor="rgba(16, 48, 109, 0)" />
        </linearGradient>
      </defs>

      {ticks.map((t, i) => (
        <g key={i}>
          <line
            x1={padLeft}
            x2={w - padRight}
            y1={t.y}
            y2={t.y}
            stroke="#eef1f6"
            strokeWidth={1}
          />
          <text
            x={padLeft - 8}
            y={t.y + 4}
            fontSize={10}
            fill="#94a3b8"
            textAnchor="end"
          >
            {formatCompact(t.v)}
          </text>
        </g>
      ))}

      <path d={areaPath} fill="url(#trend-rev-area)" />
      <path
        d={revPath}
        fill="none"
        stroke="#10306d"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d={profitPath}
        fill="none"
        stroke="#059669"
        strokeWidth={1.75}
        strokeDasharray="4 3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* 7 günlük hareketli ortalama (kâr) */}
      <path
        d={profitMaPath}
        fill="none"
        stroke="#f59e0b"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Legend */}
      <g transform={`translate(${padLeft}, 12)`} fontSize={10} fill="#64748b">
        <line x1={0} x2={16} y1={0} y2={0} stroke="#10306d" strokeWidth={2} />
        <text x={20} y={3}>Gelir</text>
        <line x1={64} x2={80} y1={0} y2={0} stroke="#059669" strokeWidth={2} strokeDasharray="4 3" />
        <text x={84} y={3}>Kâr</text>
        <line x1={120} x2={136} y1={0} y2={0} stroke="#f59e0b" strokeWidth={2} />
        <text x={140} y={3}>Kâr 7g ort.</text>
      </g>

      {xLabels.map(({ i, d }) => (
        <text
          key={i}
          x={xAt(i)}
          y={h - 10}
          fontSize={10}
          fill="#94a3b8"
          textAnchor="middle"
        >
          {d.date.slice(5)}
        </text>
      ))}
    </svg>
  );
}

function ChevronRight() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="9 6 15 12 9 18" />
    </svg>
  );
}

function SupplierRow({
  s,
  rank,
  maxRevenue,
  onClick,
}: {
  s: SupplierProfit;
  rank: number;
  maxRevenue: number;
  onClick: () => void;
}) {
  const barWidth = Math.max(0, Math.min(100, s.margin));
  const revShare = maxRevenue > 0 ? (s.revenue / maxRevenue) * 100 : 0;
  const barColor =
    s.margin >= 20
      ? "bg-gradient-to-r from-emerald-400 to-emerald-600"
      : s.margin >= 10
        ? "bg-gradient-to-r from-amber-300 to-amber-500"
        : "bg-gradient-to-r from-rose-400 to-rose-500";
  const marginTone =
    s.margin >= 20
      ? "text-emerald-700"
      : s.margin >= 10
        ? "text-amber-700"
        : "text-rose-600";
  const rankStyles =
    rank === 1
      ? "bg-gradient-to-br from-amber-300 to-amber-500 text-white"
      : rank === 2
        ? "bg-gradient-to-br from-slate-300 to-slate-400 text-white"
        : rank === 3
          ? "bg-gradient-to-br from-orange-300 to-orange-500 text-white"
          : "bg-slate-100 text-slate-500";

  return (
    <tr
      onClick={onClick}
      className="group cursor-pointer border-b border-[var(--color-border)] transition-colors hover:bg-slate-50/80"
    >
      <td className="py-3 px-4 w-12">
        <span
          className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold tabular-nums ${rankStyles}`}
        >
          {rank}
        </span>
      </td>
      <td className="py-3 px-4">
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-[var(--color-text)] group-hover:text-[var(--color-brand-navy)]">
            {s.supplierName}
          </span>
          <div className="mt-1 h-1 w-32 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#10306d] to-[#3b6dd1]"
              style={{ width: `${revShare}%` }}
            />
          </div>
        </div>
      </td>
      <td className="py-3 px-4 text-sm text-right tabular-nums font-medium text-[var(--color-text)]">
        {formatTRY(s.revenue)}
      </td>
      <td className="py-3 px-4 text-sm text-right tabular-nums text-slate-500">
        {formatTRY(s.cost)}
      </td>
      <td className="py-3 px-4 text-sm text-right tabular-nums font-semibold text-emerald-700">
        {formatTRY(s.profit)}
      </td>
      <td className="py-3 px-4 w-40">
        <div className="flex items-center gap-2">
          <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
            <div
              className={`h-full rounded-full ${barColor} transition-all duration-500`}
              style={{ width: `${barWidth}%` }}
            />
          </div>
          <span
            className={`text-xs tabular-nums font-semibold w-12 text-right ${marginTone}`}
          >
            {s.margin.toFixed(1)}%
          </span>
        </div>
      </td>
      <td className="py-3 px-4 text-sm text-right tabular-nums text-slate-500">
        {s.orderCount}
      </td>
      <td className="py-3 px-2 text-right text-slate-300 group-hover:text-[var(--color-brand-navy)] transition-colors">
        <ChevronRight />
      </td>
    </tr>
  );
}

export default function KarlilikAnaliziAnaliz() {
  const [query, setQuery] = useState<ProfitabilityQuery>(() => {
    const p = new URLSearchParams(window.location.search);
    return {
      dateFrom: p.get("dateFrom") ?? undefined,
      dateTo: p.get("dateTo") ?? undefined,
      supplierId: p.get("supplierId") ?? undefined,
    };
  });

  const [draft, setDraft] = useState(query);
  const [selectedSupplier, setSelectedSupplier] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["profitability", "analysis", query],
    queryFn: () => fetchProfitabilityAnalysis(query),
  });

  function applyFilters() {
    setQuery(draft);
    const p = new URLSearchParams();
    if (draft.dateFrom) p.set("dateFrom", draft.dateFrom);
    if (draft.dateTo) p.set("dateTo", draft.dateTo);
    if (draft.supplierId) p.set("supplierId", draft.supplierId);
    const qs = p.toString();
    window.history.replaceState(
      null,
      "",
      qs ? `?${qs}` : window.location.pathname,
    );
  }

  function applyPreset(days: number) {
    // Tarih anahtarı TR takvimine sabit (kullanıcı makinesinin TZ'sinden
    // bağımsız). toISOString (UTC) gece yarısı civarı bir gün KAYDIRIYORDU.
    const trDay = (d: Date) =>
      d.toLocaleDateString("en-CA", { timeZone: "Europe/Istanbul" });
    const to = new Date();
    const from = new Date(to.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
    const next = { dateFrom: trDay(from), dateTo: trDay(to) };
    setDraft((d) => ({ ...d, ...next }));
    setQuery((q) => ({ ...q, ...next }));
    const p = new URLSearchParams();
    p.set("dateFrom", next.dateFrom);
    p.set("dateTo", next.dateTo);
    window.history.replaceState(null, "", `?${p.toString()}`);
  }

  async function handleExport() {
    const url = buildExportUrl(query);
    const token = getToken();
    const res = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `karlilik-analizi-${new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Istanbul" })}.xlsx`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const summary = data?.summary;
  const maxSupplierRevenue = useMemo(
    () =>
      data?.bySupplier?.length
        ? Math.max(...data.bySupplier.map((s) => s.revenue))
        : 0,
    [data?.bySupplier],
  );

  const periodLabel = useMemo(() => {
    if (!data?.period) return "—";
    const fmt = (s: string) => {
      const d = new Date(s);
      return d.toLocaleDateString("tr-TR", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
    };
    return `${fmt(data.period.from)} → ${fmt(data.period.to)}`;
  }, [data?.period]);

  return (
    <div className="space-y-6 pb-12">
      {/* HERO */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#06122c] via-[#0a1f44] to-[#10306d] p-6 lg:p-8 shadow-xl">
        <div className="absolute -top-24 -right-16 h-72 w-72 rounded-full bg-blue-400/15 blur-3xl" />
        <div className="absolute -bottom-24 -left-16 h-72 w-72 rounded-full bg-violet-500/15 blur-3xl" />
        <div className="relative flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-white/80 ring-1 ring-white/15">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Karlılık Analizi
            </div>
            <h1 className="mt-3 text-2xl lg:text-3xl font-bold text-white tracking-tight">
              Gelir, maliyet ve marj — tek bakışta
            </h1>
            <p className="mt-1.5 text-sm text-white/60">
              Dönem:{" "}
              <span className="font-medium text-white/85">{periodLabel}</span>
            </p>
          </div>

          {/* Filter bar */}
          <div className="flex flex-wrap items-end gap-2 rounded-2xl bg-white/95 backdrop-blur p-3 ring-1 ring-white/20 shadow-md">
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                Başlangıç
              </label>
              <input
                type="date"
                value={draft.dateFrom ?? ""}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    dateFrom: e.target.value || undefined,
                  }))
                }
                className="h-9 px-3 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-navy)]/30"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                Bitiş
              </label>
              <input
                type="date"
                value={draft.dateTo ?? ""}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    dateTo: e.target.value || undefined,
                  }))
                }
                className="h-9 px-3 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-navy)]/30"
              />
            </div>
            <button
              type="button"
              onClick={applyFilters}
              className="h-9 px-4 rounded-lg bg-[var(--color-brand-navy)] text-white text-sm font-semibold hover:opacity-90 transition-opacity shadow-sm"
            >
              Uygula
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft({});
                setQuery({});
                window.history.replaceState(null, "", window.location.pathname);
              }}
              className="h-9 px-3 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 transition-colors"
            >
              Temizle
            </button>
          </div>
        </div>

        {/* Quick presets + export */}
        <div className="relative mt-5 flex flex-wrap items-center gap-2">
          {[
            { label: "Son 7 gün", days: 7 },
            { label: "Son 30 gün", days: 30 },
            { label: "Son 90 gün", days: 90 },
          ].map((p) => (
            <button
              key={p.days}
              type="button"
              onClick={() => applyPreset(p.days)}
              className="h-8 px-3 rounded-full bg-white/10 text-[12px] font-medium text-white/85 ring-1 ring-white/15 hover:bg-white/20 transition-colors"
            >
              {p.label}
            </button>
          ))}
          <div className="ml-auto">
            <button
              type="button"
              onClick={handleExport}
              className="inline-flex items-center gap-2 h-9 px-4 rounded-full bg-white text-[var(--color-brand-navy)] text-sm font-semibold hover:bg-white/90 transition-colors shadow-sm"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Excel İndir
            </button>
          </div>
        </div>
      </div>

      {/* Maliyet uyarısı */}
      {data && data.zeroCostItemCount > 0 ? (
        <div className="rounded-xl border border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 px-4 py-3 text-sm text-amber-800 flex items-start gap-3 shadow-sm">
          <span className="mt-0.5 shrink-0 inline-flex h-6 w-6 items-center justify-center rounded-full bg-amber-200 text-amber-800 font-bold">
            !
          </span>
          <span>
            <strong>{data.zeroCostItemCount} kalem</strong> için alış fiyatı
            (costPrice) sıfır — bu kalemlerin maliyeti hesaplanamadı. Tedarikçi
            ayarlarını kontrol edin veya XML feed'inizdeki fiyat alanını
            doğrulayın.
          </span>
        </div>
      ) : null}

      {/* Hata */}
      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-center justify-between">
          <span>Veri yüklenemedi.</span>
          <button
            type="button"
            onClick={() => refetch()}
            className="underline font-medium"
          >
            Tekrar dene
          </button>
        </div>
      ) : null}

      {/* KPI HERO CARDS */}
      {isLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div
              key={i}
              className="h-44 rounded-2xl bg-gradient-to-br from-slate-100 to-slate-200 animate-pulse"
            />
          ))}
        </div>
      ) : summary ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiHero
            label="Toplam Gelir"
            value={formatTRY(summary.revenue)}
            delta={pct(summary.revenue, summary.prevRevenue)}
            tone={pctTone(summary.revenue, summary.prevRevenue)}
            accent="navy"
            sparkline={data?.dailyTrend}
            metric="revenue"
            icon={
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <line x1="12" y1="1" x2="12" y2="23" />
                <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
              </svg>
            }
          />
          <KpiHero
            label="Net Kar"
            value={formatTRY(summary.profit)}
            delta={pct(summary.profit, summary.prevProfit)}
            tone={pctTone(summary.profit, summary.prevProfit)}
            accent="emerald"
            sparkline={data?.dailyTrend}
            metric="profit"
            icon={
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
              </svg>
            }
          />
          <KpiHero
            label="Karlılık Marjı"
            value={summary.margin.toFixed(1) + "%"}
            delta={pct(summary.margin, summary.prevMargin)}
            tone={pctTone(summary.margin, summary.prevMargin)}
            accent="amber"
            icon={
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            }
          />
          <KpiHero
            label="Sipariş Sayısı"
            value={summary.orderCount.toLocaleString("tr-TR")}
            delta={`${summary.itemCount.toLocaleString("tr-TR")} kalem`}
            tone="flat"
            accent="violet"
            icon={
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
                <line x1="3" y1="6" x2="21" y2="6" />
                <path d="M16 10a4 4 0 0 1-8 0" />
              </svg>
            }
          />
        </div>
      ) : null}

      {/* TREND CHART */}
      {data?.dailyTrend && data.dailyTrend.length > 0 ? (
        <div className="rounded-2xl border border-[var(--color-border)] bg-white shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-[var(--color-border)] flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-[var(--color-brand-navy)]">
                Günlük Trend
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Gelir (dolu çizgi) ve net kar (kesik çizgi)
              </p>
            </div>
            <div className="flex items-center gap-4 text-[11px] text-slate-600">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-[#10306d]" />
                Gelir
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-0.5 w-4 bg-emerald-600" />
                Net Kar
              </span>
            </div>
          </div>
          <div className="p-5">
            <TrendChart data={data.dailyTrend} />
          </div>
        </div>
      ) : null}

      {/* TEDARİKÇİ TABLOSU */}
      {data?.bySupplier && data.bySupplier.length > 0 ? (
        <div className="rounded-2xl border border-[var(--color-border)] bg-white shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-[var(--color-border)] flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-[var(--color-brand-navy)]">
                Tedarikçi Bazlı Karlılık
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Detay için tedarikçiye tıklayın
              </p>
            </div>
            <span className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">
              {data.bySupplier.length} tedarikçi
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 bg-slate-50/60 border-b border-[var(--color-border)]">
                  <th className="py-3 px-4 w-12">#</th>
                  <th className="py-3 px-4">Tedarikçi</th>
                  <th className="py-3 px-4 text-right">Gelir</th>
                  <th className="py-3 px-4 text-right">Maliyet</th>
                  <th className="py-3 px-4 text-right">Kar</th>
                  <th className="py-3 px-4 w-40">Marj</th>
                  <th className="py-3 px-4 text-right">Sipariş</th>
                  <th className="py-3 px-2 w-8" />
                </tr>
              </thead>
              <tbody>
                {data.bySupplier.map((s, i) => (
                  <SupplierRow
                    key={s.supplierId}
                    s={s}
                    rank={i + 1}
                    maxRevenue={maxSupplierRevenue}
                    onClick={() =>
                      setSelectedSupplier({
                        id: s.supplierId,
                        name: s.supplierName,
                      })
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : !isLoading ? (
        <div className="rounded-2xl border border-[var(--color-border)] bg-white p-12 text-center">
          <div className="mx-auto mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M3 9h18" />
            </svg>
          </div>
          <p className="text-sm font-medium text-slate-600">
            Bu dönem için veri bulunamadı.
          </p>
          <p className="text-xs text-slate-400 mt-1">
            Tarih aralığını genişleterek tekrar deneyin.
          </p>
        </div>
      ) : null}

      {/* SUPPLIER DETAIL DRAWER */}
      {selectedSupplier ? (
        <SupplierDetailDrawer
          supplierId={selectedSupplier.id}
          supplierName={selectedSupplier.name}
          query={query}
          onClose={() => setSelectedSupplier(null)}
        />
      ) : null}
    </div>
  );
}

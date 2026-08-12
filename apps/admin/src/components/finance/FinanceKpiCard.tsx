import { formatAmount } from "../../lib/format";

// Toptan Budur / Manuel Gelir/Gider / Toplam blokları için KPI kartı.
// İkon bubble + etiket + büyük tutar + "Önceki aya göre ↑ %x" delta.

type KpiVariant = "revenue" | "cost" | "profit" | "kdv";

const VARIANT: Record<
  KpiVariant,
  { icon: string; bubble: string; iconColor: string }
> = {
  revenue: { icon: "📈", bubble: "bg-blue-50", iconColor: "text-blue-600" },
  cost: { icon: "📉", bubble: "bg-rose-50", iconColor: "text-rose-600" },
  profit: { icon: "💹", bubble: "bg-emerald-50", iconColor: "text-emerald-600" },
  kdv: { icon: "％", bubble: "bg-violet-50", iconColor: "text-violet-600" },
};

interface FinanceKpiCardProps {
  variant: KpiVariant;
  label: string;
  value: number;
  delta?: number | null;
}

export default function FinanceKpiCard({
  variant,
  label,
  value,
  delta,
}: FinanceKpiCardProps) {
  const v = VARIANT[variant];
  const hasDelta = delta !== undefined && delta !== null;
  const up = (delta ?? 0) >= 0;
  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <span
          className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-base ${v.bubble} ${v.iconColor}`}
          aria-hidden
        >
          {v.icon}
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-medium text-slate-500">{label}</p>
          <p className="mt-0.5 truncate text-lg font-bold tabular-nums text-[var(--color-text)]">
            {formatAmount(value)}
          </p>
          {hasDelta ? (
            <p
              className={`mt-0.5 text-[11px] font-medium ${
                up ? "text-emerald-600" : "text-rose-600"
              }`}
            >
              Önceki aya göre {up ? "↑" : "↓"} %
              {Math.abs(delta as number).toLocaleString("tr-TR", {
                minimumFractionDigits: 1,
                maximumFractionDigits: 1,
              })}
            </p>
          ) : (
            <p className="mt-0.5 text-[11px] text-slate-400">
              Önceki ay verisi yok
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

import type { ReactElement, ReactNode } from "react";
import Sparkline from "./Sparkline";

interface HeroMetricProps {
  label: string;
  value: string;
  delta: number | null;
  sparkValues: number[];
  hint?: string;
  accent?: "blue" | "amber" | "emerald" | "violet";
  icon?: ReactNode;
  children?: ReactNode;
}

interface AccentConfig {
  stroke: string;
  glow: string;
  text: string;
  iconBg: string;
  iconText: string;
}

const ACCENTS: Record<NonNullable<HeroMetricProps["accent"]>, AccentConfig> = {
  blue: {
    stroke: "#2563eb",
    glow: "from-blue-500/10",
    text: "text-blue-600",
    iconBg: "bg-blue-50",
    iconText: "text-blue-600",
  },
  amber: {
    stroke: "#d97706",
    glow: "from-amber-500/10",
    text: "text-amber-600",
    iconBg: "bg-amber-50",
    iconText: "text-amber-600",
  },
  emerald: {
    stroke: "#059669",
    glow: "from-emerald-500/10",
    text: "text-emerald-600",
    iconBg: "bg-emerald-50",
    iconText: "text-emerald-600",
  },
  violet: {
    stroke: "#7c3aed",
    glow: "from-violet-500/10",
    text: "text-violet-600",
    iconBg: "bg-violet-50",
    iconText: "text-violet-600",
  },
};

function formatDelta(delta: number | null): { label: string; tone: "up" | "down" | "flat" } {
  if (delta === null) return { label: "—", tone: "flat" };
  if (delta === 0) return { label: "0%", tone: "flat" };
  const sign = delta > 0 ? "+" : "";
  return {
    label: `${sign}${delta.toFixed(1)}%`,
    tone: delta > 0 ? "up" : "down",
  };
}

export default function HeroMetric({
  label,
  value,
  delta,
  sparkValues,
  hint,
  accent = "blue",
  icon,
  children,
}: HeroMetricProps): ReactElement {
  const accentCfg = ACCENTS[accent];
  const deltaInfo = formatDelta(delta);
  const deltaToneClass =
    deltaInfo.tone === "up"
      ? "text-emerald-700 bg-emerald-50 border-emerald-100"
      : deltaInfo.tone === "down"
        ? "text-rose-700 bg-rose-50 border-rose-100"
        : "text-slate-500 bg-slate-50 border-slate-200";

  return (
    <div className="group relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-12px_rgba(15,23,42,0.08)] transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-[0_2px_4px_rgba(15,23,42,0.05),0_12px_28px_-12px_rgba(15,23,42,0.12)] sm:p-6">
      <div
        className={`pointer-events-none absolute -top-24 -right-24 h-56 w-56 rounded-full bg-gradient-to-br ${accentCfg.glow} to-transparent blur-3xl transition-opacity group-hover:opacity-80`}
        aria-hidden="true"
      />
      <div className="relative">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            {icon ? (
              <span
                className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${accentCfg.iconBg} ${accentCfg.iconText}`}
              >
                {icon}
              </span>
            ) : null}
            <p className="min-w-0 truncate text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 sm:text-xs">
              {label}
            </p>
          </div>
          <span
            className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold tabular-nums ${deltaToneClass}`}
          >
            {deltaInfo.label}
          </span>
        </div>

        <div className="mt-4 flex items-end justify-between gap-3 sm:mt-5 sm:gap-4">
          <p className="min-w-0 break-words text-2xl font-semibold tracking-tight tabular-nums text-slate-900 sm:text-3xl xl:text-[34px] xl:leading-[1.1]">
            {value}
          </p>
          {sparkValues.length >= 2 ? (
            <div className={`hidden sm:block ${accentCfg.text}`}>
              <Sparkline
                values={sparkValues}
                width={96}
                height={32}
                stroke={accentCfg.stroke}
                fill={accentCfg.stroke}
              />
            </div>
          ) : null}
        </div>

        {hint ? (
          <p className="mt-3 text-[11.5px] text-slate-500 sm:text-xs">{hint}</p>
        ) : null}
        {children ? <div className="mt-3">{children}</div> : null}
      </div>
    </div>
  );
}

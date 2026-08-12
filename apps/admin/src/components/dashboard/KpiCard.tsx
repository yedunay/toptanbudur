import type { ReactElement, ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";

interface KpiCardProps {
  label: string;
  value: string;
  sub?: string;
  to?: string;
  icon?: ReactNode;
  tone?: "neutral" | "warn" | "danger" | "good";
}

interface ToneConfig {
  border: string;
  hoverBorder: string;
  iconBg: string;
  iconText: string;
  subText: string;
  dot?: string;
}

const TONES: Record<NonNullable<KpiCardProps["tone"]>, ToneConfig> = {
  neutral: {
    border: "border-slate-200/80",
    hoverBorder: "hover:border-slate-300",
    iconBg: "bg-slate-100",
    iconText: "text-slate-600",
    subText: "text-slate-500",
  },
  warn: {
    border: "border-amber-200/80",
    hoverBorder: "hover:border-amber-300",
    iconBg: "bg-amber-50",
    iconText: "text-amber-600",
    subText: "text-amber-700",
    dot: "bg-amber-500",
  },
  danger: {
    border: "border-rose-200/80",
    hoverBorder: "hover:border-rose-300",
    iconBg: "bg-rose-50",
    iconText: "text-rose-600",
    subText: "text-rose-700",
    dot: "bg-rose-500",
  },
  good: {
    border: "border-emerald-200/80",
    hoverBorder: "hover:border-emerald-300",
    iconBg: "bg-emerald-50",
    iconText: "text-emerald-600",
    subText: "text-emerald-700",
    dot: "bg-emerald-500",
  },
};

export default function KpiCard({
  label,
  value,
  sub,
  to,
  icon,
  tone = "neutral",
}: KpiCardProps): ReactElement {
  const cfg = TONES[tone];
  const interactive = Boolean(to);

  const body = (
    <div
      className={`group h-full rounded-2xl border bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-all sm:p-5 ${cfg.border} ${
        interactive ? `${cfg.hoverBorder} hover:-translate-y-0.5 hover:shadow-[0_4px_12px_-4px_rgba(15,23,42,0.08)]` : ""
      }`}
    >
      <div className="flex items-start gap-3">
        {icon ? (
          <div
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${cfg.iconBg} ${cfg.iconText}`}
          >
            {icon}
          </div>
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[10.5px] font-semibold uppercase tracking-[0.14em] text-slate-500 sm:text-[11px]">
            {label}
          </p>
          <p className="mt-1.5 truncate text-xl font-semibold tabular-nums text-slate-900 sm:text-2xl">
            {value}
          </p>
          {sub ? (
            <p className={`mt-1 flex items-center gap-1.5 truncate text-[11.5px] sm:text-xs ${cfg.subText}`}>
              {cfg.dot ? (
                <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${cfg.dot}`} aria-hidden="true" />
              ) : null}
              <span className="truncate">{sub}</span>
            </p>
          ) : null}
        </div>
        {interactive ? (
          <span
            className="hidden text-slate-300 transition-all group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-slate-600 sm:inline-flex"
            aria-hidden="true"
          >
            <ArrowUpRight size={16} />
          </span>
        ) : null}
      </div>
    </div>
  );

  if (to) {
    return (
      <Link
        to={to}
        className="block rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2"
      >
        {body}
      </Link>
    );
  }
  return body;
}

import type { ReactElement } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ShoppingBag,
  WifiOff,
  CheckCircle2,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";
import type { DashboardAlertsBlock } from "../../lib/dashboard";

interface AlertListProps {
  alerts: DashboardAlertsBlock;
}

type AlertTone = "warn" | "danger" | "info";

interface AlertEntry {
  label: string;
  count: number;
  to: string;
  tone: AlertTone;
  hint?: string;
  icon: LucideIcon;
}

interface ToneConfig {
  container: string;
  iconBg: string;
  iconText: string;
  badge: string;
  hintText: string;
}

const TONE_CONFIG: Record<AlertTone, ToneConfig> = {
  warn: {
    container: "border-amber-200/80 bg-amber-50/60 text-amber-900 hover:border-amber-300 hover:bg-amber-50",
    iconBg: "bg-amber-100",
    iconText: "text-amber-700",
    badge: "bg-white/90 text-amber-900 ring-1 ring-amber-200",
    hintText: "text-amber-700/70",
  },
  danger: {
    container: "border-rose-200/80 bg-rose-50/60 text-rose-900 hover:border-rose-300 hover:bg-rose-50",
    iconBg: "bg-rose-100",
    iconText: "text-rose-700",
    badge: "bg-white/90 text-rose-900 ring-1 ring-rose-200",
    hintText: "text-rose-700/70",
  },
  info: {
    container: "border-blue-200/80 bg-blue-50/60 text-blue-900 hover:border-blue-300 hover:bg-blue-50",
    iconBg: "bg-blue-100",
    iconText: "text-blue-700",
    badge: "bg-white/90 text-blue-900 ring-1 ring-blue-200",
    hintText: "text-blue-700/70",
  },
};

export default function AlertList({ alerts }: AlertListProps): ReactElement {
  const entries: AlertEntry[] = [
    {
      label: "Bekleyen sipariş",
      count: alerts.pendingOrders,
      to: "/orders?status=paid",
      tone: "warn",
      hint: "Ödendi · hazırlanmayı bekliyor",
      icon: ShoppingBag,
    },
    {
      label: "Düşük stok SKU",
      count: alerts.lowStockSkus,
      to: "/products?stock=low",
      tone: "info",
      hint: "≤ 5 adet",
      icon: AlertTriangle,
    },
    {
      label: "Başarısız feed",
      count: alerts.failedFeeds,
      to: "/suppliers",
      tone: "danger",
      icon: WifiOff,
    },
  ];

  const visible = entries.filter((e) => e.count > 0);

  if (visible.length === 0) {
    return (
      <div className="rounded-xl border border-emerald-200/80 bg-gradient-to-br from-emerald-50 to-white p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
            <CheckCircle2 size={18} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-emerald-900">
              Tüm operasyonel akış temiz.
            </p>
            <p className="mt-0.5 text-[11px] text-emerald-700/70 sm:text-xs">
              Bekleyen sipariş, iade ya da feed hatası yok.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {visible.map((entry) => {
        const cfg = TONE_CONFIG[entry.tone];
        const Icon = entry.icon;
        return (
          <li key={entry.label}>
            <Link
              to={entry.to}
              className={`group flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-all hover:-translate-y-0.5 hover:shadow-[0_2px_8px_-4px_rgba(15,23,42,0.1)] focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 sm:px-3.5 sm:py-3 ${cfg.container}`}
            >
              <span
                className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${cfg.iconBg} ${cfg.iconText}`}
              >
                <Icon size={16} aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold sm:text-sm">
                  {entry.label}
                </p>
                {entry.hint && (
                  <p className={`truncate text-[11px] sm:text-xs ${cfg.hintText}`}>
                    {entry.hint}
                  </p>
                )}
              </div>
              <span
                className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold tabular-nums sm:text-sm ${cfg.badge}`}
              >
                {entry.count.toLocaleString("tr-TR")}
              </span>
              <ChevronRight
                size={16}
                className="hidden shrink-0 opacity-40 transition-all group-hover:translate-x-0.5 group-hover:opacity-100 sm:block"
                aria-hidden="true"
              />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

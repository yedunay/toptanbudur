import type { ReactElement } from "react";
import { Link } from "react-router-dom";
import { Rss, ArrowUpRight, CheckCircle2, AlertCircle, XCircle, type LucideIcon } from "lucide-react";
import type { DashboardFeedHealth } from "../../lib/dashboard";

interface FeedHealthProps {
  feeds: DashboardFeedHealth[];
}

type FeedStatus = "ok" | "warn" | "fail";

interface StatusConfig {
  dot: string;
  badge: string;
  label: string;
  icon: LucideIcon;
  iconText: string;
}

const STATUS_STYLES: Record<FeedStatus, StatusConfig> = {
  ok: {
    dot: "bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.15)]",
    badge: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
    label: "Sağlıklı",
    icon: CheckCircle2,
    iconText: "text-emerald-600",
  },
  warn: {
    dot: "bg-amber-500 shadow-[0_0_0_3px_rgba(245,158,11,0.15)]",
    badge: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
    label: "Gecikme",
    icon: AlertCircle,
    iconText: "text-amber-600",
  },
  fail: {
    dot: "bg-rose-500 shadow-[0_0_0_3px_rgba(244,63,94,0.15)]",
    badge: "bg-rose-50 text-rose-700 ring-1 ring-rose-200",
    label: "Hata",
    icon: XCircle,
    iconText: "text-rose-600",
  },
};

function formatAge(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "az önce";
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min} dk önce`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} sa önce`;
  const day = Math.floor(hr / 24);
  return `${day} gün önce`;
}

export default function FeedHealth({ feeds }: FeedHealthProps): ReactElement {
  return (
    <div className="flex h-full flex-col rounded-2xl border border-slate-200/80 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_4px_16px_-6px_rgba(15,23,42,0.06)] sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 sm:mb-4 sm:gap-3">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
            <Rss size={14} aria-hidden="true" />
          </span>
          <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-700">
            Tedarikçi feed sağlığı
          </h3>
        </div>
        <Link
          to="/suppliers"
          className="group inline-flex items-center gap-1 text-[11px] font-medium text-blue-600 hover:text-blue-700 sm:text-xs"
        >
          Tümü
          <ArrowUpRight
            size={12}
            className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
            aria-hidden="true"
          />
        </Link>
      </div>

      {feeds.length === 0 ? (
        <p className="flex flex-1 items-center justify-center py-6 text-xs text-slate-400 sm:text-sm">
          Henüz aktif feed yok.
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
          {feeds.map((feed) => {
            const cfg = STATUS_STYLES[feed.status];
            const Icon = cfg.icon;
            return (
              <li
                key={`${feed.supplierId}-${feed.feedName}`}
                className="flex items-center gap-3 rounded-xl border border-slate-200/70 bg-gradient-to-br from-white to-slate-50/50 px-3 py-2.5 transition-colors hover:border-slate-300 sm:px-3.5 sm:py-3"
              >
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${cfg.dot}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <p className="truncate text-xs font-semibold text-slate-900 sm:text-sm">
                      {feed.supplierName}
                    </p>
                    <span className="truncate text-[11px] text-slate-500 sm:text-xs">
                      {feed.feedName}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-slate-500 sm:text-xs">
                    {feed.error ? `Hata: ${feed.error.slice(0, 48)}` : formatAge(feed.lastSyncedAt)}
                  </p>
                </div>
                <span
                  className={`inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium sm:px-2 sm:text-[11px] ${cfg.badge}`}
                >
                  <Icon size={11} className={cfg.iconText} aria-hidden="true" />
                  {cfg.label}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

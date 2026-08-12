import type { ReactElement } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";

interface TopListItem {
  id: string;
  primary: string;
  secondary?: string;
  trailing: string;
  to?: string;
}

interface TopListProps {
  title: string;
  subtitle?: string;
  items: TopListItem[];
  emptyMessage?: string;
}

function rankClass(index: number): string {
  if (index === 0) return "bg-gradient-to-br from-amber-100 to-amber-50 text-amber-700 ring-1 ring-amber-200";
  if (index === 1) return "bg-gradient-to-br from-slate-100 to-slate-50 text-slate-600 ring-1 ring-slate-200";
  if (index === 2) return "bg-gradient-to-br from-orange-50 to-rose-50 text-orange-700 ring-1 ring-orange-200";
  return "bg-slate-50 text-slate-500 ring-1 ring-slate-200/70";
}

export default function TopList({
  title,
  subtitle,
  items,
  emptyMessage = "Veri yok",
}: TopListProps): ReactElement {
  return (
    <div className="flex h-full flex-col rounded-2xl border border-slate-200/80 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_4px_16px_-6px_rgba(15,23,42,0.06)] sm:p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2 sm:mb-4 sm:gap-3">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-700">
          {title}
        </h3>
        {subtitle && (
          <span className="text-[11px] font-medium text-slate-400 sm:text-xs">
            {subtitle}
          </span>
        )}
      </div>

      {items.length === 0 ? (
        <p className="flex flex-1 items-center justify-center py-6 text-xs text-slate-400 sm:text-sm">
          {emptyMessage}
        </p>
      ) : (
        <ol className="space-y-1">
          {items.map((item, i) => {
            const row = (
              <div className="group flex items-center gap-3 rounded-xl px-1.5 py-1.5 transition-all hover:bg-slate-50 sm:px-2 sm:py-2">
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold tabular-nums ${rankClass(i)}`}
                >
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-slate-900 sm:text-sm">
                    {item.primary}
                  </p>
                  {item.secondary && (
                    <p className="truncate text-[11px] text-slate-500 sm:text-xs">
                      {item.secondary}
                    </p>
                  )}
                </div>
                <span className="shrink-0 text-xs font-semibold tabular-nums text-slate-800 sm:text-sm">
                  {item.trailing}
                </span>
                {item.to && (
                  <ArrowUpRight
                    size={14}
                    className="hidden shrink-0 text-slate-300 transition-all group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-slate-600 sm:block"
                    aria-hidden="true"
                  />
                )}
              </div>
            );
            return (
              <li key={item.id}>
                {item.to ? (
                  <Link
                    to={item.to}
                    className="block rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                  >
                    {row}
                  </Link>
                ) : (
                  row
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

"use client";

import {
  ArrowDownCircle,
  ArrowUpCircle,
  ClipboardCheck,
} from "lucide-react";
import type { AccountBalancePageData, RecentMovement } from "./types";
import { amountClass } from "./helpers";

export { SuggestionsCard } from "./SuggestionsCard";

const HISTORY_ANCHOR_ID = "bakiye-odeme-gecmisi";

function scrollToHistory() {
  if (typeof window === "undefined") return;
  const el = document.getElementById(HISTORY_ANCHOR_ID);
  if (el) {
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

interface BalanceSummaryCardProps {
  data: AccountBalancePageData["balanceSummary"];
}

export function BalanceSummaryCard({ data }: BalanceSummaryCardProps) {
  const rows = [
    { label: "Kullanılabilir Bakiye", value: data.availableBalance, className: "text-green-600" },
    { label: "Bloke Tutar", value: data.blockedAmount, className: "text-orange-500" },
    { label: "Bu Ay Yükleme", value: data.monthlyTopUp, className: "text-[var(--ab-blue)]" },
    { label: "Bu Ay Kullanım", value: data.monthlyUsage, className: "text-orange-500" },
  ];

  return (
    <section className="rounded-3xl border border-[var(--ab-border)] bg-white p-5 shadow-sm">
      <h2 className="text-base font-black text-[var(--ab-text)] sm:text-lg">Bakiye Özeti</h2>

      <div className="mt-4 divide-y divide-slate-100">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-4 py-3">
            <span className="text-sm font-semibold text-slate-500">{row.label}</span>
            <span className={`text-sm font-black ${row.className}`}>{row.value}</span>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={scrollToHistory}
        className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-blue-100 bg-white px-4 py-3 text-sm font-bold text-[var(--ab-blue)] transition hover:bg-blue-50"
      >
        <ClipboardCheck className="h-4 w-4" aria-hidden="true" />
        Detaylı Raporu Gör
      </button>
    </section>
  );
}

interface RecentMovementsCardProps {
  movements: RecentMovement[];
}

export function RecentMovementsCard({ movements }: RecentMovementsCardProps) {
  return (
    <section className="rounded-3xl border border-[var(--ab-border)] bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-black text-[var(--ab-text)] sm:text-lg">Son Hareketler</h2>
        <button
          type="button"
          onClick={scrollToHistory}
          className="text-xs font-black text-[var(--ab-blue)] transition hover:underline focus-visible:outline-none focus-visible:underline"
        >
          Tümünü Gör
        </button>
      </div>

      <ul className="mt-4 space-y-4">
        {movements.map((movement) => (
          <li key={movement.id} className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span
                aria-hidden="true"
                className={[
                  "flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl",
                  movement.direction === "positive"
                    ? "bg-green-50 text-green-600"
                    : "bg-orange-50 text-orange-500",
                ].join(" ")}
              >
                {movement.direction === "positive" ? (
                  <ArrowUpCircle className="h-5 w-5" />
                ) : (
                  <ArrowDownCircle className="h-5 w-5" />
                )}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-black text-[var(--ab-text)]">
                  {movement.title}
                </span>
                <span className="block text-xs text-slate-500">{movement.date}</span>
              </span>
            </div>

            <span className={`text-sm font-black ${amountClass(movement.direction)}`}>
              {movement.amount}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}


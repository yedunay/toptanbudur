"use client";

import { ArrowDownCircle, ArrowUpCircle, Clock, Wallet } from "lucide-react";
import { formatTRY } from "@/components/account-balance/bakiyem-format";
import type { CurrentAccountSummary } from "./types";

interface CurrentAccountSummaryCardsProps {
  summary: CurrentAccountSummary | null;
}

interface CardConfig {
  key: string;
  title: string;
  value: string;
  description: string;
  icon: typeof Wallet;
  iconClass: string;
  valueClass: string;
}

export function CurrentAccountSummaryCards({
  summary,
}: CurrentAccountSummaryCardsProps) {
  const safe: CurrentAccountSummary = summary ?? {
    currentBalance: 0,
    totalLoaded: 0,
    totalSpent: 0,
    pendingTopupCount: 0,
  };

  const cards: CardConfig[] = [
    {
      key: "current-balance",
      title: "Güncel Bakiye",
      value: formatTRY(safe.currentBalance),
      description: "Anlık kullanılabilir bakiyeniz",
      icon: Wallet,
      iconClass: "bg-blue-50 text-blue-600",
      valueClass:
        safe.currentBalance < 0 ? "text-red-600" : "text-[var(--ab-text)]",
    },
    {
      key: "total-loaded",
      title: "Toplam Yüklenen",
      value: formatTRY(safe.totalLoaded),
      description: "Yükleme + iade + pozitif düzeltme",
      icon: ArrowUpCircle,
      iconClass: "bg-emerald-50 text-emerald-600",
      valueClass: "text-emerald-700",
    },
    {
      key: "total-spent",
      title: "Toplam Harcanan",
      value: formatTRY(safe.totalSpent),
      description: "Sipariş ödemeleri + negatif düzeltme",
      icon: ArrowDownCircle,
      iconClass: "bg-rose-50 text-rose-600",
      valueClass: "text-rose-600",
    },
    {
      key: "pending-topup",
      title: "Bekleyen Yükleme",
      value: `${safe.pendingTopupCount} adet`,
      description: "Onay bekleyen yükleme talepleriniz",
      icon: Clock,
      iconClass: "bg-amber-50 text-amber-600",
      valueClass: "text-amber-700",
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <article
            key={card.key}
            className="rounded-3xl border border-[var(--ab-border)] bg-white p-5 shadow-sm"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {card.title}
                </p>
                <p className={`mt-2 text-2xl font-black ${card.valueClass}`}>
                  {card.value}
                </p>
              </div>
              <span
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${card.iconClass}`}
                aria-hidden="true"
              >
                <Icon className="h-5 w-5" />
              </span>
            </div>
            <p className="mt-3 text-xs text-slate-500">{card.description}</p>
          </article>
        );
      })}
    </div>
  );
}

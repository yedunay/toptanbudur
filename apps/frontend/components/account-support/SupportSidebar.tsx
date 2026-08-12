"use client";

import Link from "next/link";
import {
  Clock,
  FileText,
  Headphones,
  HelpCircle,
  History,
  Plus,
} from "lucide-react";
import type { MetricTone, SupportSummaryItem } from "./types";

/* ------------------------------------------------------------------ */
/*  Talep Özeti — Donut Chart                                        */
/* ------------------------------------------------------------------ */

const DIST_COLORS: Record<MetricTone | "gray", string> = {
  orange: "#f59e0b",
  green: "#10b981",
  gray: "#94a3b8",
  blue: "#3b82f6",
  purple: "#8b5cf6",
};

const DIST_DOT: Record<MetricTone | "gray", string> = {
  orange: "bg-amber-500",
  green: "bg-emerald-500",
  gray: "bg-slate-400",
  blue: "bg-blue-500",
  purple: "bg-purple-500",
};

interface SummaryProps {
  items: SupportSummaryItem[];
  total: number;
}

function SummaryCard({ items, total }: SummaryProps) {
  let accumulated = 0;
  const segments = items
    .filter((d) => d.count > 0)
    .map((d) => {
      const start = accumulated;
      const end = start + d.percentage;
      accumulated = end;
      return `${DIST_COLORS[d.tone]} ${start}% ${end}%`;
    });
  const gradient =
    segments.length > 0
      ? `conic-gradient(${segments.join(", ")})`
      : "conic-gradient(#e2e8f0 0% 100%)";

  return (
    <section className="rounded-3xl border border-[var(--border)] bg-white p-5 shadow-sm">
      <h3 className="mb-4 text-base font-black text-[var(--text)]">
        Talep Özeti
      </h3>
      <div className="flex items-center gap-5">
        <div className="relative h-28 w-28 shrink-0">
          <div
            className="h-full w-full rounded-full"
            style={{ background: gradient }}
          />
          <div className="absolute inset-3 flex flex-col items-center justify-center rounded-full bg-white">
            <span className="text-xs text-[var(--text-muted)]">Toplam</span>
            <span className="text-2xl font-black text-[var(--text)]">
              {total}
            </span>
          </div>
        </div>
        <ul className="flex-1 space-y-1.5">
          {items.map((d) => (
            <li
              key={d.label}
              className="flex items-center justify-between text-xs"
            >
              <span className="flex items-center gap-2 font-semibold text-[var(--text)]">
                <span
                  className={`h-2.5 w-2.5 rounded-sm ${DIST_DOT[d.tone]}`}
                />
                {d.label}
              </span>
              <span className="font-black text-[var(--text-muted)]">
                {d.count}{" "}
                <span className="font-semibold">%{d.percentage}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
      <Link
        href="#"
        className="mt-4 block text-right text-xs font-black text-[var(--brand-blue)] hover:underline"
      >
        Detaylı Raporu Gör &rarr;
      </Link>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Hızlı İşlemler                                                    */
/* ------------------------------------------------------------------ */

interface QuickActionsProps {
  onNewTicket: () => void;
}

function QuickActionsCard({ onNewTicket }: QuickActionsProps) {
  const actions = [
    {
      icon: Plus,
      title: "Yeni Talep Oluştur",
      desc: "Destek talebi oluşturun",
      onClick: onNewTicket,
    },
    {
      icon: HelpCircle,
      title: "Sık Sorulan Sorular",
      desc: "SSS bölümünü inceleyin",
      onClick: undefined,
    },
    {
      icon: Headphones,
      title: "Canlı Destek",
      desc: "Anında destek alın",
      onClick: undefined,
    },
    {
      icon: History,
      title: "Talep Geçmişi",
      desc: "Tüm taleplerinizi görüntüleyin",
      onClick: undefined,
    },
  ];

  return (
    <section className="rounded-3xl border border-[var(--border)] bg-white p-5 shadow-sm">
      <h3 className="mb-3 text-base font-black text-[var(--text)]">
        Hızlı İşlemler
      </h3>
      <ul className="space-y-2">
        {actions.map((a) => (
          <li key={a.title}>
            <button
              type="button"
              onClick={a.onClick}
              className="flex w-full items-center gap-3 rounded-xl p-2 text-left transition hover:bg-blue-50"
            >
              <a.icon className="h-5 w-5 shrink-0 text-[var(--brand-blue)]" />
              <div>
                <p className="text-sm font-black text-[var(--text)]">
                  {a.title}
                </p>
                <p className="text-xs text-[var(--text-muted)]">{a.desc}</p>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Destek Saatleri                                                    */
/* ------------------------------------------------------------------ */

function SupportHoursCard() {
  return (
    <section className="rounded-3xl border border-[var(--border)] bg-white p-5 shadow-sm">
      <h3 className="mb-3 text-base font-black text-[var(--text)]">
        Destek Saatleri
      </h3>
      <dl className="space-y-2 text-sm">
        <div className="flex justify-between">
          <dt className="text-[var(--text-muted)]">Pazartesi - Cuma</dt>
          <dd className="font-black text-[var(--text)]">09:00 - 18:00</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-[var(--text-muted)]">Cumartesi</dt>
          <dd className="font-black text-[var(--text)]">09:00 - 13:00</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-[var(--text-muted)]">Pazar</dt>
          <dd className="font-black text-[var(--text)]">Kapalı</dd>
        </div>
      </dl>
      <div className="mt-3 flex items-start gap-2 rounded-xl bg-blue-50 p-3 text-xs text-blue-700">
        <Clock className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          Resmi tatillerde destek hizmetimiz sınırlı olarak verilmektedir.
        </p>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Birleşik Sidebar                                                   */
/* ------------------------------------------------------------------ */

interface SupportSidebarProps {
  summaryItems: SupportSummaryItem[];
  totalTickets: number;
  onNewTicket: () => void;
}

export function SupportSidebar({
  summaryItems,
  totalTickets,
  onNewTicket,
}: SupportSidebarProps) {
  return (
    <aside className="space-y-5 xl:sticky xl:top-24 xl:self-start">
      <SummaryCard items={summaryItems} total={totalTickets} />
      <QuickActionsCard onNewTicket={onNewTicket} />
      <SupportHoursCard />
    </aside>
  );
}

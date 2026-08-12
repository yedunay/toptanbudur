"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import {
  ChevronRight,
  Gift,
  Headphones,
  Megaphone,
  PackageCheck,
  RefreshCw,
  RotateCcw,
  ShoppingCart,
  Tag,
  Wallet,
} from "lucide-react";
import { AccountSidebar } from "../account-orders/AccountSidebar";
import type {
  AccountOverviewPageData,
  Announcement,
  BalanceMovement,
  MetricTone,
  OrderFlowStep,
  OrderStatus,
  OverviewMetric,
  QuickAction,
  RecentOrder,
} from "./types";

interface AccountOverviewPageProps {
  data: AccountOverviewPageData;
}

const toneClasses: Record<MetricTone, string> = {
  blue: "bg-blue-50 text-[var(--ab-blue)]",
  green: "bg-green-50 text-green-600",
  orange: "bg-orange-50 text-orange-500",
  purple: "bg-purple-50 text-purple-500",
};

const toneDotClasses: Record<MetricTone, string> = {
  blue: "bg-[var(--ab-blue)]",
  green: "bg-green-500",
  orange: "bg-orange-500",
  purple: "bg-purple-500",
};

export function AccountOverviewPage({ data }: AccountOverviewPageProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const closeMobileNav = useCallback(() => setMobileNavOpen(false), []);
  const openMobileNav = useCallback(() => setMobileNavOpen(true), []);

  return (
    <div className="flex w-full bg-[var(--surface)]">
      <AccountSidebar user={data.user} onNavigate={closeMobileNav} mobileOpen={mobileNavOpen} />

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-12 items-center px-4 sm:px-6 xl:hidden">
          <button
            type="button"
            onClick={openMobileNav}
            aria-label="Hesap menüsünü aç"
            aria-controls="account-sidebar"
            aria-expanded={mobileNavOpen}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ab-blue)]"
          >
            <span aria-hidden="true">☰</span>
            <span>Hesap Menüsü</span>
          </button>
        </div>

        <section className="mx-auto w-full max-w-[1500px] flex-1 px-4 pb-10 pt-3 sm:px-6 sm:pt-5">
          <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h1 className="text-3xl font-black tracking-tight text-[var(--ab-text)]">Hesabım</h1>
              <p className="mt-1 text-sm text-slate-600">
                Siparişlerinizi, bakiyenizi, iade süreçlerinizi ve geçmiş işlemlerinizi tek ekranda yönetin.
              </p>
            </div>

            <div className="inline-flex items-center gap-2 rounded-2xl border border-[var(--ab-border)] bg-white px-4 py-2 text-sm text-slate-700 shadow-sm">
              <span className="h-2 w-2 rounded-full bg-green-500" aria-hidden="true" />
              Son Güncelleme: {data.updatedAt}
              <RefreshCw className="h-4 w-4 text-slate-500" aria-hidden="true" />
            </div>
          </div>

          <div className="space-y-4">
            <MetricGrid metrics={data.metrics} />
            <QuickActions actions={data.quickActions} />

            <div className="grid gap-4">
              <RecentOrdersCard orders={data.recentOrders} />
              <BalanceMovementsCard movements={data.balanceMovements} />
            </div>

            <div className="grid gap-4">
              <OrderDistributionCard distribution={data.orderDistribution} />
            </div>

            <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
              <OrderFlowCard steps={data.orderFlow} />
              <SupportCalloutCard />
            </div>

            <AnnouncementsCard announcements={data.announcements} />
          </div>
        </section>
      </div>
    </div>
  );
}

function MetricGrid({ metrics }: { metrics: OverviewMetric[] }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
      {metrics.map((metric) => (
        <MetricCard key={metric.title} metric={metric} />
      ))}
    </div>
  );
}

function MetricIcon({ title }: { title: string }) {
  const props = { className: "h-5 w-5", "aria-hidden": true } as const;
  switch (title) {
    case "Cari Bakiye":
      return <Wallet {...props} />;
    case "Son 30 Gün Sipariş":
      return <ShoppingCart {...props} />;
    case "Bekleyen Sipariş":
      return <RefreshCw {...props} />;
    case "Tamamlanan Sipariş":
      return <PackageCheck {...props} />;
    case "Açık İade Talebi":
      return <RotateCcw {...props} />;
    default:
      return null;
  }
}

function MetricCard({ metric }: { metric: OverviewMetric }) {
  return (
    <article className="rounded-2xl border border-[var(--ab-border)] bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className={["flex h-11 w-11 items-center justify-center rounded-2xl", toneClasses[metric.tone]].join(" ")}>
          <MetricIcon title={metric.title} />
        </div>

        <Sparkline values={metric.sparkline} tone={metric.tone} label={`${metric.title} trendi`} />
      </div>

      <p className="mt-3 text-xs font-bold text-slate-600">{metric.title}</p>
      <p
        className={[
          "mt-1 text-xl font-black",
          metric.tone === "green" ? "text-green-700" : "text-[var(--ab-text)]",
        ].join(" ")}
      >
        {metric.value}
      </p>
      <p
        className={[
          "mt-2 text-xs font-semibold",
          metric.tone === "orange" ? "text-orange-700" : "text-green-700",
        ].join(" ")}
      >
        {metric.description}
      </p>
    </article>
  );
}

function Sparkline({ values, tone, label }: { values: number[]; tone: MetricTone; label: string }) {
  const max = Math.max(...values);

  return (
    <div className="flex h-10 items-end gap-1" role="img" aria-label={label}>
      {values.map((value, index) => {
        const heightPercent = Math.max(20, Math.round((value / max) * 100));

        return (
          <span
            key={`${value}-${index}`}
            aria-hidden="true"
            className={[
              "w-1.5 rounded-full",
              tone === "blue" ? "bg-blue-500" : "",
              tone === "green" ? "bg-green-500" : "",
              tone === "orange" ? "bg-orange-400" : "",
              tone === "purple" ? "bg-purple-500" : "",
              heightPercent > 80 ? "h-8" : heightPercent > 60 ? "h-6" : heightPercent > 40 ? "h-5" : "h-3",
            ].join(" ")}
          />
        );
      })}
    </div>
  );
}

function QuickActionIcon({ id }: { id: string }) {
  const props = { className: "h-5 w-5", "aria-hidden": true } as const;
  switch (id) {
    case "balance":
      return <Wallet {...props} />;
    case "orders":
      return <ShoppingCart {...props} />;
    case "return":
      return <RotateCcw {...props} />;
    case "support":
      return <Headphones {...props} />;
    default:
      return null;
  }
}

function QuickActions({ actions }: { actions: QuickAction[] }) {
  return (
    <section
      aria-label="Hızlı işlemler"
      className="grid gap-3 rounded-3xl border border-[var(--ab-border)] bg-white p-3 shadow-sm md:grid-cols-2 xl:grid-cols-5"
    >
      {actions.map((action) => (
        <Link
          key={action.id}
          href={action.href}
          className="group flex items-center justify-between gap-3 rounded-2xl px-4 py-3 text-left transition hover:bg-blue-50/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ab-blue)]"
        >
          <span className="flex items-center gap-3">
            <span className={["flex h-11 w-11 items-center justify-center rounded-2xl", toneClasses[action.tone]].join(" ")}>
              <QuickActionIcon id={action.id} />
            </span>
            <span>
              <span className="block text-sm font-black text-[var(--ab-text)]">{action.title}</span>
              <span className="block text-xs text-slate-600">{action.description}</span>
            </span>
          </span>
          <ChevronRight
            className="h-4 w-4 text-slate-500 transition group-hover:text-[var(--ab-blue)]"
            aria-hidden="true"
          />
        </Link>
      ))}
    </section>
  );
}

function RecentOrdersCard({ orders }: { orders: RecentOrder[] }) {
  return (
    <section className="rounded-3xl border border-[var(--ab-border)] bg-white p-5 shadow-sm">
      <CardHeader title="Son Siparişler" actionLabel="Tüm Siparişler" actionHref="/hesabim/siparislerim" />

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[460px] text-left text-sm">
          <caption className="sr-only">Son siparişler listesi</caption>
          <thead className="text-xs text-slate-600">
            <tr>
              <th scope="col" className="py-2 font-black">Sipariş No</th>
              <th scope="col" className="py-2 font-black">Tarih</th>
              <th scope="col" className="py-2 font-black">Durum</th>
              <th scope="col" className="py-2 text-right font-black">Tutar</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {orders.map((order) => (
              <tr key={order.id}>
                <td className="py-3 font-semibold text-[var(--ab-text)]">{order.orderNumber}</td>
                <td className="py-3 text-xs text-slate-600">{order.date}</td>
                <td className="py-3">
                  <OrderStatusPill status={order.status} />
                </td>
                <td className="py-3 text-right font-bold text-[var(--ab-text)]">{order.amount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <CardFooter
        text={`Toplam ${orders.length} sipariş gösteriliyor.`}
        link="Tümünü Gör"
        href="/hesabim/siparislerim"
      />
    </section>
  );
}

function BalanceMovementsCard({ movements }: { movements: BalanceMovement[] }) {
  return (
    <section className="rounded-3xl border border-[var(--ab-border)] bg-white p-5 shadow-sm">
      <CardHeader title="Bakiye Hareketleri" actionLabel="Tümünü Gör" actionHref="/hesabim/bakiyem" />

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[520px] text-left text-sm">
          <caption className="sr-only">Bakiye hareket geçmişi</caption>
          <thead className="text-xs text-slate-600">
            <tr>
              <th scope="col" className="py-2 font-black">Tarih</th>
              <th scope="col" className="py-2 font-black">İşlem Türü</th>
              <th scope="col" className="py-2 text-right font-black">Tutar</th>
              <th scope="col" className="py-2 text-right font-black">Durum</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {movements.map((movement) => (
              <tr key={movement.id}>
                <td className="py-3 text-xs text-slate-600">{movement.date}</td>
                <td className="py-3 font-semibold text-[var(--ab-text)]">{movement.transactionType}</td>
                <td
                  className={[
                    "py-3 text-right font-black",
                    movement.direction === "positive" ? "text-green-700" : "text-[var(--ab-text)]",
                  ].join(" ")}
                >
                  {movement.amount}
                </td>
                <td className="py-3 text-right">
                  <span className="rounded-full bg-green-50 px-2.5 py-1 text-xs font-black text-green-800">
                    {movement.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Link
        href="/hesabim/bakiyem"
        className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--ab-blue)] px-4 py-3 text-sm font-black text-white transition hover:bg-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ab-blue)]"
      >
        <Wallet className="h-4 w-4" aria-hidden="true" />
        Yeni Bakiye Yükle
      </Link>
    </section>
  );
}

function OrderDistributionCard({ distribution }: { distribution: import("./types").OrderDistributionRow[] }) {
  const total = distribution.reduce((sum, r) => sum + r.value, 0);

  const toneColors: Record<MetricTone, string> = {
    blue: "#1267f4",
    green: "#16a34a",
    orange: "#f97316",
    purple: "#8b5cf6",
  };

  // Build conic-gradient from real data
  let gradient = "bg-slate-100";
  if (total > 0) {
    const segments: string[] = [];
    let cumPercent = 0;
    for (const row of distribution) {
      const pct = (row.value / total) * 100;
      if (pct > 0) {
        const start = cumPercent;
        cumPercent += pct;
        segments.push(`${toneColors[row.tone]} ${start}% ${cumPercent}%`);
      }
    }
    if (segments.length > 0) {
      gradient = "";
    }
  }

  const conicStyle = total > 0
    ? {
        background: `conic-gradient(${distribution
          .reduce<{ segments: string[]; cum: number }>((acc, row) => {
            const pct = (row.value / total) * 100;
            if (pct > 0) {
              acc.segments.push(`${toneColors[row.tone]} ${acc.cum}% ${acc.cum + pct}%`);
              acc.cum += pct;
            }
            return acc;
          }, { segments: [], cum: 0 })
          .segments.join(", ")})`,
      }
    : undefined;

  return (
    <section className="rounded-3xl border border-[var(--ab-border)] bg-white p-5 shadow-sm">
      <h2 className="text-lg font-black text-[var(--ab-text)]">Sipariş Durum Dağılımı</h2>

      <div className="mt-5 grid gap-4 md:grid-cols-[150px_1fr]">
        <div
          role="img"
          aria-label={`Toplam ${total} sipariş`}
          className={["grid h-36 w-36 place-items-center rounded-full", total === 0 ? "bg-slate-100" : ""].join(" ")}
          style={conicStyle}
        >
          <div className="grid h-24 w-24 place-items-center rounded-full bg-white text-center shadow-sm">
            <span className="text-xs text-slate-600">Toplam</span>
            <strong className="block text-2xl text-[var(--ab-text)]">{total}</strong>
          </div>
        </div>

        <ul className="space-y-3">
          {distribution.map((row) => {
            const pct = total > 0 ? ((row.value / total) * 100).toFixed(1) : "0";
            return (
              <li key={row.label} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 text-sm">
                <span className="flex items-center gap-2 font-semibold text-slate-700">
                  <span className={["h-3 w-3 rounded-sm", toneDotClasses[row.tone]].join(" ")} aria-hidden="true" />
                  {row.label}
                </span>
                <span className="font-black text-[var(--ab-text)]">{row.value}</span>
                <span className="text-slate-600">%{pct}</span>
              </li>
            );
          })}
        </ul>
      </div>

      <Link
        href="/hesabim/siparislerim"
        className="mt-4 inline-flex text-sm font-black text-[var(--ab-blue)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ab-blue)]"
      >
        Detaylı Raporu Gör →
      </Link>
    </section>
  );
}

function AnnouncementIcon({ tone }: { tone: MetricTone }) {
  const props = { className: "h-5 w-5", "aria-hidden": true } as const;
  switch (tone) {
    case "blue":
      return <Megaphone {...props} />;
    case "orange":
      return <Tag {...props} />;
    case "green":
      return <PackageCheck {...props} />;
    case "purple":
      return <Gift {...props} />;
    default:
      return null;
  }
}

function AnnouncementsCard({ announcements }: { announcements: Announcement[] }) {
  return (
    <section className="rounded-3xl border border-[var(--ab-border)] bg-white p-5 shadow-sm">
      <CardHeader title="Duyurular & Öneriler" actionLabel="Tüm Duyurular" actionHref="/duyurular" />

      <ul className="mt-4 space-y-4">
        {announcements.map((item) => (
          <li key={item.id}>
            <article className="flex gap-3">
              <span className={["flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl", toneClasses[item.tone]].join(" ")}>
                <AnnouncementIcon tone={item.tone} />
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-sm font-black text-[var(--ab-text)]">{item.title}</h3>
                  <span className="shrink-0 text-xs text-slate-600">{item.date}</span>
                </div>
                <p className="mt-1 text-xs leading-5 text-slate-600">{item.description}</p>
              </div>
            </article>
          </li>
        ))}
      </ul>
    </section>
  );
}

function OrderFlowCard({ steps }: { steps: OrderFlowStep[] }) {
  return (
    <section className="rounded-3xl border border-[var(--ab-border)] bg-white p-5 shadow-sm">
      <h2 className="text-lg font-black text-[var(--ab-text)]">Sipariş Süreç Akışı</h2>

      <ol className="mt-5 flex flex-wrap items-center gap-4">
        {steps.map((step, index) => (
          <li key={step.id} className="flex items-center gap-4">
            <div className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className={[
                  "grid h-9 w-9 place-items-center rounded-full text-sm font-black text-white",
                  toneDotClasses[step.tone],
                ].join(" ")}
              >
                {index + 1}
              </span>
              <span>
                <span className="block text-sm font-black text-[var(--ab-text)]">{step.label}</span>
                <span className="block text-xs text-slate-600">{step.count}</span>
              </span>
            </div>

            {index < steps.length - 1 ? (
              <ChevronRight className="h-5 w-5 text-slate-400" aria-hidden="true" />
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

function SupportCalloutCard() {
  return (
    <section className="rounded-3xl border border-blue-100 bg-blue-50 p-5">
      <h2 className="text-lg font-black text-[var(--ab-text)]">Her adımda siparişlerinizi takip edin.</h2>
      <p className="mt-2 text-sm leading-6 text-slate-700">Sipariş sürecinizi anlık olarak izleyin.</p>

      <Link
        href="/hesabim/siparislerim"
        className="mt-5 inline-flex items-center gap-2 rounded-xl border border-blue-200 bg-white px-4 py-3 text-sm font-black text-[var(--ab-blue)] transition hover:bg-white/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ab-blue)]"
      >
        <ShoppingCart className="h-4 w-4" aria-hidden="true" />
        Siparişlerimi Gör
      </Link>
    </section>
  );
}

function CardHeader({
  title,
  actionLabel,
  actionHref,
}: {
  title: string;
  actionLabel: string;
  actionHref: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <h2 className="text-lg font-black text-[var(--ab-text)]">{title}</h2>
      <Link
        href={actionHref}
        className="text-xs font-black text-[var(--ab-blue)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ab-blue)]"
      >
        {actionLabel}
      </Link>
    </div>
  );
}

function CardFooter({ text, link, href }: { text: string; link: string; href: string }) {
  return (
    <div className="mt-4 flex items-center justify-between gap-4">
      <p className="text-xs text-slate-600">{text}</p>
      <Link
        href={href}
        className="text-sm font-black text-[var(--ab-blue)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ab-blue)]"
      >
        {link} →
      </Link>
    </div>
  );
}

function OrderStatusPill({ status }: { status: OrderStatus }) {
  const className =
    status === "Kargoya Verildi"
      ? "bg-green-50 text-green-800"
      : status === "İptal Edildi"
        ? "bg-red-50 text-red-800"
        : status === "İade Edildi"
          ? "bg-purple-50 text-purple-800"
          : "bg-blue-50 text-blue-800"; // Sipariş Alındı, Hazırlanıyor

  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-black ${className}`}>{status}</span>;
}

import Image from "next/image";
import {
  PackageCheck,
  RotateCcw,
  ShoppingBag,
  Truck,
  Wrench,
} from "lucide-react";
import { cargoMeta, marketplaceMeta, toneClasses } from "./shared-meta";
import type {
  CargoDistributionItem,
  MarketplaceDistributionItem,
  MetricTone,
  OrderSummary,
  RecentUpdateItem,
  TopProductItem,
} from "./types";

interface OrdersAsideProps {
  orderSummary: OrderSummary;
  marketplaceDistribution: MarketplaceDistributionItem[];
  cargoDistribution: CargoDistributionItem[];
  topProducts: TopProductItem[];
  recentUpdates: RecentUpdateItem[];
}

export function OrdersAside({
  orderSummary,
  marketplaceDistribution,
  cargoDistribution,
  topProducts,
  recentUpdates,
}: OrdersAsideProps) {
  return (
    <aside aria-label="Sipariş özeti ve dağılımları" className="space-y-4">
      <OrderSummaryCard data={orderSummary} />
      <MarketplaceDistributionCard items={marketplaceDistribution} totalLabel={orderSummary.totalOrders} />
      <CargoDistributionCard items={cargoDistribution} />
      <TopProductsCard items={topProducts} />
      <RecentUpdatesCard items={recentUpdates} />
    </aside>
  );
}

function OrderSummaryCard({ data }: { data: OrderSummary }) {
  const rows = [
    { label: "Toplam Sipariş", value: data.totalOrders, tone: "text-[var(--ab-text)]" },
    { label: "Kargoya Verilen", value: data.deliveredOrders, tone: "text-green-700" },
    { label: "Bekleyen Sipariş", value: data.pendingOrders, tone: "text-orange-700" },
    { label: "Bu Ayki Satış Tutarı", value: data.monthlySalesAmount, tone: "text-[var(--ab-blue)]" },
  ];

  return (
    <section className="rounded-3xl border border-[var(--ab-border)] bg-white p-5 shadow-sm">
      <h2 className="text-lg font-black text-[var(--ab-text)]">Sipariş Özeti</h2>

      <dl className="mt-4 divide-y divide-slate-100">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-4 py-3">
            <dt className="text-sm font-semibold text-slate-700">{row.label}</dt>
            <dd className={`text-sm font-black ${row.tone}`}>{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function buildConicGradient(items: MarketplaceDistributionItem[]): string {
  if (items.length === 0) return "conic-gradient(#e2e8f0 0 100%)";
  let cursor = 0;
  const stops = items.map((item) => {
    const color = marketplaceMeta[item.marketplace].chartColor;
    const start = cursor;
    cursor += item.pct;
    return `${color} ${start}% ${cursor}%`;
  });
  return `conic-gradient(${stops.join(", ")})`;
}

function MarketplaceDistributionCard({
  items,
  totalLabel,
}: {
  items: MarketplaceDistributionItem[];
  totalLabel: string;
}) {
  const gradient = buildConicGradient(items);
  const summary = items
    .map((item) => `${marketplaceMeta[item.marketplace].label} ${item.count} sipariş (${item.percentage})`)
    .join(", ");

  return (
    <section className="rounded-3xl border border-[var(--ab-border)] bg-white p-5 shadow-sm">
      <h2 className="text-lg font-black text-[var(--ab-text)]">Satış Kanalı Dağılımı</h2>

      {items.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">Henüz veri yok</p>
      ) : (
        <div className="mt-5 flex flex-col items-center gap-5">
          <div
            role="img"
            aria-label={`Satış kanalı dağılımı, toplam ${totalLabel} sipariş: ${summary}`}
            className="grid h-28 w-28 shrink-0 place-items-center rounded-full"
            style={{ background: gradient }}
          >
            <div className="grid h-[68px] w-[68px] place-items-center rounded-full bg-white text-center shadow-sm">
              <span className="text-[10px] font-semibold text-slate-500">Toplam</span>
              <strong className="block text-xl leading-none text-[var(--ab-text)]">{totalLabel}</strong>
            </div>
          </div>

          <ul className="w-full space-y-2" aria-hidden="true">
            {items.map((item) => {
              const meta = marketplaceMeta[item.marketplace];
              return (
                <li key={item.marketplace} className="flex items-center gap-2">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: meta.chartColor }}
                  />
                  <span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-700">
                    {meta.label}
                  </span>
                  <span className="shrink-0 text-xs font-black text-[var(--ab-text)]">{item.count}</span>
                  <span className="w-10 shrink-0 text-right text-xs text-slate-500">{item.percentage}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

function CargoDistributionCard({ items }: { items: CargoDistributionItem[] }) {
  const max = items[0]?.pct ?? 1;

  return (
    <section className="rounded-3xl border border-[var(--ab-border)] bg-white p-5 shadow-sm">
      <h2 className="text-lg font-black text-[var(--ab-text)]">Kargo Dağılımı</h2>

      {items.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">Henüz veri yok</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {items.map((item) => {
            const meta = cargoMeta[item.cargo];
            const barWidth = max > 0 ? (item.pct / max) * 100 : 0;
            return (
              <li key={item.cargo}>
                <div className="mb-1.5 flex items-center gap-2">
                  <span className={["inline-flex h-6 items-center rounded px-1.5 ring-1", meta.pillClass].join(" ")}>
                    <Image
                      src={meta.logoSrc}
                      alt={meta.logoAlt}
                      width={44}
                      height={14}
                      className="h-[13px] w-auto max-w-[44px] object-contain"
                    />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-700">{meta.label}</span>
                  <span className="shrink-0 text-xs font-black text-[var(--ab-text)]">{item.count}</span>
                  <span className="w-9 shrink-0 text-right text-xs text-slate-500">{item.percentage}</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={["h-full rounded-full transition-all duration-500", meta.barClass].join(" ")}
                    style={{ width: `${barWidth}%` }}
                    role="presentation"
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function TopProductsCard({ items }: { items: TopProductItem[] }) {
  return (
    <section className="rounded-3xl border border-[var(--ab-border)] bg-white p-5 shadow-sm">
      <h2 className="text-lg font-black text-[var(--ab-text)]">En Çok Alınan Ürünler</h2>

      <ol className="mt-4 space-y-3">
        {items.map((item) => (
          <li key={item.id} className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span
                aria-hidden="true"
                className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[var(--ab-blue)] text-xs font-black text-white"
              >
                {item.rank}
              </span>
              <span className="min-w-0 truncate text-sm font-bold text-[var(--ab-text)]">
                <span className="sr-only">{`${item.rank}. sıra: `}</span>
                {item.name}
              </span>
            </div>
            <span className="shrink-0 text-xs font-black text-slate-600">{item.quantity}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function RecentUpdateIcon({ tone }: { tone: MetricTone }) {
  const props = { className: "h-4 w-4", "aria-hidden": true } as const;
  switch (tone) {
    case "green":
      return <PackageCheck {...props} />;
    case "orange":
      return <Truck {...props} />;
    case "blue":
      return <ShoppingBag {...props} />;
    case "purple":
      return <RotateCcw {...props} />;
    default:
      return <Wrench {...props} />;
  }
}

function RecentUpdatesCard({ items }: { items: RecentUpdateItem[] }) {
  return (
    <section className="rounded-3xl border border-[var(--ab-border)] bg-white p-5 shadow-sm">
      <h2 className="text-lg font-black text-[var(--ab-text)]">Son Güncellemeler</h2>

      <ul className="mt-4 space-y-4">
        {items.map((item) => (
          <li key={item.id} className="flex gap-3">
            <span
              aria-hidden="true"
              className={["mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl", toneClasses[item.tone]].join(" ")}
            >
              <RecentUpdateIcon tone={item.tone} />
            </span>

            <div className="min-w-0 flex-1">
              <p className="text-sm font-black text-[var(--ab-text)]">{item.title}</p>
              <p className="text-xs font-semibold text-slate-600">{item.orderNumber}</p>
              <p className="mt-1 text-xs text-slate-600">{item.date}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

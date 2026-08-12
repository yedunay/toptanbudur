"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Eye,
  PackageCheck,
  Search,
  ShoppingBag,
  Star,
  Truck,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { ProductImage } from "@/components/ProductImage";
import { ReceiptButton } from "@/components/receipts/ReceiptButton";
import { AccountSidebar } from "./AccountSidebar";
import { OrdersAside } from "./OrdersAside";
import { cargoMeta, marketplaceMeta, toneClasses } from "./shared-meta";
import type {
  AccountOrdersPageData,
  CargoKey,
  MarketplaceKey,
  MetricTone,
  OrderItem,
  OrderMetric,
  OrderStatus,
  PaginationMeta,
  StatusCounts,
} from "./types";

interface AccountOrdersPageProps {
  data: AccountOrdersPageData;
}

export function AccountOrdersPage({ data }: AccountOrdersPageProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const closeMobileNav = useCallback(() => setMobileNavOpen(false), []);
  const openMobileNav = useCallback(() => setMobileNavOpen(true), []);

  return (
    <div className="flex w-full bg-[var(--surface)]">
      <AccountSidebar
        user={data.user}
        onNavigate={closeMobileNav}
        mobileOpen={mobileNavOpen}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-12 items-center px-4 sm:px-6 xl:hidden">
          <button
            type="button"
            onClick={openMobileNav}
            aria-label="Hesap menüsünü aç"
            aria-controls="account-sidebar"
            aria-expanded={mobileNavOpen}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ab-blue)]"
          >
            <span aria-hidden="true">☰</span>
            <span>Hesap Menüsü</span>
          </button>
        </div>

        <section className="mx-auto w-full max-w-[1500px] flex-1 px-4 pb-10 pt-3 sm:px-6 sm:pt-5">
          <div className="mb-5">
            <h1 className="text-2xl font-black tracking-tight text-[var(--ab-text)] sm:text-3xl">
              Siparişlerim
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Tüm siparişlerinizi, satış kanalı detaylarını ve gönderi süreçlerinizi tek ekranda takip edin.
            </p>
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="min-w-0 space-y-4">
              <MetricGrid metrics={data.metrics} />
              <OrdersFilterBar statusCounts={data.statusCounts} />
              <OrdersList orders={data.orders} totalLabel={data.orderSummary.totalOrders} pagination={data.pagination} />
            </div>

            <OrdersAside
              orderSummary={data.orderSummary}
              marketplaceDistribution={data.marketplaceDistribution}
              cargoDistribution={data.cargoDistribution}
              topProducts={data.topProducts}
              recentUpdates={data.recentUpdates}
            />
          </div>
        </section>
      </div>
    </div>
  );
}

function MetricGrid({ metrics }: { metrics: OrderMetric[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
      {metrics.map((metric) => (
        <MetricCard key={metric.title} metric={metric} />
      ))}
    </div>
  );
}

function MetricIcon({ title }: { title: string }) {
  const props = { className: "h-5 w-5", "aria-hidden": true } as const;
  switch (title) {
    case "Toplam Sipariş":
      return <ShoppingBag {...props} />;
    case "Toplam Satış Tutarı":
      return <Wallet {...props} />;
    case "Kargoya Verilen Sipariş":
      return <PackageCheck {...props} />;
    case "Bekleyen Sipariş":
      return <Truck {...props} />;
    case "En Çok Alınan Ürün":
      return <Star {...props} />;
    default:
      return null;
  }
}

function MetricCard({ metric }: { metric: OrderMetric }) {
  return (
    <article className="rounded-2xl border border-[var(--ab-border)] bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className={["flex h-11 w-11 items-center justify-center rounded-2xl", toneClasses[metric.tone]].join(" ")}>
          <MetricIcon title={metric.title} />
        </div>

        <Sparkline values={metric.sparkline} tone={metric.tone} label={`${metric.title} trendi`} />
      </div>

      <p className="mt-3 text-xs font-bold text-slate-600">{metric.title}</p>
      <p className="mt-1 text-xl font-black text-[var(--ab-text)]">{metric.value}</p>
      <p
        className={[
          "mt-2 text-xs font-semibold",
          metric.tone === "green" ? "text-green-700" : "",
          metric.tone === "blue" ? "text-blue-700" : "",
          metric.tone === "orange" ? "text-orange-700" : "",
          metric.tone === "purple" ? "text-purple-700" : "",
        ].join(" ")}
      >
        {metric.description}
      </p>
    </article>
  );
}

function Sparkline({ values, tone, label }: { values: number[]; tone: MetricTone; label: string }) {
  const max = Math.max(...values);
  const last = values[values.length - 1];
  const min = Math.min(...values);
  const ariaLabel = `${label}. Min ${min}, maks ${max}, son ${last}.`;

  return (
    <div className="flex h-10 items-end gap-1" role="img" aria-label={ariaLabel}>
      {values.map((value, index) => {
        const heightPercent = Math.max(20, Math.round((value / max) * 100));

        return (
          <span
            key={index}
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

const STATUS_OPTIONS = [
  { value: "", label: "Tüm Durumlar" },
  { value: "paid", label: "Sipariş Alındı" },
  { value: "preparing", label: "Hazırlanıyor" },
  { value: "shipped", label: "Kargoya Verildi" },
  { value: "cancelled", label: "İptal" },
  { value: "refunded", label: "İade Edildi" },
];

const MARKETPLACE_OPTIONS = [
  { value: "", label: "Tüm Satış Kanalları" },
  { value: "self", label: "Kendim İçin" },
  { value: "other", label: "Diğer Satış Kanalı" },
];

const CARGO_OPTIONS = [
  { value: "", label: "Tüm Kargo Firmaları" },
  { value: "aras", label: "Aras Kargo" },
  { value: "surat", label: "Sürat Kargo" },
  { value: "yurtici", label: "Yurtiçi Kargo" },
  { value: "ptt", label: "PTT Kargo" },
  { value: "dhl", label: "DHL" },
];

const DATE_PRESET_OPTIONS = [
  { value: "", label: "Tüm Tarihler" },
  { value: "today", label: "Bugün" },
  { value: "7d", label: "Son 7 Gün" },
  { value: "30d", label: "Son 30 Gün" },
  { value: "thisMonth", label: "Bu Ay" },
  { value: "lastMonth", label: "Geçen Ay" },
];

const QUICK_STATUS_CHIPS: { label: string; value: string }[] = [
  { label: "Tümü", value: "" },
  { label: "Hazırlanıyor", value: "preparing" },
  { label: "Kargoya Verildi", value: "shipped" },
  { label: "İptal", value: "cancelled" },
  { label: "İade", value: "refunded" },
];

interface DropdownOption {
  value: string;
  label: string;
}

interface FilterDropdownProps {
  label: string;
  icon: LucideIcon;
  ariaLabel: string;
  options: DropdownOption[];
  value: string;
  onChange: (value: string) => void;
}

function FilterDropdown({ label, icon: Icon, ariaLabel, options, value, onChange }: FilterDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const selected = options.find((o) => o.value === value);
  const displayLabel = selected?.value ? selected.label : label;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((o) => !o)}
        className={[
          "inline-flex h-11 w-full min-w-0 items-center justify-between gap-3 rounded-xl border px-4 text-sm font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ab-blue)]",
          selected?.value
            ? "border-[var(--ab-blue)] bg-blue-50 text-[var(--ab-blue)]"
            : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
        ].join(" ")}
      >
        <span className="truncate">{displayLabel}</span>
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      </button>

      {open && (
        <ul
          role="listbox"
          aria-label={ariaLabel}
          className="absolute left-0 top-full z-50 mt-1 min-w-full overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
        >
          {options.map((opt) => (
            <li key={opt.value} role="option" aria-selected={opt.value === value}>
              <button
                type="button"
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                className={[
                  "w-full px-4 py-2.5 text-left text-sm font-semibold transition hover:bg-blue-50",
                  opt.value === value ? "bg-blue-50 font-black text-[var(--ab-blue)]" : "text-slate-700",
                ].join(" ")}
              >
                {opt.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const EXPORT_ALLOWED_KEYS = [
  "status",
  "search",
  "marketplace",
  "cargoCompany",
  "dateFrom",
  "dateTo",
  "datePreset",
] as const;

interface ExportOrdersButtonProps {
  searchParams: URLSearchParams | ReturnType<typeof useSearchParams>;
}

function ExportOrdersButton({ searchParams }: ExportOrdersButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = useCallback(async () => {
    if (loading) return;
    setError(null);
    setLoading(true);
    try {
      const out = new URLSearchParams();
      for (const key of EXPORT_ALLOWED_KEYS) {
        const v = searchParams.get(key);
        if (v && v.trim() !== "") out.set(key, v);
      }
      const qs = out.toString();
      const url = qs
        ? `/api/me/orders/export.xlsx?${qs}`
        : "/api/me/orders/export.xlsx";

      const res = await fetch(url, {
        method: "GET",
        credentials: "include",
        headers: {
          accept:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        },
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const blob = await res.blob();

      const disposition = res.headers.get("content-disposition") ?? "";
      const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
      const asciiMatch = disposition.match(/filename="?([^";]+)"?/i);
      let filename = "siparislerim.xlsx";
      if (utf8Match?.[1]) {
        try {
          filename = decodeURIComponent(utf8Match[1]);
        } catch {
          filename = utf8Match[1];
        }
      } else if (asciiMatch?.[1]) {
        filename = asciiMatch[1];
      }

      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (err) {
      console.warn("[orders-export] download failed", err);
      setError("Dışa aktarma başarısız oldu. Lütfen tekrar deneyin.");
    } finally {
      setLoading(false);
    }
  }, [loading, searchParams]);

  return (
    <div className="flex flex-col items-stretch">
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        aria-busy={loading}
        aria-live="polite"
        className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-blue-100 bg-white px-4 text-sm font-black text-[var(--ab-blue)] transition hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ab-blue)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Download className="h-4 w-4" aria-hidden="true" />
        {loading ? "Hazırlanıyor…" : "Dışa Aktar"}
      </button>
      {error ? (
        <p role="alert" className="mt-1 text-xs font-semibold text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function OrdersFilterBar({ statusCounts }: { statusCounts: StatusCounts }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateFilter = useCallback(
    (key: string, value: string) => {
      const sp = new URLSearchParams(searchParams.toString());
      if (value) {
        sp.set(key, value);
      } else {
        sp.delete(key);
      }
      sp.delete("page");
      router.push(`?${sp.toString()}`, { scroll: false });
    },
    [searchParams, router],
  );

  const handleSearch = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        updateFilter("search", val.trim());
      }, 500);
    },
    [updateFilter],
  );

  const currentStatus = searchParams.get("status") ?? "";
  const currentMarketplace = searchParams.get("marketplace") ?? "";
  const currentCargo = searchParams.get("cargoCompany") ?? "";
  const currentDatePreset = searchParams.get("datePreset") ?? "";
  const currentSearch = searchParams.get("search") ?? "";

  const datePresetLabel =
    DATE_PRESET_OPTIONS.find((o) => o.value === currentDatePreset)?.label ??
    "Tarih Seç";

  return (
    <section
      aria-label="Sipariş filtreleri"
      className="sticky top-2 z-30 rounded-3xl border border-[var(--ab-border)] bg-white/95 p-4 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-white/80"
    >
      <form
        role="search"
        aria-label="Sipariş arama"
        className="relative mb-3 w-full"
        onSubmit={(e) => e.preventDefault()}
      >
        <label htmlFor="orders-search-input" className="sr-only">
          Sipariş veya ürün ara
        </label>
        <Search
          className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500"
          aria-hidden="true"
        />
        <input
          id="orders-search-input"
          type="search"
          autoComplete="off"
          spellCheck={false}
          defaultValue={currentSearch}
          onChange={handleSearch}
          placeholder="Sipariş numarası, ürün adı veya müşteri ara..."
          className="h-12 w-full rounded-2xl border border-slate-300 bg-white pl-11 pr-4 text-base font-medium text-slate-900 outline-none transition placeholder:text-slate-500 focus:border-[var(--ab-blue)] focus:ring-2 focus:ring-[var(--ab-blue)]/30 focus-visible:outline-none"
        />
      </form>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-[minmax(0,210px)_minmax(0,180px)_minmax(0,190px)_minmax(0,190px)_auto]">
        <FilterDropdown
          label={datePresetLabel}
          icon={CalendarDays}
          ariaLabel="Tarih aralığı seç"
          options={DATE_PRESET_OPTIONS}
          value={currentDatePreset}
          onChange={(v) => updateFilter("datePreset", v)}
        />

        <FilterDropdown
          label="Tüm Durumlar"
          icon={ChevronDown}
          ariaLabel="Durum filtresi"
          options={STATUS_OPTIONS}
          value={currentStatus}
          onChange={(v) => updateFilter("status", v)}
        />

        <FilterDropdown
          label="Tüm Satış Kanalları"
          icon={ChevronDown}
          ariaLabel="Satış kanalı filtresi"
          options={MARKETPLACE_OPTIONS}
          value={currentMarketplace}
          onChange={(v) => updateFilter("marketplace", v)}
        />

        <FilterDropdown
          label="Tüm Kargo Firmaları"
          icon={ChevronDown}
          ariaLabel="Kargo firması filtresi"
          options={CARGO_OPTIONS}
          value={currentCargo}
          onChange={(v) => updateFilter("cargoCompany", v)}
        />

        <ExportOrdersButton searchParams={searchParams} />
      </div>

      <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Hızlı durum filtreleri">
        {QUICK_STATUS_CHIPS.map((chip) => {
          const isActive = currentStatus === chip.value;
          const count =
            chip.value === ""
              ? statusCounts.total > 0 ? String(statusCounts.total) : undefined
              : chip.value === "preparing" ? String(statusCounts.preparing)
              : chip.value === "shipped" ? String(statusCounts.shipped)
              : chip.value === "cancelled" ? String(statusCounts.cancelled)
              : chip.value === "refunded" ? String(statusCounts.refunded)
              : undefined;

          return (
            <QuickChip
              key={chip.value}
              label={chip.label}
              count={count}
              active={isActive}
              onClick={() => updateFilter("status", chip.value)}
            />
          );
        })}
      </div>
    </section>
  );
}

function QuickChip({
  label,
  count,
  active = false,
  onClick,
}: {
  label: string;
  count?: string;
  active?: boolean;
  onClick?: () => void;
}) {
  const ariaLabel = count ? `${label}, ${count} sipariş` : label;

  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={ariaLabel}
      onClick={onClick}
      className={[
        "inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-black transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ab-blue)]",
        active ? "bg-[var(--ab-blue)] text-white" : "border border-slate-200 bg-slate-50 text-slate-700 hover:bg-blue-50",
      ].join(" ")}
    >
      <span aria-hidden="true">{label}</span>
      {count ? (
        <span aria-hidden="true" className={active ? "text-white/90" : "rounded-full bg-white px-2 py-0.5 text-slate-700"}>
          {count}
        </span>
      ) : null}
    </button>
  );
}

interface OrdersListProps {
  orders: OrderItem[];
  totalLabel: string;
  pagination: PaginationMeta;
}

function OrdersList({ orders, totalLabel, pagination }: OrdersListProps) {
  const router = useRouter();

  return (
    <section className="rounded-3xl border border-[var(--ab-border)] bg-white p-4 shadow-sm">
      <ul className="space-y-3 lg:hidden" aria-label="Siparişlerim">
        {orders.map((order) => (
          <OrderCard key={order.id} order={order} />
        ))}
      </ul>

      <div className="hidden overflow-x-auto rounded-2xl border border-slate-200 lg:block">
        <table className="w-full min-w-[1000px] text-left text-sm">
          <caption className="sr-only">Siparişlerim listesi</caption>
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
            <tr>
              <th scope="col" className="px-3 py-3 font-black">Ürün</th>
              <th scope="col" className="px-3 py-3 font-black">Tarih</th>
              <th scope="col" className="px-3 py-3 font-black">Sipariş No</th>
              <th scope="col" className="px-3 py-3 font-black">Müşteri</th>
              <th scope="col" className="px-3 py-3 font-black">Ürün Adı</th>
              <th scope="col" className="px-3 py-3 font-black">Satış Kanalı</th>
              <th scope="col" className="px-3 py-3 font-black">Barkod</th>
              <th scope="col" className="px-3 py-3 font-black">Kargo</th>
              <th scope="col" className="px-3 py-3 font-black">Durum</th>
              <th scope="col" className="px-3 py-3 font-black">Tutar</th>
              <th scope="col" className="px-3 py-3 font-black">İşlem</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-100 bg-white">
            {orders.map((order) => {
              const goToDetail = () => router.push(`/hesabim/siparislerim/${order.id}`);
              return (
              <tr
                key={order.id}
                onClick={goToDetail}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    goToDetail();
                  }
                }}
                tabIndex={0}
                role="link"
                aria-label={`${order.orderNumber} sipariş detayını aç`}
                className="cursor-pointer transition hover:bg-blue-50/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ab-blue)]"
              >
                <td className="px-3 py-3">
                  <ProductThumbnail
                    tone={order.productImageTone}
                    imageUrl={order.imageUrl}
                    productName={order.productName}
                  />
                </td>
                <td className="px-3 py-3 whitespace-nowrap">
                  <span className="block font-black text-[var(--ab-text)]">{order.date}</span>
                  <span className="block text-xs font-semibold text-slate-600">{order.time}</span>
                </td>
                <td className="px-3 py-3 whitespace-nowrap">
                  <span className="font-black text-[var(--ab-blue)]">
                    {order.orderNumber}
                  </span>
                </td>
                <td className="px-3 py-3 max-w-[160px]">
                  <span className="block truncate font-black text-[var(--ab-text)]">
                    {order.endCustomerName}
                  </span>
                </td>
                <td className="px-3 py-3 max-w-[220px]">
                  <CopyableProductName name={order.productName} variant={order.productVariant} />
                </td>
                <td className="px-3 py-3">
                  <MarketplaceBadge marketplace={order.marketplace} />
                </td>
                <td className="px-3 py-3 font-semibold text-slate-700 whitespace-nowrap">{order.marketplaceBarcode}</td>
                <td className="px-3 py-3">
                  <CargoLogo cargo={order.cargo} />
                </td>
                <td className="px-3 py-3">
                  <StatusBadge status={order.status} />
                </td>
                <td className="px-3 py-3 font-black text-[var(--ab-text)] whitespace-nowrap">{order.amount}</td>
                <td className="px-3 py-3">
                  <div className="flex items-center gap-1.5">
                    <Link
                      href={`/hesabim/siparislerim/${order.id}`}
                      aria-label={`${order.orderNumber} sipariş detayını görüntüle`}
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-[var(--ab-blue)] transition hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ab-blue)]"
                    >
                      <Eye className="h-4 w-4" aria-hidden="true" />
                    </Link>
                    {order.hasReceipt ? (
                      <span onClick={(e) => e.stopPropagation()}>
                        <ReceiptButton
                          kind="order"
                          id={order.id}
                          label={`${order.orderNumber} tahsilat makbuzunu görüntüle`}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-emerald-200 text-emerald-600 transition hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 active:scale-95 disabled:cursor-progress disabled:opacity-70"
                        />
                      </span>
                    ) : null}
                  </div>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Pagination totalLabel={totalLabel} meta={pagination} />
    </section>
  );
}

function OrderCard({ order }: { order: OrderItem }) {
  return (
    <li className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex items-start gap-3">
        <ProductThumbnail
          tone={order.productImageTone}
          imageUrl={order.imageUrl}
          productName={order.productName}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Link
              href={`/hesabim/siparislerim/${order.id}`}
              className="text-sm font-black text-[var(--ab-blue)] hover:underline"
            >
              {order.orderNumber}
            </Link>
            <StatusBadge status={order.status} />
          </div>
          <p className="mt-1 truncate text-sm font-black text-[var(--ab-text)]">{order.productName}</p>
          <p className="truncate text-xs text-slate-600">{order.productVariant}</p>

          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-600">
            <span className="font-semibold text-slate-700">{order.date} · {order.time}</span>
            <span aria-hidden="true">·</span>
            <span>Müşteri: <span className="font-semibold text-slate-700">{order.endCustomerName}</span></span>
            <span aria-hidden="true">·</span>
            <span>Barkod: <span className="font-semibold text-slate-700">{order.marketplaceBarcode}</span></span>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <MarketplaceBadge marketplace={order.marketplace} />
            <CargoLogo cargo={order.cargo} />
            <span className="ml-auto text-sm font-black text-[var(--ab-text)]">{order.amount}</span>
          </div>

          <div className="mt-3 flex items-center justify-end gap-2">
            {order.hasReceipt ? (
              <ReceiptButton
                kind="order"
                id={order.id}
                variant="button"
                label="Makbuz"
                className="inline-flex items-center gap-1 rounded-xl border border-emerald-200 px-3 py-1.5 text-xs font-bold text-emerald-600 transition hover:bg-emerald-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500 active:scale-[0.98] disabled:cursor-progress disabled:opacity-70"
              />
            ) : null}
            <Link
              href={`/hesabim/siparislerim/${order.id}`}
              className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-bold text-[var(--ab-blue)] transition hover:bg-blue-50"
            >
              <Eye className="h-3.5 w-3.5" aria-hidden="true" /> Detay
            </Link>
          </div>
        </div>
      </div>
    </li>
  );
}

function Pagination({ totalLabel, meta }: { totalLabel: string; meta: PaginationMeta }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { page, totalPages } = meta;

  const navigate = useCallback(
    (newPage: number) => {
      const sp = new URLSearchParams(searchParams.toString());
      if (newPage === 1) {
        sp.delete("page");
      } else {
        sp.set("page", String(newPage));
      }
      router.push(`?${sp.toString()}`, { scroll: false });
    },
    [searchParams, router],
  );

  const changeLimit = useCallback(
    (newLimit: string) => {
      const sp = new URLSearchParams(searchParams.toString());
      sp.set("limit", newLimit);
      sp.delete("page");
      router.push(`?${sp.toString()}`, { scroll: false });
    },
    [searchParams, router],
  );

  const currentLimit = searchParams.get("limit") ?? "20";

  const pages: (number | "...")[] = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (page > 3) pages.push("...");
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) pages.push(i);
    if (page < totalPages - 2) pages.push("...");
    if (totalPages > 1) pages.push(totalPages);
  }

  return (
    <nav className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between" aria-label="Sayfalama">
      <p className="text-sm font-semibold text-slate-600">Toplam {totalLabel} sipariş</p>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => navigate(page - 1)}
          aria-label="Önceki sayfa"
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 transition hover:bg-slate-50 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ab-blue)]"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </button>
        {pages.map((p, idx) => {
          if (p === "...") {
            return (
              <span key={`ellipsis-${idx}`} aria-hidden="true" className="px-2 text-sm font-bold text-slate-600">
                ...
              </span>
            );
          }
          const isActive = p === page;
          return (
            <button
              key={p}
              type="button"
              aria-label={`Sayfa ${p}`}
              aria-current={isActive ? "page" : undefined}
              onClick={() => navigate(p)}
              className={[
                "rounded-lg px-3.5 py-2 text-sm font-black transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ab-blue)]",
                isActive
                  ? "bg-[var(--ab-blue)] text-white"
                  : "border border-slate-200 text-slate-700 hover:bg-slate-50",
              ].join(" ")}
            >
              {p}
            </button>
          );
        })}
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => navigate(page + 1)}
          aria-label="Sonraki sayfa"
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 transition hover:bg-slate-50 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ab-blue)]"
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>

        <label className="ml-2 inline-flex items-center gap-2">
          <span className="sr-only">Sayfa başına kayıt sayısı</span>
          <select
            value={currentLimit}
            onChange={(e) => changeLimit(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ab-blue)]"
          >
            <option value="10">10 / sayfa</option>
            <option value="20">20 / sayfa</option>
            <option value="25">25 / sayfa</option>
            <option value="50">50 / sayfa</option>
            <option value="100">100 / sayfa</option>
          </select>
        </label>
      </div>
    </nav>
  );
}

function ProductThumbnail({
  tone,
  imageUrl,
  productName,
}: {
  tone: MetricTone;
  imageUrl: string | null;
  productName: string;
}) {
  if (imageUrl) {
    return (
      <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <ProductImage
          key={imageUrl}
          src={imageUrl}
          alt={productName}
          fill
          sizes="48px"
          className="object-cover"
          unoptimized
        />
      </div>
    );
  }

  return (
    <div
      aria-hidden="true"
      className={[
        "flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border shadow-sm",
        tone === "blue" ? "border-blue-100 bg-blue-50 text-blue-700" : "",
        tone === "green" ? "border-green-100 bg-green-50 text-green-700" : "",
        tone === "orange" ? "border-orange-100 bg-orange-50 text-orange-700" : "",
        tone === "purple" ? "border-purple-100 bg-purple-50 text-purple-700" : "",
      ].join(" ")}
    >
      <PackageCheck className="h-6 w-6" aria-hidden="true" />
    </div>
  );
}

// Satış kanalı rozeti — üçüncü taraf pazaryeri logosu yok, metin rozet.
function MarketplaceBadge({ marketplace }: { marketplace: MarketplaceKey }) {
  const meta = marketplaceMeta[marketplace];

  return (
    <span
      className={["inline-flex h-7 max-w-[120px] items-center justify-center rounded-lg px-2 text-xs font-semibold ring-1", meta.pillClass].join(" ")}
      title={meta.label}
    >
      <span className="truncate">{meta.label}</span>
    </span>
  );
}

function CargoLogo({ cargo }: { cargo: CargoKey }) {
  const meta = cargoMeta[cargo];

  return (
    <span
      className={["inline-flex h-7 w-[80px] items-center justify-center rounded-lg px-2 ring-1", meta.pillClass].join(" ")}
      title={meta.label}
    >
      <Image
        src={meta.logoSrc}
        alt={meta.logoAlt}
        width={64}
        height={18}
        className="max-h-[18px] w-auto max-w-full object-contain"
      />
    </span>
  );
}

function CopyableProductName({ name, variant }: { name: string; variant: string }) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const copy = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!name) return;
      try {
        await navigator.clipboard.writeText(name);
        setCopied(true);
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        timeoutRef.current = setTimeout(() => setCopied(false), 1500);
      } catch (err) {
        console.warn("[orders] product name copy failed", err);
      }
    },
    [name],
  );

  return (
    <div className="min-w-0">
      <p className="font-black leading-snug text-[var(--ab-text)]">
        {name}
        <button
          type="button"
          onClick={copy}
          title="Ürün adını kopyala"
          aria-label={`Ürün adını kopyala: ${name}`}
          className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded-md align-middle text-slate-400 transition hover:bg-blue-50 hover:text-[var(--ab-blue)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ab-blue)]"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-green-600" aria-hidden="true" />
          ) : (
            <Copy className="h-3.5 w-3.5" aria-hidden="true" />
          )}
        </button>
      </p>
      <span className="block truncate text-xs text-slate-600">{variant}</span>
      <span aria-live="polite" className="sr-only">
        {copied ? "Ürün adı kopyalandı" : ""}
      </span>
    </div>
  );
}

function StatusBadge({ status }: { status: OrderStatus }) {
  const className =
    status === "Kargoya Verildi"
      ? "bg-green-50 text-green-800"
      : status === "İptal Edildi"
        ? "bg-red-50 text-red-800"
        : status === "İade Edildi"
          ? "bg-purple-50 text-purple-800"
          : "bg-blue-50 text-blue-800"; // Sipariş Alındı, Hazırlanıyor

  return <span className={`inline-flex rounded-full px-3 py-1 text-xs font-black ${className}`}>{status}</span>;
}

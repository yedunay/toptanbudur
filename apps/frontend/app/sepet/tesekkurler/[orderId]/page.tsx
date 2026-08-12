"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { formatPrice } from "@/lib/api";
import { fetchOrder, formatOrderNo, type OrderDetail } from "@/lib/orders";
import type { OrderDetail as CustomerOrderDetail } from "@/lib/customer-types";
import { apiCustomer, ApiError, useCustomer } from "@/lib/auth";
import { useCartStore } from "@/lib/cart";
import { useCartStashStore } from "@/lib/cart-stash";

type Params = { orderId: string };
type SearchParams = { t?: string };

/** Kargo firması kodlarının (ARAS/SURAT/...) okunabilir etiketleri. */
const CARGO_LABELS: Record<string, string> = {
  ARAS: "Aras Kargo",
  SURAT: "Sürat Kargo",
  PTT: "PTT Kargo",
  DHL: "DHL",
  YURTICI: "Yurtiçi Kargo",
  MNG: "MNG Kargo",
  UPS: "UPS",
  HEPSIJET: "HepsiJET",
};

function cargoLabel(value?: string | null): string | null {
  if (!value) return null;
  const v = value.trim();
  if (!v) return null;
  return CARGO_LABELS[v.toUpperCase()] ?? v;
}

/** Satış kanalı kodlarının okunabilir etiketleri. */
const MARKETPLACE_LABELS: Record<string, string> = {
  self: "Kendim İçin",
  other: "Diğer Satış Kanalı",
};

function marketplaceLabel(value?: string | null): string | null {
  if (!value) return null;
  const v = value.trim();
  if (!v) return null;
  return MARKETPLACE_LABELS[v.toLowerCase()] ?? v;
}

/**
 * /api/me/orders/:id yanıtındaki `data` payload'ını (flat müşteri sipariş
 * şekli, paymentMethod alanlı) bu sayfanın render ettiği `{order, items}`
 * OrderDetail şekline çevirir. Path 2 (girişli + token'sız) bu mapper
 * üzerinden çalışır — endpoint `{success, data}` zarfıyla döner.
 */
function mapCustomerOrderDetail(detail: CustomerOrderDetail): OrderDetail {
  return {
    order: {
      id: detail.id,
      humanOrderNo: detail.number ?? null,
      total: detail.total,
      subtotal: detail.subtotal ?? null,
      kdvAmount: detail.kdvAmount ?? null,
      kdvRate: detail.kdvRate ?? null,
      packagingCost: detail.packagingCost ?? null,
      packagingUnitFee: detail.packagingUnitFee ?? null,
      currency: detail.currency,
      status: detail.status,
      createdAt: detail.createdAt,
      paymentType: detail.paymentMethod ?? null,
      cardCommissionRate: detail.cardCommissionRate ?? null,
      cardCommissionAmount: detail.cardCommissionAmount ?? null,
      cariPreviousBalance: detail.cariPreviousBalance ?? null,
      cariNewBalance: detail.cariNewBalance ?? null,
      cariDeducted: detail.cariDeducted ?? null,
      marketplace: detail.marketplace ?? null,
      // Backend `carrier` = Order.cargoCompany (firma kodu/etiketi).
      cargoCompany: detail.carrier ?? null,
      cargoBarcode: detail.cargoBarcode ?? null,
      trackingNumber: detail.trackingNumber ?? null,
      endCustomerName: detail.endCustomerName ?? null,
    },
    items: detail.items.map((i) => ({
      slug: i.productSlug ?? i.productId ?? i.id ?? i.productName,
      name: i.productName,
      qty: i.qty,
      price: i.unitPrice,
      image: i.imageUrl ?? null,
    })),
  };
}

type LoadState =
  | { kind: "loading" }
  | { kind: "ok"; detail: OrderDetail }
  | { kind: "guest-no-token" }
  | { kind: "not-found" };

function CheckCircle() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-9 w-9"
      aria-hidden
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export default function TesekkurlerPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<SearchParams>;
}) {
  const { orderId } = use(params);
  const { t } = use(searchParams);
  const { customer, loading: customerLoading } = useCustomer();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [restoredCount, setRestoredCount] = useState<number>(0);

  // "Sepeti Paketlere Ayır" akışında stash'lenen ürünleri sepete geri ekle.
  // Sayfa mount'unda 1 kez çalışır — eğer stash boşsa hiçbir şey yapmaz.
  useEffect(() => {
    const stash = useCartStashStore.getState();
    if (!stash.has()) return;
    const popped = stash.pop();
    if (popped.length === 0) return;
    useCartStore.setState((s) => ({ items: [...s.items, ...popped] }));
    setRestoredCount(popped.length);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      // Path 1: token in URL — works for guest checkout and is the primary path.
      if (t) {
        const detail = await fetchOrder(orderId, t);
        if (cancelled) return;
        if (detail) {
          setState({ kind: "ok", detail });
        } else {
          setState({ kind: "not-found" });
        }
        return;
      }

      // Path 2: authenticated customer fallback — fetch via /me/orders/:id
      if (customerLoading) return;
      if (!customer) {
        setState({ kind: "guest-no-token" });
        return;
      }

      try {
        const res = await apiCustomer<{
          success?: boolean;
          data?: CustomerOrderDetail;
        }>(`/me/orders/${encodeURIComponent(orderId)}`, {
          method: "GET",
          general: true,
        });
        if (cancelled) return;
        const raw = res?.data;
        if (!raw || typeof raw !== "object" || !("id" in raw)) {
          setState({ kind: "not-found" });
          return;
        }
        setState({ kind: "ok", detail: mapCustomerOrderDetail(raw) });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          setState({ kind: "not-found" });
          return;
        }
        setState({ kind: "not-found" });
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [orderId, t, customer, customerLoading]);

  if (state.kind === "loading") {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <div className="h-40 animate-pulse rounded-3xl bg-[var(--surface-muted)]" />
        <div className="mt-6 h-52 animate-pulse rounded-2xl bg-[var(--surface-muted)]" />
      </main>
    );
  }

  if (state.kind === "guest-no-token") {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16 text-center sm:px-6">
        <div className="rounded-3xl border border-emerald-200 bg-gradient-to-b from-emerald-50 to-white p-8 shadow-sm">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg shadow-emerald-500/30">
            <CheckCircle />
          </div>
          <h1 className="mt-5 text-2xl font-bold text-emerald-900">
            Siparişiniz oluşturuldu
          </h1>
          <p className="mt-2 text-sm text-emerald-800/80">
            Sipariş detaylarını görüntülemek için hesabınıza giriş yapın.
          </p>
        </div>
        <div className="mt-8 flex flex-col items-center gap-3">
          <Link
            href="/giris"
            className="inline-block rounded-xl bg-[var(--brand-blue)] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[var(--brand-navy)]"
          >
            Giriş yap
          </Link>
          <Link
            href="/hesabim/siparislerim"
            className="text-sm text-[var(--brand-blue)] hover:text-[var(--brand-navy)]"
          >
            Siparişlerime git
          </Link>
        </div>
      </main>
    );
  }

  if (state.kind === "not-found") {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16 text-center sm:px-6">
        <div className="rounded-3xl border border-amber-200 bg-amber-50 p-8">
          <h1 className="text-2xl font-bold text-amber-900">Sipariş bulunamadı</h1>
          <p className="mt-2 text-sm text-amber-800">
            Sipariş bağlantısı geçersiz veya süresi dolmuş olabilir.
          </p>
        </div>
        <div className="mt-8 flex flex-col items-center gap-3">
          {customer ? (
            <Link
              href="/hesabim/siparislerim"
              className="inline-block rounded-xl bg-[var(--brand-blue)] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[var(--brand-navy)]"
            >
              Siparişlerime git
            </Link>
          ) : (
            <Link
              href="/giris"
              className="inline-block rounded-xl bg-[var(--brand-blue)] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[var(--brand-navy)]"
            >
              Giriş yap
            </Link>
          )}
          <Link
            href="/katalog"
            className="text-sm text-[var(--text-muted)] hover:text-[var(--brand-navy)]"
          >
            Katalog'a dön
          </Link>
        </div>
      </main>
    );
  }

  const { order, items } = state.detail;
  const currency = order.currency ?? "TRY";
  const itemsTotal = items.reduce((acc, item) => acc + item.price * item.qty, 0);
  const subtotal = order.subtotal ?? itemsTotal;
  const kdvRate = order.kdvRate ?? 20;
  const kdvAmount =
    order.kdvAmount ?? Math.round(((subtotal * kdvRate) / 100) * 100) / 100;
  const packagingCost =
    typeof order.packagingCost === "number" ? order.packagingCost : 0;
  // Kargo bedeli (örn. "Kendim İçin" sabit kargosu) — toplamdan türetilir
  // (total − ara toplam − KDV − paketleme). Böylece itemize satırlar toplama
  // tam oturur; self-DIŞI siparişlerde 0 → satır gizli.
  const shipping = Math.max(0, order.total - subtotal - kdvAmount - packagingCost);
  // Kart komisyonu — yalnızca kartlı ödemede backend tarafından snapshot'lanır;
  // cari ödemede null/yok. Ödenen Toplam = total + komisyon.
  const cardCommission =
    typeof order.cardCommissionAmount === "number" &&
    order.cardCommissionAmount > 0
      ? order.cardCommissionAmount
      : null;
  const cardCommissionRate = Number(order.cardCommissionRate ?? NaN);

  const isCari = order.paymentType === "cari_balance";
  const isCard = order.paymentType === "card";
  const cariPrev =
    typeof order.cariPreviousBalance === "number"
      ? order.cariPreviousBalance
      : null;
  const cariNew =
    typeof order.cariNewBalance === "number" ? order.cariNewBalance : null;
  const cariDeducted =
    typeof order.cariDeducted === "number" ? order.cariDeducted : order.total;
  const hasCariBreakdown = isCari && cariPrev !== null && cariNew !== null;

  const cargoCompanyName = cargoLabel(order.cargoCompany);
  const marketplaceName = marketplaceLabel(order.marketplace);
  const hasCargoInfo = Boolean(
    order.cargoBarcode ||
      order.trackingNumber ||
      cargoCompanyName ||
      order.endCustomerName ||
      marketplaceName,
  );

  const createdAtLabel = order.createdAt
    ? new Date(order.createdAt).toLocaleString("tr-TR", {
        day: "2-digit",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
      {/* ── Başarı başlığı ─────────────────────────────────────────────── */}
      <section className="overflow-hidden rounded-3xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-white shadow-sm">
        <div className="flex flex-col items-center gap-4 px-6 py-8 text-center sm:flex-row sm:items-center sm:gap-5 sm:text-left">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg shadow-emerald-500/30">
            <CheckCircle />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold text-emerald-900 sm:text-[1.7rem]">
              Teşekkürler, siparişiniz alındı!
            </h1>
            <p className="mt-1 text-sm text-emerald-800/80">
              Siparişiniz başarıyla oluşturuldu ve hazırlanmaya alınıyor.
            </p>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-xs font-semibold text-emerald-900 shadow-sm ring-1 ring-emerald-200">
                Sipariş No:{" "}
                <span className="font-mono">
                  {formatOrderNo(order.humanOrderNo, order.id)}
                </span>
              </span>
              {marketplaceName ? (
                <span className="inline-flex items-center rounded-full bg-white px-3 py-1 text-xs font-semibold text-[var(--brand-navy)] shadow-sm ring-1 ring-[var(--border)]">
                  {marketplaceName}
                </span>
              ) : null}
              {isCari ? (
                <span className="inline-flex items-center rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700 ring-1 ring-indigo-200">
                  Cari ile ödendi
                </span>
              ) : isCard ? (
                <span className="inline-flex items-center rounded-full bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-700 ring-1 ring-sky-200">
                  Kredi Kartı ile ödendi
                </span>
              ) : null}
            </div>
            {createdAtLabel ? (
              <p className="mt-2 text-xs text-[var(--text-muted)]">
                {createdAtLabel}
              </p>
            ) : null}
          </div>
        </div>
      </section>

      {restoredCount > 0 && (
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-900">
          <h2 className="text-base font-bold">
            Kalan paketler sepetinize geri eklendi
          </h2>
          <p className="mt-1 text-sm">
            Sonraki paketinizi sipariş edebilmek için sepetinize {restoredCount} ürün
            geri eklendi. Lütfen{" "}
            <Link href="/sepet" className="font-semibold underline">
              sepetinize
            </Link>{" "}
            dönüp sonraki paket için ayrı bir kargo barkodu ile yeni bir sipariş
            oluşturun.
          </p>
        </div>
      )}

      {/* ── Kontrol kartı: bayinin "doğru girdim mi?" doğrulaması ───────── */}
      {hasCargoInfo ? (
        <section className="mt-6 rounded-2xl border border-[var(--brand-blue)]/25 bg-[var(--brand-blue)]/[0.04] p-5">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[var(--brand-blue)]/10 text-[var(--brand-blue)]">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                className="h-3.5 w-3.5"
                aria-hidden
              >
                <path
                  d="M9 12l2 2 4-4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <circle cx="12" cy="12" r="9" />
              </svg>
            </span>
            <h2 className="text-base font-semibold text-[var(--brand-navy)]">
              Kargo & Gönderi Bilgileri
            </h2>
          </div>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            Lütfen aşağıdaki bilgilerin doğru olduğunu kontrol edin.
          </p>

          {order.cargoBarcode ? (
            <div className="mt-4 rounded-xl border border-[var(--border)] bg-white p-4">
              <div className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
                Kargo Barkodu
              </div>
              <div className="mt-1 break-all font-mono text-xl font-bold tracking-wide text-[var(--brand-navy)]">
                {order.cargoBarcode}
              </div>
            </div>
          ) : null}

          <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            {order.endCustomerName ? (
              <div>
                <dt className="text-xs text-[var(--text-muted)]">Müşteri İsmi</dt>
                <dd className="font-semibold text-[var(--text)]">
                  {order.endCustomerName}
                </dd>
              </div>
            ) : null}
            {marketplaceName ? (
              <div>
                <dt className="text-xs text-[var(--text-muted)]">Satış Kanalı</dt>
                <dd className="font-semibold text-[var(--text)]">
                  {marketplaceName}
                </dd>
              </div>
            ) : null}
            {cargoCompanyName ? (
              <div>
                <dt className="text-xs text-[var(--text-muted)]">Kargo Firması</dt>
                <dd className="font-semibold text-[var(--text)]">
                  {cargoCompanyName}
                </dd>
              </div>
            ) : null}
            {order.trackingNumber ? (
              <div>
                <dt className="text-xs text-[var(--text-muted)]">Takip Numarası</dt>
                <dd className="break-all font-mono font-semibold text-[var(--text)]">
                  {order.trackingNumber}
                </dd>
              </div>
            ) : null}
          </dl>
        </section>
      ) : null}

      {/* ── Sipariş kalemleri + tutar dökümü ───────────────────────────── */}
      <section className="mt-6 rounded-2xl border border-[var(--border)] bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-[var(--brand-navy)]">
          Sipariş Özeti
        </h2>
        <ul className="mt-4 divide-y divide-[var(--border)]">
          {items.map((item) => (
            <li key={item.slug} className="flex items-center gap-3 py-3 text-sm">
              <span className="inline-flex h-7 min-w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-muted)] px-2 text-xs font-bold text-[var(--brand-navy)]">
                {item.qty}×
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-medium text-[var(--text)]">{item.name}</div>
                <div className="text-xs text-[var(--text-muted)]">
                  {formatPrice(item.price, item.currency ?? currency)} / adet
                </div>
              </div>
              <div className="whitespace-nowrap font-semibold text-[var(--brand-navy)]">
                {formatPrice(item.price * item.qty, item.currency ?? currency)}
              </div>
            </li>
          ))}
        </ul>
        <div className="mt-4 space-y-2 border-t border-[var(--border)] pt-3 text-sm">
          <div className="flex justify-between text-[var(--text-muted)]">
            <span>Ara toplam</span>
            <span>{formatPrice(subtotal, currency)}</span>
          </div>
          <div className="flex justify-between text-[var(--text-muted)]">
            <span>%{kdvRate} KDV</span>
            <span>{formatPrice(kdvAmount, currency)}</span>
          </div>
          {packagingCost > 0 ? (
            <div className="flex justify-between text-[var(--text-muted)]">
              <span>
                Paketleme
                {typeof order.packagingUnitFee === "number" &&
                order.packagingUnitFee > 0 ? (
                  <span className="ml-1 text-xs">
                    ({formatPrice(order.packagingUnitFee, currency)}/birim)
                  </span>
                ) : null}
              </span>
              <span>{formatPrice(packagingCost, currency)}</span>
            </div>
          ) : null}
          {shipping > 0 ? (
            <div className="flex justify-between text-[var(--text-muted)]">
              <span>Kargo Bedeli</span>
              <span>{formatPrice(shipping, currency)}</span>
            </div>
          ) : null}
          <div className="flex justify-between border-t border-[var(--border)] pt-2 text-base font-bold text-[var(--brand-navy)]">
            <span>Toplam</span>
            <span>{formatPrice(order.total, currency)}</span>
          </div>
        </div>
      </section>

      {/* ── Ödeme detayı ───────────────────────────────────────────────── */}
      {isCard ? (
        <section className="mt-6 rounded-2xl border border-sky-200 bg-sky-50/60 p-5">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-sky-100 text-sky-700">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                className="h-4 w-4"
                aria-hidden
              >
                <rect x="2" y="5" width="20" height="14" rx="2" />
                <path d="M2 10h20" />
              </svg>
            </span>
            <h2 className="text-base font-semibold text-sky-900">
              Kredi Kartı ile Ödendi
            </h2>
          </div>
          <div className="mt-3 rounded-xl bg-white p-4 text-sm shadow-sm">
            <div className="flex items-center justify-between py-1.5">
              <span className="text-[var(--text-muted)]">Sipariş tutarı</span>
              <span className="font-semibold text-[var(--text)]">
                {formatPrice(order.total, currency)}
              </span>
            </div>
            {cardCommission !== null ? (
              <div className="flex items-center justify-between py-1.5">
                <span className="text-[var(--text-muted)]">
                  Kart Komisyonu
                  {Number.isFinite(cardCommissionRate) && cardCommissionRate > 0
                    ? ` (%${cardCommissionRate})`
                    : ""}
                </span>
                <span className="font-semibold text-[var(--text)]">
                  {formatPrice(cardCommission, currency)}
                </span>
              </div>
            ) : null}
            <div className="mt-1 flex items-center justify-between border-t border-[var(--border)] pt-2.5">
              <span className="font-semibold text-sky-900">Karttan çekilen</span>
              <span className="text-lg font-bold text-sky-900">
                {formatPrice(order.total + (cardCommission ?? 0), currency)}
              </span>
            </div>
          </div>
        </section>
      ) : null}

      {isCari ? (
        <section className="mt-6 rounded-2xl border border-indigo-200 bg-indigo-50/60 p-5">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                className="h-4 w-4"
                aria-hidden
              >
                <path d="M3 7h18v10H3z" strokeLinejoin="round" />
                <path d="M3 11h18" />
              </svg>
            </span>
            <h2 className="text-base font-semibold text-indigo-900">
              Cari Bakiyeden Ödendi
            </h2>
          </div>

          {hasCariBreakdown ? (
            <div className="mt-3 rounded-xl bg-white p-4 text-sm shadow-sm">
              <div className="flex items-center justify-between py-1.5">
                <span className="text-[var(--text-muted)]">Önceki bakiye</span>
                <span className="font-semibold text-[var(--text)]">
                  {formatPrice(cariPrev as number, currency)}
                </span>
              </div>
              <div className="flex items-center justify-between py-1.5">
                <span className="text-[var(--text-muted)]">Sipariş tutarı</span>
                <span className="font-semibold text-rose-600">
                  − {formatPrice(cariDeducted, currency)}
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between border-t border-[var(--border)] pt-2.5">
                <span className="font-semibold text-indigo-900">
                  Kalan bakiye
                </span>
                <span className="text-lg font-bold text-indigo-900">
                  {formatPrice(cariNew as number, currency)}
                </span>
              </div>
            </div>
          ) : (
            <div className="mt-3 flex items-center justify-between rounded-xl bg-white px-4 py-3 text-sm shadow-sm">
              <span className="text-[var(--text-muted)]">Cariden düşülen</span>
              <span className="text-lg font-bold text-indigo-900">
                {formatPrice(cariDeducted, currency)}
              </span>
            </div>
          )}
        </section>
      ) : null}

      {order.customer && (
        <section className="mt-6 rounded-2xl border border-[var(--border)] bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-[var(--brand-navy)]">
            Teslimat Bilgileri
          </h2>
          <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            {order.endCustomerName && (
              <div className="sm:col-span-2">
                <dt className="text-xs text-[var(--text-muted)]">Müşteri İsmi</dt>
                <dd className="font-medium">{order.endCustomerName}</dd>
              </div>
            )}
            <div>
              <dt className="text-xs text-[var(--text-muted)]">Ad Soyad</dt>
              <dd className="font-medium">{order.customer.name}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--text-muted)]">E-posta</dt>
              <dd className="font-medium">{order.customer.email}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--text-muted)]">Telefon</dt>
              <dd className="font-medium">{order.customer.phone}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs text-[var(--text-muted)]">Adres</dt>
              <dd className="font-medium">
                {order.customer.address.line1}, {order.customer.address.city}{" "}
                {order.customer.address.postalCode} /{" "}
                {order.customer.address.country}
              </dd>
            </div>
          </dl>
        </section>
      )}

      <div className="mt-8 flex flex-col items-center gap-3 text-center">
        {customer && (
          <Link
            href="/hesabim/siparislerim"
            className="inline-block rounded-xl bg-[var(--brand-blue)] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[var(--brand-navy)]"
          >
            Siparişlerime git
          </Link>
        )}
        <Link
          href="/katalog"
          className={
            customer
              ? "text-sm text-[var(--text-muted)] hover:text-[var(--brand-navy)]"
              : "inline-block rounded-xl bg-[var(--brand-blue)] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[var(--brand-navy)]"
          }
        >
          Katalog'a dön
        </Link>
      </div>
    </main>
  );
}

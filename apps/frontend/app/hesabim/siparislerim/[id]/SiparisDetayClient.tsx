"use client";

import Link from "next/link";
import { ProductImage } from "@/components/ProductImage";
import { useEffect, useState } from "react";
import { formatPrice } from "@/lib/api";
import { apiCustomer, ApiError } from "@/lib/auth";
import { useAuth } from "@/components/AuthProvider";
import { ReceiptButton } from "@/components/receipts/ReceiptButton";
import { formatOrderNo } from "@/lib/orders";
import type {
  OrderAddressSnapshot,
  OrderDetail,
} from "@/lib/customer-types";
import { TrackingTimeline } from "./TrackingTimeline";
import {
  deriveCustomerOrderView,
  CUSTOMER_STAGE_LABEL,
  type CustomerOrderStage,
} from "@/lib/order-customer-status";
import {
  Toast,
  type ToastState,
} from "@/components/account-shared/Toast";

// KESKİN KURAL: Müşteriye gösterilen aşama etiketleri TrackingTimeline ile AYNI
// tek kaynaktan (deriveCustomerOrderView) türetilir — badge ile çizelge asla
// çelişmez. "shipped" müşteriye ancak 96 saat dolunca "Kargoya Verildi" olarak
// gösterilir; o ana kadar "Hazırlanıyor" kalır.
const STAGE_CONFIG: Record<
  CustomerOrderStage,
  { bg: string; text: string; dot: string }
> = {
  received: { bg: "bg-blue-50", text: "text-blue-700", dot: "bg-blue-400" },
  preparing: { bg: "bg-sky-50", text: "text-sky-700", dot: "bg-sky-400" },
  shipped: {
    bg: "bg-emerald-50",
    text: "text-emerald-700",
    dot: "bg-emerald-500",
  },
  cancelled: { bg: "bg-red-50", text: "text-red-700", dot: "bg-red-400" },
  refunded: {
    bg: "bg-purple-50",
    text: "text-purple-700",
    dot: "bg-purple-400",
  },
};

function isSafeUrl(u?: string | null): boolean {
  if (!u) return false;
  try {
    return new URL(u).protocol === "https:";
  } catch {
    return false;
  }
}

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("tr-TR", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function StatusBadge({
  status,
  createdAt,
}: {
  status: string;
  createdAt: string | Date | null | undefined;
}) {
  const { stage } = deriveCustomerOrderView(status, createdAt);
  const cfg = STAGE_CONFIG[stage];
  const label = CUSTOMER_STAGE_LABEL[stage];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${cfg.bg} ${cfg.text}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
      {label}
    </span>
  );
}

function SectionCard({
  title,
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-white shadow-sm">
      {title && (
        <div className="border-b border-[var(--border)] px-5 py-3.5">
          <h3 className="text-sm font-semibold text-[var(--text)]">{title}</h3>
        </div>
      )}
      <div className="p-5">{children}</div>
    </div>
  );
}

function AddressCard({
  title,
  address,
  icon,
}: {
  title: string;
  address?: OrderAddressSnapshot | null;
  icon: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-white shadow-sm">
      <div className="flex items-center gap-2.5 border-b border-[var(--border)] px-5 py-3.5">
        <span className="text-[var(--text-muted)]">{icon}</span>
        <h3 className="text-sm font-semibold text-[var(--text)]">{title}</h3>
      </div>
      <div className="p-5">
        {address ? (
          <div className="space-y-1 text-sm">
            <p className="font-semibold text-[var(--text)]">
              {address.fullName}
            </p>
            <p className="text-[var(--text-muted)]">{address.phone}</p>
            <p className="mt-2 text-[var(--text)]">{address.line1}</p>
            {address.line2 && (
              <p className="text-[var(--text)]">{address.line2}</p>
            )}
            <p className="text-[var(--text-muted)]">
              {[address.district, address.city]
                .filter(Boolean)
                .join(" / ")}{" "}
              {address.postalCode}
            </p>
            {address.country && address.country !== "TR" && (
              <p className="text-[var(--text-muted)]">{address.country}</p>
            )}
          </div>
        ) : (
          <p className="text-sm text-[var(--text-muted)]">
            Adres bilgisi bulunmuyor.
          </p>
        )}
      </div>
    </div>
  );
}

function extractDetail(value: unknown): OrderDetail | null {
  if (!value || typeof value !== "object") return null;
  if ("id" in value) return value as OrderDetail;
  if ("data" in value) {
    const d = (value as { data?: unknown }).data;
    if (d && typeof d === "object" && "id" in d) return d as OrderDetail;
  }
  if ("order" in value) {
    const d = (value as { order?: unknown }).order;
    if (d && typeof d === "object" && "id" in d) return d as OrderDetail;
  }
  return null;
}

interface SiparisDetayClientProps {
  id: string;
}

export function SiparisDetayClient({ id }: SiparisDetayClientProps) {
  const { customer } = useAuth();

  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);

  useEffect(() => {
    if (!customer || !id) return;
    let cancelled = false;
    setError(null);
    setLoaded(false);
    apiCustomer<unknown>(`/me/orders/${encodeURIComponent(id)}`, {
      method: "GET",
      general: true,
    })
      .then((data) => {
        if (cancelled) return;
        const detail = extractDetail(data);
        if (!detail) {
          setError("Sipariş bulunamadı");
        } else {
          setOrder(detail);
        }
        setLoaded(true);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg =
          err instanceof ApiError ? err.message : "Sipariş yüklenemedi";
        setError(msg);
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [customer, id]);

  if (!loaded) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 animate-pulse rounded-lg bg-[var(--surface-muted)]" />
        <div className="h-28 animate-pulse rounded-2xl bg-[var(--surface-muted)]" />
        <div className="h-48 animate-pulse rounded-2xl bg-[var(--surface-muted)]" />
        <div className="h-32 animate-pulse rounded-2xl bg-[var(--surface-muted)]" />
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="space-y-4">
        <Link
          href="/hesabim/siparislerim"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--brand-blue)] hover:text-[var(--brand-navy)]"
        >
          ← Siparişlerime dön
        </Link>
        <div
          role="alert"
          className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700"
        >
          {error ?? "Sipariş bulunamadı"}
        </div>
      </div>
    );
  }

  const itemsTotal = order.items.reduce(
    (sum, item) => sum + item.unitPrice * item.qty,
    0,
  );
  const subtotal = order.subtotal ?? itemsTotal;
  const kdvRate = order.kdvRate ?? 20;
  const kdvAmount =
    order.kdvAmount ?? Math.round(((subtotal * kdvRate) / 100) * 100) / 100;
  const packagingCost =
    typeof order.packagingCost === "number" ? order.packagingCost : 0;
  const shipping =
    order.shippingCost != null
      ? order.shippingCost
      : Math.max(0, order.total - subtotal - kdvAmount - packagingCost);
  // Kart komisyonu — yalnızca kartlı ödemede backend tarafından snapshot'lanır;
  // cari ödemede null/yok. Ödenen Toplam = total + komisyon.
  const cardCommission =
    typeof order.cardCommissionAmount === "number" &&
    order.cardCommissionAmount > 0
      ? order.cardCommissionAmount
      : null;
  const cardCommissionRate = Number(order.cardCommissionRate ?? NaN);

  return (
    <div className="space-y-4">
      {/* Back link */}
      <Link
        href="/hesabim/siparislerim"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--text-muted)] transition hover:text-[var(--text)]"
      >
        <svg
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 19l-7-7 7-7"
          />
        </svg>
        Siparişlerime dön
      </Link>

      {/* Order header */}
      <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2.5">
                <h2 className="text-lg font-bold text-[var(--text)]">
                  Sipariş #
                  {formatOrderNo(
                    order.number,
                    order.id.slice(0, 8).toUpperCase(),
                  )}
                </h2>
                <StatusBadge
                  status={order.status}
                  createdAt={order.createdAt}
                />
              </div>
              <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                {formatDate(order.createdAt)}
              </p>
              {order.endCustomerName && (
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  Müşteri:{" "}
                  <span className="font-semibold text-[var(--text)]">
                    {order.endCustomerName}
                  </span>
                </p>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* Kargo Takip: yalnızca geçerli (https) bir takip URL'i varsa
                göster; URL yoksa butonu tamamen gizle. trackingNumber şartı
                kaldırıldı — backend artık carrierTrackingUrl döndürebiliyor ve
                URL varsa numara olmasa bile takip linkini sunmalıyız. */}
            {isSafeUrl(order.carrierTrackingUrl) && (
              <a
                href={order.carrierTrackingUrl as string}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--brand-blue)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--brand-navy)]"
              >
                Kargo Takip
                <svg
                  className="h-3.5 w-3.5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                  />
                </svg>
              </a>
            )}
            <Link
              href={`/hesabim/destek?orderId=${encodeURIComponent(order.id)}${order.number ? `&orderNumber=${encodeURIComponent(order.number)}` : ""}&new=1`}
              className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--border)] bg-white px-4 py-2 text-sm font-semibold text-[var(--text)] transition hover:bg-[var(--surface-muted)]"
            >
              <svg
                className="h-3.5 w-3.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              Destek Talebi
            </Link>
          </div>
        </div>

        {/* Cargo info bar */}
        {(order.trackingNumber || order.carrier || order.cargoBarcode) && (
          <div className="flex flex-wrap items-center gap-4 border-t border-[var(--border)] bg-[var(--surface-muted)] px-5 py-3 text-xs text-[var(--text-muted)]">
            {order.carrier && (
              <span className="flex items-center gap-1.5">
                <svg
                  className="h-3.5 w-3.5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
                  />
                </svg>
                <span className="font-medium text-[var(--text)]">
                  {order.carrier}
                </span>
              </span>
            )}
            {order.cargoBarcode && (
              <span className="flex items-center gap-1.5">
                Teslimat No:{" "}
                <span className="font-mono font-semibold text-[var(--text)]">
                  {order.cargoBarcode}
                </span>
              </span>
            )}
            {order.trackingNumber && (
              <span className="flex items-center gap-1.5">
                Takip No:{" "}
                <span className="font-mono font-semibold text-[var(--text)]">
                  {order.trackingNumber}
                </span>
              </span>
            )}
          </div>
        )}
      </div>

      {/* Tracking timeline — order.status + createdAt'ten TÜRETİLİR; ham
          tedarikçi/otomasyon event açıklamaları müşteriye ASLA sızmaz. */}
      <SectionCard title="Kargo Takibi">
        <TrackingTimeline
          status={order.status}
          createdAt={order.createdAt}
        />
      </SectionCard>

      {/* Products */}
      <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-white shadow-sm">
        <div className="border-b border-[var(--border)] px-5 py-3.5">
          <h3 className="text-sm font-semibold text-[var(--text)]">
            Ürünler{" "}
            <span className="ml-1 text-[var(--text-muted)]">
              ({order.items.length})
            </span>
          </h3>
        </div>
        <ul className="divide-y divide-[var(--border)]">
          {order.items.map((item, idx) => (
            <li
              key={item.id ?? `${order.id}-${idx}`}
              className="flex gap-4 p-5"
            >
              <div className="relative h-20 w-20 flex-shrink-0 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-muted)]">
                <ProductImage
                  key={`${item.id ?? idx}-${item.imageUrl ?? "none"}`}
                  src={item.imageUrl}
                  alt={item.productName}
                  fill
                  sizes="80px"
                  className="object-cover"
                  unoptimized
                />
              </div>
              <div className="flex flex-1 flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  {item.productSlug ? (
                    <Link
                      href={`/katalog/${item.productSlug}`}
                      className="line-clamp-2 text-sm font-medium text-[var(--text)] hover:text-[var(--brand-blue)]"
                    >
                      {item.productName}
                    </Link>
                  ) : (
                    <span className="line-clamp-2 text-sm font-medium text-[var(--text)]">
                      {item.productName}
                    </span>
                  )}
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <span className="text-xs text-[var(--text-muted)]">
                      {item.qty} adet
                    </span>
                    <span className="text-xs text-[var(--text-muted)]">×</span>
                    <span className="text-xs font-medium text-[var(--text)]">
                      {formatPrice(item.unitPrice, order.currency)}
                    </span>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <span className="text-sm font-bold text-[var(--text)]">
                    {formatPrice(item.unitPrice * item.qty, order.currency)}
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ul>

        {/* Price breakdown */}
        <div className="border-t border-[var(--border)] bg-[var(--surface-muted)] px-5 py-4">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between text-[var(--text-muted)]">
              <dt>Ara toplam</dt>
              <dd className="font-medium text-[var(--text)]">
                {formatPrice(subtotal, order.currency)}
              </dd>
            </div>
            <div className="flex justify-between text-[var(--text-muted)]">
              <dt>%{kdvRate} KDV</dt>
              <dd className="font-medium text-[var(--text)]">
                {formatPrice(kdvAmount, order.currency)}
              </dd>
            </div>
            <div className="flex justify-between text-[var(--text-muted)]">
              <dt>Kargo</dt>
              <dd className="font-medium text-[var(--text)]">
                {shipping > 0
                  ? formatPrice(shipping, order.currency)
                  : "Ücretsiz"}
              </dd>
            </div>
            {packagingCost > 0 ? (
              <div className="flex justify-between text-[var(--text-muted)]">
                <dt>
                  Paketleme
                  {typeof order.packagingUnitFee === "number" &&
                  order.packagingUnitFee > 0 ? (
                    <span className="ml-1 text-xs">
                      ({formatPrice(order.packagingUnitFee, order.currency)}/birim)
                    </span>
                  ) : null}
                </dt>
                <dd className="font-medium text-[var(--text)]">
                  {formatPrice(packagingCost, order.currency)}
                </dd>
              </div>
            ) : null}
            <div className="flex justify-between border-t border-[var(--border)] pt-2.5">
              <dt className="text-base font-bold text-[var(--text)]">
                Toplam
              </dt>
              <dd className="text-base font-bold text-[var(--brand-blue)]">
                {formatPrice(order.total, order.currency)}
              </dd>
            </div>
            {cardCommission !== null ? (
              <>
                <div className="flex justify-between text-[var(--text-muted)]">
                  <dt>
                    Kart Komisyonu
                    {Number.isFinite(cardCommissionRate) &&
                    cardCommissionRate > 0
                      ? ` (%${cardCommissionRate})`
                      : ""}
                  </dt>
                  <dd className="font-medium text-[var(--text)]">
                    {formatPrice(cardCommission, order.currency)}
                  </dd>
                </div>
                <div className="flex justify-between border-t border-[var(--border)] pt-2.5">
                  <dt className="text-base font-bold text-[var(--text)]">
                    Ödenen Toplam
                  </dt>
                  <dd className="text-base font-bold text-[var(--brand-blue)]">
                    {formatPrice(order.total + cardCommission, order.currency)}
                  </dd>
                </div>
              </>
            ) : null}
          </dl>
        </div>
      </div>

      {/* Addresses */}
      <div className="grid gap-4 sm:grid-cols-2">
        <AddressCard
          title="Teslimat adresi"
          address={order.shippingAddress}
          icon={
            <svg
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
          }
        />
        <AddressCard
          title="Fatura adresi"
          address={order.billingAddress ?? order.shippingAddress}
          icon={
            <svg
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
          }
        />
      </div>

      {/* Payment info */}
      {(order.paymentMethod || order.paymentStatus) && (
        <SectionCard title="Ödeme bilgisi">
          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            {order.paymentMethod && (
              <div>
                <dt className="text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">
                  Ödeme yöntemi
                </dt>
                <dd className="mt-1 font-semibold text-[var(--text)]">
                  {order.paymentMethod === "cari_balance"
                    ? "Cari Hesap"
                    : order.paymentMethod === "card"
                      ? "Kredi Kartı"
                      : order.paymentMethod}
                  {cardCommission !== null ? (
                    <span className="ml-2 text-xs font-medium text-[var(--text-muted)]">
                      (Kart komisyonu:{" "}
                      {formatPrice(cardCommission, order.currency)})
                    </span>
                  ) : null}
                </dd>
              </div>
            )}
            {order.paymentStatus && (
              <div>
                <dt className="text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">
                  Ödeme durumu
                </dt>
                <dd className="mt-1 font-semibold text-[var(--text)]">
                  {order.paymentStatus === "approved"
                    ? "Onaylandı"
                    : order.paymentStatus === "pending"
                      ? "Beklemede"
                      : order.paymentStatus === "rejected"
                        ? "Reddedildi"
                        : order.paymentStatus}
                </dd>
              </div>
            )}
          </dl>
          {/* Tahsilat makbuzu — yalnızca kredi kartıyla ödenmiş siparişlerde. */}
          {order.paymentMethod === "card" && order.hasReceipt ? (
            <div className="mt-4 border-t border-[var(--border)] pt-4">
              <ReceiptButton
                kind="order"
                id={order.id}
                variant="button"
                label="Tahsilat makbuzunu görüntüle"
              />
            </div>
          ) : null}
        </SectionCard>
      )}

      {/* Faturalandırma — aylık toplu fatura (BirFatura) */}
      {order.invoiceBatch && (
        <SectionCard title="Faturalandırma">
          <div className="space-y-4 text-sm">
            <p className="text-[var(--text)]">
              Bu sipariş{" "}
              <strong className="font-semibold">
                {order.invoiceBatch.monthLabel}
              </strong>{" "}
              toplu faturasına dahildir.
            </p>
            {(order.invoiceBatch.invoiceNumber ||
              order.invoiceBatch.invoiceDate) && (
              <dl className="grid gap-4 sm:grid-cols-2">
                {order.invoiceBatch.invoiceNumber && (
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">
                      Fatura no
                    </dt>
                    <dd className="mt-1 font-semibold text-[var(--text)]">
                      {order.invoiceBatch.invoiceNumber}
                    </dd>
                  </div>
                )}
                {order.invoiceBatch.invoiceDate && (
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">
                      Fatura tarihi
                    </dt>
                    <dd className="mt-1 font-semibold text-[var(--text)]">
                      {formatDate(order.invoiceBatch.invoiceDate)}
                    </dd>
                  </div>
                )}
              </dl>
            )}
            <div className="flex flex-wrap items-center gap-3">
              {isSafeUrl(order.invoiceBatch.invoiceUrl) ? (
                <a
                  href={order.invoiceBatch.invoiceUrl as string}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--brand-blue)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--brand-navy)]"
                >
                  <svg
                    className="h-3.5 w-3.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                    />
                  </svg>
                  Faturayı indir
                </a>
              ) : (
                <p className="rounded-lg bg-[var(--surface-muted)] px-3 py-2 text-xs text-[var(--text-muted)]">
                  {order.invoiceBatch.status === "cancelled"
                    ? "Bu toplu fatura iptal edilmiştir."
                    : "Faturanız ay sonu kesim gününde oluşturulacaktır; hazır olduğunda buradan indirebileceksiniz."}
                </p>
              )}
              <Link
                href="/hesabim/faturalarim"
                className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--border)] bg-white px-4 py-2 text-sm font-semibold text-[var(--text)] transition hover:bg-[var(--surface-muted)]"
              >
                Tüm faturalarım
              </Link>
            </div>
          </div>
        </SectionCard>
      )}

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}

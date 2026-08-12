import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  fetchOrder,
  formatOrderNo,
  ORDER_STATUS_LABELS,
  type OrderDetail,
  type OrderItem,
  type OrderStatus,
} from "../../lib/orders";
import { getCarrierTrackingUrl } from "../../lib/cargo-tracking";
import { storefrontProductUrl } from "../../lib/urls";
import { canAccess } from "../../lib/permissions";

/**
 * Sipariş bağlı destek talebi açıldığında drawer içinde sipariş detayını
 * (ürünler, fiyat, KDV, kargo, ödeme) lazy-load eden panel. Admin müşterinin
 * iptal/iade talebini değerlendirirken siparişin tam içeriğini tek bakışta
 * görmek için kullanır.
 */
interface Props {
  orderId: string;
  /** Liste satırından bilinen fallback no — fetch tamamlanana kadar gösterilir. */
  orderNumberHint?: string | null;
  /** Talepten bilinen kargo firması — sipariş kaydında yoksa fallback. */
  carrier?: string | null;
  /** Talepten bilinen kargo takip kodu — sipariş kaydında yoksa fallback. */
  trackingCode?: string | null;
  /** Talepten bilinen satış kanalı — sipariş kaydında yoksa fallback. */
  marketplace?: string | null;
}

const TERMINAL_STATUSES: ReadonlyArray<OrderStatus> = ["cancelled", "refunded"];

function formatTRY(value: number | undefined | null): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  try {
    return new Intl.NumberFormat("tr-TR", {
      style: "currency",
      currency: "TRY",
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ₺`;
  }
}

function statusTone(status: OrderStatus): string {
  if (TERMINAL_STATUSES.includes(status)) {
    return "bg-red-50 text-red-700 border-red-200";
  }
  if (status === "shipped") {
    return "bg-emerald-50 text-emerald-700 border-emerald-200";
  }
  if (status === "paid") {
    return "bg-blue-50 text-blue-700 border-blue-200";
  }
  return "bg-amber-50 text-amber-800 border-amber-200";
}

function OrderItemRow({ item }: { item: OrderItem }): React.ReactElement {
  return (
    <div className="flex items-start gap-3 border-b border-[var(--color-border)] py-2.5 last:border-b-0">
      <div className="h-12 w-12 shrink-0 overflow-hidden rounded-md border border-[var(--color-border)] bg-white">
        {item.imageUrl ? (
          <img
            src={item.imageUrl}
            alt={item.productName}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[10px] text-[var(--color-text-muted)]">
            Görsel yok
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-[var(--color-text)]">
          {(() => {
            const href = storefrontProductUrl(item.productSlug);
            if (href) {
              return (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[var(--color-brand-blue)] hover:underline"
                  title="Katalogda aç"
                >
                  {item.productName}
                </a>
              );
            }
            return item.productName;
          })()}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-[var(--color-text-muted)]">
          {item.sku ? <span>SKU: {item.sku}</span> : null}
          {item.supplierSku ? <span>Ted. Kodu: {item.supplierSku}</span> : null}
          {item.supplier?.name ? <span>{item.supplier.name}</span> : null}
        </div>
      </div>
      <div className="shrink-0 text-right text-xs">
        <div className="font-mono text-[var(--color-text)]">
          {item.quantity} × {formatTRY(item.unitPrice)}
        </div>
        <div className="mt-0.5 font-semibold text-[var(--color-text)]">
          {formatTRY(item.total)}
        </div>
      </div>
    </div>
  );
}

export function TicketOrderPanel({
  orderId,
  orderNumberHint,
  carrier: carrierProp,
  trackingCode: trackingCodeProp,
  marketplace: marketplaceProp,
}: Props): React.ReactElement | null {
  // Sipariş detayı ucu 'orders' iznine bağlı — izinsiz çalışanda 403 dönüp
  // kırmızı "Sipariş alınamadı" kutusu kalırdı; sorguyu atmayıp paneli gizle.
  const allowed = canAccess("orders");
  const query = useQuery<OrderDetail>({
    queryKey: ["ticket-order-detail", orderId],
    queryFn: () => fetchOrder(orderId),
    staleTime: 30_000,
    enabled: allowed,
  });

  if (!allowed) return null;

  const order = query.data;
  const displayNo = order
    ? formatOrderNo(order.humanOrderNo, order.orderNumber)
    : formatOrderNo(orderNumberHint, orderId.slice(0, 8));

  // Kargo bilgisi tek kaynak: önce sipariş kaydı, yoksa talepten gelen fallback.
  const marketplace = order?.marketplace ?? marketplaceProp ?? null;
  const carrier = order?.cargoCompany ?? carrierProp ?? null;
  const trackingCode =
    order?.trackingNumber ?? order?.cargoBarcode ?? trackingCodeProp ?? null;
  const trackingUrl = getCarrierTrackingUrl(carrier, trackingCode);

  return (
    <section className="mt-4 rounded-md border border-[var(--color-border)] bg-white">
      <header className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
            Sipariş İçeriği
          </div>
          <div className="mt-0.5 text-sm font-medium text-[var(--color-text)]">
            <Link
              to={`/orders/${orderId}`}
              className="text-[var(--color-brand-blue)] hover:underline"
            >
              #{displayNo}
            </Link>
          </div>
        </div>
        {order ? (
          <span
            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${statusTone(
              order.status,
            )}`}
          >
            {ORDER_STATUS_LABELS[order.status]}
          </span>
        ) : null}
      </header>

      <div className="p-3">
        {query.isLoading ? (
          <div className="py-6 text-center text-xs text-[var(--color-text-muted)]">
            Sipariş yükleniyor…
          </div>
        ) : query.isError ? (
          <div className="flex items-center justify-between rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
            <span>
              {query.error instanceof Error
                ? query.error.message
                : "Sipariş alınamadı"}
            </span>
            <button
              type="button"
              onClick={() => void query.refetch()}
              className="rounded-md border border-red-300 bg-white px-2 py-0.5 text-[11px] hover:bg-red-100"
            >
              Tekrar dene
            </button>
          </div>
        ) : !order ? (
          <div className="py-6 text-center text-xs text-[var(--color-text-muted)]">
            Sipariş bulunamadı.
          </div>
        ) : (
          <>
            <div className="mb-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs sm:grid-cols-3">
              <div>
                <dt className="text-[var(--color-text-muted)]">Satış Kanalı</dt>
                <dd className="font-medium text-[var(--color-text)]">
                  {marketplace ?? "—"}
                </dd>
              </div>
              <div>
                <dt className="text-[var(--color-text-muted)]">Kargo Firması</dt>
                <dd className="font-medium text-[var(--color-text)]">
                  {carrier ?? "—"}
                </dd>
              </div>
              <div>
                <dt className="text-[var(--color-text-muted)]">Sipariş Tarihi</dt>
                <dd className="font-medium text-[var(--color-text)]">
                  {new Date(order.createdAt).toLocaleString("tr-TR")}
                </dd>
              </div>
              {order.supplierOrderNo ? (
                <div>
                  <dt className="text-[var(--color-text-muted)]">Tedarikçi Sip. No</dt>
                  <dd className="font-medium text-[var(--color-text)]">
                    <span className="font-mono">{order.supplierOrderNo}</span>
                  </dd>
                </div>
              ) : null}
              {trackingCode ? (
                <div className="col-span-2 sm:col-span-3">
                  <dt className="text-[var(--color-text-muted)]">Kargo Takip Kodu</dt>
                  <dd className="flex flex-wrap items-center gap-2">
                    <span className="break-all font-mono text-[var(--color-text)]">
                      {trackingCode}
                    </span>
                    {trackingUrl ? (
                      <a
                        href={trackingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 rounded-md bg-[var(--color-brand-blue)] px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-[var(--color-brand-navy)]"
                      >
                        Kargo Takip <span aria-hidden="true">↗</span>
                      </a>
                    ) : null}
                  </dd>
                </div>
              ) : null}
            </div>

            <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2">
              {order.items.length === 0 ? (
                <div className="py-4 text-center text-xs text-[var(--color-text-muted)]">
                  Bu siparişte ürün satırı bulunmuyor.
                </div>
              ) : (
                order.items.map((it) => <OrderItemRow key={it.id} item={it} />)
              )}
            </div>

            <dl className="mt-3 space-y-1 text-xs">
              {order.subtotal !== undefined ? (
                <div className="flex justify-between">
                  <dt className="text-[var(--color-text-muted)]">Ara Toplam</dt>
                  <dd className="font-mono text-[var(--color-text)]">
                    {formatTRY(order.subtotal)}
                  </dd>
                </div>
              ) : null}
              {order.shippingFee !== undefined && order.shippingFee > 0 ? (
                <div className="flex justify-between">
                  <dt className="text-[var(--color-text-muted)]">Kargo</dt>
                  <dd className="font-mono text-[var(--color-text)]">
                    {formatTRY(order.shippingFee)}
                  </dd>
                </div>
              ) : null}
              {typeof order.packagingCost === "number" && order.packagingCost > 0 ? (
                <div className="flex justify-between">
                  <dt className="text-[var(--color-text-muted)]">Paketleme</dt>
                  <dd className="font-mono text-[var(--color-text)]">
                    {formatTRY(order.packagingCost)}
                  </dd>
                </div>
              ) : null}
              <div className="flex justify-between border-t border-[var(--color-border)] pt-1.5 text-sm">
                <dt className="font-semibold text-[var(--color-text)]">
                  Toplam
                </dt>
                <dd className="font-mono font-semibold text-[var(--color-text)]">
                  {formatTRY(order.total)}
                </dd>
              </div>
            </dl>
          </>
        )}
      </div>
    </section>
  );
}

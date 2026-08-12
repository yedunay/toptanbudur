"use client";

import { ChevronLeft, ChevronRight, Eye, Loader2, XCircle } from "lucide-react";
import type { TicketStatus, TicketTableItem } from "./types";

const STATUS_CLASS: Record<TicketStatus, string> = {
  NEW: "bg-red-50 text-red-700 border-red-200",
  READ: "bg-red-50 text-red-700 border-red-200",
  REPLIED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  ARCHIVED: "bg-slate-50 text-slate-500 border-slate-200",
};

const CATEGORY_CLASS: Record<string, string> = {
  siparis: "bg-blue-50 text-blue-700",
  fatura: "bg-purple-50 text-purple-700",
  iade: "bg-amber-50 text-amber-700",
  teknik: "bg-cyan-50 text-cyan-700",
  odeme: "bg-emerald-50 text-emerald-700",
  urun: "bg-orange-50 text-orange-700",
  kargo: "bg-rose-50 text-rose-700",
  hesap: "bg-indigo-50 text-indigo-700",
  iptal: "bg-red-50 text-red-700",
};

/** Talep satırındaki ilk ürün görseli — yoksa nötr yer tutucu gösterilir. */
function ProductThumb({
  src,
  alt,
  count,
}: {
  src: string | null;
  alt: string | null;
  count: number;
}) {
  return (
    <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-xl border border-[var(--border)] bg-slate-50">
      {src ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={src}
          alt={alt ?? "Ürün görseli"}
          className="h-full w-full object-cover"
          loading="lazy"
        />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-center text-[9px] font-semibold leading-tight text-slate-400">
          Görsel
          <br />
          yok
        </span>
      )}
      {count > 1 ? (
        <span className="absolute -right-1 -top-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full border border-white bg-[var(--brand-blue)] px-1 text-[10px] font-black text-white">
          +{count - 1}
        </span>
      ) : null}
    </div>
  );
}

interface Props {
  items: TicketTableItem[];
  page: number;
  pageSize: number;
  totalItems: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  onViewDetail: (id: string) => void;
  /** Tanımlıysa müşteri talebi kendisi kapatabilir (yalnız açık talepler). */
  onCloseTicket?: (id: string) => void;
  /** Şu an kapatılmakta olan talebin id'si — buton spinner durumu için. */
  closingId?: string | null;
}

export function SupportTicketsTable({
  items,
  page,
  pageSize,
  totalItems,
  onPageChange,
  onPageSizeChange,
  onViewDetail,
  onCloseTicket,
  closingId,
}: Props) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

  return (
    <section className="rounded-3xl border border-[var(--border)] bg-white shadow-sm">
      {/* Desktop table */}
      <div className="hidden overflow-x-auto lg:block">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-[var(--border)] bg-[var(--surface-muted)] text-xs uppercase tracking-wide text-[var(--text-muted)]">
            <tr>
              <th className="px-4 py-3 font-black">Talep No</th>
              <th className="px-4 py-3 font-black">Ürün &amp; Konu</th>
              <th className="px-4 py-3 font-black">Müşteri</th>
              <th className="px-4 py-3 font-black">Kategori</th>
              <th className="px-4 py-3 font-black">Durum</th>
              <th className="px-4 py-3 font-black">Son Güncelleme</th>
              <th className="px-4 py-3 text-center font-black">İşlemler</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((item) => (
              <tr key={item.id} className="transition hover:bg-blue-50/30">
                <td className="px-4 py-4 align-top font-black text-[var(--text)]">
                  {item.ticketNo}
                </td>
                <td className="px-4 py-4 align-top">
                  <div className="flex items-start gap-3">
                    <ProductThumb
                      src={item.productImageUrl}
                      alt={item.productName}
                      count={item.itemCount}
                    />
                    <div className="min-w-0">
                      <p className="font-semibold text-[var(--text)]">
                        {item.subject}
                      </p>
                      {item.productName ? (
                        <p className="mt-0.5 max-w-[280px] truncate text-xs font-semibold text-[var(--brand-navy)]">
                          {item.productName}
                        </p>
                      ) : null}
                      <p className="mt-0.5 max-w-[280px] truncate text-xs text-[var(--text-muted)]">
                        {item.description}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-4 align-top">
                  {item.recipientName ? (
                    <span className="font-semibold text-[var(--text)]">
                      {item.recipientName}
                    </span>
                  ) : (
                    <span className="text-xs text-[var(--text-muted)]">—</span>
                  )}
                </td>
                <td className="px-4 py-4 align-top">
                  <span
                    className={`inline-flex rounded-lg px-2.5 py-1 text-xs font-black ${CATEGORY_CLASS[item.categoryKey] ?? "bg-slate-50 text-slate-600"}`}
                  >
                    {item.category}
                  </span>
                </td>
                <td className="px-4 py-4 align-top">
                  <span
                    className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-black ${STATUS_CLASS[item.status]}`}
                  >
                    {item.statusLabel}
                  </span>
                </td>
                <td className="px-4 py-4 align-top text-sm text-[var(--text)]">
                  <p>{item.updatedAt}</p>
                  {item.updatedBy ? (
                    <p className="text-xs text-[var(--text-muted)]">
                      {item.updatedBy}
                    </p>
                  ) : null}
                </td>
                <td className="px-4 py-4 align-top">
                  <div className="flex items-center justify-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => onViewDetail(item.id)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--text-muted)] transition hover:bg-slate-50"
                      aria-label="Detay görüntüle"
                    >
                      <Eye className="h-4 w-4" />
                    </button>
                    {onCloseTicket && item.canClose ? (
                      <button
                        type="button"
                        onClick={() => onCloseTicket(item.id)}
                        disabled={closingId === item.id}
                        className="inline-flex h-8 items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2 text-xs font-black text-rose-600 transition hover:bg-rose-100 disabled:opacity-50"
                        aria-label="Talebi kapat"
                      >
                        {closingId === item.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <XCircle className="h-3.5 w-3.5" />
                        )}
                        Kapat
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="space-y-3 p-4 lg:hidden">
        {items.map((item) => (
          <div
            key={item.id}
            className="rounded-2xl border border-[var(--border)] bg-white p-4 transition hover:bg-blue-50/30"
          >
            <button
              type="button"
              onClick={() => onViewDetail(item.id)}
              className="w-full text-left"
            >
              <div className="flex items-start gap-3">
                <ProductThumb
                  src={item.productImageUrl}
                  alt={item.productName}
                  count={item.itemCount}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs font-black text-[var(--text-muted)]">
                      {item.ticketNo}
                    </p>
                    <span
                      className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-black ${STATUS_CLASS[item.status]}`}
                    >
                      {item.statusLabel}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-sm font-semibold text-[var(--text)]">
                    {item.subject}
                  </p>
                  {item.productName ? (
                    <p className="mt-0.5 truncate text-xs font-semibold text-[var(--brand-navy)]">
                      {item.productName}
                    </p>
                  ) : null}
                  {item.recipientName ? (
                    <p className="mt-0.5 truncate text-xs text-[var(--text-muted)]">
                      <span className="text-slate-400">Müşteri: </span>
                      <span className="font-semibold text-[var(--text)]">
                        {item.recipientName}
                      </span>
                    </p>
                  ) : null}
                </div>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <span
                  className={`rounded-lg px-2 py-0.5 text-xs font-black ${CATEGORY_CLASS[item.categoryKey] ?? "bg-slate-50 text-slate-600"}`}
                >
                  {item.category}
                </span>
                <span className="text-xs text-[var(--text-muted)]">
                  {item.createdAt}
                </span>
              </div>
            </button>
            {onCloseTicket && item.canClose ? (
              <div className="mt-3 flex justify-end border-t border-slate-100 pt-3">
                <button
                  type="button"
                  onClick={() => onCloseTicket(item.id)}
                  disabled={closingId === item.id}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-black text-rose-600 transition hover:bg-rose-100 disabled:opacity-50"
                  aria-label="Talebi kapat"
                >
                  {closingId === item.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5" />
                  )}
                  Talebi Kapat
                </button>
              </div>
            ) : null}
          </div>
        ))}
      </div>

      {/* Pagination */}
      <div className="flex flex-col items-center justify-between gap-3 border-t border-[var(--border)] px-4 py-3 sm:flex-row">
        <p className="text-sm text-[var(--text-muted)]">
          Toplam {totalItems} talep
        </p>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--text-muted)] transition hover:bg-slate-50 disabled:opacity-40"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>

          {Array.from({ length: totalPages }, (_, i) => i + 1)
            .filter(
              (p) => p === 1 || p === totalPages || Math.abs(p - page) <= 1,
            )
            .map((p, idx, arr) => {
              const prev = arr[idx - 1];
              const showEllipsis = prev != null && p - prev > 1;
              return (
                <span key={p} className="flex items-center gap-1">
                  {showEllipsis ? (
                    <span className="px-1 text-[var(--text-muted)]">...</span>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => onPageChange(p)}
                    className={[
                      "inline-flex h-9 w-9 items-center justify-center rounded-lg text-sm font-black transition",
                      p === page
                        ? "bg-[var(--brand-blue)] text-white"
                        : "border border-[var(--border)] text-[var(--text)] hover:bg-slate-50",
                    ].join(" ")}
                  >
                    {p}
                  </button>
                </span>
              );
            })}

          <button
            type="button"
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--text-muted)] transition hover:bg-slate-50 disabled:opacity-40"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <select
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
          className="h-9 rounded-lg border border-[var(--border)] bg-white px-3 text-sm font-bold text-[var(--text)]"
        >
          <option value={10}>10 / sayfa</option>
          <option value={25}>25 / sayfa</option>
          <option value={50}>50 / sayfa</option>
        </select>
      </div>
    </section>
  );
}

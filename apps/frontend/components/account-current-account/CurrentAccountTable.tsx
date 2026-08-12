"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import {
  formatShortDate,
  formatTRY,
} from "@/components/account-balance/bakiyem-format";
import type {
  CurrentAccountPageMeta,
  CurrentAccountStatementRow,
  CurrentAccountTransactionType,
} from "./types";

interface CurrentAccountTableProps {
  rows: CurrentAccountStatementRow[];
  meta: CurrentAccountPageMeta;
  isLoading: boolean;
  onPageChange: (page: number) => void;
}

interface BadgeStyle {
  label: string;
  className: string;
}

const TYPE_BADGES: Record<CurrentAccountTransactionType, BadgeStyle> = {
  TOPUP: {
    label: "Yükleme",
    className: "bg-emerald-50 text-emerald-700 border border-emerald-200",
  },
  ORDER_PAYMENT: {
    label: "Sipariş",
    className: "bg-blue-50 text-blue-700 border border-blue-200",
  },
  REFUND: {
    label: "İptal Ücreti",
    className: "bg-amber-50 text-amber-700 border border-amber-200",
  },
  ADJUSTMENT: {
    label: "Düzeltme",
    className: "bg-slate-100 text-slate-700 border border-slate-200",
  },
};

function TypeBadge({ type }: { type: CurrentAccountTransactionType }) {
  const style = TYPE_BADGES[type];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${style.className}`}
    >
      {style.label}
    </span>
  );
}

export function CurrentAccountTable({
  rows,
  meta,
  isLoading,
  onPageChange,
}: CurrentAccountTableProps) {
  const hasRows = rows.length > 0;
  const canPrev = meta.page > 1 && !isLoading;
  const canNext = meta.page < meta.totalPages && !isLoading;

  return (
    <section className="overflow-hidden rounded-3xl border border-[var(--ab-border)] bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
        <div>
          <h2 className="text-base font-bold text-[var(--ab-text)]">
            Cari Hareket Ekstresi
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Toplam {meta.total} kayıt · Sayfa {meta.page} / {meta.totalPages}
          </p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[920px] text-sm">
          <thead className="bg-slate-50/70 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-5 py-3 text-left font-semibold">Tarih</th>
              <th className="px-5 py-3 text-left font-semibold">Açıklama</th>
              <th className="px-5 py-3 text-right font-semibold">
                Yüklenen (₺)
              </th>
              <th className="px-5 py-3 text-right font-semibold">
                Harcanan (₺)
              </th>
              <th className="px-5 py-3 text-right font-semibold">Bakiye (₺)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading && !hasRows ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-5 py-10 text-center text-sm text-slate-500"
                >
                  Yükleniyor…
                </td>
              </tr>
            ) : !hasRows ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-5 py-10 text-center text-sm text-slate-500"
                >
                  Seçilen filtrelere uygun cari hareket bulunamadı.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.id}
                  className="transition hover:bg-slate-50/60"
                >
                  <td className="whitespace-nowrap px-5 py-3 text-slate-700">
                    {formatShortDate(row.dateIso)}
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <TypeBadge type={row.type} />
                        {row.humanOrderNo ? (
                          row.orderId ? (
                            <Link
                              href={`/hesabim/siparislerim/${row.orderId}`}
                              className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--ab-blue)] underline-offset-2 transition hover:underline"
                              title="Siparişe git"
                            >
                              {row.humanOrderNo}
                              <ExternalLink
                                className="h-3 w-3"
                                aria-hidden="true"
                              />
                            </Link>
                          ) : (
                            <span className="text-xs font-semibold text-slate-500">
                              {row.humanOrderNo}
                            </span>
                          )
                        ) : null}
                      </div>
                      <span className="text-sm text-slate-800">
                        {row.description}
                      </span>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-5 py-3 text-right font-semibold text-emerald-600">
                    {row.loadedAmount !== null
                      ? formatTRY(row.loadedAmount)
                      : "—"}
                  </td>
                  <td className="whitespace-nowrap px-5 py-3 text-right font-semibold text-rose-600">
                    {row.spentAmount !== null
                      ? formatTRY(row.spentAmount)
                      : "—"}
                  </td>
                  <td className="whitespace-nowrap px-5 py-3 text-right font-bold">
                    <span
                      className={
                        row.balance < 0 ? "text-red-600" : "text-slate-800"
                      }
                    >
                      {formatTRY(row.balance)}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {meta.totalPages > 1 ? (
        <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3">
          <p className="text-xs font-semibold text-slate-500">
            Sayfa {meta.page} / {meta.totalPages}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onPageChange(meta.page - 1)}
              disabled={!canPrev}
              aria-label="Önceki sayfa"
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => onPageChange(meta.page + 1)}
              disabled={!canNext}
              aria-label="Sonraki sayfa"
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

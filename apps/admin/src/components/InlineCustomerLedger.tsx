import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  CARI_LEDGER_TYPE_LABELS,
  fetchCustomerCariLedger,
  type CariLedgerEntry,
  type CariLedgerResponse,
} from "../lib/customers";
import { formatSignedTRY, formatTRY, formatLedgerDate } from "../lib/cari-ledger";

interface InlineCustomerLedgerProps {
  customerId: string;
  customerName: string | null;
  currentBalance: number;
}

const INLINE_PAGE_SIZE = 10;

export default function InlineCustomerLedger({
  customerId,
  customerName,
  currentBalance,
}: InlineCustomerLedgerProps): React.ReactElement {
  const [page, setPage] = useState<number>(1);

  useEffect(() => {
    setPage(1);
  }, [customerId]);

  const ledgerQuery = useQuery<CariLedgerResponse>({
    queryKey: ["customer-cari-ledger", customerId, page, INLINE_PAGE_SIZE],
    queryFn: () => fetchCustomerCariLedger(customerId, page, INLINE_PAGE_SIZE),
    placeholderData: (prev) => prev,
  });

  const entries = ledgerQuery.data?.data ?? [];
  const total = ledgerQuery.data?.meta.total ?? entries.length;
  const totalPages = Math.max(ledgerQuery.data?.meta.totalPages ?? 1, 1);
  const rangeStart = total === 0 ? 0 : (page - 1) * INLINE_PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * INLINE_PAGE_SIZE, total);

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
            Cari Defter — {customerName ?? "Müşteri"}
          </div>
          <div className="text-base font-semibold text-[var(--color-text)]">
            Güncel Bakiye:{" "}
            <span
              className={
                currentBalance < 0
                  ? "text-red-600"
                  : currentBalance > 0
                    ? "text-emerald-700"
                    : "text-[var(--color-text)]"
              }
            >
              {formatTRY(currentBalance)}
            </span>
          </div>
        </div>
        <Link
          to={`/customers/${customerId}`}
          className="inline-flex items-center rounded-md border border-[var(--color-border)] bg-white px-2.5 py-1 text-xs text-[var(--color-text)] hover:bg-white hover:text-[var(--color-brand-blue)]"
        >
          Tam defteri aç →
        </Link>
      </div>

      {ledgerQuery.isLoading ? (
        <div className="rounded-md border border-[var(--color-border)] bg-white p-3 text-center text-xs text-[var(--color-text-muted)]">
          Defter yükleniyor…
        </div>
      ) : ledgerQuery.isError ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-center text-xs text-red-700">
          {ledgerQuery.error instanceof Error
            ? ledgerQuery.error.message
            : "Defter alınamadı"}
        </div>
      ) : entries.length === 0 ? (
        <div className="rounded-md border border-[var(--color-border)] bg-white p-3 text-center text-xs text-[var(--color-text-muted)]">
          Bu müşteri için henüz cari hareket yok.
        </div>
      ) : (
        <div className="rounded-md border border-[var(--color-border)] bg-white overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]">
              <tr>
                <th className="px-3 py-1.5 text-left font-medium">Tip</th>
                <th className="px-3 py-1.5 text-right font-medium">Tutar</th>
                <th className="px-3 py-1.5 text-right font-medium">
                  Sonraki Bakiye
                </th>
                <th className="px-3 py-1.5 text-left font-medium">Açıklama</th>
                <th className="px-3 py-1.5 text-left font-medium">Tarih</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e: CariLedgerEntry) => {
                const isPositive = e.amount > 0;
                const amountClass = isPositive
                  ? "text-emerald-700"
                  : e.amount < 0
                    ? "text-red-600"
                    : "text-[var(--color-text)]";
                return (
                  <tr
                    key={e.id}
                    className="border-t border-[var(--color-border)]"
                  >
                    <td className="px-3 py-1.5">
                      <span className="inline-flex items-center rounded-full bg-[var(--color-surface-muted)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-text)]">
                        {CARI_LEDGER_TYPE_LABELS[e.type]}
                      </span>
                    </td>
                    <td
                      className={`px-3 py-1.5 text-right tabular-nums font-medium ${amountClass}`}
                    >
                      {formatSignedTRY(e.amount)}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-[var(--color-text-muted)]">
                      {formatTRY(e.balanceAfter)}
                    </td>
                    <td
                      className="px-3 py-1.5 text-[var(--color-text-muted)] max-w-[280px] truncate"
                      title={e.description ?? ""}
                    >
                      {e.description ?? "—"}
                      {e.humanOrderNo ? (
                        <span className="ml-1 text-[10px] text-[var(--color-text-muted)]">
                          · #{e.humanOrderNo}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-1.5 text-[var(--color-text-muted)]">
                      {formatLedgerDate(e.createdAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-1.5">
            <p
              aria-live="polite"
              className="text-[10px] text-[var(--color-text-muted)] tabular-nums"
            >
              {rangeStart}-{rangeEnd} / {total} kayıt
              {ledgerQuery.isFetching ? " · Yükleniyor…" : ""}
            </p>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1 || ledgerQuery.isFetching}
                className="rounded-md border border-[var(--color-border)] bg-white px-2 py-0.5 text-[10px] hover:bg-[var(--color-surface-muted)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                ← Önceki
              </button>
              <span className="text-[10px] text-[var(--color-text-muted)] tabular-nums">
                {page} / {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages || ledgerQuery.isFetching}
                className="rounded-md border border-[var(--color-border)] bg-white px-2 py-0.5 text-[10px] hover:bg-[var(--color-surface-muted)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Sonraki →
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

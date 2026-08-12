import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  CARI_PAYMENT_FILTERS,
  CARI_PAYMENT_FILTER_LABELS,
  CARI_PAYMENT_STATUS_LABELS,
  decideCariPayment,
  fetchCariPayments,
  formatCariPaymentDate,
  type CariPayment,
  type CariPaymentDecision,
  type CariPaymentFilter,
  type CariPaymentStatus,
  type CariPaymentsResponse,
} from "../lib/cari-payments";
import { formatAmount } from "../lib/format";
import { useToast } from "./Toast";
import ConfirmDialog from "./ConfirmDialog";

function statusBadgeClass(status: CariPaymentStatus): string {
  switch (status) {
    case "approved":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "rejected":
      return "bg-red-50 text-red-700 border-red-200";
    default:
      return "bg-amber-50 text-amber-700 border-amber-200";
  }
}

interface PendingDecision {
  payment: CariPayment;
  decision: CariPaymentDecision;
}

interface CariPaymentsPanelProps {
  enabled: boolean;
}

export default function CariPaymentsPanel({
  enabled,
}: CariPaymentsPanelProps): React.ReactElement {
  const queryClient = useQueryClient();
  const toast = useToast();

  const [filter, setFilter] = useState<CariPaymentFilter>("pending");
  const [pending, setPending] = useState<PendingDecision | null>(null);

  const paymentsQuery = useQuery<CariPaymentsResponse>({
    queryKey: ["cari-payments", filter],
    queryFn: () => fetchCariPayments(filter),
    enabled,
  });

  const decideMutation = useMutation({
    mutationFn: ({
      id,
      decision,
    }: {
      id: string;
      decision: CariPaymentDecision;
    }) => decideCariPayment(id, decision),
    onSuccess: (_data, variables) => {
      toast.push(
        "success",
        variables.decision === "approve"
          ? "Ödeme onaylandı"
          : "Ödeme reddedildi",
      );
      void queryClient.invalidateQueries({ queryKey: ["cari-payments"] });
    },
    onError: (err) => {
      toast.push(
        "error",
        err instanceof Error ? err.message : "İşlem başarısız",
      );
    },
  });

  const data = paymentsQuery.data;
  const payments = useMemo(() => data?.data ?? [], [data]);

  return (
    <section className="flex flex-col min-w-0">
      <header className="mb-4">
        <h2 className="text-lg font-semibold text-[var(--color-text)]">
          Cariden Ödemeler
        </h2>
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">
          Bayilerin bildirdiği banka havalesi/EFT ödemelerini onaylayın veya
          reddedin.
        </p>
      </header>

      <div className="mb-3 flex flex-wrap items-center gap-1 rounded-lg border border-[var(--color-border)] bg-white p-1 w-fit">
        {CARI_PAYMENT_FILTERS.map((value) => {
          const isActive = filter === value;
          return (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              className={`rounded-md px-3 py-1.5 text-xs transition-colors ${
                isActive
                  ? "bg-[var(--color-brand-blue)] text-white"
                  : "text-[var(--color-text)] hover:bg-[var(--color-surface-muted)]"
              }`}
              aria-pressed={isActive}
            >
              {CARI_PAYMENT_FILTER_LABELS[value]}
            </button>
          );
        })}
      </div>

      {paymentsQuery.isError ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {paymentsQuery.error instanceof Error
            ? paymentsQuery.error.message
            : "Veri alınamadı"}
        </div>
      ) : (
        <div className="rounded-xl border border-[var(--color-border)] bg-white overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]">
                <tr>
                  <th className="px-3 py-2 text-left">Sipariş</th>
                  <th className="px-3 py-2 text-left">Müşteri</th>
                  <th className="px-3 py-2 text-right">Tutar</th>
                  <th className="px-3 py-2 text-left">Tarih</th>
                  <th className="px-3 py-2 text-center">Durum</th>
                  <th className="px-3 py-2 text-right">İşlem</th>
                </tr>
              </thead>
              <tbody>
                {paymentsQuery.isLoading ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-3 py-8 text-center text-[var(--color-text-muted)]"
                    >
                      Yükleniyor…
                    </td>
                  </tr>
                ) : payments.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-3 py-8 text-center text-[var(--color-text-muted)]"
                    >
                      Kayıt bulunamadı
                    </td>
                  </tr>
                ) : (
                  payments.map((p) => {
                    const orderLabel =
                      p.orderNumber ??
                      (p.orderId ? p.orderId.slice(0, 8) : "—");
                    return (
                      <tr
                        key={p.id}
                        className="border-t border-[var(--color-border)] hover:bg-[var(--color-surface-muted)]"
                      >
                        <td className="px-3 py-2 font-medium">
                          {p.orderId ? (
                            <Link
                              to={`/orders/${p.orderId}`}
                              className="text-[var(--color-brand-blue)] hover:underline"
                            >
                              {orderLabel}
                            </Link>
                          ) : (
                            <span>{orderLabel}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-[var(--color-text-muted)]">
                          <div className="flex flex-col">
                            <span className="text-[var(--color-text)]">
                              {p.customerName ?? "—"}
                            </span>
                            {p.customerEmail ? (
                              <span className="text-xs">
                                {p.customerEmail}
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {formatAmount(p.amount)}
                        </td>
                        <td className="px-3 py-2 text-[var(--color-text-muted)]">
                          {formatCariPaymentDate(p.requestedAt)}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium border ${statusBadgeClass(p.status)}`}
                          >
                            {CARI_PAYMENT_STATUS_LABELS[p.status]}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          {p.status === "pending" ? (
                            <div className="flex items-center justify-end gap-1">
                              <button
                                type="button"
                                onClick={() =>
                                  setPending({
                                    payment: p,
                                    decision: "approve",
                                  })
                                }
                                disabled={decideMutation.isPending}
                                className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs text-white hover:bg-emerald-700 disabled:opacity-60"
                              >
                                Onayla
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setPending({
                                    payment: p,
                                    decision: "reject",
                                  })
                                }
                                disabled={decideMutation.isPending}
                                className="rounded-md border border-red-200 bg-white px-2.5 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-60"
                              >
                                Reddet
                              </button>
                            </div>
                          ) : (
                            <span className="text-xs text-[var(--color-text-muted)]">
                              —
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {pending ? (
        <ConfirmDialog
          title={
            pending.decision === "approve"
              ? "Ödemeyi onayla"
              : "Ödemeyi reddet"
          }
          message={
            pending.decision === "approve"
              ? `${formatAmount(pending.payment.amount)} tutarındaki ödeme onaylanacak. Devam edilsin mi?`
              : `${formatAmount(pending.payment.amount)} tutarındaki ödeme reddedilecek. Devam edilsin mi?`
          }
          confirmLabel={pending.decision === "approve" ? "Onayla" : "Reddet"}
          destructive={pending.decision === "reject"}
          onCancel={() => setPending(null)}
          onConfirm={() => {
            const { payment, decision } = pending;
            setPending(null);
            decideMutation.mutate({ id: payment.id, decision });
          }}
        />
      ) : null}
    </section>
  );
}

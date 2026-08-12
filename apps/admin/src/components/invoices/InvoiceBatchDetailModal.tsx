import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  cancelInvoiceBatch,
  fetchInvoiceBatch,
  type InvoiceBatchDetail,
} from "../../lib/invoices";
import { formatAmount } from "../../lib/format";
import { useToast } from "../Toast";
import ConfirmDialog from "../ConfirmDialog";
import {
  batchStatusBadge,
  formatDateOnly,
  formatDateTime,
  paymentTypeLabel,
} from "./invoiceFormat";

/**
 * Tek InvoiceBatch tam detayı (birfatura.md §9): başlık (bayi, ödeme tipi,
 * dönem, durum, fatura no/link), üye siparişler ve §2 motoruyla hesaplanmış
 * kalem dökümü ("Kargo Bedeli" satırı dahil) + toplamlar.
 */

interface InvoiceBatchDetailModalProps {
  batchId: string;
  onClose: () => void;
}

export default function InvoiceBatchDetailModal({
  batchId,
  onClose,
}: InvoiceBatchDetailModalProps): React.ReactElement {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);

  const query = useQuery<InvoiceBatchDetail>({
    queryKey: ["admin-invoice-batch", batchId],
    queryFn: () => fetchInvoiceBatch(batchId),
  });

  const batch = query.data;

  // Sadece DONMUŞ batch iptal edilebilir; faturalanmış/iptal edilmiş gizler.
  const canCancel = String(batch?.status ?? "").toLowerCase() === "frozen";

  const cancelMutation = useMutation({
    mutationFn: () => cancelInvoiceBatch(batchId),
    onSuccess: (updated: InvoiceBatchDetail) => {
      setCancelConfirmOpen(false);
      toast.push(
        "success",
        `Batch iptal edildi — ${updated.orderCount} sipariş serbest bırakıldı.`,
      );
      // Detayı tazele (rozet "İptal" olur) + liste sayfasını invalidate et.
      queryClient.setQueryData(["admin-invoice-batch", batchId], updated);
      queryClient.invalidateQueries({ queryKey: ["admin-invoice-batches"] });
    },
    onError: (err: unknown) => {
      setCancelConfirmOpen(false);
      toast.push(
        "error",
        err instanceof Error ? err.message : "Batch iptal edilemedi",
      );
    },
  });

  return (
    <>
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/40 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="batch-detail-title"
        className="my-8 w-full max-w-3xl rounded-2xl border border-[var(--color-border)] bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-[var(--color-border)] px-6 py-4">
          <div>
            <h2
              id="batch-detail-title"
              className="text-lg font-semibold text-[var(--color-text)]"
            >
              Konsolide Fatura Detayı
            </h2>
            <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
              {batch ? `${batch.members.length} sipariş` : "Yükleniyor…"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-[var(--color-border)] bg-white px-2.5 py-1.5 text-sm text-[var(--color-text-muted)] transition hover:bg-slate-50"
            aria-label="Kapat"
          >
            ×
          </button>
        </header>

        <div className="px-6 py-5">
          {query.isLoading ? (
            <p className="text-sm text-[var(--color-text-muted)]">
              Detay yükleniyor…
            </p>
          ) : query.isError || !batch ? (
            <p className="text-sm text-red-600">
              {query.error instanceof Error
                ? query.error.message
                : "Fatura detayı yüklenemedi"}
            </p>
          ) : (
            <BatchBody batch={batch} />
          )}
        </div>

        {/* İptal aksiyonu — yalnız donmuş batch'lerde (birfatura.md §12.9) */}
        {batch && canCancel ? (
          <footer className="flex items-center justify-between gap-4 border-t border-[var(--color-border)] bg-slate-50/60 px-6 py-4">
            <p className="text-xs text-[var(--color-text-muted)]">
              İptal, bu kesimi geri alır ve üye siparişleri yeniden faturalanabilir
              hâle getirir (sonraki kesime dahil olurlar).
            </p>
            <button
              type="button"
              onClick={() => setCancelConfirmOpen(true)}
              disabled={cancelMutation.isPending}
              className="shrink-0 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {cancelMutation.isPending ? "İptal ediliyor…" : "Batch'i İptal Et"}
            </button>
          </footer>
        ) : null}
      </div>
    </div>

      {/* İptal onayı — onClose backdrop'unun dışında (fragment kardeşi) ki
          onay diyaloğunun arka planına tıklamak tüm modalı kapatmasın. */}
      {batch ? (
        <ConfirmDialog
          open={cancelConfirmOpen}
          title="Batch'i iptal et?"
          message={`${batch.customerName} — ${batch.orderCode} kesimi iptal edilecek. ${batch.orderCount} üye sipariş serbest bırakılacak ve bir sonraki kesimde yeniden değerlendirilecek. Faturalanmış batch'ler iptal edilemez.`}
          confirmLabel="Evet, iptal et"
          cancelLabel="Vazgeç"
          destructive
          onConfirm={() => cancelMutation.mutate()}
          onCancel={() => setCancelConfirmOpen(false)}
        />
      ) : null}
    </>
  );
}

function BatchBody({
  batch,
}: {
  batch: InvoiceBatchDetail;
}): React.ReactElement {
  const badge = batchStatusBadge(batch.status);
  return (
    <div className="space-y-6">
      {/* Başlık özeti */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Field label="Bayi" value={batch.customerName} />
        <Field
          label="Ödeme Tipi"
          value={`${paymentTypeLabel(batch.paymentType, batch.paymentTypeLabel)} (${batch.paymentTypeId})`}
        />
        <Field
          label="Dönem"
          value={`${formatDateOnly(batch.periodStart)} → ${formatDateOnly(batch.periodEnd)}`}
        />
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
            Durum
          </p>
          <span
            className={`mt-1 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${badge.className}`}
          >
            {badge.label}
          </span>
        </div>
        <Field label="Sentetik OrderId" value={batch.birfaturaOrderId} mono />
        <Field
          label="Fatura No"
          value={batch.invoiceNumber ?? "—"}
          mono
        />
        <Field
          label="Fatura Tarihi"
          value={formatDateOnly(batch.invoiceDate)}
        />
        <Field
          label="Faturalandı"
          value={formatDateTime(batch.invoicedAt)}
        />
      </div>

      {batch.invoiceUrl ? (
        <a
          href={batch.invoiceUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 rounded-lg border border-[var(--color-brand-blue)]/30 bg-[var(--color-brand-blue)]/5 px-3 py-2 text-sm font-medium text-[var(--color-brand-blue)] transition hover:bg-[var(--color-brand-blue)]/10"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
          </svg>
          Fatura PDF'ini aç
        </a>
      ) : null}

      {/* Üye siparişler */}
      <section>
        <h3 className="mb-2 text-sm font-semibold text-[var(--color-text)]">
          Üye Siparişler ({batch.members.length})
        </h3>
        <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
              <tr>
                <th className="px-3 py-2 font-medium">Sipariş No</th>
                <th className="px-3 py-2 font-medium">Durum</th>
                <th className="px-3 py-2 font-medium">Kargo</th>
                <th className="px-3 py-2 text-right font-medium">Adet</th>
                <th className="px-3 py-2 text-right font-medium">Tutar (KDV dahil)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {batch.members.map((m) => (
                <tr key={m.id}>
                  <td className="px-3 py-2 font-mono text-xs text-[var(--color-text)]">
                    {m.humanOrderNo}
                  </td>
                  <td className="px-3 py-2 text-xs text-[var(--color-text-muted)]">
                    {m.status}
                  </td>
                  <td className="px-3 py-2 text-xs text-[var(--color-text-muted)]">
                    {formatDateOnly(m.shippedAt)}
                  </td>
                  <td className="px-3 py-2 text-right text-[var(--color-text)]">
                    {m.quantity}
                  </td>
                  <td className="px-3 py-2 text-right text-[var(--color-text)]">
                    {formatAmount(m.totalTaxIncluding)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Kalem dökümü */}
      <section>
        <h3 className="mb-2 text-sm font-semibold text-[var(--color-text)]">
          Kalem Dökümü ({batch.lines.length})
        </h3>
        <InvoiceLinesTable lines={batch.lines} />
      </section>

      {/* Toplamlar */}
      <section className="rounded-lg border border-[var(--color-border)] bg-slate-50/60 p-4">
        <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <TotalRow label="Toplam adet" value={String(batch.totalQuantity)} />
          <TotalRow label="Sipariş sayısı" value={String(batch.orderCount)} />
          <TotalRow
            label="Mal Hizmet Toplam Tutarı"
            value={formatAmount(batch.productsTotalTaxExcluding)}
          />
          <TotalRow label="Toplam İskonto" value={formatAmount(0)} />
          <TotalRow
            label="Hesaplanan KDV (%20)"
            value={formatAmount(
              batch.totalPaidTaxIncluding - batch.productsTotalTaxExcluding,
            )}
          />
          <TotalRow
            label="Vergiler Dahil Toplam Tutar"
            value={formatAmount(batch.totalPaidTaxIncluding)}
            strong
          />
        </dl>
      </section>
    </div>
  );
}

export function InvoiceLinesTable({
  lines,
}: {
  lines: InvoiceBatchDetail["lines"];
}): React.ReactElement {
  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
          <tr>
            <th className="px-3 py-2 font-medium">Sıra No</th>
            <th className="px-3 py-2 font-medium">Stok Kodu</th>
            <th className="px-3 py-2 font-medium">Mal Hizmet</th>
            <th className="px-3 py-2 text-right font-medium">Miktar</th>
            <th className="px-3 py-2 text-right font-medium">Birim Fiyat</th>
            <th className="px-3 py-2 text-right font-medium">KDV Oranı</th>
            <th className="px-3 py-2 text-right font-medium">KDV Tutarı</th>
            <th className="px-3 py-2 text-right font-medium">Mal Hizmet Tutarı</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-border)]">
          {lines.map((l, i) => (
            <tr key={`${l.productCode}-${i}`}>
              <td className="px-3 py-2 text-xs text-[var(--color-text-muted)]">
                {i + 1}
              </td>
              <td className="px-3 py-2 font-mono text-xs text-[var(--color-text-muted)]">
                {l.productCode || "—"}
              </td>
              {/* Mal Hizmet = sipariş no (önek) + ürün adı — BirFatura'ya giden ile birebir */}
              <td className="px-3 py-2 text-[var(--color-text)]">
                {l.orderCode ? `${l.orderCode} · ` : ""}
                {l.productName}
              </td>
              <td className="px-3 py-2 text-right text-[var(--color-text)]">
                {l.quantity} Adet
              </td>
              <td className="px-3 py-2 text-right text-[var(--color-text)]">
                {formatAmount(l.unitPriceTaxExcluding)}
              </td>
              <td className="px-3 py-2 text-right text-[var(--color-text-muted)]">
                %{l.vatRate}
              </td>
              <td className="px-3 py-2 text-right text-[var(--color-text)]">
                {formatAmount(l.lineTotalTaxIncluding - l.lineTotalTaxExcluding)}
              </td>
              <td className="px-3 py-2 text-right font-medium text-[var(--color-text)]">
                {formatAmount(l.lineTotalTaxExcluding)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}): React.ReactElement {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
        {label}
      </p>
      <p
        className={`mt-1 text-sm text-[var(--color-text)] ${mono ? "font-mono text-xs" : ""}`}
      >
        {value}
      </p>
    </div>
  );
}

function TotalRow({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}): React.ReactElement {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-sm text-[var(--color-text-muted)]">{label}</dt>
      <dd
        className={`text-sm ${strong ? "font-semibold text-[var(--color-text)]" : "text-[var(--color-text)]"}`}
      >
        {value}
      </dd>
    </div>
  );
}

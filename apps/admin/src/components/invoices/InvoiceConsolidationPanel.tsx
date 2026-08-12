import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchInvoiceBatches,
  freezeInvoices,
  type FreezeResult,
  type InvoiceBatchListResponse,
} from "../../lib/invoices";
import { useToast } from "../Toast";
import ConfirmDialog from "../ConfirmDialog";
import CustomerPicker, { type PickedCustomer } from "./CustomerPicker";
import InvoiceBatchList from "./InvoiceBatchList";
import InvoiceBatchDetailModal from "./InvoiceBatchDetailModal";
import InvoicePreviewModal from "./InvoicePreviewModal";

/**
 * Konsolide fatura yönetim paneli (birfatura.md §9):
 * - Kapsam seçici (bayi) + durum filtresi
 * - "Önizle" (DB'ye yazmaz) ve "Kesimi Dondur" (geri alınamaz, onaylı)
 * - Ay-ay batch listesi → satıra tıkla → detay
 * Kapsam: bir bayi seçiliyse tekli, değilse toplu kesim/önizleme.
 */

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Tüm durumlar" },
  { value: "frozen", label: "Donduruldu" },
  { value: "invoiced", label: "Faturalandı" },
  { value: "failed", label: "Hata" },
  { value: "cancelled", label: "İptal" },
];

export default function InvoiceConsolidationPanel(): React.ReactElement {
  const toast = useToast();
  const queryClient = useQueryClient();

  const [scope, setScope] = useState<PickedCustomer | null>(null);
  const [status, setStatus] = useState("");
  const [detailBatchId, setDetailBatchId] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [freezeConfirmOpen, setFreezeConfirmOpen] = useState(false);
  // Kesim tarihi (cutoff). Boşsa "bugün". Hem önizleme hem dondurma bunu kullanır;
  // o tarihe kadarki (shippedAt <= tarih) TÜM faturalanmamış kargolar alınır — alt sınır yok.
  const [freezeAsOf, setFreezeAsOf] = useState<string>("");

  const batchesQuery = useQuery<InvoiceBatchListResponse>({
    queryKey: ["admin-invoice-batches", scope?.id ?? null, status || null],
    queryFn: () =>
      fetchInvoiceBatches({
        customerId: scope?.id,
        status: status || undefined,
      }),
  });

  const freezeMutation = useMutation({
    mutationFn: () => freezeInvoices(scope?.id, freezeAsOf || undefined),
    onSuccess: (result: FreezeResult) => {
      setFreezeConfirmOpen(false);
      if (result.batchCount === 0) {
        toast.push(
          "info",
          "Kesilecek uygun sipariş bulunamadı — hiçbir fatura dondurulmadı.",
        );
      } else {
        toast.push(
          "success",
          `${result.batchCount} fatura donduruldu (${result.orderCount} sipariş).`,
        );
      }
      queryClient.invalidateQueries({ queryKey: ["admin-invoice-batches"] });
    },
    onError: (err: unknown) => {
      setFreezeConfirmOpen(false);
      toast.push(
        "error",
        err instanceof Error ? err.message : "Kesim sırasında hata oluştu",
      );
    },
  });

  const scopeLabel = scope ? scope.name : "Tüm uygun bayiler";

  return (
    <section className="rounded-2xl border border-[var(--color-border)] bg-white p-6 shadow-sm">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-[var(--color-text)]">
            Konsolide Faturalar
          </h2>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            Ay-ay dondurulmuş kesimler. Elle kesim öncesi mutlaka{" "}
            <strong>Önizle</strong> ile kontrol edin — dondurma geri alınamaz.
          </p>
        </div>
      </header>

      {/* Kapsam + filtre + aksiyon çubuğu */}
      <div className="mb-5 flex flex-wrap items-end gap-3 rounded-xl border border-[var(--color-border)] bg-slate-50/50 p-4">
        <div className="min-w-[16rem]">
          <span className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">
            Kapsam (bayi)
          </span>
          <CustomerPicker
            value={scope}
            onChange={setScope}
            disabled={freezeMutation.isPending}
          />
        </div>

        <div>
          <span className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">
            Durum
          </span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-sm focus:border-[var(--color-brand-blue)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-blue)]/20"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <span className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">
            Kesim tarihi
          </span>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={freezeAsOf}
              onChange={(e) => setFreezeAsOf(e.target.value)}
              disabled={freezeMutation.isPending}
              className="rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-sm focus:border-[var(--color-brand-blue)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-blue)]/20"
            />
            {freezeAsOf ? (
              <button
                type="button"
                onClick={() => setFreezeAsOf("")}
                className="rounded-lg border border-[var(--color-border)] bg-white px-2 py-2 text-xs text-[var(--color-text-muted)] transition hover:bg-slate-50"
                title="Bugüne dön"
              >
                Bugün
              </button>
            ) : null}
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPreviewOpen(true)}
            className="rounded-lg border border-[var(--color-brand-blue)]/40 bg-white px-4 py-2 text-sm font-medium text-[var(--color-brand-blue)] transition hover:bg-[var(--color-brand-blue)]/5"
          >
            Önizle
          </button>
          <button
            type="button"
            onClick={() => setFreezeConfirmOpen(true)}
            disabled={freezeMutation.isPending}
            className="rounded-lg bg-[var(--color-brand-blue)] px-4 py-2 text-sm font-medium text-white transition hover:bg-[var(--color-brand-navy)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {freezeMutation.isPending ? "Donduruluyor…" : "Kesimi Dondur"}
          </button>
        </div>

        <p className="basis-full text-[11px] text-[var(--color-text-muted)]">
          Aktif kapsam: <strong>{scopeLabel}</strong>. Bir bayi seçilirse yalnız
          o bayi, seçilmezse uygun tüm bayiler için işlem yapılır.
        </p>
      </div>

      {batchesQuery.isError ? (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {batchesQuery.error instanceof Error
            ? batchesQuery.error.message
            : "Faturalar yüklenemedi"}
        </p>
      ) : null}

      <InvoiceBatchList
        months={batchesQuery.data?.months ?? []}
        onSelect={setDetailBatchId}
        isLoading={batchesQuery.isLoading}
      />

      {/* Detay modalı */}
      {detailBatchId ? (
        <InvoiceBatchDetailModal
          batchId={detailBatchId}
          onClose={() => setDetailBatchId(null)}
        />
      ) : null}

      {/* Önizleme modalı */}
      {previewOpen ? (
        <InvoicePreviewModal
          customerId={scope?.id}
          scopeLabel={scopeLabel}
          initialAsOf={freezeAsOf || undefined}
          onClose={() => setPreviewOpen(false)}
        />
      ) : null}

      {/* Dondurma onayı (geri alınamaz) */}
      <ConfirmDialog
        open={freezeConfirmOpen}
        title="Kesimi dondur?"
        message={`${scopeLabel} için, ${freezeAsOf || "bugüne"} dek kargoya verilmiş ve faturalanmamış TÜM siparişler (alt tarih sınırı yok) konsolide edilip DONDURULACAK. Bu işlem geri alınamaz. Devam etmeden önce "Önizle" ile kontrol ettiğinizden emin olun.`}
        confirmLabel="Evet, dondur"
        cancelLabel="Vazgeç"
        destructive
        onConfirm={() => freezeMutation.mutate()}
        onCancel={() => setFreezeConfirmOpen(false)}
      />
    </section>
  );
}

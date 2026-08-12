import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  previewInvoices,
  type PreviewInvoice,
  type PreviewResult,
} from "../../lib/invoices";
import { formatAmount } from "../../lib/format";
import { formatDateOnly, paymentTypeLabel } from "./invoiceFormat";
import { InvoiceLinesTable } from "./InvoiceBatchDetailModal";

/**
 * Kesim ÖNİZLEMESİ (birfatura.md §8/§9): DB'ye hiçbir şey yazmadan, kesim
 * anında üretilecek konsolide faturaların birebir aynısını gösterir.
 * Kapsam tekli (customerId) ya da toplu olabilir; opsiyonel `asOf` cutoff.
 */

interface InvoicePreviewModalProps {
  /** Tekli önizleme için bayi; yoksa toplu (tüm uygun bayiler). */
  customerId?: string;
  /** Üst başlıkta gösterilecek kapsam etiketi. */
  scopeLabel: string;
  /** Panelde seçili kesim tarihi (YYYY-MM-DD) — modal bununla açılır; değiştirilebilir. */
  initialAsOf?: string;
  onClose: () => void;
}

export default function InvoicePreviewModal({
  customerId,
  scopeLabel,
  initialAsOf,
  onClose,
}: InvoicePreviewModalProps): React.ReactElement {
  // Kesim tarihi (asOf) seçici — boşsa "şimdi" ile kesilir (varsayılan davranış).
  // Ay ortasında keyfi bir kesim tarihiyle önizleme için (birfatura.md §8: "müşteri
  // + tarih seç, ör. bugün 21'i"). HTML date değeri (YYYY-MM-DD) backend'de günün
  // başlangıcına (Europe/Istanbul) eşlenir; cron kesimiyle birebir aynı pencere.
  const [asOf, setAsOf] = useState<string>(initialAsOf ?? "");

  const query = useQuery<PreviewResult>({
    queryKey: ["admin-invoice-preview", customerId ?? "all", asOf || "now"],
    queryFn: () => previewInvoices({ customerId, asOf: asOf || undefined }),
    // Önizleme bir "anlık" işlem; otomatik refetch istemiyoruz.
    refetchOnWindowFocus: false,
    staleTime: 0,
  });

  const result = query.data;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/40 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="invoice-preview-title"
        className="my-8 w-full max-w-4xl rounded-2xl border border-[var(--color-border)] bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-[var(--color-border)] px-6 py-4">
          <div>
            <h2
              id="invoice-preview-title"
              className="flex items-center gap-2 text-lg font-semibold text-[var(--color-text)]"
            >
              Kesim Önizlemesi
              <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-700">
                DB'ye yazılmaz
              </span>
            </h2>
            <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
              {scopeLabel}
              {result
                ? ` · ${formatDateOnly(result.asOf)} tarihine kadar faturalanmamış TÜM kargolar (alt tarih sınırı yok)`
                : ""}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <label
                htmlFor="invoice-preview-asof"
                className="text-xs font-medium text-[var(--color-text-muted)]"
              >
                Kesim tarihi
              </label>
              <input
                id="invoice-preview-asof"
                type="date"
                value={asOf}
                onChange={(e) => setAsOf(e.target.value)}
                className="rounded-md border border-[var(--color-border)] bg-white px-2.5 py-1.5 text-sm focus:border-[var(--color-brand-blue)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-blue)]/20"
              />
              {asOf ? (
                <button
                  type="button"
                  onClick={() => setAsOf("")}
                  className="rounded-md border border-[var(--color-border)] bg-white px-2 py-1.5 text-xs text-[var(--color-text-muted)] transition hover:bg-slate-50"
                  title="Bugüne (şimdi) dön"
                >
                  Şimdi
                </button>
              ) : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-[var(--color-border)] bg-white px-2.5 py-1.5 text-sm text-[var(--color-text-muted)] transition hover:bg-slate-50"
              aria-label="Kapat"
            >
              ×
            </button>
          </div>
        </header>

        <div className="px-6 py-5">
          {query.isLoading ? (
            <p className="text-sm text-[var(--color-text-muted)]">
              Önizleme hesaplanıyor…
            </p>
          ) : query.isError || !result ? (
            <p className="text-sm text-red-600">
              {query.error instanceof Error
                ? query.error.message
                : "Önizleme oluşturulamadı"}
            </p>
          ) : result.invoiceCount === 0 ? (
            <div className="rounded-lg border border-[var(--color-border)] bg-slate-50/60 p-6 text-center">
              <p className="text-sm font-medium text-[var(--color-text)]">
                Kesilecek fatura yok
              </p>
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                Bu kapsamda, kesim tarihine dek kargoya verilmiş ve henüz
                faturalanmamış uygun sipariş bulunamadı.
              </p>
            </div>
          ) : (
            <PreviewBody result={result} />
          )}
        </div>
      </div>
    </div>
  );
}

function PreviewBody({
  result,
}: {
  result: PreviewResult;
}): React.ReactElement {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--color-border)] bg-slate-50/60 px-4 py-3 text-sm">
        <Stat label="Fatura" value={String(result.invoiceCount)} />
        <span className="text-[var(--color-border)]">|</span>
        <Stat label="Sipariş" value={String(result.orderCount)} />
        <span className="text-[var(--color-border)]">|</span>
        <Stat
          label="Kesim anı (asOf)"
          value={formatDateOnly(result.asOf)}
        />
      </div>

      {result.invoices.map((inv, i) => (
        <PreviewInvoiceCard key={`${inv.customerId}-${inv.paymentTypeId}-${i}`} inv={inv} />
      ))}
    </div>
  );
}

function PreviewInvoiceCard({
  inv,
}: {
  inv: PreviewInvoice;
}): React.ReactElement {
  const b = inv.billing;
  return (
    <article className="overflow-hidden rounded-xl border border-[var(--color-border)]">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--color-border)] bg-slate-50/70 px-5 py-3">
        <div>
          <p className="text-sm font-semibold text-[var(--color-text)]">
            {inv.customerName}
            <span
              className={`ml-2 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                inv.isCorporate
                  ? "bg-indigo-100 text-indigo-700"
                  : "bg-slate-200 text-slate-600"
              }`}
            >
              {inv.isCorporate ? "Kurumsal" : "Bireysel"}
            </span>
          </p>
          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
            {paymentTypeLabel(inv.paymentType, inv.paymentTypeLabel)} (
            {inv.paymentTypeId}) · {inv.orderCount} sipariş · {inv.totalQuantity}{" "}
            adet
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-[var(--color-text-muted)]">
            Ödenecek (KDV dahil)
          </p>
          <p className="text-lg font-semibold text-[var(--color-text)]">
            {formatAmount(inv.totalPaidTaxIncluding)}
          </p>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 px-5 py-4">
        {/* Fatura adresi / cari bilgileri */}
        <div className="space-y-1.5 text-sm">
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
            Fatura Bilgileri
          </h4>
          <BillingLine
            label="Ünvan / Ad"
            value={b.billingCompanyTitle || b.billingName}
          />
          {inv.isCorporate ? (
            <>
              <BillingLine label="VKN" value={b.billingVergiNo} />
              <BillingLine label="Vergi Dairesi" value={b.billingVergiDairesi} />
            </>
          ) : (
            <BillingLine label="TCKN" value={b.billingTcNo} />
          )}
          <BillingLine label="E-posta" value={b.billingEmail} highlight />
          <BillingLine
            label="Telefon"
            value={b.billingMobilePhone || b.billingPhone}
          />
          <BillingLine
            label="Adres"
            value={joinAddress(b.billingAddressLine, b.billingDistrict, b.billingCity)}
          />
        </div>

        {/* "Kapsanan Siparişler" listesi kaldırıldı — sipariş no'ları artık
            kalem dökümündeki "Sipariş No" kolonunda satır bazında görünüyor. */}
      </div>

      <div className="px-5 pb-4">
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
          Kalem Dökümü ({inv.lines.length})
        </h4>
        <InvoiceLinesTable lines={inv.lines} />
        <dl className="mt-3 flex flex-wrap justify-end gap-x-8 gap-y-1 text-sm">
          <TotalInline
            label="Mal Hizmet Toplam Tutarı"
            value={formatAmount(inv.productsTotalTaxExcluding)}
          />
          <TotalInline
            label="Hesaplanan KDV (%20)"
            value={formatAmount(
              inv.totalPaidTaxIncluding - inv.productsTotalTaxExcluding,
            )}
          />
          <TotalInline
            label="Vergiler Dahil Toplam"
            value={formatAmount(inv.totalPaidTaxIncluding)}
            strong
          />
        </dl>
      </div>
    </article>
  );
}

function joinAddress(
  line: string | null,
  district: string | null,
  city: string | null,
): string | null {
  const parts = [line, district, city].filter(
    (p): p is string => !!p && p.trim().length > 0,
  );
  return parts.length > 0 ? parts.join(", ") : null;
}

function BillingLine({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string | null;
  highlight?: boolean;
}): React.ReactElement {
  const missing = !value || value.trim().length === 0;
  return (
    <div className="flex items-baseline gap-2">
      <span className="w-24 shrink-0 text-xs text-[var(--color-text-muted)]">
        {label}
      </span>
      <span
        className={`min-w-0 break-words text-sm ${
          missing
            ? "italic text-red-500"
            : highlight
              ? "font-medium text-[var(--color-text)]"
              : "text-[var(--color-text)]"
        }`}
      >
        {missing ? "eksik" : value}
      </span>
    </div>
  );
}

function Stat({
  label,
  value,
}: {
  label: string;
  value: string;
}): React.ReactElement {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-xs text-[var(--color-text-muted)]">{label}:</span>
      <span className="font-semibold text-[var(--color-text)]">{value}</span>
    </span>
  );
}

function TotalInline({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}): React.ReactElement {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="text-xs text-[var(--color-text-muted)]">{label}</dt>
      <dd
        className={
          strong
            ? "text-base font-semibold text-[var(--color-text)]"
            : "text-sm text-[var(--color-text)]"
        }
      >
        {value}
      </dd>
    </div>
  );
}

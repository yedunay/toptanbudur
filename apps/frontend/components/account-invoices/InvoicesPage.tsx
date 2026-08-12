"use client";

import { useCallback, useState } from "react";
import {
  ChevronDown,
  Download,
  FileText,
  Loader2,
  Receipt,
} from "lucide-react";
import { formatPrice } from "@/lib/api";
import { apiCustomer } from "@/lib/auth";
import type {
  DealerInvoiceBatchDetail,
  DealerInvoiceBatchRow,
  DealerInvoiceListResponse,
  DealerInvoiceMonthGroup,
} from "@/lib/customer-types";
import { InvoiceBatchDetail } from "./InvoiceBatchDetail";
import {
  formatPeriod,
  invoiceStatusConfig,
  isSafeUrl,
} from "./invoice-format";

interface InvoicesPageProps {
  initialData: DealerInvoiceListResponse | null;
}

interface DetailState {
  loading: boolean;
  error: string | null;
  data: DealerInvoiceBatchDetail | null;
}

const EMPTY_DETAIL: DetailState = { loading: false, error: null, data: null };

export function InvoicesPage({ initialData }: InvoicesPageProps) {
  const months: DealerInvoiceMonthGroup[] = initialData?.months ?? [];
  const batchCount = initialData?.batchCount ?? 0;

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, DetailState>>({});

  const loadDetail = useCallback(async (id: string) => {
    setDetails((prev) => ({
      ...prev,
      [id]: { ...EMPTY_DETAIL, loading: true },
    }));
    try {
      const res = await apiCustomer<{
        success: boolean;
        data: DealerInvoiceBatchDetail;
      }>(`/me/invoices/${encodeURIComponent(id)}`, {
        method: "GET",
        general: true,
      });
      if (res?.success && res.data) {
        setDetails((prev) => ({
          ...prev,
          [id]: { loading: false, error: null, data: res.data },
        }));
      } else {
        setDetails((prev) => ({
          ...prev,
          [id]: {
            loading: false,
            error: "Fatura detayı yüklenemedi.",
            data: null,
          },
        }));
      }
    } catch {
      setDetails((prev) => ({
        ...prev,
        [id]: {
          loading: false,
          error: "Fatura detayı yüklenemedi. Lütfen tekrar deneyin.",
          data: null,
        },
      }));
    }
  }, []);

  const handleToggle = useCallback(
    (id: string) => {
      setExpandedId((current) => {
        if (current === id) return null;
        if (!details[id]?.data && !details[id]?.loading) {
          void loadDetail(id);
        }
        return id;
      });
    },
    [details, loadDetail],
  );

  if (batchCount === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-[var(--ab-border)] bg-white px-6 py-16 text-center">
        <span
          className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-blue-600"
          aria-hidden="true"
        >
          <Receipt className="h-7 w-7" />
        </span>
        <h2 className="text-lg font-bold text-[var(--ab-text)]">
          Henüz faturanız yok
        </h2>
        <p className="mt-2 max-w-sm text-sm text-slate-500">
          Siparişleriniz her ay sonunda tek bir toplu faturada birleştirilir.
          Fatura kesildiğinde burada listelenecek ve indirebileceksiniz.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {months.map((group) => (
        <section
          key={group.month}
          aria-label={group.monthLabel}
          className="overflow-hidden rounded-3xl border border-[var(--ab-border)] bg-white shadow-sm"
        >
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--surface-muted)] px-5 py-3.5">
            <h2 className="text-sm font-bold text-[var(--ab-text)]">
              {group.monthLabel}
              <span className="ml-2 text-xs font-medium text-[var(--text-muted)]">
                ({group.batchCount} fatura)
              </span>
            </h2>
            <span className="text-sm font-semibold text-[var(--ab-text)]">
              {formatPrice(group.totalTaxIncluding)}
            </span>
          </header>

          <ul className="divide-y divide-[var(--border)]">
            {group.batches.map((batch) => (
              <InvoiceRow
                key={batch.id}
                batch={batch}
                isExpanded={expandedId === batch.id}
                detail={details[batch.id] ?? EMPTY_DETAIL}
                onToggle={() => handleToggle(batch.id)}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

interface InvoiceRowProps {
  batch: DealerInvoiceBatchRow;
  isExpanded: boolean;
  detail: DetailState;
  onToggle: () => void;
}

function InvoiceRow({ batch, isExpanded, detail, onToggle }: InvoiceRowProps) {
  const status = invoiceStatusConfig(batch.status);
  const canDownload = isSafeUrl(batch.invoiceUrl);

  return (
    <li>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={isExpanded}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600"
            aria-hidden="true"
          >
            <FileText className="h-5 w-5" />
          </span>
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-[var(--ab-text)]">
                {batch.paymentTypeLabel}
              </span>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${status.className}`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${status.dotClass}`}
                  aria-hidden="true"
                />
                {status.label}
              </span>
            </span>
            <span className="mt-0.5 block text-xs text-[var(--text-muted)]">
              {formatPeriod(batch.periodStart, batch.periodEnd)} ·{" "}
              {batch.orderCount} sipariş
              {batch.invoiceNumber ? ` · ${batch.invoiceNumber}` : ""}
            </span>
          </span>
        </button>

        <div className="flex items-center gap-3">
          <span className="text-right text-sm font-bold tabular-nums text-[var(--ab-text)]">
            {formatPrice(batch.totalPaidTaxIncluding)}
          </span>
          {canDownload ? (
            <a
              href={batch.invoiceUrl as string}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              title="Faturayı indir"
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--brand-blue)] text-white transition hover:bg-[var(--brand-navy)]"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only">Faturayı indir</span>
            </a>
          ) : null}
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={isExpanded}
            aria-label={isExpanded ? "Detayı gizle" : "Detayı göster"}
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--border)] text-[var(--text-muted)] transition hover:bg-[var(--surface-muted)]"
          >
            <ChevronDown
              className={`h-4 w-4 transition-transform ${isExpanded ? "rotate-180" : ""}`}
              aria-hidden="true"
            />
          </button>
        </div>
      </div>

      {isExpanded ? (
        detail.loading ? (
          <div className="flex items-center gap-2 border-t border-[var(--border)] bg-[var(--surface-muted)] px-5 py-6 text-sm text-[var(--text-muted)]">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Detay yükleniyor…
          </div>
        ) : detail.error ? (
          <div
            role="alert"
            className="border-t border-[var(--border)] bg-rose-50 px-5 py-4 text-sm font-semibold text-rose-700"
          >
            {detail.error}
          </div>
        ) : detail.data ? (
          <InvoiceBatchDetail detail={detail.data} />
        ) : null
      ) : null}
    </li>
  );
}

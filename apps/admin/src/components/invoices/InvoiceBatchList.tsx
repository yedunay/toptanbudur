import type { InvoiceMonthGroup } from "../../lib/invoices";
import { formatAmount } from "../../lib/format";
import { batchStatusBadge, formatDateOnly, paymentTypeLabel } from "./invoiceFormat";

/**
 * Ay-ay gruplanmış konsolide fatura listesi (birfatura.md §9): her ay başlığı
 * altında batch satırları — bayi, ödeme tipi, dönem, tutar, fatura no/link,
 * durum. Satıra tıklayınca detay açılır (onSelect).
 */

interface InvoiceBatchListProps {
  months: InvoiceMonthGroup[];
  onSelect: (batchId: string) => void;
  isLoading?: boolean;
}

export default function InvoiceBatchList({
  months,
  onSelect,
  isLoading,
}: InvoiceBatchListProps): React.ReactElement {
  if (isLoading) {
    return (
      <p className="px-1 py-6 text-sm text-[var(--color-text-muted)]">
        Faturalar yükleniyor…
      </p>
    );
  }

  if (months.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--color-border)] bg-slate-50/50 px-6 py-10 text-center">
        <p className="text-sm font-medium text-[var(--color-text)]">
          Henüz dondurulmuş fatura yok
        </p>
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">
          Kesim gününde otomatik oluşur; ya da yukarıdan elle "Kesimi Dondur"
          ile üretebilirsin. Önce "Önizle" ile kontrol etmeniz önerilir.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {months.map((group) => (
        <section key={group.month}>
          <header className="mb-2 flex items-baseline justify-between gap-3">
            <h3 className="text-sm font-semibold text-[var(--color-text)]">
              {group.monthLabel}
              <span className="ml-2 text-xs font-normal text-[var(--color-text-muted)]">
                {group.batchCount} fatura
              </span>
            </h3>
            <span className="text-sm font-medium text-[var(--color-text)]">
              {formatAmount(group.totalTaxIncluding)}
            </span>
          </header>

          <div className="overflow-x-auto rounded-xl border border-[var(--color-border)]">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
                <tr>
                  <th className="px-3 py-2 font-medium">Bayi</th>
                  <th className="px-3 py-2 font-medium">Ödeme</th>
                  <th className="px-3 py-2 font-medium">Dönem</th>
                  <th className="px-3 py-2 text-right font-medium">Sip.</th>
                  <th className="px-3 py-2 text-right font-medium">Tutar</th>
                  <th className="px-3 py-2 font-medium">Fatura No</th>
                  <th className="px-3 py-2 font-medium">Durum</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {group.batches.map((b) => {
                  const badge = batchStatusBadge(b.status);
                  return (
                    <tr
                      key={b.id}
                      onClick={() => onSelect(b.id)}
                      className="cursor-pointer transition hover:bg-slate-50"
                    >
                      <td className="px-3 py-2 font-medium text-[var(--color-text)]">
                        {b.customerName}
                      </td>
                      <td className="px-3 py-2 text-xs text-[var(--color-text-muted)]">
                        {paymentTypeLabel(b.paymentType, b.paymentTypeLabel)}
                      </td>
                      <td className="px-3 py-2 text-xs text-[var(--color-text-muted)]">
                        {formatDateOnly(b.periodStart)} →{" "}
                        {formatDateOnly(b.periodEnd)}
                      </td>
                      <td className="px-3 py-2 text-right text-[var(--color-text)]">
                        {b.orderCount}
                      </td>
                      <td className="px-3 py-2 text-right font-medium text-[var(--color-text)]">
                        {formatAmount(b.totalPaidTaxIncluding)}
                      </td>
                      <td className="px-3 py-2">
                        {b.invoiceUrl ? (
                          <a
                            href={b.invoiceUrl}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="font-mono text-xs text-[var(--color-brand-blue)] underline-offset-2 hover:underline"
                          >
                            {b.invoiceNumber || "PDF"}
                          </a>
                        ) : (
                          <span className="font-mono text-xs text-[var(--color-text-muted)]">
                            {b.invoiceNumber || "—"}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${badge.className}`}
                        >
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right text-[var(--color-text-muted)]">
                        ›
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}

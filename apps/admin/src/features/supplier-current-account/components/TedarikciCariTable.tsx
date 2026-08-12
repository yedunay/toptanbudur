import { ChevronLeft, ChevronRight } from "lucide-react";
import { formatAmount } from "../../../lib/format";
import type {
  TedarikciCariMeta,
  TedarikciCariRow,
  TedarikciCariSummary,
} from "../types";

interface TedarikciCariTableProps {
  rows: TedarikciCariRow[];
  meta: TedarikciCariMeta;
  summary: TedarikciCariSummary;
  isLoading?: boolean;
  onPageChange: (page: number) => void;
}

function formatDate(iso: string): string {
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

export function TedarikciCariTable({
  rows,
  meta,
  summary,
  isLoading = false,
  onPageChange,
}: TedarikciCariTableProps): React.ReactElement {
  const start = meta.total === 0 ? 0 : (meta.page - 1) * meta.pageSize + 1;
  const end = Math.min(meta.page * meta.pageSize, meta.total);
  const canPrev = meta.page > 1;
  const canNext = meta.page < meta.totalPages;

  return (
    <section className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-600">
            <tr>
              <th scope="col" className="px-3 py-3 text-left">
                Tarih
              </th>
              <th scope="col" className="px-3 py-3 text-left">
                Tedarikçi
              </th>
              <th scope="col" className="px-3 py-3 text-left">
                Açıklama
              </th>
              <th scope="col" className="px-3 py-3 text-right">
                Ürün Alış Fiyatı
              </th>
              <th scope="col" className="px-3 py-3 text-right">
                Satış Fiyatı
              </th>
              <th scope="col" className="px-3 py-3 text-right">
                Kâr
              </th>
              <th scope="col" className="px-3 py-3 text-right">
                KDV Farkı
              </th>
              <th scope="col" className="px-3 py-3 text-center">
                İşlem Türü
              </th>
              <th scope="col" className="px-3 py-3 text-left">
                Sipariş No
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border)] text-[var(--color-text)]">
            {isLoading && rows.length === 0 ? (
              <tr>
                <td
                  colSpan={9}
                  className="px-3 py-10 text-center text-sm text-slate-400"
                >
                  Yükleniyor…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td
                  colSpan={9}
                  className="px-3 py-10 text-center text-sm text-slate-400"
                >
                  Bu filtreye uyan hareket bulunamadı.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="hover:bg-slate-50">
                  <td className="whitespace-nowrap px-3 py-3 text-slate-600">
                    {formatDate(row.dateIso)}
                  </td>
                  <td className="px-3 py-3 font-medium">{row.supplierName}</td>
                  <td className="max-w-[320px] px-3 py-3">
                    <div className="truncate" title={row.description}>
                      {row.description}
                    </div>
                    {row.customerName ? (
                      <div
                        className="truncate text-xs text-slate-500"
                        title={row.customerName}
                      >
                        Müşteri: {row.customerName}
                      </div>
                    ) : null}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">
                    {formatAmount(row.productPurchasePrice)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">
                    {formatAmount(row.salePrice)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-right font-semibold tabular-nums text-emerald-600">
                    {formatAmount(row.profit)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-right font-semibold tabular-nums text-emerald-600">
                    {formatAmount(row.vatDifference)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-center">
                    <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                      Satış
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 font-mono text-xs text-slate-600">
                    {row.humanOrderNo}
                  </td>
                </tr>
              ))
            )}
          </tbody>
          {rows.length > 0 ? (
            <tfoot className="bg-slate-50 text-xs font-semibold text-slate-700">
              <tr>
                <td className="px-3 py-3" colSpan={3}>
                  Sayfa Toplamı (filtre uygulanmış toplam)
                </td>
                <td className="px-3 py-3 text-right tabular-nums">
                  {formatAmount(summary.totalPurchaseAmount)}
                </td>
                <td className="px-3 py-3 text-right tabular-nums">
                  {formatAmount(summary.totalSalesAmount)}
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-emerald-700">
                  {formatAmount(summary.totalGrossProfit)}
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-emerald-700">
                  {formatAmount(summary.totalVatDifference)}
                </td>
                <td className="px-3 py-3" colSpan={2}>
                  {summary.itemCount} satır · {summary.orderCount} sipariş
                </td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border)] bg-white px-4 py-3 text-xs text-slate-600">
        <span>
          {start}-{end} / {meta.total}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onPageChange(meta.page - 1)}
            disabled={!canPrev || isLoading}
            className="inline-flex items-center gap-1 rounded-lg border border-[var(--color-border)] bg-white px-2 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Önceki
          </button>
          <span className="px-1 tabular-nums">
            Sayfa {meta.page} / {Math.max(1, meta.totalPages)}
          </span>
          <button
            type="button"
            onClick={() => onPageChange(meta.page + 1)}
            disabled={!canNext || isLoading}
            className="inline-flex items-center gap-1 rounded-lg border border-[var(--color-border)] bg-white px-2 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Sonraki
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>
    </section>
  );
}

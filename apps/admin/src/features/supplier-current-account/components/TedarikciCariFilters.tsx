import { Download, Eraser, Filter, Search } from "lucide-react";
import type { SupplierOption, TedarikciCariQuery } from "../types";

interface TedarikciCariFiltersProps {
  draft: TedarikciCariQuery;
  setDraft: (next: TedarikciCariQuery) => void;
  suppliers: SupplierOption[];
  onApply: () => void;
  onClear: () => void;
  onExport: () => void;
  isExporting?: boolean;
}

export function TedarikciCariFilters({
  draft,
  setDraft,
  suppliers,
  onApply,
  onClear,
  onExport,
  isExporting = false,
}: TedarikciCariFiltersProps): React.ReactElement {
  function patch(next: Partial<TedarikciCariQuery>): void {
    setDraft({ ...draft, ...next });
  }

  return (
    <section className="rounded-2xl border border-[var(--color-border)] bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--color-text)]">
        <Filter className="h-4 w-4 text-slate-500" aria-hidden="true" />
        Filtreler
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-5">
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          <span>Tedarikçi</span>
          <select
            value={draft.supplierId ?? ""}
            onChange={(e) =>
              patch({ supplierId: e.target.value || undefined })
            }
            className="h-10 rounded-lg border border-[var(--color-border)] bg-white px-3 text-sm text-[var(--color-text)] focus:border-[var(--color-brand-blue,#0f62fe)] focus:outline-none"
          >
            <option value="">Tümü</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          <span>Başlangıç</span>
          <input
            type="date"
            value={draft.from ?? ""}
            onChange={(e) => patch({ from: e.target.value || undefined })}
            className="h-10 rounded-lg border border-[var(--color-border)] bg-white px-3 text-sm text-[var(--color-text)] focus:border-[var(--color-brand-blue,#0f62fe)] focus:outline-none"
          />
        </label>

        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          <span>Bitiş</span>
          <input
            type="date"
            value={draft.to ?? ""}
            onChange={(e) => patch({ to: e.target.value || undefined })}
            className="h-10 rounded-lg border border-[var(--color-border)] bg-white px-3 text-sm text-[var(--color-text)] focus:border-[var(--color-brand-blue,#0f62fe)] focus:outline-none"
          />
        </label>

        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          <span>İşlem Türü</span>
          <select
            disabled
            value="sale"
            className="h-10 cursor-not-allowed rounded-lg border border-[var(--color-border)] bg-slate-50 px-3 text-sm text-slate-500 focus:outline-none"
          >
            <option value="sale">Satış</option>
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          <span>Sipariş No / Müşteri</span>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <input
              type="text"
              placeholder="Ara…"
              value={draft.search ?? ""}
              onChange={(e) =>
                patch({ search: e.target.value || undefined })
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") onApply();
              }}
              className="h-10 w-full rounded-lg border border-[var(--color-border)] bg-white pl-9 pr-3 text-sm text-[var(--color-text)] focus:border-[var(--color-brand-blue,#0f62fe)] focus:outline-none"
            />
          </div>
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={onClear}
          className="inline-flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
        >
          <Eraser className="h-4 w-4" aria-hidden="true" />
          Filtreleri Temizle
        </button>
        <button
          type="button"
          onClick={onApply}
          className="inline-flex items-center gap-2 rounded-lg bg-[var(--color-brand-blue,#0f62fe)] px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
        >
          <Filter className="h-4 w-4" aria-hidden="true" />
          Uygula
        </button>
        <button
          type="button"
          onClick={onExport}
          disabled={isExporting}
          className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          {isExporting ? "İndiriliyor…" : "Excel İndir"}
        </button>
      </div>
    </section>
  );
}

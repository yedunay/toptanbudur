"use client";

import { FileDown, RefreshCcw, Search } from "lucide-react";
import { useCallback, useState } from "react";
import type {
  CurrentAccountFilters,
  CurrentAccountTransactionType,
} from "./types";

interface CurrentAccountToolbarProps {
  initial: CurrentAccountFilters;
  onApply: (filters: CurrentAccountFilters) => void;
  onExport: (filters: CurrentAccountFilters) => void;
  isLoading: boolean;
}

const TYPE_OPTIONS: {
  value: "" | CurrentAccountTransactionType;
  label: string;
}[] = [
  { value: "", label: "Tüm Hareketler" },
  { value: "TOPUP", label: "Yükleme" },
  { value: "ORDER_PAYMENT", label: "Sipariş" },
  { value: "REFUND", label: "İptal Ücreti" },
  { value: "ADJUSTMENT", label: "Düzeltme" },
];

export function CurrentAccountToolbar({
  initial,
  onApply,
  onExport,
  isLoading,
}: CurrentAccountToolbarProps) {
  const [from, setFrom] = useState(initial.from ?? "");
  const [to, setTo] = useState(initial.to ?? "");
  const [type, setType] = useState<CurrentAccountFilters["type"]>(
    initial.type ?? "",
  );
  const [search, setSearch] = useState(initial.search ?? "");

  const handleApply = useCallback(() => {
    onApply({
      from: from || undefined,
      to: to || undefined,
      type: type || undefined,
      search: search.trim() || undefined,
    });
  }, [from, to, type, search, onApply]);

  const handleExport = useCallback(() => {
    onExport({
      from: from || undefined,
      to: to || undefined,
      type: type || undefined,
      search: search.trim() || undefined,
    });
  }, [from, to, type, search, onExport]);

  const handleSubmit = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      handleApply();
    },
    [handleApply],
  );

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-3xl border border-[var(--ab-border)] bg-white p-4 shadow-sm"
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
        <div className="grid grid-cols-2 gap-3 lg:flex lg:flex-1 lg:gap-3">
          <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
            Başlangıç
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-800 focus:border-[var(--ab-blue)] focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
            Bitiş
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-800 focus:border-[var(--ab-blue)] focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
          </label>
        </div>

        <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600 lg:w-44">
          İşlem Türü
          <select
            value={type ?? ""}
            onChange={(e) =>
              setType(
                (e.target.value as CurrentAccountFilters["type"]) || undefined,
              )
            }
            className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-800 focus:border-[var(--ab-blue)] focus:outline-none focus:ring-2 focus:ring-blue-100"
          >
            {TYPE_OPTIONS.map((o) => (
              <option key={o.value || "all"} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-1 flex-col gap-1 text-xs font-semibold text-slate-600 lg:min-w-[220px]">
          Arama
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Sipariş no veya açıklama"
              className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm font-medium text-slate-800 focus:border-[var(--ab-blue)] focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
          </div>
        </label>

        <div className="flex flex-col gap-2 sm:flex-row sm:gap-2 lg:flex-row">
          <button
            type="submit"
            disabled={isLoading}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[var(--ab-blue)] px-4 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCcw
              className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`}
              aria-hidden="true"
            />
            Uygula
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={isLoading}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 text-sm font-bold text-emerald-700 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <FileDown className="h-4 w-4" aria-hidden="true" />
            Excel İndir
          </button>
        </div>
      </div>
    </form>
  );
}

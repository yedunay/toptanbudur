"use client";

import { Filter, Search } from "lucide-react";
import type { TabKey, TicketCategory } from "./types";

const TABS: { key: TabKey; label: string }[] = [
  { key: "all", label: "Tüm Talepler" },
  { key: "open", label: "Açık Talepler" },
  { key: "replied", label: "Yanıtlananlar" },
  { key: "closed", label: "Kapatılanlar" },
];

// Filtre de yeni 4 türle sınırlı; eski kategorili talepler "Tümü"nde görünür.
const CATEGORY_OPTIONS: { value: TicketCategory | ""; label: string }[] = [
  { value: "", label: "Kategori: Tümü" },
  { value: "kargo", label: "Kargo" },
  { value: "iptal", label: "İptal" },
  { value: "iade", label: "İade" },
  { value: "diger", label: "Diğer" },
];

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Durum: Tümü" },
  { value: "NEW", label: "Açık" },
  { value: "REPLIED", label: "Yanıtlandı" },
  { value: "ARCHIVED", label: "Kapatıldı" },
];

interface Props {
  activeTab: TabKey;
  onTabChange: (tab: TabKey) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  statusFilter: string;
  onStatusChange: (s: string) => void;
  categoryFilter: string;
  onCategoryChange: (c: string) => void;
  onFilter: () => void;
}

export function SupportFilterBar({
  activeTab,
  onTabChange,
  searchQuery,
  onSearchChange,
  statusFilter,
  onStatusChange,
  categoryFilter,
  onCategoryChange,
  onFilter,
}: Props) {
  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex gap-1 border-b border-[var(--border)]">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => onTabChange(tab.key)}
            className={[
              "px-4 py-2.5 text-sm font-black transition",
              activeTab === tab.key
                ? "border-b-2 border-[var(--brand-blue)] text-[var(--brand-blue)]"
                : "text-[var(--text-muted)] hover:text-[var(--text)]",
            ].join(" ")}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Filters row */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <label className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            placeholder="Talep no, konu veya açıklama ile ara..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="h-11 w-full rounded-xl border border-[var(--border)] bg-white pl-10 pr-4 text-sm font-semibold outline-none transition placeholder:text-slate-400 focus:border-[var(--brand-blue)]"
          />
        </label>

        <select
          value={statusFilter}
          onChange={(e) => onStatusChange(e.target.value)}
          className="h-11 rounded-xl border border-[var(--border)] bg-white px-4 text-sm font-bold text-slate-700 outline-none"
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>

        <select
          value={categoryFilter}
          onChange={(e) => onCategoryChange(e.target.value)}
          className="h-11 rounded-xl border border-[var(--border)] bg-white px-4 text-sm font-bold text-slate-700 outline-none"
        >
          {CATEGORY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>

        <button
          type="button"
          onClick={onFilter}
          className="inline-flex h-11 items-center gap-2 rounded-xl border border-[var(--brand-blue)] bg-white px-5 text-sm font-black text-[var(--brand-blue)] transition hover:bg-blue-50"
        >
          <Filter className="h-4 w-4" />
          Filtrele
        </button>
      </div>
    </div>
  );
}

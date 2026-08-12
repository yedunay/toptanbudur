import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Loader2, Search, X } from "lucide-react";
import { fetchCustomers, type CustomerListItem } from "../../lib/customers";

/**
 * "Seçili müşteriler" hedeflemesi için aranabilir çoklu seçim. Müşteri ID'leri
 * dışarıya `customerIds` olarak verilir. Seçili müşterilerin etiketleri yerel
 * önbellekte tutulur — düzenleme modunda arama sonuçlarında olmayan ID'ler için
 * kısa ID gösterilir (ad çözülünce güncellenir).
 */

interface CustomerPickerProps {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}

const PAGE_SIZE = 25;

function customerLabel(c: CustomerListItem): string {
  const bayi = c.bayiNo ? ` · ${c.bayiNo}` : "";
  return `${c.name}${bayi}`;
}

export function CustomerPicker({ selectedIds, onChange }: CustomerPickerProps) {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const labelCache = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(handle);
  }, [search]);

  const { data, isFetching } = useQuery({
    queryKey: ["popup-customer-search", debounced],
    queryFn: () => fetchCustomers({ q: debounced, pageSize: PAGE_SIZE }),
    staleTime: 30_000,
  });

  const results = data?.data ?? [];
  for (const c of results) labelCache.current.set(c.id, customerLabel(c));

  const selected = new Set(selectedIds);

  function toggle(id: string) {
    if (selected.has(id)) {
      onChange(selectedIds.filter((x) => x !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  }

  function remove(id: string) {
    onChange(selectedIds.filter((x) => x !== id));
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Seçili özeti + chip'ler */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs font-medium text-[var(--color-text-muted,#64748b)]">
          {selectedIds.length} müşteri seçili
        </span>
        {selectedIds.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            className="text-xs font-medium text-red-600 hover:underline"
          >
            Tümünü temizle
          </button>
        )}
      </div>

      {selectedIds.length > 0 && (
        <div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto rounded-md border border-[var(--color-border,#e2e8f0)] bg-slate-50 p-2">
          {selectedIds.map((id) => (
            <span
              key={id}
              className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-xs text-slate-700 shadow-sm ring-1 ring-slate-200"
            >
              {labelCache.current.get(id) ?? `#${id.slice(0, 8)}`}
              <button
                type="button"
                onClick={() => remove(id)}
                className="text-slate-400 hover:text-red-600"
                aria-label="Kaldır"
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Arama */}
      <div className="relative">
        <Search
          size={15}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
        />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Müşteri adı, bayi no veya e-posta ara…"
          className="w-full rounded-md border border-[var(--color-border,#e2e8f0)] bg-white py-2 pl-9 pr-9 text-sm"
        />
        {isFetching && (
          <Loader2
            size={15}
            className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-slate-400"
          />
        )}
      </div>

      {/* Sonuç listesi */}
      <div className="max-h-52 overflow-y-auto rounded-md border border-[var(--color-border,#e2e8f0)]">
        {results.length === 0 ? (
          <p className="px-3 py-4 text-center text-xs text-slate-400">
            {isFetching ? "Aranıyor…" : "Sonuç yok"}
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {results.map((c) => {
              const isSelected = selected.has(c.id);
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => toggle(c.id)}
                    className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50"
                  >
                    <span
                      className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border ${
                        isSelected
                          ? "border-blue-600 bg-blue-600 text-white"
                          : "border-slate-300 bg-white"
                      }`}
                    >
                      {isSelected && <Check size={13} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-slate-800">
                        {c.name}
                      </span>
                      <span className="block truncate text-xs text-slate-400">
                        {[c.bayiNo, c.email].filter(Boolean).join(" · ") || "—"}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

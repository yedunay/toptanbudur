import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchCustomers, type CustomerListItem } from "../../lib/customers";
import { useDebounce } from "../../lib/useDebounce";

/**
 * Tek bayi seçici (tekli kesim / önizleme kapsamı için). Arama kutusu +
 * sonuç listesi; seçili bayi rozet olarak gösterilir, "×" ile temizlenir.
 */

export interface PickedCustomer {
  id: string;
  name: string;
}

interface CustomerPickerProps {
  value: PickedCustomer | null;
  onChange: (c: PickedCustomer | null) => void;
  disabled?: boolean;
}

const SEARCH_DEBOUNCE_MS = 300;
const RESULT_LIMIT = 8;

export default function CustomerPicker({
  value,
  onChange,
  disabled,
}: CustomerPickerProps): React.ReactElement {
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState(false);
  const debounced = useDebounce(term.trim(), SEARCH_DEBOUNCE_MS);

  const query = useQuery({
    queryKey: ["admin-invoice-customer-picker", debounced],
    queryFn: () => fetchCustomers({ q: debounced, pageSize: RESULT_LIMIT }),
    enabled: open && debounced.length >= 2,
  });

  if (value) {
    return (
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-2 rounded-lg border border-[var(--color-brand-blue)]/30 bg-[var(--color-brand-blue)]/5 px-3 py-1.5 text-sm font-medium text-[var(--color-text)]">
          <span className="h-2 w-2 rounded-full bg-[var(--color-brand-blue)]" />
          {value.name}
        </span>
        <button
          type="button"
          onClick={() => onChange(null)}
          disabled={disabled}
          className="rounded-md border border-[var(--color-border)] bg-white px-2 py-1.5 text-xs font-medium text-[var(--color-text-muted)] transition hover:bg-slate-50 disabled:opacity-60"
          aria-label="Bayi seçimini temizle"
        >
          ×
        </button>
      </div>
    );
  }

  const results: CustomerListItem[] = query.data?.data ?? [];

  return (
    <div className="relative w-full max-w-sm">
      <input
        type="text"
        value={term}
        onChange={(e) => {
          setTerm(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Bayi ara (ad / e-posta)…"
        disabled={disabled}
        className="w-full rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-sm focus:border-[var(--color-brand-blue)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-blue)]/20 disabled:opacity-60"
      />
      {open && debounced.length >= 2 ? (
        <div className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-[var(--color-border)] bg-white shadow-lg">
          {query.isLoading ? (
            <p className="px-3 py-2 text-sm text-[var(--color-text-muted)]">
              Aranıyor…
            </p>
          ) : results.length === 0 ? (
            <p className="px-3 py-2 text-sm text-[var(--color-text-muted)]">
              Sonuç yok
            </p>
          ) : (
            <ul className="divide-y divide-[var(--color-border)]">
              {results.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange({ id: c.id, name: c.name });
                      setOpen(false);
                      setTerm("");
                    }}
                    className="flex w-full flex-col items-start px-3 py-2 text-left transition hover:bg-slate-50"
                  >
                    <span className="text-sm font-medium text-[var(--color-text)]">
                      {c.name}
                    </span>
                    {c.email ? (
                      <span className="text-xs text-[var(--color-text-muted)]">
                        {c.email}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { useDebounce } from "../lib/useDebounce";

export interface SearchableSelectProps<T> {
  /** Seçili öğe (kontrollü). */
  value: T | null;
  /** Seçim değiştiğinde (öğe veya temizlemede null). */
  onChange: (item: T | null) => void;
  /** Sunucu araması — debounce edilmiş terimle çağrılır. */
  search: (q: string) => Promise<T[]>;
  /** React-query cache anahtarı önekleri (kaynak başına ayrı tutmak için). */
  queryKey: string;
  getKey: (item: T) => string;
  getLabel: (item: T) => string;
  /** İkincil satır (e-posta, bayi no vb.) — opsiyonel. */
  getSublabel?: (item: T) => string | null;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  /** Açılışta hangi terimle ön-arama yapılsın (varsayılan: boş = ilk 20). */
  minChars?: number;
}

const DROPDOWN_DEBOUNCE_MS = 250;

export default function SearchableSelect<T>({
  value,
  onChange,
  search,
  queryKey,
  getKey,
  getLabel,
  getSublabel,
  label,
  placeholder = "Ara…",
  disabled = false,
  minChars = 0,
}: SearchableSelectProps<T>) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const debouncedTerm = useDebounce(term, DROPDOWN_DEBOUNCE_MS);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listboxId = useId();

  const canSearch = debouncedTerm.trim().length >= minChars;

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["muhasebe-select", queryKey, debouncedTerm],
    queryFn: () => search(debouncedTerm.trim()),
    enabled: open && canSearch,
    staleTime: 30_000,
  });

  const options = data ?? [];

  // Dışarı tıklayınca kapat
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent): void {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  useEffect(() => {
    setActiveIndex(-1);
  }, [debouncedTerm, open]);

  const selectItem = useCallback(
    (item: T): void => {
      onChange(item);
      setOpen(false);
      setTerm("");
    },
    [onChange],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>): void => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        if (!open) setOpen(true);
        setActiveIndex((i) => Math.min(i + 1, options.length - 1));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (event.key === "Enter") {
        if (open && activeIndex >= 0 && activeIndex < options.length) {
          event.preventDefault();
          selectItem(options[activeIndex]);
        }
      } else if (event.key === "Escape") {
        setOpen(false);
      }
    },
    [open, options, activeIndex, selectItem],
  );

  return (
    <div className="relative" ref={containerRef}>
      {label ? (
        <label
          className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500"
          htmlFor={`${listboxId}-input`}
        >
          {label}
        </label>
      ) : null}

      {value ? (
        <div className="flex h-9 items-center gap-2 rounded-lg border border-[var(--color-border)] bg-white px-3 text-sm">
          <span className="min-w-0 flex-1 truncate font-medium text-[var(--color-text)]">
            {getLabel(value)}
          </span>
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              onChange(null);
              setTerm("");
              setOpen(true);
              requestAnimationFrame(() => inputRef.current?.focus());
            }}
            className="shrink-0 rounded-md p-0.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50"
            aria-label="Seçimi temizle"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      ) : (
        <input
          id={`${listboxId}-input`}
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          autoComplete="off"
          disabled={disabled}
          value={term}
          placeholder={placeholder}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setTerm(e.target.value);
            if (!open) setOpen(true);
          }}
          onKeyDown={handleKeyDown}
          className="h-9 w-full rounded-lg border border-[var(--color-border)] bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-navy)]/30 disabled:bg-slate-50 disabled:opacity-60"
        />
      )}

      {open && !value ? (
        <div
          id={listboxId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-[var(--color-border)] bg-white py-1 shadow-lg"
        >
          {!canSearch ? (
            <div className="px-3 py-2 text-xs text-slate-400">
              En az {minChars} karakter yazın.
            </div>
          ) : isLoading ? (
            <div className="px-3 py-2 text-xs text-slate-400">Aranıyor…</div>
          ) : isError ? (
            <button
              type="button"
              onClick={() => refetch()}
              className="w-full px-3 py-2 text-left text-xs text-rose-600 hover:bg-rose-50"
            >
              Arama başarısız — tekrar dene
            </button>
          ) : options.length === 0 ? (
            <div className="px-3 py-2 text-xs text-slate-400">
              Sonuç bulunamadı.
            </div>
          ) : (
            options.map((item, index) => {
              const sub = getSublabel?.(item);
              const isActive = index === activeIndex;
              return (
                <button
                  type="button"
                  key={getKey(item)}
                  role="option"
                  aria-selected={isActive}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => selectItem(item)}
                  className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left transition-colors ${
                    isActive ? "bg-slate-100" : "hover:bg-slate-50"
                  }`}
                >
                  <span className="truncate text-sm font-medium text-[var(--color-text)]">
                    {getLabel(item)}
                  </span>
                  {sub ? (
                    <span className="truncate text-xs text-slate-400">
                      {sub}
                    </span>
                  ) : null}
                </button>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}

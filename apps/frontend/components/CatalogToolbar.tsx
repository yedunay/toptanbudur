"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const SORT_OPTIONS: { value: string; label: string }[] = [
  { value: "recommended", label: "Önerilenler" },
  { value: "best_selling", label: "Çok Satanlar" },
  { value: "newest", label: "Yeniler" },
  { value: "price_asc", label: "Fiyat: Düşükten Yükseğe" },
  { value: "price_desc", label: "Fiyat: Yüksekten Düşüğe" },
  { value: "name", label: "İsim (A → Z)" },
];

export function CatalogToolbar({ total }: { total: number }) {
  const router = useRouter();
  const sp = useSearchParams();
  const [q, setQ] = useState(sp.get("q") ?? "");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setQ(sp.get("q") ?? "");
  }, [sp]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const onSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const next = new URLSearchParams(sp.toString());
    if (q.trim()) next.set("q", q.trim());
    else next.delete("q");
    next.delete("sayfa");
    router.push(`/katalog?${next.toString()}`, { scroll: false });
  };

  const setSort = (value: string) => {
    const next = new URLSearchParams(sp.toString());
    if (value && value !== "recommended") next.set("sirala", value);
    else next.delete("sirala");
    next.delete("sayfa");
    setOpen(false);
    router.push(`/katalog?${next.toString()}`, { scroll: false });
  };

  const currentSort = sp.get("sirala") ?? "recommended";
  const currentLabel =
    SORT_OPTIONS.find((o) => o.value === currentSort)?.label ?? "Önerilenler";

  return (
    <div className="flex flex-col gap-3 border-b border-[var(--border)] pb-4 sm:flex-row sm:items-center sm:justify-between">
      <form onSubmit={onSearch} className="relative flex w-full max-w-md gap-2">
        <div className="relative flex-1">
          <svg
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            viewBox="0 0 24 24"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" strokeLinecap="round" />
          </svg>
          <input
            type="search"
            name="q"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Ürün, marka veya kod ara…"
            className="w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 pl-9 text-sm outline-none transition focus:border-[var(--brand-blue)] focus:ring-2 focus:ring-[var(--brand-blue)]/20"
          />
        </div>
        <button
          type="submit"
          className="rounded-md bg-[var(--brand-navy)] px-4 py-2 text-sm font-medium text-white transition hover:bg-[var(--brand-blue)]"
        >
          Ara
        </button>
      </form>
      <div className="flex items-center gap-3 text-sm">
        <span className="whitespace-nowrap text-[var(--text-muted)]">
          {total.toLocaleString("tr-TR")} ürün
        </span>
        <div className="relative" ref={ref}>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm font-medium transition hover:border-[var(--brand-blue)]"
          >
            <span className="text-[var(--text-muted)]">Sırala:</span>
            <span>{currentLabel}</span>
            <svg
              className={`h-4 w-4 transition ${open ? "rotate-180" : ""}`}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              viewBox="0 0 24 24"
            >
              <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {open && (
            <div className="absolute right-0 top-full z-20 mt-1 w-56 overflow-hidden rounded-md border border-[var(--border)] bg-white shadow-lg">
              {SORT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setSort(opt.value)}
                  className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm transition hover:bg-[var(--surface-muted)] ${
                    currentSort === opt.value
                      ? "bg-[var(--surface-muted)] font-medium text-[var(--brand-navy)]"
                      : ""
                  }`}
                >
                  <span>{opt.label}</span>
                  {currentSort === opt.value && (
                    <svg
                      className="h-4 w-4 text-[var(--brand-blue)]"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      viewBox="0 0 24 24"
                    >
                      <path
                        d="m5 12 5 5L20 7"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

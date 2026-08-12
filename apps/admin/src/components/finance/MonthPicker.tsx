import { useEffect, useRef, useState } from "react";

// Ay-only seçici ("Temmuz 2026"). Gün YOK — panel ay bazlı çalışır.
// value/onChange "YYYY-MM" formatında.

const TR_MONTHS = [
  "Ocak",
  "Şubat",
  "Mart",
  "Nisan",
  "Mayıs",
  "Haziran",
  "Temmuz",
  "Ağustos",
  "Eylül",
  "Ekim",
  "Kasım",
  "Aralık",
] as const;

export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return month;
  return `${TR_MONTHS[m - 1]} ${y}`;
}

interface MonthPickerProps {
  value: string; // "YYYY-MM"
  onChange: (month: string) => void;
}

export default function MonthPicker({ value, onChange }: MonthPickerProps) {
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState<number>(() => Number(value.split("-")[0]));
  const ref = useRef<HTMLDivElement>(null);
  const selMonth = Number(value.split("-")[1]);
  const selYear = Number(value.split("-")[0]);

  useEffect(() => {
    if (open) setYear(Number(value.split("-")[0]));
  }, [open, value]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  function pick(m: number) {
    onChange(`${year}-${String(m).padStart(2, "0")}`);
    setOpen(false);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-9 items-center gap-2 rounded-lg border border-[var(--color-border)] bg-white px-3 text-sm font-semibold text-[var(--color-text)] shadow-sm hover:bg-slate-50"
      >
        <span aria-hidden>🗓️</span>
        {monthLabel(value)}
        <span className="text-slate-400">▾</span>
      </button>
      {open ? (
        <div className="absolute right-0 z-30 mt-2 w-64 rounded-xl border border-[var(--color-border)] bg-white p-3 shadow-lg">
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setYear((y) => y - 1)}
              className="h-7 w-7 rounded-md text-slate-500 hover:bg-slate-100"
            >
              ‹
            </button>
            <span className="text-sm font-bold text-[var(--color-brand-navy)]">
              {year}
            </span>
            <button
              type="button"
              onClick={() => setYear((y) => y + 1)}
              className="h-7 w-7 rounded-md text-slate-500 hover:bg-slate-100"
            >
              ›
            </button>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {TR_MONTHS.map((label, i) => {
              const m = i + 1;
              const active = m === selMonth && year === selYear;
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => pick(m)}
                  className={`rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
                    active
                      ? "bg-[var(--color-brand-navy)] text-white"
                      : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  {label.slice(0, 3)}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

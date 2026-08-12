"use client";

import { useState } from "react";
import {
  Bell,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Sparkles,
  Zap,
} from "lucide-react";
import type { SuggestionItem } from "./types";
import { toneClasses } from "./helpers";

interface SuggestionsCardProps {
  suggestions: SuggestionItem[];
}

export function SuggestionsCard({ suggestions }: SuggestionsCardProps) {
  const [open, setOpen] = useState(false);

  return (
    <section className="rounded-3xl border border-[var(--ab-border)] bg-white p-5 shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="suggestions-panel"
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <span className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-2xl bg-purple-50 text-purple-500">
            <Sparkles className="h-4 w-4" aria-hidden="true" />
          </span>
          <h2 className="text-base font-black text-[var(--ab-text)] sm:text-lg">
            Öneriler
          </h2>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600">
            {suggestions.length}
          </span>
        </span>
        <ChevronDown
          className={[
            "h-5 w-5 shrink-0 text-slate-500 transition-transform duration-200",
            open ? "rotate-180" : "rotate-0",
          ].join(" ")}
          aria-hidden="true"
        />
      </button>

      <div
        id="suggestions-panel"
        hidden={!open}
        className={open ? "mt-4" : undefined}
      >
        <ul className="space-y-3">
          {suggestions.map((item) => (
            <li
              key={item.id}
              className="flex items-start gap-3 rounded-2xl border border-slate-100 bg-slate-50/60 p-3"
            >
              <span
                aria-hidden="true"
                className={[
                  "flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl",
                  toneClasses[item.tone],
                ].join(" ")}
              >
                {item.tone === "green" ? <CheckCircle2 className="h-5 w-5" /> : null}
                {item.tone === "orange" ? <Bell className="h-5 w-5" /> : null}
                {item.tone === "purple" ? <Zap className="h-5 w-5" /> : null}
                {item.tone === "blue" ? <Sparkles className="h-5 w-5" /> : null}
              </span>

              <span className="min-w-0 flex-1">
                <span className="block text-sm font-black text-[var(--ab-text)]">
                  {item.title}
                </span>
                <span className="mt-1 block text-xs leading-5 text-slate-500">
                  {item.description}
                </span>
              </span>

              <ChevronRight
                className="mt-2 h-4 w-4 text-slate-400"
                aria-hidden="true"
              />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

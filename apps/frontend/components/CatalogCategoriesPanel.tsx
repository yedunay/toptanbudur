"use client";

import { useEffect, useState } from "react";
import {
  CATEGORY_VISIBILITY_COOKIE,
  CATEGORY_VISIBILITY_MAX_AGE,
  type CategoryVisibility,
} from "@/lib/catalog-prefs";

interface CatalogCategoriesPanelProps {
  initial: CategoryVisibility | null;
  children: React.ReactNode;
}

function writeVisibilityCookie(value: CategoryVisibility) {
  if (typeof document === "undefined") return;
  const isHttps =
    typeof window !== "undefined" && window.location.protocol === "https:";
  const parts = [
    `${CATEGORY_VISIBILITY_COOKIE}=${value}`,
    "Path=/",
    `Max-Age=${CATEGORY_VISIBILITY_MAX_AGE}`,
    "SameSite=Lax",
  ];
  if (isHttps) parts.push("Secure");
  document.cookie = parts.join("; ");
}

export function CatalogCategoriesPanel({
  initial,
  children,
}: CatalogCategoriesPanelProps) {
  const [userPreference, setUserPreference] = useState<CategoryVisibility | null>(
    initial,
  );

  const mobileOpen =
    userPreference === "open" ? true : userPreference === "closed" ? false : false;

  const toggleMobile = () => {
    const next: CategoryVisibility = mobileOpen ? "closed" : "open";
    setUserPreference(next);
    writeVisibilityCookie(next);
  };

  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    root.dataset.catVisibility = userPreference ?? "default";
    return () => {
      delete root.dataset.catVisibility;
    };
  }, [userPreference]);

  return (
    <div
      className="w-full lg:w-[300px] lg:shrink-0"
      data-cat-panel
      data-user-preference={userPreference ?? "default"}
    >
      <div className="lg:hidden">
        <button
          type="button"
          aria-expanded={mobileOpen}
          aria-controls="catalog-categories-panel"
          onClick={toggleMobile}
          className="flex w-full items-center justify-between rounded-xl border border-[var(--border)] bg-white px-4 py-3 text-sm font-semibold text-[var(--brand-navy)] shadow-sm transition hover:border-[var(--brand-blue)]"
        >
          <span className="flex items-center gap-2">
            <svg
              className="h-4 w-4 text-[var(--brand-blue)]"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                d="M4 6h16M4 12h16M4 18h10"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Kategoriler
          </span>
          <span className="flex items-center gap-1.5 text-xs font-medium text-[var(--text-muted)]">
            {mobileOpen ? "Gizle" : "Göster"}
            <svg
              className={`h-4 w-4 transition-transform duration-200 ${
                mobileOpen ? "rotate-180" : ""
              }`}
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </button>
      </div>

      <div
        id="catalog-categories-panel"
        className={`${
          mobileOpen ? "mt-3 grid-rows-[1fr]" : "mt-0 grid-rows-[0fr]"
        } grid overflow-hidden transition-[grid-template-rows,margin] duration-300 ease-out lg:mt-0 lg:!grid-rows-[1fr] lg:!overflow-visible`}
      >
        <div className="min-h-0 lg:min-h-fit">{children}</div>
      </div>
    </div>
  );
}

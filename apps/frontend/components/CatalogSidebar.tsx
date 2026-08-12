"use client";

import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { CategoryNode } from "@/lib/api";

type Props = {
  categories: CategoryNode[];
  active: {
    kategori?: string;
    min?: string;
    max?: string;
    stoklu?: string;
  };
};

function buildHref(
  current: URLSearchParams,
  patch: Record<string, string | null>,
) {
  const next = new URLSearchParams(current.toString());
  Object.entries(patch).forEach(([k, v]) => {
    if (v === null || v === "") next.delete(k);
    else next.set(k, v);
  });
  next.delete("sayfa");
  const qs = next.toString();
  return qs ? `/katalog?${qs}` : "/katalog";
}

function pathOfActive(
  nodes: CategoryNode[],
  slug: string | undefined,
  trail: string[] = [],
): string[] | null {
  if (!slug) return null;
  for (const n of nodes) {
    const next = [...trail, n.slug];
    if (n.slug === slug) return next;
    if (n.children) {
      const found = pathOfActive(n.children, slug, next);
      if (found) return found;
    }
  }
  return null;
}

function CategoryItem({
  node,
  activeSlug,
  activeAncestors,
  sp,
  depth = 0,
}: {
  node: CategoryNode;
  activeSlug?: string;
  activeAncestors: Set<string>;
  sp: URLSearchParams;
  depth?: number;
}) {
  const isActive = activeSlug === node.slug;
  const isAncestor = activeAncestors.has(node.slug);
  const hasChildren = !!node.children && node.children.length > 0;
  const [open, setOpen] = useState<boolean>(
    () => isAncestor || isActive || depth === 0,
  );

  useEffect(() => {
    if (isAncestor || isActive) setOpen(true);
  }, [isAncestor, isActive]);

  return (
    <li className="group/item">
      <div
        className={`relative flex items-center gap-1 rounded-md transition ${
          isActive
            ? "bg-[var(--brand-blue)] text-white shadow-sm"
            : "hover:bg-white"
        }`}
      >
        {hasChildren ? (
          <button
            type="button"
            aria-label={open ? "Daralt" : "Genişlet"}
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className={`grid h-7 w-7 shrink-0 place-items-center rounded transition ${
              isActive
                ? "text-white/80 hover:text-white"
                : "text-[var(--text-muted)] hover:text-[var(--brand-navy)]"
            }`}
          >
            <svg
              className={`h-3.5 w-3.5 transition-transform duration-200 ${
                open ? "rotate-90" : ""
              }`}
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              viewBox="0 0 24 24"
            >
              <path d="m9 6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        ) : (
          <span className="inline-block h-7 w-7 shrink-0" />
        )}
        <Link
          href={buildHref(sp, { kategori: node.slug })}
          scroll={false}
          className={`flex flex-1 items-center justify-between truncate py-1.5 pr-2 text-sm transition ${
            isActive
              ? "font-medium text-white"
              : isAncestor
                ? "font-medium text-[var(--brand-navy)]"
                : "text-[var(--text)]"
          }`}
        >
          <span className="truncate">{node.name}</span>
          {typeof node.count === "number" && (
            <span
              className={`ml-2 shrink-0 rounded-full px-1.5 py-0.5 text-[10px] tabular-nums ${
                isActive
                  ? "bg-white/20 text-white"
                  : "bg-[var(--surface-muted)] text-[var(--text-muted)]"
              }`}
            >
              {node.count}
            </span>
          )}
        </Link>
      </div>
      {hasChildren && (
        <div
          className={`grid overflow-hidden transition-[grid-template-rows] duration-200 ease-out ${
            open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
          }`}
        >
          <ul className="ml-3.5 min-h-0 space-y-0.5 border-l border-dashed border-[var(--border)] pl-2 pt-1">
            {node.children!.map((c) => (
              <CategoryItem
                key={c.slug}
                node={c}
                activeSlug={activeSlug}
                activeAncestors={activeAncestors}
                sp={sp}
                depth={depth + 1}
              />
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}

export function CatalogSidebar({ categories, active }: Props) {
  const router = useRouter();
  const sp = useSearchParams();
  const [min, setMin] = useState(active.min ?? "");
  const [max, setMax] = useState(active.max ?? "");
  const [search, setSearch] = useState("");

  const activeAncestors = useMemo(() => {
    const trail = pathOfActive(categories, active.kategori);
    return new Set(trail ?? []);
  }, [categories, active.kategori]);

  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("tr-TR");
    if (!term) return categories;
    function filterNodes(nodes: CategoryNode[]): CategoryNode[] {
      const out: CategoryNode[] = [];
      for (const n of nodes) {
        const matches = n.name.toLocaleLowerCase("tr-TR").includes(term);
        const childMatches = n.children ? filterNodes(n.children) : [];
        if (matches || childMatches.length > 0) {
          out.push({
            ...n,
            children: childMatches.length > 0 ? childMatches : n.children,
          });
        }
      }
      return out;
    }
    return filterNodes(categories);
  }, [categories, search]);

  const onPriceApply = (e: React.FormEvent) => {
    e.preventDefault();
    const next = new URLSearchParams(sp.toString());
    if (min) next.set("min", min);
    else next.delete("min");
    if (max) next.set("max", max);
    else next.delete("max");
    next.delete("sayfa");
    router.push(`/katalog?${next.toString()}`, { scroll: false });
  };

  const clearPrice = () => {
    setMin("");
    setMax("");
    const next = new URLSearchParams(sp.toString());
    next.delete("min");
    next.delete("max");
    next.delete("sayfa");
    router.push(`/katalog?${next.toString()}`, { scroll: false });
  };

  const toggleStock = () => {
    const next = new URLSearchParams(sp.toString());
    if (active.stoklu === "1") next.delete("stoklu");
    else next.set("stoklu", "1");
    next.delete("sayfa");
    router.push(`/katalog?${next.toString()}`, { scroll: false });
  };

  const hasActive = !!(active.kategori || active.min || active.max || active.stoklu);

  return (
    <aside className="w-full">
      <div className="space-y-5 lg:sticky lg:top-20">
        <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-gradient-to-b from-white to-[var(--surface-muted)] shadow-sm">
          <header className="flex items-center justify-between border-b border-[var(--border)] bg-white px-4 py-3">
            <h3 className="text-sm font-semibold tracking-tight text-[var(--brand-navy)]">
              Kategoriler
            </h3>
            {hasActive && (
              <Link
                href="/katalog"
                scroll={false}
                className="text-xs text-[var(--brand-blue)] hover:underline"
              >
                Filtreleri temizle
              </Link>
            )}
          </header>
          <div className="space-y-3 p-3">
            <div className="relative">
              <svg
                className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]"
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
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Kategori ara…"
                className="w-full rounded-md border border-[var(--border)] bg-white px-3 py-1.5 pl-8 text-xs outline-none transition focus:border-[var(--brand-blue)] focus:ring-2 focus:ring-[var(--brand-blue)]/15"
              />
            </div>
            {filtered.length === 0 ? (
              <p className="px-2 py-3 text-center text-sm text-[var(--text-muted)]">
                Kategori bulunamadı.
              </p>
            ) : (
              <ul className="max-h-[58vh] space-y-0.5 overflow-y-auto pr-1">
                <li>
                  <Link
                    href={buildHref(sp, { kategori: null })}
                    scroll={false}
                    className={`flex items-center justify-between rounded-md px-2.5 py-2 text-sm font-medium transition ${
                      !active.kategori
                        ? "bg-[var(--brand-navy)] text-white shadow-sm"
                        : "text-[var(--text)] hover:bg-white"
                    }`}
                  >
                    <span>Tüm Ürünler</span>
                  </Link>
                </li>
                {filtered.map((c) => (
                  <CategoryItem
                    key={c.slug}
                    node={c}
                    activeSlug={active.kategori}
                    activeAncestors={activeAncestors}
                    sp={sp}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-[var(--border)] bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold tracking-tight text-[var(--brand-navy)]">
              Fiyat (₺)
            </h3>
            {(min || max) && (
              <button
                type="button"
                onClick={clearPrice}
                className="text-xs text-[var(--brand-blue)] hover:underline"
              >
                Sıfırla
              </button>
            )}
          </div>
          <form onSubmit={onPriceApply} className="space-y-2">
            <div className="flex items-center gap-2">
              <input
                type="number"
                inputMode="decimal"
                placeholder="Min"
                value={min}
                onChange={(e) => setMin(e.target.value)}
                className="w-full rounded-md border border-[var(--border)] bg-white px-2.5 py-1.5 text-sm outline-none transition focus:border-[var(--brand-blue)]"
              />
              <span className="text-[var(--text-muted)]">—</span>
              <input
                type="number"
                inputMode="decimal"
                placeholder="Max"
                value={max}
                onChange={(e) => setMax(e.target.value)}
                className="w-full rounded-md border border-[var(--border)] bg-white px-2.5 py-1.5 text-sm outline-none transition focus:border-[var(--brand-blue)]"
              />
            </div>
            <button
              type="submit"
              className="w-full rounded-md bg-[var(--brand-navy)] py-2 text-sm font-medium text-white transition hover:bg-[var(--brand-blue)]"
            >
              Uygula
            </button>
          </form>
        </div>

        <div className="rounded-xl border border-[var(--border)] bg-white p-4 shadow-sm">
          <label className="flex cursor-pointer items-center gap-3 text-sm font-medium">
            <span className="relative inline-flex">
              <input
                type="checkbox"
                checked={active.stoklu === "1"}
                onChange={toggleStock}
                className="peer h-4 w-4 cursor-pointer appearance-none rounded border border-[var(--border)] bg-white transition checked:border-[var(--brand-blue)] checked:bg-[var(--brand-blue)]"
              />
              <svg
                className="pointer-events-none absolute inset-0 m-auto h-3 w-3 text-white opacity-0 peer-checked:opacity-100"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                viewBox="0 0 24 24"
              >
                <path d="m5 12 5 5L20 7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <span>Sadece stokta olanlar</span>
          </label>
        </div>
      </div>
    </aside>
  );
}

import Link from "next/link";

function buildHref(base: URLSearchParams, page: number) {
  const next = new URLSearchParams(base.toString());
  if (page <= 1) next.delete("sayfa");
  else next.set("sayfa", String(page));
  const qs = next.toString();
  return qs ? `/katalog?${qs}` : "/katalog";
}

export function Pagination({
  current,
  totalPages,
  searchParams,
}: {
  current: number;
  totalPages: number;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  if (totalPages <= 1) return null;
  const sp = new URLSearchParams();
  Object.entries(searchParams).forEach(([k, v]) => {
    if (v == null) return;
    if (Array.isArray(v)) v.forEach((x) => sp.append(k, x));
    else sp.set(k, v);
  });

  const window = 2;
  const pages: number[] = [];
  for (
    let p = Math.max(1, current - window);
    p <= Math.min(totalPages, current + window);
    p++
  ) {
    pages.push(p);
  }
  if (!pages.includes(1)) pages.unshift(1);
  if (!pages.includes(totalPages)) pages.push(totalPages);

  const cls = (active: boolean) =>
    `min-w-9 rounded-md border px-3 py-1.5 text-sm transition ${
      active
        ? "border-[var(--brand-navy)] bg-[var(--brand-navy)] text-white"
        : "border-[var(--border)] bg-white hover:border-[var(--brand-blue)] hover:text-[var(--brand-blue)]"
    }`;

  return (
    <nav
      aria-label="Sayfalama"
      className="mt-8 flex flex-wrap items-center justify-center gap-2"
    >
      <Link
        aria-disabled={current <= 1}
        href={buildHref(sp, Math.max(1, current - 1))}
        className={`${cls(false)} ${
          current <= 1 ? "pointer-events-none opacity-40" : ""
        }`}
      >
        ← Önceki
      </Link>
      {pages.map((p, i) => {
        const prev = pages[i - 1];
        const gap = prev && p - prev > 1;
        return (
          <span key={p} className="flex items-center gap-2">
            {gap && <span className="text-[var(--text-muted)]">…</span>}
            <Link href={buildHref(sp, p)} className={cls(p === current)}>
              {p}
            </Link>
          </span>
        );
      })}
      <Link
        aria-disabled={current >= totalPages}
        href={buildHref(sp, Math.min(totalPages, current + 1))}
        className={`${cls(false)} ${
          current >= totalPages ? "pointer-events-none opacity-40" : ""
        }`}
      >
        Sonraki →
      </Link>
    </nav>
  );
}

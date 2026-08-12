import Link from "next/link";

type Reason = "not_found" | "out_of_stock" | "removed";

interface ProductUnavailableProps {
  reason: Reason;
  productName?: string;
}

const COPY: Record<Reason, { title: string; body: string; cta?: string }> = {
  not_found: {
    title: "Ürün bulunamadı",
    body: "Aradığınız ürün kaldırılmış veya hiç eklenmemiş olabilir. Kataloğa dönerek benzer ürünleri inceleyebilirsiniz.",
  },
  removed: {
    title: "Bu ürün artık satışta değil",
    body: "Kaldırılan bu ürün için size yakın alternatifler kataloğumuzda yer alıyor.",
  },
  out_of_stock: {
    title: "Ürün tükendi",
    body: "Şu anda stoğumuzda bulunmuyor. Yeniden geldiğinde haberdar olmak için bildirim alabilirsiniz.",
    cta: "Stok geldiğinde haber ver",
  },
};

export function ProductUnavailable({ reason, productName }: ProductUnavailableProps) {
  const copy = COPY[reason];
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <div className="rounded-xl border border-[var(--border)] bg-white p-10 text-center shadow-sm">
        <div className="mx-auto mb-6 grid h-16 w-16 place-items-center rounded-full bg-[var(--surface-muted)] text-3xl">
          {reason === "out_of_stock" ? "⏳" : "🗂️"}
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--brand-navy)]">
          {copy.title}
        </h1>
        {productName && (
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            {productName}
          </p>
        )}
        <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-[var(--text-muted)]">
          {copy.body}
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/katalog"
            className="rounded-md bg-[var(--brand-blue)] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[var(--brand-navy)]"
          >
            Ürünlere geri dön
          </Link>
          {copy.cta && (
            <button
              type="button"
              disabled
              className="rounded-md border border-[var(--border)] bg-white px-5 py-2.5 text-sm font-semibold text-[var(--text-muted)]"
              title="Yakında"
            >
              {copy.cta}
            </button>
          )}
        </div>
      </div>
    </main>
  );
}

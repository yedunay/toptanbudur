import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-20">
      <div className="rounded-xl border border-[var(--border)] bg-white p-10 text-center shadow-sm">
        <div className="mx-auto mb-6 grid h-16 w-16 place-items-center rounded-full bg-[var(--surface-muted)] text-3xl">
          🧭
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--brand-navy)]">
          Aradığınız sayfa kaldırılmış olabilir
        </h1>
        <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-[var(--text-muted)]">
          Bu adres artık geçerli değil veya bağlantı eski olabilir. Kataloğa
          giderek ürünleri incelemeye devam edebilirsiniz.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/katalog"
            className="rounded-md bg-[var(--brand-blue)] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[var(--brand-navy)]"
          >
            Kataloğa git
          </Link>
          <Link
            href="/"
            className="rounded-md border border-[var(--border)] bg-white px-5 py-2.5 text-sm font-semibold text-[var(--text)] transition hover:bg-[var(--surface-muted)]"
          >
            Ana sayfa
          </Link>
        </div>
      </div>
    </main>
  );
}

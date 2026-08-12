"use client";

import Link from "next/link";
import { useEffect } from "react";

interface ErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: ErrorPageProps) {
  useEffect(() => {
    if (typeof window !== "undefined") {
      // Surface to monitoring; avoid leaking details to the user.
      // eslint-disable-next-line no-console
      console.error("[ui:error]", error?.digest ?? error?.message);
    }
  }, [error]);

  return (
    <main className="mx-auto max-w-3xl px-6 py-20">
      <div className="rounded-xl border border-[var(--border)] bg-white p-10 text-center shadow-sm">
        <div className="mx-auto mb-6 grid h-16 w-16 place-items-center rounded-full bg-[var(--surface-muted)] text-3xl">
          ⚠️
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--brand-navy)]">
          Şu an bağlantı kurulamıyor
        </h1>
        <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-[var(--text-muted)]">
          İçerik geçici olarak yüklenemiyor. Bir kaç saniye sonra yeniden
          deneyebilir veya kataloğa dönebilirsiniz.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="rounded-md bg-[var(--brand-blue)] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[var(--brand-navy)]"
          >
            Tekrar dene
          </button>
          <Link
            href="/katalog"
            className="rounded-md border border-[var(--border)] bg-white px-5 py-2.5 text-sm font-semibold text-[var(--text)] transition hover:bg-[var(--surface-muted)]"
          >
            Kataloğa dön
          </Link>
        </div>
      </div>
    </main>
  );
}

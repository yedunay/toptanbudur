import Link from "next/link";

/**
 * Kurumsal / yasal sayfaların ortak kabuğu (başlık + içerik kartı).
 *
 * ⚠️ İÇERİK KURALI: Bu sayfalarda UYDURMA hukuki metin, sahte şirket unvanı,
 * sahte VKN / MERSİS / adres BULUNMAZ. Müşterinin gerçek künyesi ve iade
 * koşulları elimize geçene kadar `children` verilmeyen her sayfa nötr bir
 * "yakında yayınlanacaktır" bildirimi gösterir.
 */
export interface LegalPageProps {
  title: string;
  /** Sayfanın ne olduğunu anlatan kısa, nötr açıklama. */
  intro?: string;
  /** Verilmezse nötr "içerik yakında" bildirimi gösterilir. */
  children?: React.ReactNode;
}

export function LegalPage({ title, intro, children }: LegalPageProps) {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12 sm:py-16">
      <h1 className="text-2xl font-bold tracking-tight text-[var(--brand-navy)] sm:text-3xl">
        {title}
      </h1>
      {intro ? (
        <p className="mt-3 text-sm leading-relaxed text-[var(--text-muted)]">
          {intro}
        </p>
      ) : null}
      <div className="mt-8 rounded-xl border border-[var(--border)] bg-white p-6 shadow-sm sm:p-8">
        {children ?? <ContentPending />}
      </div>
    </main>
  );
}

function ContentPending() {
  return (
    <div className="space-y-4 text-sm leading-relaxed text-[var(--text-muted)]">
      <p>Bu sayfanın içeriği yakında yayınlanacaktır.</p>
      <p>
        Sorularınız için{" "}
        <Link
          href="/iletisim"
          className="font-semibold text-[var(--brand-blue)] hover:text-[var(--brand-navy)]"
        >
          bizimle iletişime geçebilirsiniz
        </Link>
        .
      </p>
    </div>
  );
}

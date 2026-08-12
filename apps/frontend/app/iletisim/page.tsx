import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/LegalPage";
import { CONTACT, whatsappLink } from "@/lib/contact";

export const metadata: Metadata = {
  title: "İletişim — Toptan Budur",
};

const linkClass =
  "font-semibold text-[var(--brand-blue)] hover:text-[var(--brand-navy)]";

/**
 * ⚠️ Burada YALNIZCA kodda hâlihazırda tanımlı iletişim bilgisi gösterilir
 * (`lib/contact.ts`). Adres / telefon müşteriden alınıp `NEXT_PUBLIC_CONTACT_*`
 * env değişkenleriyle verilmediği sürece UYDURULMAZ, hiç render edilmez.
 */
export default function IletisimPage() {
  return (
    <LegalPage
      title="İletişim"
      intro="Sipariş, bayilik ve ürünlerle ilgili sorularınız için bize ulaşın."
    >
      <dl className="space-y-6 text-sm leading-relaxed">
        <div>
          <dt className="font-semibold text-[var(--text)]">E-posta</dt>
          <dd className="mt-1">
            <a href={`mailto:${CONTACT.email}`} className={linkClass}>
              {CONTACT.email}
            </a>
          </dd>
        </div>

        {CONTACT.phoneE164 && CONTACT.phoneDisplay ? (
          <div>
            <dt className="font-semibold text-[var(--text)]">Telefon</dt>
            <dd className="mt-1">
              <a href={`tel:${CONTACT.phoneE164}`} className={linkClass}>
                {CONTACT.phoneDisplay}
              </a>
            </dd>
          </div>
        ) : null}

        {CONTACT.whatsappNumber ? (
          <div>
            <dt className="font-semibold text-[var(--text)]">WhatsApp</dt>
            <dd className="mt-1">
              <a
                href={whatsappLink()}
                target="_blank"
                rel="noopener noreferrer"
                className={linkClass}
              >
                WhatsApp üzerinden yazın
              </a>
            </dd>
          </div>
        ) : null}
      </dl>

      <p className="mt-8 border-t border-[var(--border)] pt-6 text-sm leading-relaxed text-[var(--text-muted)]">
        Bayilik başvurusu yapmak istiyorsanız{" "}
        <Link href="/basvuru" className={linkClass}>
          başvuru formunu
        </Link>{" "}
        doldurabilirsiniz.
      </p>
    </LegalPage>
  );
}

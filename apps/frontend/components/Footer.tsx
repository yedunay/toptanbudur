"use client";

import Image from "next/image";
import Link from "next/link";
import { APP_URLS, LANDING_URLS } from "@/lib/urls";
import { COMPANY, CONTACT, HAS_COMPANY_REGISTRY } from "@/lib/contact";
import { useCustomer } from "@/lib/auth";
import { PaymentLogos } from "@/components/PaymentLogos";

type FooterLink = { href: string; label: string; external: boolean };

function buildSections(loggedIn: boolean): { title: string; links: FooterLink[] }[] {
  // Giriş yapmış müşteriler zaten bayi → "Bayilik Başvurusu" / "Bayi Girişi"
  // bağlantıları gösterilmez.
  // `external` yalnızca ayrı bir uygulamaya giden bağlantılar için true kalır
  // (admin paneli). Kurumsal/yasal sayfaların hepsi artık storefront içinde.
  const companyLinks: FooterLink[] = [
    { href: LANDING_URLS.about, label: "Hakkımızda", external: false },
    ...(loggedIn
      ? []
      : [
          { href: LANDING_URLS.apply, label: "Bayilik Başvurusu", external: false },
        ]),
    { href: LANDING_URLS.contact, label: "İletişim", external: false },
    ...(loggedIn
      ? []
      : [{ href: APP_URLS.adminLogin, label: "Bayi Girişi", external: true }]),
  ];

  return [
    {
      title: "Ürün",
      links: [{ href: "/katalog", label: "Katalog", external: false }],
    },
    { title: "Şirket", links: companyLinks },
    {
      title: "Yasal",
      links: [
        { href: LANDING_URLS.mesafeliSatis, label: "Mesafeli Satış Sözleşmesi", external: false },
        { href: LANDING_URLS.iadeIptal, label: "İptal ve İade Şartları", external: false },
        { href: LANDING_URLS.teslimat, label: "Teslimat ve Kargo", external: false },
        { href: LANDING_URLS.kvkk, label: "KVKK Aydınlatma", external: false },
        { href: LANDING_URLS.gizlilik, label: "Gizlilik Politikası", external: false },
        { href: LANDING_URLS.cerez, label: "Çerez Politikası", external: false },
        { href: LANDING_URLS.kullanimSartlari, label: "Kullanım Şartları", external: false },
      ],
    },
  ];
}

export function Footer() {
  const { customer } = useCustomer();
  const sections = buildSections(Boolean(customer));
  return (
    <footer className="bg-white border-t border-[var(--border)] pt-16 pb-8 mt-auto">
      <div className="mx-auto max-w-7xl px-6">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-8 mb-12">
          <div className="col-span-2">
            <Link href={LANDING_URLS.home} className="flex items-center gap-2">
              <Image
                src="/toptanbudur-logo.webp"
                alt="Toptan Budur"
                width={180}
                height={104}
                className="h-11 w-auto"
              />
            </Link>
            <p className="text-sm text-[var(--text-muted)] max-w-sm mt-4 mb-5 leading-relaxed">
              Toptan Alım · Güvenli Ticaret · Hızlı Teslimat
            </p>
            <ul className="space-y-2 text-sm text-[var(--text-muted)]">
              <li>
                <a
                  href={`mailto:${CONTACT.email}`}
                  className="hover:text-[var(--brand-blue)] transition-colors"
                >
                  {CONTACT.email}
                </a>
              </li>
              {CONTACT.phoneE164 && CONTACT.phoneDisplay ? (
                <li>
                  <a
                    href={`tel:${CONTACT.phoneE164}`}
                    className="hover:text-[var(--brand-blue)] transition-colors"
                  >
                    {CONTACT.phoneDisplay}
                  </a>
                </li>
              ) : null}
            </ul>
          </div>

          {sections.map((section) => (
            <div key={section.title}>
              <h4 className="text-xs font-semibold text-[var(--brand-navy)] mb-4 uppercase tracking-wider">
                {section.title}
              </h4>
              <ul className="space-y-2">
                {section.links.map((link) => (
                  <li key={link.label}>
                    {link.external ? (
                      <a
                        href={link.href}
                        className="text-sm text-[var(--text-muted)] hover:text-[var(--brand-blue)] transition-colors"
                      >
                        {link.label}
                      </a>
                    ) : (
                      <Link
                        href={link.href}
                        className="text-sm text-[var(--text-muted)] hover:text-[var(--brand-blue)] transition-colors"
                      >
                        {link.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="pt-8 border-t border-[var(--border)]">
          {HAS_COMPANY_REGISTRY ? (
            <p className="text-xs text-[var(--text-muted)] text-center sm:text-left leading-relaxed mb-4">
              {COMPANY.legalName} ({COMPANY.brand}) ·{" "}
              {COMPANY.taxOffice} — VKN: {COMPANY.taxNumber} · MERSİS:{" "}
              {COMPANY.mersis}
            </p>
          ) : null}
          <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
            <p className="text-sm text-[var(--text-muted)]">
              © 2026 {COMPANY.brand} · Tüm hakları saklıdır.
            </p>
            <div className="flex items-center gap-3">
              <PaymentLogos height={28} />
              <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
                <span>SSL ile korunmaktadır</span>
                <span aria-hidden>·</span>
                <span>KVKK Uyumlu</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}

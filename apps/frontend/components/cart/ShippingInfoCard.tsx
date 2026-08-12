"use client";

import Link from "next/link";
import { AlertTriangle, FileText, MapPin, Pencil, Truck } from "lucide-react";
import type { Customer } from "@/lib/auth";

export interface SavedAddress {
  id: string;
  title: string;
  fullName: string;
  phone?: string | null;
  line1: string;
  line2?: string | null;
  city: string;
  district?: string | null;
  postalCode?: string | null;
  isDefault?: boolean;
}

interface ShippingInfoCardProps {
  customer: Customer | null;
  /** Sipariş için kullanılan adres (isDefault=true). */
  defaultAddress: SavedAddress | null;
  /** Fatura adresi (kargo adresinden farklıysa ayrı blok olarak gösterilir). */
  billingAddress?: SavedAddress | null;
  /** true → sıkı doğrulama: profil + adres tamam mı (sipariş için yeterli mi). */
  showCompleteness?: boolean;
}

function formatAddressLine(address: SavedAddress): string {
  const parts: string[] = [];
  parts.push(address.line1);
  if (address.line2) parts.push(address.line2);
  if (address.district) parts.push(address.district);
  const cityPostal = [address.city, address.postalCode]
    .filter(Boolean)
    .join(" ");
  if (cityPostal) parts.push(cityPostal);
  return parts.filter((p) => p && p.trim()).join(", ");
}

interface AddressBlockProps {
  address: SavedAddress;
  /** İkonu özelleştir — fatura için FileText, kargo için Truck. */
  icon: typeof MapPin;
  label: string;
}

function AddressBlock({ address, icon: Icon, label }: AddressBlockProps) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
      <div className="mb-1 flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 text-[var(--brand-blue)]" />
        <span className="text-xs font-black uppercase tracking-wide text-[var(--text-muted)]">
          {label}
        </span>
        {address.isDefault ? (
          <span className="rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-black text-[var(--brand-blue)]">
            Sipariş bu adrese
          </span>
        ) : null}
      </div>
      <p className="text-sm font-black text-[var(--text)]">
        {address.fullName}
      </p>
      <p className="mt-0.5 text-xs leading-5 text-[var(--text-muted)]">
        {formatAddressLine(address)}
      </p>
      {address.phone ? (
        <p className="mt-0.5 text-xs text-[var(--text-muted)]">
          Tel: {address.phone}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Müşteri profili + adres(ler) okunur özeti. Fatura ve kargo adresi
 * farklıysa iki blok render edilir; aynı veya tek adres varsa kompakt
 * tek blok gösterilir. Tek hakikat kaynağı /hesabim/ayarlar#billing.
 */
export function ShippingInfoCard({
  customer,
  defaultAddress,
  billingAddress,
  showCompleteness,
}: ShippingInfoCardProps) {
  const missing: string[] = [];
  if (!customer) {
    missing.push("oturum");
  } else {
    if (!customer.name?.trim()) missing.push("ad soyad");
    if (!customer.email?.trim()) missing.push("e-posta");
    if (!customer.phone?.trim()) missing.push("telefon");
  }
  if (
    !defaultAddress ||
    !defaultAddress.line1?.trim() ||
    !defaultAddress.city?.trim() ||
    !defaultAddress.postalCode?.trim()
  ) {
    missing.push("varsayılan adres");
  }

  const hasIssues = missing.length > 0;

  // Fatura ve kargo farklı mı? — billingAddress sağlandıysa ve
  // defaultAddress'tan farklıysa iki blok gösterilir.
  const hasSeparateBilling =
    !!billingAddress &&
    !!defaultAddress &&
    billingAddress.id !== defaultAddress.id;

  return (
    <section className="rounded-3xl border border-[var(--border)] bg-white p-5 shadow-sm">
      <header className="mb-1 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-black text-[var(--text)]">
          <FileText className="h-4 w-4 text-[var(--brand-blue)]" />
          Hesap & Fatura Bilgileriniz
        </h2>
        <Link
          href="/hesabim/ayarlar#billing"
          className="inline-flex items-center gap-1 text-xs font-black text-[var(--brand-blue)] hover:underline"
        >
          <Pencil className="h-3 w-3" />
          Düzenle
        </Link>
      </header>
      <p className="mb-3 text-xs leading-5 text-[var(--text-muted)]">
        Bu bilgiler size kesilen fatura ve sipariş kayıtları içindir; pazaryeri
        son müşterisine gönderilmez.
      </p>

      {customer ? (
        <>
          <dl className="space-y-2 text-sm">
            <div className="flex items-baseline gap-2">
              <dt className="w-20 shrink-0 text-xs font-semibold text-[var(--text-muted)]">
                Ad Soyad
              </dt>
              <dd className="font-black text-[var(--text)]">
                {customer.name || (
                  <span className="text-red-600">eksik</span>
                )}
              </dd>
            </div>
            <div className="flex items-baseline gap-2">
              <dt className="w-20 shrink-0 text-xs font-semibold text-[var(--text-muted)]">
                E-posta
              </dt>
              <dd className="font-semibold text-[var(--text)]">
                {customer.email || (
                  <span className="text-red-600">eksik</span>
                )}
              </dd>
            </div>
            <div className="flex items-baseline gap-2">
              <dt className="w-20 shrink-0 text-xs font-semibold text-[var(--text-muted)]">
                Telefon
              </dt>
              <dd className="font-semibold text-[var(--text)]">
                {customer.phone || (
                  <span className="text-red-600">eksik</span>
                )}
              </dd>
            </div>
          </dl>

          {hasSeparateBilling ? (
            <div className="mt-3 grid gap-2">
              <AddressBlock
                address={billingAddress!}
                icon={FileText}
                label="Fatura Adresi"
              />
              <AddressBlock
                address={defaultAddress!}
                icon={Truck}
                label="Kargo Adresi"
              />
            </div>
          ) : defaultAddress ? (
            <div className="mt-3">
              <AddressBlock
                address={defaultAddress}
                icon={MapPin}
                label={defaultAddress.title || "Adres"}
              />
            </div>
          ) : (
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-900">
              Adres bilgisi yok — sipariş için tanımlamanız gerekir.
            </div>
          )}
        </>
      ) : (
        <p className="text-sm font-semibold text-[var(--text-muted)]">
          Bilgiler için{" "}
          <Link
            href="/giris?next=/sepet"
            className="font-black text-[var(--brand-blue)] hover:underline"
          >
            giriş yapın
          </Link>
          .
        </p>
      )}

      {showCompleteness && hasIssues ? (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Sipariş için eksik: <strong>{missing.join(", ")}</strong>.{" "}
            <Link
              href="/hesabim/ayarlar#billing"
              className="text-[var(--brand-blue)] hover:underline"
            >
              Tamamla →
            </Link>
          </span>
        </div>
      ) : null}
    </section>
  );
}

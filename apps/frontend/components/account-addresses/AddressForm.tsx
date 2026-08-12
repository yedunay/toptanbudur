"use client";

import { useEffect, useState } from "react";
import type { AddressInput, CustomerAddress } from "@/lib/customer-types";
import { normalizeTrPhone, validateTrPhone } from "@/lib/forms";

interface AddressFormProps {
  initial?: CustomerAddress | null;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (input: AddressInput) => void;
}

interface FormErrors {
  title?: string;
  fullName?: string;
  phone?: string;
  line1?: string;
  district?: string;
  city?: string;
  postalCode?: string;
}

const POSTAL_RE = /^[0-9]{4,10}$/;

function emptyForm(): AddressInput {
  return {
    title: "",
    fullName: "",
    phone: "",
    line1: "",
    line2: "",
    district: "",
    city: "",
    postalCode: "",
    country: "TR",
    isDefault: false,
  };
}

function fromInitial(a: CustomerAddress): AddressInput {
  return {
    title: a.title ?? "",
    fullName: a.fullName ?? "",
    phone: a.phone ?? "",
    line1: a.line1 ?? "",
    line2: a.line2 ?? "",
    district: a.district ?? "",
    city: a.city ?? "",
    postalCode: a.postalCode ?? "",
    country: a.country ?? "TR",
    isDefault: a.isDefault ?? false,
  };
}

function validate(form: AddressInput): FormErrors {
  const errors: FormErrors = {};
  if (!form.fullName.trim()) {
    errors.fullName = "Müşteri ad soyadı zorunlu";
  }
  if (form.phone.trim()) {
    const phoneCheck = validateTrPhone(form.phone, { required: false });
    if (!phoneCheck.ok) {
      errors.phone = phoneCheck.reason ?? "Geçerli telefon girin";
    }
  }
  if (form.postalCode.trim() && !POSTAL_RE.test(form.postalCode.trim())) {
    errors.postalCode = "Posta kodu 4-10 haneli olmalı";
  }
  return errors;
}

export function AddressForm({
  initial,
  submitting,
  onCancel,
  onSubmit,
}: AddressFormProps) {
  const [form, setForm] = useState<AddressInput>(
    initial ? fromInitial(initial) : emptyForm(),
  );
  const [errors, setErrors] = useState<FormErrors>({});
  const [addressOpen, setAddressOpen] = useState<boolean>(true);

  useEffect(() => {
    setForm(initial ? fromInitial(initial) : emptyForm());
    setErrors({});
    setAddressOpen(!initial);
  }, [initial]);

  function update<K extends keyof AddressInput>(key: K, value: AddressInput[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const v = validate(form);
    setErrors(v);
    if (Object.keys(v).length > 0) {
      if (
        v.title || v.phone || v.line1 || v.district || v.city || v.postalCode
      ) {
        setAddressOpen(true);
      }
      return;
    }
    const phoneRaw = form.phone.trim();
    const phoneNorm = phoneRaw ? (normalizeTrPhone(phoneRaw) ?? phoneRaw) : "";
    onSubmit({
      title: form.title.trim(),
      fullName: form.fullName.trim(),
      phone: phoneNorm,
      line1: form.line1.trim(),
      line2: form.line2?.trim() || null,
      district: form.district.trim(),
      city: form.city.trim(),
      postalCode: form.postalCode.trim(),
      country: form.country?.trim() || "TR",
      isDefault: form.isDefault,
    });
  }

  const inputClass =
    "w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--text)] placeholder:text-gray-400 focus:border-[var(--brand-blue)] focus:outline-none";
  const errInputClass =
    "w-full rounded-md border border-red-400 bg-white px-3 py-2 text-sm text-[var(--text)] placeholder:text-gray-400 focus:border-red-500 focus:outline-none";
  const labelClass = "mb-1 block text-sm font-medium text-[var(--text)]";

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <div>
        <label htmlFor="fullName" className={labelClass}>
          Müşteri Ad Soyadı <span className="text-red-600">*</span>
        </label>
        <input
          id="fullName"
          type="text"
          maxLength={120}
          value={form.fullName}
          onChange={(e) => update("fullName", e.target.value)}
          className={errors.fullName ? errInputClass : inputClass}
          placeholder="Ad Soyad"
          required
        />
        {errors.fullName && (
          <p className="mt-1 text-xs text-red-600">{errors.fullName}</p>
        )}
      </div>

      <div className="rounded-md border border-[var(--border)] bg-[var(--surface-muted)]/40">
        <button
          type="button"
          onClick={() => setAddressOpen((o) => !o)}
          aria-expanded={addressOpen}
          aria-controls="address-fields"
          className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-[var(--text)] transition hover:text-[var(--brand-navy)]"
        >
          <span>Adres bilgileri (opsiyonel)</span>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className={`h-4 w-4 transition-transform ${
              addressOpen ? "rotate-180" : ""
            }`}
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z"
              clipRule="evenodd"
            />
          </svg>
        </button>

        {addressOpen && (
          <div id="address-fields" className="space-y-4 border-t border-[var(--border)] p-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="title" className={labelClass}>
                  Başlık (Ev / İş)
                </label>
                <input
                  id="title"
                  type="text"
                  maxLength={40}
                  value={form.title}
                  onChange={(e) => update("title", e.target.value)}
                  className={errors.title ? errInputClass : inputClass}
                  placeholder="Ev"
                />
                {errors.title && (
                  <p className="mt-1 text-xs text-red-600">{errors.title}</p>
                )}
              </div>
              <div>
                <label htmlFor="phone" className={labelClass}>
                  Telefon
                </label>
                <input
                  id="phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  maxLength={20}
                  value={form.phone}
                  onChange={(e) => update("phone", e.target.value)}
                  className={errors.phone ? errInputClass : inputClass}
                  placeholder="0500 000 00 00"
                />
                {errors.phone && (
                  <p className="mt-1 text-xs text-red-600">{errors.phone}</p>
                )}
              </div>
            </div>

            <div>
              <label htmlFor="line1" className={labelClass}>
                Adres satırı
              </label>
              <input
                id="line1"
                type="text"
                maxLength={200}
                value={form.line1}
                onChange={(e) => update("line1", e.target.value)}
                className={errors.line1 ? errInputClass : inputClass}
                placeholder="Mahalle, sokak, bina no"
              />
              {errors.line1 && (
                <p className="mt-1 text-xs text-red-600">{errors.line1}</p>
              )}
            </div>

            <div>
              <label htmlFor="line2" className={labelClass}>
                Adres satırı 2 (opsiyonel)
              </label>
              <input
                id="line2"
                type="text"
                maxLength={200}
                value={form.line2 ?? ""}
                onChange={(e) => update("line2", e.target.value)}
                className={inputClass}
                placeholder="Daire, kat (opsiyonel)"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label htmlFor="district" className={labelClass}>
                  İlçe
                </label>
                <input
                  id="district"
                  type="text"
                  maxLength={80}
                  value={form.district}
                  onChange={(e) => update("district", e.target.value)}
                  className={errors.district ? errInputClass : inputClass}
                  placeholder="İlçe"
                />
                {errors.district && (
                  <p className="mt-1 text-xs text-red-600">{errors.district}</p>
                )}
              </div>
              <div>
                <label htmlFor="city" className={labelClass}>
                  İl
                </label>
                <input
                  id="city"
                  type="text"
                  maxLength={80}
                  value={form.city}
                  onChange={(e) => update("city", e.target.value)}
                  className={errors.city ? errInputClass : inputClass}
                  placeholder="İl"
                />
                {errors.city && (
                  <p className="mt-1 text-xs text-red-600">{errors.city}</p>
                )}
              </div>
              <div>
                <label htmlFor="postalCode" className={labelClass}>
                  Posta kodu
                </label>
                <input
                  id="postalCode"
                  type="text"
                  inputMode="numeric"
                  maxLength={10}
                  value={form.postalCode}
                  onChange={(e) => update("postalCode", e.target.value)}
                  className={errors.postalCode ? errInputClass : inputClass}
                  placeholder="34000"
                />
                {errors.postalCode && (
                  <p className="mt-1 text-xs text-red-600">{errors.postalCode}</p>
                )}
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm text-[var(--text)]">
              <input
                type="checkbox"
                checked={!!form.isDefault}
                onChange={(e) => update("isDefault", e.target.checked)}
                className="h-4 w-4 rounded border-[var(--border)]"
              />
              Varsayılan adres olarak ayarla
            </label>
          </div>
        )}
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="rounded-md border border-[var(--border)] bg-white px-4 py-2 text-sm font-medium text-[var(--text)] transition hover:border-[var(--brand-blue)] hover:text-[var(--brand-blue)] disabled:opacity-60"
        >
          İptal
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-[var(--brand-blue)] px-5 py-2 text-sm font-semibold text-white transition hover:bg-[var(--brand-navy)] disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          {submitting ? "Kaydediliyor…" : "Kaydet"}
        </button>
      </div>
    </form>
  );
}

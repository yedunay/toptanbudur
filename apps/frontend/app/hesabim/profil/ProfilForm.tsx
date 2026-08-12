"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiCustomer, ApiError } from "@/lib/auth";
import { useAuth } from "@/components/AuthProvider";
import { Toast, makeToast, type ToastState } from "@/components/account-shared/Toast";
import type { CustomerProfile } from "@/lib/customer-types";
import { normalizeTrPhone, validateTrPhone } from "@/lib/forms";

interface FormState {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  companyTitle: string;
  vergiNo: string;
  vergiDairesi: string;
}

interface FormErrors {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  companyTitle?: string;
  vergiNo?: string;
  vergiDairesi?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function deriveNameParts(profile: CustomerProfile): {
  firstName: string;
  lastName: string;
} {
  if (profile.firstName || profile.lastName) {
    return {
      firstName: profile.firstName ?? "",
      lastName: profile.lastName ?? "",
    };
  }
  const parts = (profile.name ?? "").trim().split(/\s+/);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts[parts.length - 1],
  };
}

function validate(form: FormState): FormErrors {
  const errors: FormErrors = {};
  if (!form.firstName.trim()) errors.firstName = "Ad zorunlu";
  if (!form.lastName.trim()) errors.lastName = "Soyad zorunlu";
  if (!EMAIL_RE.test(form.email.trim())) errors.email = "Geçerli bir e-posta girin";
  const phoneCheck = validateTrPhone(form.phone, { required: false });
  if (!phoneCheck.ok) errors.phone = phoneCheck.reason;
  if (form.companyTitle.trim().length > 200)
    errors.companyTitle = "Firma ünvanı en fazla 200 karakter olabilir";
  const vergiNoTrimmed = form.vergiNo.trim();
  if (vergiNoTrimmed && !/^\d{1,20}$/.test(vergiNoTrimmed))
    errors.vergiNo = "Vergi no en fazla 20 rakamdan oluşmalıdır";
  if (form.vergiDairesi.trim().length > 200)
    errors.vergiDairesi = "Vergi dairesi en fazla 200 karakter olabilir";
  return errors;
}

export function ProfilForm() {
  const router = useRouter();
  const auth = useAuth();
  const customer = auth.customer;
  const [form, setForm] = useState<FormState>({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    companyTitle: "",
    vergiNo: "",
    vergiDairesi: "",
  });
  const [initialised, setInitialised] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);

  useEffect(() => {
    if (!customer) return;
    let cancelled = false;
    setLoadError(null);
    apiCustomer<{ customer: CustomerProfile } | CustomerProfile>("/me", {
      method: "GET",
      general: true,
    })
      .then((data) => {
        if (cancelled) return;
        const profile: CustomerProfile =
          data && typeof data === "object" && "customer" in data
            ? (data as { customer: CustomerProfile }).customer
            : (data as CustomerProfile);
        const { firstName, lastName } = deriveNameParts(profile);
        setForm({
          firstName,
          lastName,
          email: profile.email ?? "",
          phone: profile.phone ?? "",
          companyTitle: profile.companyTitle ?? "",
          vergiNo: profile.vergiNo ?? "",
          vergiDairesi: profile.vergiDairesi ?? "",
        });
        setInitialised(true);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg =
          err instanceof ApiError ? err.message : "Profil yüklenemedi";
        setLoadError(msg);
        const { firstName, lastName } = deriveNameParts({
          ...customer,
          firstName: null,
          lastName: null,
        } as CustomerProfile);
        setForm({
          firstName,
          lastName,
          email: customer.email ?? "",
          phone: customer.phone ?? "",
          companyTitle: "",
          vergiNo: "",
          vergiDairesi: "",
        });
        setInitialised(true);
      });
    return () => {
      cancelled = true;
    };
  }, [customer]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const v = validate(form);
    setErrors(v);
    if (Object.keys(v).length > 0) return;

    setSubmitting(true);
    try {
      const phoneRaw = form.phone.trim();
      const normalizedPhone = phoneRaw ? normalizeTrPhone(phoneRaw) ?? phoneRaw : null;
      const payload = {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        name: `${form.firstName.trim()} ${form.lastName.trim()}`.trim(),
        email: form.email.trim(),
        phone: normalizedPhone,
        companyTitle: form.companyTitle.trim(),
        vergiNo: form.vergiNo.trim(),
        vergiDairesi: form.vergiDairesi.trim(),
      };
      const data = await apiCustomer<
        { customer: CustomerProfile } | CustomerProfile
      >("/me", {
        method: "PATCH",
        general: true,
        body: JSON.stringify(payload),
      });
      const updated: CustomerProfile =
        data && typeof data === "object" && "customer" in data
          ? (data as { customer: CustomerProfile }).customer
          : (data as CustomerProfile);
      // Backend, ad+telefon dolu olduğunda profileCompleted=true döndürür.
      // Yönlendirmeden önce tam olarak bunu doğrula — yarı dolu profille
      // genel bakışa atıp ardından geri yönlendirme yaşamayalım.
      const completed =
        updated.profileCompleted === true ||
        (!!updated.name?.trim() && !!updated.phone?.trim());
      auth.setCustomer({
        id: updated.id,
        email: updated.email,
        name: updated.name,
        phone: updated.phone ?? null,
        profileCompleted: completed,
      });
      setToast(makeToast("success", "Profil bilgileriniz kaydedildi"));
      if (completed) {
        setTimeout(() => router.replace("/hesabim"), 800);
      }
    } catch (err: unknown) {
      const msg =
        err instanceof ApiError ? err.message : "Profil güncellenemedi";
      setToast(makeToast("error", msg));
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass =
    "w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--text)] focus:border-[var(--brand-blue)] focus:outline-none";
  const errorInputClass =
    "w-full rounded-md border border-red-400 bg-white px-3 py-2 text-sm text-[var(--text)] focus:border-red-500 focus:outline-none";
  const labelClass = "mb-1 block text-sm font-medium text-[var(--text)]";

  if (!customer || !initialised) {
    return (
      <div className="space-y-3">
        <div className="h-9 w-48 animate-pulse rounded-md bg-[var(--surface-muted)]" />
        <div className="h-64 animate-pulse rounded-md bg-[var(--surface-muted)]" />
      </div>
    );
  }

  return (
    <>
      <Toast toast={toast} onDismiss={() => setToast(null)} />
      <div className="rounded-md border border-[var(--border)] bg-white p-6">
        <div className="mb-5">
          <h2 className="text-lg font-semibold text-[var(--brand-navy)]">
            Profil bilgilerim
          </h2>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Ad, soyad, e-posta, telefon ve firma bilgilerinizi güncelleyin.
          </p>
        </div>

        {loadError && (
          <div
            role="alert"
            className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800"
          >
            {loadError}
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="firstName" className={labelClass}>
                Ad
              </label>
              <input
                id="firstName"
                type="text"
                autoComplete="given-name"
                maxLength={80}
                value={form.firstName}
                onChange={(e) => update("firstName", e.target.value)}
                className={errors.firstName ? errorInputClass : inputClass}
                aria-invalid={!!errors.firstName}
                aria-describedby={errors.firstName ? "firstName-err" : undefined}
              />
              {errors.firstName && (
                <p id="firstName-err" className="mt-1 text-xs text-red-600">
                  {errors.firstName}
                </p>
              )}
            </div>
            <div>
              <label htmlFor="lastName" className={labelClass}>
                Soyad
              </label>
              <input
                id="lastName"
                type="text"
                autoComplete="family-name"
                maxLength={80}
                value={form.lastName}
                onChange={(e) => update("lastName", e.target.value)}
                className={errors.lastName ? errorInputClass : inputClass}
                aria-invalid={!!errors.lastName}
                aria-describedby={errors.lastName ? "lastName-err" : undefined}
              />
              {errors.lastName && (
                <p id="lastName-err" className="mt-1 text-xs text-red-600">
                  {errors.lastName}
                </p>
              )}
            </div>
          </div>

          <div>
            <label htmlFor="email" className={labelClass}>
              E-posta
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              maxLength={180}
              value={form.email}
              onChange={(e) => update("email", e.target.value)}
              className={errors.email ? errorInputClass : inputClass}
              aria-invalid={!!errors.email}
              aria-describedby={errors.email ? "email-err" : undefined}
            />
            {errors.email && (
              <p id="email-err" className="mt-1 text-xs text-red-600">
                {errors.email}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="phone" className={labelClass}>
              Telefon
            </label>
            <input
              id="phone"
              type="tel"
              autoComplete="tel"
              maxLength={20}
              value={form.phone}
              onChange={(e) => update("phone", e.target.value)}
              className={errors.phone ? errorInputClass : inputClass}
              aria-invalid={!!errors.phone}
              aria-describedby={errors.phone ? "phone-err" : undefined}
              placeholder="+90 500 000 00 00"
            />
            {errors.phone && (
              <p id="phone-err" className="mt-1 text-xs text-red-600">
                {errors.phone}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="companyTitle" className={labelClass}>
              Firma Ünvanı
            </label>
            <input
              id="companyTitle"
              type="text"
              autoComplete="organization"
              maxLength={200}
              value={form.companyTitle}
              onChange={(e) => update("companyTitle", e.target.value)}
              className={errors.companyTitle ? errorInputClass : inputClass}
              aria-invalid={!!errors.companyTitle}
              aria-describedby={
                errors.companyTitle ? "companyTitle-err" : undefined
              }
            />
            {errors.companyTitle && (
              <p id="companyTitle-err" className="mt-1 text-xs text-red-600">
                {errors.companyTitle}
              </p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="vergiNo" className={labelClass}>
                Vergi No
              </label>
              <input
                id="vergiNo"
                type="text"
                inputMode="numeric"
                maxLength={20}
                value={form.vergiNo}
                onChange={(e) => update("vergiNo", e.target.value)}
                className={errors.vergiNo ? errorInputClass : inputClass}
                aria-invalid={!!errors.vergiNo}
                aria-describedby={errors.vergiNo ? "vergiNo-err" : undefined}
              />
              {errors.vergiNo && (
                <p id="vergiNo-err" className="mt-1 text-xs text-red-600">
                  {errors.vergiNo}
                </p>
              )}
            </div>
            <div>
              <label htmlFor="vergiDairesi" className={labelClass}>
                Vergi Dairesi
              </label>
              <input
                id="vergiDairesi"
                type="text"
                maxLength={200}
                value={form.vergiDairesi}
                onChange={(e) => update("vergiDairesi", e.target.value)}
                className={errors.vergiDairesi ? errorInputClass : inputClass}
                aria-invalid={!!errors.vergiDairesi}
                aria-describedby={
                  errors.vergiDairesi ? "vergiDairesi-err" : undefined
                }
              />
              {errors.vergiDairesi && (
                <p id="vergiDairesi-err" className="mt-1 text-xs text-red-600">
                  {errors.vergiDairesi}
                </p>
              )}
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={submitting}
              className="rounded-md bg-[var(--brand-blue)] px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-[var(--brand-navy)] disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              {submitting ? "Kaydediliyor…" : "Kaydet"}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}

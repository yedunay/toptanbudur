"use client";

import { useState } from "react";
import { apiCustomer, ApiError } from "@/lib/auth";
import { Toast, makeToast, type ToastState } from "@/components/account-shared/Toast";

interface FormState {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

interface FormErrors {
  currentPassword?: string;
  newPassword?: string;
  confirmPassword?: string;
}

const HAS_LETTER = /[A-Za-zÇĞİÖŞÜçğıöşü]/;
const HAS_DIGIT = /\d/;

function validate(form: FormState): FormErrors {
  const errors: FormErrors = {};
  if (!form.currentPassword) errors.currentPassword = "Mevcut şifrenizi girin";
  if (form.newPassword.length < 8) {
    errors.newPassword = "En az 8 karakter olmalı";
  } else if (!HAS_LETTER.test(form.newPassword) || !HAS_DIGIT.test(form.newPassword)) {
    errors.newPassword = "En az 1 harf ve 1 rakam içermeli";
  }
  if (form.confirmPassword !== form.newPassword) {
    errors.confirmPassword = "Şifreler eşleşmiyor";
  }
  return errors;
}

export function SifreForm() {
  const [form, setForm] = useState<FormState>({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);

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
      await apiCustomer<unknown>("/me/password", {
        method: "PATCH",
        general: true,
        body: JSON.stringify({
          currentPassword: form.currentPassword,
          newPassword: form.newPassword,
        }),
      });
      setToast(makeToast("success", "Şifreniz başarıyla güncellendi"));
      setForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        if (err.status === 400 || err.status === 401) {
          setErrors({ currentPassword: err.message });
        } else {
          setToast(makeToast("error", err.message));
        }
      } else {
        setToast(makeToast("error", "Şifre güncellenemedi"));
      }
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass =
    "w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--text)] focus:border-[var(--brand-blue)] focus:outline-none";
  const errorInputClass =
    "w-full rounded-md border border-red-400 bg-white px-3 py-2 text-sm text-[var(--text)] focus:border-red-500 focus:outline-none";
  const labelClass = "mb-1 block text-sm font-medium text-[var(--text)]";

  return (
    <>
      <Toast toast={toast} onDismiss={() => setToast(null)} />
      <div className="rounded-md border border-[var(--border)] bg-white p-6">
        <div className="mb-5">
          <h2 className="text-lg font-semibold text-[var(--brand-navy)]">
            Şifre değiştir
          </h2>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            En az 8 karakter, 1 harf ve 1 rakam içermelidir.
          </p>
        </div>

        <form onSubmit={handleSubmit} noValidate className="space-y-5">
          <div>
            <label htmlFor="currentPassword" className={labelClass}>
              Mevcut şifre
            </label>
            <input
              id="currentPassword"
              type="password"
              autoComplete="current-password"
              maxLength={120}
              value={form.currentPassword}
              onChange={(e) => update("currentPassword", e.target.value)}
              className={errors.currentPassword ? errorInputClass : inputClass}
              aria-invalid={!!errors.currentPassword}
            />
            {errors.currentPassword && (
              <p className="mt-1 text-xs text-red-600">
                {errors.currentPassword}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="newPassword" className={labelClass}>
              Yeni şifre
            </label>
            <input
              id="newPassword"
              type="password"
              autoComplete="new-password"
              maxLength={120}
              value={form.newPassword}
              onChange={(e) => update("newPassword", e.target.value)}
              className={errors.newPassword ? errorInputClass : inputClass}
              aria-invalid={!!errors.newPassword}
            />
            {errors.newPassword && (
              <p className="mt-1 text-xs text-red-600">{errors.newPassword}</p>
            )}
          </div>

          <div>
            <label htmlFor="confirmPassword" className={labelClass}>
              Yeni şifre (tekrar)
            </label>
            <input
              id="confirmPassword"
              type="password"
              autoComplete="new-password"
              maxLength={120}
              value={form.confirmPassword}
              onChange={(e) => update("confirmPassword", e.target.value)}
              className={errors.confirmPassword ? errorInputClass : inputClass}
              aria-invalid={!!errors.confirmPassword}
            />
            {errors.confirmPassword && (
              <p className="mt-1 text-xs text-red-600">
                {errors.confirmPassword}
              </p>
            )}
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={submitting}
              className="rounded-md bg-[var(--brand-blue)] px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-[var(--brand-navy)] disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              {submitting ? "Kaydediliyor…" : "Şifreyi güncelle"}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}

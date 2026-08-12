"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { apiCustomer, ApiError, type AuthResponse } from "@/lib/auth";
import { useAuth } from "@/components/AuthProvider";
import { LANDING_URLS } from "@/lib/urls";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface FormState {
  email: string;
  password: string;
}

export default function GirisPage() {
  return (
    <Suspense fallback={<main className="mx-auto max-w-md px-6 py-10" />}>
      <GirisPageInner />
    </Suspense>
  );
}

function GirisPageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const auth = useAuth();
  const rawNext = params.get("next") || "/hesabim";
  const next =
    rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/hesabim";

  const [form, setForm] = useState<FormState>({ email: "", password: "" });
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (auth.customer) {
      router.replace(next);
    }
  }, [auth.customer, next, router]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!EMAIL_RE.test(form.email.trim())) {
      setError("Geçerli bir e-posta girin");
      return;
    }
    if (!form.password) {
      setError("Şifre zorunlu");
      return;
    }

    setSubmitting(true);
    try {
      const data = await apiCustomer<AuthResponse>("/login", {
        method: "POST",
        body: JSON.stringify({
          email: form.email.trim(),
          password: form.password,
        }),
      });
      auth.setCustomer(data.customer);
      const destination = data.customer.profileCompleted === false
        ? "/hesabim/profil"
        : next;
      // Hard navigation: kök layout'u yeniden çalıştırarak SSR'in
      // tb_session cookie'sini taze okumasını garantiler. router.replace +
      // router.refresh kombinasyonu Next 15/16'da bazen layout'u yeniden
      // render etmiyor, sonuç: header "Giriş yap" göstermeye devam ediyor.
      window.location.assign(destination);
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Giriş yapılamadı. Lütfen tekrar deneyin.");
      }
      setSubmitting(false);
    }
  }

  const inputClass =
    "w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--text)] focus:border-[var(--brand-blue)] focus:outline-none";
  const labelClass = "mb-1 block text-sm font-medium text-[var(--text)]";

  return (
    <main className="mx-auto max-w-md px-6 py-10">
      <h1 className="text-2xl font-bold text-[var(--brand-navy)] sm:text-3xl">
        Giriş yap
      </h1>
      <p className="mt-2 text-sm text-[var(--text-muted)]">
        Hesabınıza giriş yaparak siparişlerinizi takip edin.
      </p>

      <form
        onSubmit={handleSubmit}
        noValidate
        className="mt-6 space-y-5 rounded-md border border-[var(--border)] bg-white p-6"
      >
        <div>
          <label htmlFor="email" className={labelClass}>
            E-posta
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            autoFocus
            maxLength={180}
            value={form.email}
            onChange={(e) => update("email", e.target.value)}
            className={inputClass}
            required
          />
        </div>

        <div>
          <label htmlFor="password" className={labelClass}>
            Şifre
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            maxLength={120}
            value={form.password}
            onChange={(e) => update("password", e.target.value)}
            className={inputClass}
            required
          />
          <div className="mt-1.5 text-right">
            <a
              href="/sifremi-unuttum"
              className="text-sm font-medium text-[var(--brand-blue)] hover:text-[var(--brand-navy)]"
            >
              Şifremi unuttum?
            </a>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <input
            id="rememberMe"
            type="checkbox"
            checked={rememberMe}
            onChange={(e) => setRememberMe(e.target.checked)}
            className="h-4 w-4 rounded border-[var(--border)] text-[var(--brand-blue)] focus:ring-[var(--brand-blue)]"
          />
          <label htmlFor="rememberMe" className="text-sm text-[var(--text)]">
            Beni hatırla
          </label>
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700"
          >
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-md bg-[var(--brand-blue)] px-6 py-3 text-base font-semibold text-white transition hover:bg-[var(--brand-navy)] disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          {submitting ? "Giriş yapılıyor…" : "Giriş yap"}
        </button>

        <p className="text-center text-sm text-[var(--text-muted)]">
          Hesabınız yok mu?{" "}
          <Link
            href={LANDING_URLS.apply}
            className="font-semibold text-[var(--brand-blue)] hover:text-[var(--brand-navy)]"
          >
            Bayilik başvurusu yapın
          </Link>
        </p>
        <p className="text-center text-xs text-[var(--text-muted)]">
          Hesaplar yalnızca onaylı bayilik başvuruları için açılır.
        </p>
      </form>

    </main>
  );
}

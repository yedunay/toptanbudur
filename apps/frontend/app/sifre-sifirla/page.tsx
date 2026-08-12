"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { apiCustomer, ApiError } from "@/lib/auth";

const MIN_LEN = 8;

type CheckState = "checking" | "valid" | "invalid" | "error";

interface FormState {
  newPassword: string;
  confirmPassword: string;
}

export default function SifreSifirlaPage() {
  return (
    <Suspense fallback={<main className="mx-auto max-w-md px-6 py-10" />}>
      <SifreSifirlaInner />
    </Suspense>
  );
}

function SifreSifirlaInner() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") ?? "";

  const [check, setCheck] = useState<CheckState>("checking");
  const [form, setForm] = useState<FormState>({
    newPassword: "",
    confirmPassword: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const validate = useCallback(async () => {
    if (!token) {
      setCheck("invalid");
      return;
    }
    setCheck("checking");
    try {
      const res = await apiCustomer<{ valid: boolean }>(
        "/reset-password/validate",
        { method: "POST", body: JSON.stringify({ token }) },
      );
      // Sadece backend açıkça "geçersiz" derse invalid; ağ/429/5xx hataları
      // token'ı geçersiz saymaz (kullanıcı 5 dk'lık geçerli linkini kaybetmesin).
      setCheck(res.valid === true ? "valid" : "invalid");
    } catch {
      setCheck("error");
    }
  }, [token]);

  useEffect(() => {
    void validate();
  }, [validate]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (form.newPassword.length < MIN_LEN) {
      setError(`Şifre en az ${MIN_LEN} karakter olmalı`);
      return;
    }
    if (form.newPassword !== form.confirmPassword) {
      setError("Şifreler eşleşmiyor");
      return;
    }

    setSubmitting(true);
    try {
      await apiCustomer("/reset-password", {
        method: "POST",
        body: JSON.stringify({ token, newPassword: form.newPassword }),
      });
      setDone(true);
      // Başarı: kısa bilgi ekranından sonra girişe yönlendir.
      setTimeout(() => router.replace("/giris"), 2500);
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        setError(err.message);
        // 400 → token bu arada süresi dolmuş/kullanılmış → geçersiz görünüme geç.
        // Diğer hatalar (429/5xx/ağ) formu koru, kullanıcı tekrar denesin.
        if (err.status === 400) setCheck("invalid");
      } else {
        setError("Şifre güncellenemedi. Lütfen tekrar deneyin.");
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
        Yeni şifre belirle
      </h1>

      {check === "checking" && (
        <p className="mt-4 text-sm text-[var(--text-muted)]">
          Bağlantı doğrulanıyor…
        </p>
      )}

      {check === "error" && !done && (
        <div className="mt-6 space-y-4 rounded-md border border-[var(--border)] bg-white p-6">
          <div
            role="alert"
            className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800"
          >
            <p className="font-semibold">Bağlantı doğrulanamadı.</p>
            <p className="mt-1">
              Geçici bir bağlantı/sunucu sorunu olabilir. Linkiniz hâlâ geçerli
              olabilir; lütfen tekrar deneyin.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void validate()}
            className="block w-full rounded-md bg-[var(--brand-blue)] px-6 py-3 text-center text-base font-semibold text-white transition hover:bg-[var(--brand-navy)]"
          >
            Tekrar dene
          </button>
        </div>
      )}

      {check === "invalid" && !done && (
        <div className="mt-6 space-y-4 rounded-md border border-[var(--border)] bg-white p-6">
          <div
            role="alert"
            className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-700"
          >
            <p className="font-semibold">Bağlantı geçersiz veya süresi dolmuş.</p>
            <p className="mt-1">
              Şifre sıfırlama bağlantıları yalnızca 5 dakika geçerlidir. Lütfen
              yeniden talep oluşturun.
            </p>
          </div>
          <a
            href="/sifremi-unuttum"
            className="block w-full rounded-md bg-[var(--brand-blue)] px-6 py-3 text-center text-base font-semibold text-white transition hover:bg-[var(--brand-navy)]"
          >
            Yeni bağlantı iste
          </a>
        </div>
      )}

      {done && (
        <div className="mt-6 rounded-md border border-[var(--border)] bg-white p-6">
          <div
            role="status"
            className="rounded-md border border-green-300 bg-green-50 p-4 text-sm text-green-800"
          >
            <p className="font-semibold">Şifreniz güncellendi.</p>
            <p className="mt-1">
              Yeni şifrenizle giriş yapabilirsiniz. Giriş ekranına
              yönlendiriliyorsunuz…
            </p>
          </div>
          <a
            href="/giris"
            className="mt-4 block w-full rounded-md bg-[var(--brand-blue)] px-6 py-3 text-center text-base font-semibold text-white transition hover:bg-[var(--brand-navy)]"
          >
            Giriş yap
          </a>
        </div>
      )}

      {check === "valid" && !done && (
        <>
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            Yeni şifrenizi iki kez girin. En az {MIN_LEN} karakter olmalıdır.
          </p>
          <form
            onSubmit={handleSubmit}
            noValidate
            className="mt-6 space-y-5 rounded-md border border-[var(--border)] bg-white p-6"
          >
            <div>
              <label htmlFor="newPassword" className={labelClass}>
                Yeni şifre
              </label>
              <input
                id="newPassword"
                type="password"
                autoComplete="new-password"
                autoFocus
                maxLength={120}
                value={form.newPassword}
                onChange={(e) => update("newPassword", e.target.value)}
                className={inputClass}
                required
              />
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
                className={inputClass}
                required
              />
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
              {submitting ? "Güncelleniyor…" : "Şifreyi güncelle"}
            </button>
          </form>
        </>
      )}
    </main>
  );
}

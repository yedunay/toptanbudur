"use client";

import { useState } from "react";
import { apiCustomer, ApiError } from "@/lib/auth";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function SifremiUnuttumPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!EMAIL_RE.test(email.trim())) {
      setError("Geçerli bir e-posta girin");
      return;
    }

    setSubmitting(true);
    try {
      // Başarılı yanıt HER ZAMAN generic {ok:true} döner (enumeration yok) —
      // başarı ekranını e-postanın kayıtlı olup olmamasından bağımsız gösteririz.
      await apiCustomer("/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email: email.trim() }),
      });
      setSent(true);
    } catch (err: unknown) {
      // Sadece GERÇEK aktarım hatalarında (429 rate-limit / 5xx / ağ) kullanıcıya
      // "gönderildi" YALANI söyleme — aksi halde gelmeyen maili beklerdi. Bu
      // hatalar e-postanın varlığını sızdırmaz (girdiden bağımsız oluşur).
      if (err instanceof ApiError && err.status === 429) {
        setError("Çok fazla deneme yaptınız. Lütfen birkaç dakika sonra tekrar deneyin.");
      } else {
        setError("İstek gönderilemedi. Bağlantınızı kontrol edip tekrar deneyin.");
      }
    }
    setSubmitting(false);
  }

  const inputClass =
    "w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--text)] focus:border-[var(--brand-blue)] focus:outline-none";
  const labelClass = "mb-1 block text-sm font-medium text-[var(--text)]";

  return (
    <main className="mx-auto max-w-md px-6 py-10">
      <h1 className="text-2xl font-bold text-[var(--brand-navy)] sm:text-3xl">
        Şifremi unuttum
      </h1>
      <p className="mt-2 text-sm text-[var(--text-muted)]">
        Hesabınıza kayıtlı e-posta adresinizi girin; şifrenizi sıfırlamanız için
        bir bağlantı gönderelim.
      </p>

      {sent ? (
        <div className="mt-6 space-y-4 rounded-md border border-[var(--border)] bg-white p-6">
          <div
            role="status"
            className="rounded-md border border-green-300 bg-green-50 p-4 text-sm text-green-800"
          >
            <p className="font-semibold">Talebiniz alındı.</p>
            <p className="mt-1">
              Eğer bu e-posta onaylı bir bayiye aitse, şifre sıfırlama bağlantısı
              gönderildi. Lütfen gelen kutunuzu kontrol edin.
            </p>
            <p className="mt-2">
              Bağlantı <strong>5 dakika</strong> geçerlidir. E-posta{" "}
              <strong>spam / gereksiz</strong> kutunuza düşmüş olabilir; orayı da
              kontrol etmeyi unutmayın.
            </p>
          </div>
          <a
            href="/giris"
            className="block w-full rounded-md bg-[var(--brand-blue)] px-6 py-3 text-center text-base font-semibold text-white transition hover:bg-[var(--brand-navy)]"
          >
            Giriş ekranına dön
          </a>
        </div>
      ) : (
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
              value={email}
              onChange={(e) => setEmail(e.target.value)}
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
            {submitting ? "Gönderiliyor…" : "Sıfırlama bağlantısı gönder"}
          </button>

          <p className="text-center text-sm text-[var(--text-muted)]">
            Şifrenizi hatırladınız mı?{" "}
            <a
              href="/giris"
              className="font-semibold text-[var(--brand-blue)] hover:text-[var(--brand-navy)]"
            >
              Giriş yapın
            </a>
          </p>
        </form>
      )}
    </main>
  );
}

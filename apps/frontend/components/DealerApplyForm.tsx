"use client";

import { useState } from "react";
import Link from "next/link";
import { apiCustomer, ApiError } from "@/lib/auth";
import { validateTrPhone } from "@/lib/forms";
import { CONTACT } from "@/lib/contact";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const inputClass =
  "w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--text)] focus:border-[var(--brand-blue)] focus:outline-none";
const labelClass = "mb-1 block text-sm font-medium text-[var(--text)]";

/**
 * Bayilik başvuru formu — backend `POST /api/dealer/apply` (DealerApplyDto).
 * Zorunlu alanlar DTO ile birebir: name, email, phone (TR cep), vergiDairesi.
 *
 * Doğrulama burada da yapılır çünkü backend validation hatalarını `message`
 * DİZİSİ olarak döner; `apiCustomer` yalnızca string `message` okuduğu için
 * kullanıcı aksi halde jenerik "İstek başarısız (400)" görürdü.
 */
export function DealerApplyForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [company, setCompany] = useState("");
  const [vergiDairesi, setVergiDairesi] = useState("");
  const [vergiNo, setVergiNo] = useState("");
  const [message, setMessage] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (name.trim().length < 2) {
      setError("Ad soyad en az 2 karakter olmalı.");
      return;
    }
    if (!EMAIL_RE.test(email.trim())) {
      setError("Geçerli bir e-posta girin.");
      return;
    }
    const phoneCheck = validateTrPhone(phone, { required: true });
    if (!phoneCheck.ok) {
      setError(phoneCheck.reason ?? "Geçerli bir cep numarası girin.");
      return;
    }
    if (!vergiDairesi.trim()) {
      setError("Vergi dairesi zorunludur.");
      return;
    }

    setSubmitting(true);
    try {
      await apiCustomer("/dealer/apply", {
        general: true,
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          phone: phoneCheck.normalized,
          vergiDairesi: vergiDairesi.trim(),
          ...(company.trim() ? { company: company.trim() } : {}),
          ...(vergiNo.trim() ? { vergiNo: vergiNo.trim() } : {}),
          ...(message.trim() ? { message: message.trim() } : {}),
        }),
      });
      setSent(true);
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 429) {
        setError(
          "Çok fazla deneme yaptınız. Lütfen birkaç dakika sonra tekrar deneyin.",
        );
      } else if (err instanceof ApiError && err.status === 400) {
        setError(err.message);
      } else {
        setError(
          "Başvurunuz iletilemedi. Bağlantınızı kontrol edip tekrar deneyin.",
        );
      }
    }
    setSubmitting(false);
  }

  if (sent) {
    return (
      <div className="space-y-4">
        <div
          role="status"
          className="rounded-md border border-green-300 bg-green-50 p-4 text-sm leading-relaxed text-green-800"
        >
          <p className="font-semibold">Başvurunuz alındı.</p>
          <p className="mt-1">
            Başvurunuz incelendikten sonra e-posta ile bilgilendirileceksiniz.
          </p>
        </div>
        <p className="text-sm text-[var(--text-muted)]">
          Sorularınız için{" "}
          <a
            href={`mailto:${CONTACT.email}`}
            className="font-semibold text-[var(--brand-blue)] hover:text-[var(--brand-navy)]"
          >
            {CONTACT.email}
          </a>{" "}
          adresine yazabilirsiniz.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5">
      <div>
        <label htmlFor="ba-name" className={labelClass}>
          Ad Soyad <span aria-hidden>*</span>
        </label>
        <input
          id="ba-name"
          type="text"
          autoComplete="name"
          maxLength={200}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputClass}
          required
        />
      </div>

      <div>
        <label htmlFor="ba-email" className={labelClass}>
          E-posta <span aria-hidden>*</span>
        </label>
        <input
          id="ba-email"
          type="email"
          autoComplete="email"
          maxLength={254}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputClass}
          required
        />
      </div>

      <div>
        <label htmlFor="ba-phone" className={labelClass}>
          Cep Telefonu <span aria-hidden>*</span>
        </label>
        <input
          id="ba-phone"
          type="tel"
          autoComplete="tel"
          inputMode="tel"
          placeholder="0500 000 00 00"
          maxLength={20}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className={inputClass}
          required
        />
      </div>

      <div>
        <label htmlFor="ba-company" className={labelClass}>
          Firma Adı
        </label>
        <input
          id="ba-company"
          type="text"
          autoComplete="organization"
          maxLength={200}
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor="ba-vergi-dairesi" className={labelClass}>
          Vergi Dairesi <span aria-hidden>*</span>
        </label>
        <input
          id="ba-vergi-dairesi"
          type="text"
          maxLength={200}
          value={vergiDairesi}
          onChange={(e) => setVergiDairesi(e.target.value)}
          className={inputClass}
          required
        />
      </div>

      <div>
        <label htmlFor="ba-vergi-no" className={labelClass}>
          Vergi No / TC Kimlik No
        </label>
        <input
          id="ba-vergi-no"
          type="text"
          inputMode="numeric"
          maxLength={20}
          value={vergiNo}
          onChange={(e) => setVergiNo(e.target.value)}
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor="ba-message" className={labelClass}>
          Mesajınız
        </label>
        <textarea
          id="ba-message"
          rows={4}
          maxLength={2000}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          className={`${inputClass} resize-y`}
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
        {submitting ? "Gönderiliyor…" : "Başvuruyu gönder"}
      </button>

      <p className="text-center text-sm text-[var(--text-muted)]">
        Zaten hesabınız var mı?{" "}
        <Link
          href="/giris"
          className="font-semibold text-[var(--brand-blue)] hover:text-[var(--brand-navy)]"
        >
          Giriş yapın
        </Link>
      </p>
    </form>
  );
}

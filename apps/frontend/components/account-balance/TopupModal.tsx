"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, X } from "lucide-react";
import { createTopup } from "@/lib/api-client";
import { CONTACT, whatsappLink } from "@/lib/contact";
import type { BalanceBankAccount } from "@/lib/customer-api";

interface TopupModalProps {
  onClose: () => void;
  bankAccounts: BalanceBankAccount[];
}

type Step = "form" | "success";

export function TopupModal({ onClose, bankAccounts }: TopupModalProps) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("form");
  const [amount, setAmount] = useState("");
  const [bankAccountId, setBankAccountId] = useState(bankAccounts[0]?.id ?? "");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdTopupNo, setCreatedTopupNo] = useState<string | null>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      const parsed = parseFloat(amount.replace(",", "."));
      if (!Number.isFinite(parsed) || parsed < 1) {
        setError("Geçerli bir tutar giriniz (en az 1 ₺).");
        return;
      }
      setLoading(true);
      const result = await createTopup({
        amount: parsed,
        bankAccountId: bankAccountId || undefined,
        customerNote: note.trim() || undefined,
      });
      setLoading(false);
      if (!result.success) {
        setError(result.error ?? "Bir hata oluştu.");
        return;
      }
      setCreatedTopupNo(result.humanTopupNo ?? null);
      setStep("success");
      router.refresh();
    },
    [amount, bankAccountId, note, router],
  );

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === backdropRef.current) onClose();
    },
    [onClose],
  );

  return (
    <div
      ref={backdropRef}
      onClick={handleBackdropClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Bakiye yükleme"
    >
      <div className="w-full max-w-md rounded-3xl border border-[var(--ab-border)] bg-white p-6 shadow-2xl">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-black text-[var(--ab-text)]">
            {step === "success" ? "Talep Alındı" : "Bakiye Yükle"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Kapat"
            className="rounded-xl p-1.5 text-slate-500 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ab-blue)]"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {step === "success" ? (
          <div className="mt-6 flex flex-col items-center gap-4 py-4 text-center">
            <CheckCircle2 className="h-14 w-14 text-green-500" aria-hidden="true" />
            <p className="text-base font-black text-[var(--ab-text)]">Yükleme talebiniz alındı!</p>
            {createdTopupNo ? (
              <p className="rounded-xl bg-slate-50 px-3 py-1.5 font-mono text-sm font-bold tracking-wider text-[var(--ab-text)]">
                Talep No: {createdTopupNo}
              </p>
            ) : null}
            <p className="text-sm text-slate-600">
              Havale/EFT işleminiz onaylandıktan sonra bakiyenize yansıyacaktır.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-2 inline-flex h-11 w-full items-center justify-center rounded-2xl bg-[var(--ab-blue)] px-6 text-sm font-black text-white transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ab-blue)]"
            >
              Kapat
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-5 space-y-4" noValidate>
            <div>
              <label htmlFor="topup-amount" className="mb-1.5 block text-sm font-bold text-slate-700">
                Yüklenecek Tutar (₺)
              </label>
              <input
                id="topup-amount"
                type="number"
                inputMode="decimal"
                min="1"
                step="0.01"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0,00"
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold outline-none transition placeholder:text-slate-400 focus:border-[var(--ab-blue)] focus-visible:ring-2 focus-visible:ring-[var(--ab-blue)]"
              />
            </div>

            {bankAccounts.length > 0 && (
              <div>
                <label htmlFor="topup-bank" className="mb-1.5 block text-sm font-bold text-slate-700">
                  Transfer Yapılacak Banka
                </label>
                <select
                  id="topup-bank"
                  value={bankAccountId}
                  onChange={(e) => setBankAccountId(e.target.value)}
                  className="h-11 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold outline-none transition focus:border-[var(--ab-blue)] focus-visible:ring-2 focus-visible:ring-[var(--ab-blue)]"
                >
                  {bankAccounts.map((ba) => (
                    <option key={ba.id} value={ba.id}>
                      {ba.bankName} — {ba.accountName}
                    </option>
                  ))}
                </select>

                {bankAccountId && (() => {
                  const ba = bankAccounts.find((b) => b.id === bankAccountId);
                  if (!ba) return null;
                  return (
                    <div className="mt-2 rounded-xl border border-slate-100 bg-slate-50 p-3 text-xs font-semibold text-slate-700 space-y-1">
                      <p>IBAN: <span className="font-black tracking-wider">{ba.iban}</span></p>
                      {ba.note && <p className="text-slate-500">{ba.note}</p>}
                    </div>
                  );
                })()}
              </div>
            )}

            <div>
              <label htmlFor="topup-note" className="mb-1.5 block text-sm font-bold text-slate-700">
                Not <span className="font-normal text-slate-500">(isteğe bağlı)</span>
              </label>
              <textarea
                id="topup-note"
                rows={2}
                maxLength={2000}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="İşlem açıklaması..."
                className="w-full resize-none rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold outline-none transition placeholder:text-slate-400 focus:border-[var(--ab-blue)] focus-visible:ring-2 focus-visible:ring-[var(--ab-blue)]"
              />
            </div>

            <p className="text-xs leading-5 text-slate-500">
              Havale/EFT ile yaptığınız yüklemelerde yatırdığınız tutarın
              tamamı cari bakiyenize eklenir. Yükleme talebinizi
              göndermenizin ardından ödemeye ilişkin dekontunuzu{" "}
              {CONTACT.whatsappNumber ? (
                <a
                  href={whatsappLink(
                    "Merhaba, bakiye yükleme dekontumu iletmek istiyorum.",
                  )}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-bold text-emerald-600 hover:underline"
                >
                  WhatsApp
                </a>
              ) : (
                <span className="font-bold text-slate-600">destek ekibimize</span>
              )}{" "}
              üzerinden ilettiğiniz takdirde bakiyeniz en kısa sürede
              onaylanacaktır.
            </p>

            {error && (
              <p role="alert" className="rounded-xl bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-700">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="inline-flex h-11 w-full items-center justify-center rounded-2xl bg-[var(--ab-blue)] px-6 text-sm font-black text-white transition hover:opacity-90 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ab-blue)]"
            >
              {loading ? "Gönderiliyor..." : "Talebi Gönder"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CreditCard, X } from "lucide-react";
import { apiCustomer, ApiError } from "@/lib/auth";
import { formatTRY } from "./bakiyem-format";

const RATE_FORMATTER = new Intl.NumberFormat("tr-TR", {
  maximumFractionDigits: 2,
});

interface CardTopupResponse {
  success?: boolean;
  data?: {
    topupId: string;
    humanTopupNo: string | null;
    amount: number;
    commissionRate: number;
    commissionAmount: number;
    chargedAmount: number;
    status: string;
  };
}

interface CardTopupModalProps {
  onClose: () => void;
  /** Kart komisyon oranı (%) — card-fee endpoint'inden; null ise oran bilinmiyor. */
  ratePercent: number | null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function CardTopupModal({ onClose, ratePercent }: CardTopupModalProps) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  const parsedAmount = (() => {
    const parsed = parseFloat(amount.replace(",", "."));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  })();

  // Yalnızca GÖSTERİM amaçlı canlı döküm — kesin hesabı backend yapar.
  const commission =
    parsedAmount != null && ratePercent != null
      ? round2((parsedAmount * ratePercent) / 100)
      : null;
  const charged =
    parsedAmount != null ? round2(parsedAmount + (commission ?? 0)) : null;

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
      try {
        const res = await apiCustomer<CardTopupResponse>(
          "/me/cari-balance/topups/card",
          {
            method: "POST",
            general: true,
            body: JSON.stringify({ amount: parsed }),
          },
        );
        if (res?.success && res.data?.topupId) {
          router.push(`/hesabim/bakiyem/kart/${res.data.topupId}`);
          return;
        }
        setLoading(false);
        setError("İşlem başlatılamadı — lütfen tekrar deneyin.");
      } catch (err) {
        setLoading(false);
        setError(
          err instanceof ApiError && err.message.trim()
            ? err.message
            : "İşlem başlatılamadı — lütfen tekrar deneyin.",
        );
      }
    },
    [amount, router],
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
      aria-label="Kartla bakiye yükleme"
    >
      <div className="w-full max-w-md rounded-3xl border border-[var(--ab-border)] bg-white p-6 shadow-2xl">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-black text-[var(--ab-text)]">
            Kartla Bakiye Yükle
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

        <form onSubmit={handleSubmit} className="mt-5 space-y-4" noValidate>
          <div>
            <label
              htmlFor="card-topup-amount"
              className="mb-1.5 block text-sm font-bold text-slate-700"
            >
              Yüklenecek Tutar (₺)
            </label>
            <input
              id="card-topup-amount"
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

          {parsedAmount != null && (
            <div className="space-y-1.5 rounded-xl border border-slate-100 bg-slate-50 p-3 text-sm">
              <div className="flex items-center justify-between font-semibold text-slate-700">
                <span>Cari’ye eklenecek</span>
                <span>{formatTRY(parsedAmount)}</span>
              </div>
              {commission != null && ratePercent != null && (
                <div className="flex items-center justify-between text-xs font-medium text-slate-500">
                  <span>
                    Kart komisyonu (%{RATE_FORMATTER.format(ratePercent)})
                  </span>
                  <span>+{formatTRY(commission)}</span>
                </div>
              )}
              {charged != null && (
                <div className="flex items-center justify-between border-t border-slate-200 pt-1.5 font-black text-[var(--ab-text)]">
                  <span>Karttan çekilecek</span>
                  <span>{formatTRY(charged)}</span>
                </div>
              )}
            </div>
          )}

          <p className="text-xs leading-5 text-slate-500">
            {ratePercent != null
              ? `Kart ile bakiye yüklemelerinde %${RATE_FORMATTER.format(ratePercent)} kart komisyonu uygulanır.`
              : "Kart ile bakiye yüklemelerinde kart komisyonu uygulanır."}
          </p>

          {error && (
            <p
              role="alert"
              className="rounded-xl bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-700"
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-[var(--ab-blue)] px-6 text-sm font-black text-white transition hover:opacity-90 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ab-blue)]"
          >
            <CreditCard className="h-4 w-4" aria-hidden="true" />
            {loading ? "Yönlendiriliyor..." : "Ödemeye Geç"}
          </button>
        </form>
      </div>
    </div>
  );
}

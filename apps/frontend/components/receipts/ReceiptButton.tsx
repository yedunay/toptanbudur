"use client";

import { useRef, useState } from "react";
import { Loader2, ReceiptText } from "lucide-react";
import { apiCustomer, ApiError } from "@/lib/auth";

/**
 * Tahsilat makbuzu indirme/görüntüleme düğmesi — kartla yapılan cari yükleme
 * ve kartla ödenen siparişler için tek, paylaşılan bileşen (DRY).
 *
 * Makbuz yalnızca kredi-kartı işlemlerinde var olur; bu bileşen yalnızca
 * `hasReceipt === true` olan satır/sayfalarda render edilmelidir. Tıklamada
 * makbuz PDF'inin imzalı URL'i çekilir ve yeni sekmede açılır. PDF, ödeme
 * onayından hemen sonra arka planda üretildiği için kısa bir süre 404
 * dönebilir — bu durum kullanıcıya "hazırlanıyor" olarak nazikçe bildirilir.
 */

export type ReceiptKind = "topup" | "order";

interface ReceiptResponse {
  success?: boolean;
  data?: { pdfUrl?: string | null } | null;
}

interface ReceiptButtonProps {
  kind: ReceiptKind;
  /** topup → topupId, order → orderId */
  id: string;
  /** `icon` küçük tablo/kart ikonu, `button` tam genişlikli düğme. */
  variant?: "icon" | "button";
  /** `button` varyantında görünen metin. */
  label?: string;
  className?: string;
}

const NOT_READY_MESSAGE =
  "Makbuz hazırlanıyor — birkaç saniye sonra tekrar deneyin.";
const GENERIC_MESSAGE = "Makbuz açılamadı. Lütfen tekrar deneyin.";
const FEEDBACK_TIMEOUT_MS = 4_000;

function receiptPath(kind: ReceiptKind, id: string): string {
  const encoded = encodeURIComponent(id);
  return kind === "topup"
    ? `/me/cari-balance/topups/${encoded}/receipt`
    : `/me/orders/${encoded}/receipt`;
}

export function ReceiptButton({
  kind,
  id,
  variant = "icon",
  label = "Makbuzu görüntüle",
  className,
}: ReceiptButtonProps) {
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  function showFeedback(message: string) {
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    setFeedback(message);
    feedbackTimer.current = setTimeout(
      () => setFeedback(null),
      FEEDBACK_TIMEOUT_MS,
    );
  }

  async function handleOpen() {
    if (loading) return;
    setLoading(true);
    setFeedback(null);
    try {
      const res = await apiCustomer<ReceiptResponse>(receiptPath(kind, id), {
        method: "GET",
        general: true,
        cache: "no-store",
      });
      const url = res?.data?.pdfUrl;
      if (!url) {
        showFeedback(NOT_READY_MESSAGE);
        return;
      }
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        showFeedback(NOT_READY_MESSAGE);
      } else {
        showFeedback(GENERIC_MESSAGE);
      }
    } finally {
      setLoading(false);
    }
  }

  const Icon = loading ? Loader2 : ReceiptText;

  if (variant === "button") {
    return (
      <div className="relative inline-flex flex-col items-stretch">
        <button
          type="button"
          onClick={handleOpen}
          disabled={loading}
          aria-label={label}
          className={
            className ??
            "inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--brand-blue,#2563eb)]/30 bg-[var(--brand-blue,#2563eb)]/5 px-4 py-2.5 text-sm font-semibold text-[var(--brand-blue,#2563eb)] transition hover:bg-[var(--brand-blue,#2563eb)]/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-blue,#2563eb)] active:scale-[0.98] disabled:cursor-progress disabled:opacity-70"
          }
        >
          <Icon
            className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
            aria-hidden="true"
          />
          {label}
        </button>
        {feedback ? (
          <span
            role="status"
            className="mt-1.5 text-xs font-medium text-amber-600"
          >
            {feedback}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={handleOpen}
        disabled={loading}
        aria-label={label}
        title={label}
        className={
          className ??
          "inline-flex rounded-lg p-1.5 text-emerald-500 transition hover:bg-emerald-50 hover:text-emerald-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500 active:scale-95 disabled:cursor-progress disabled:opacity-70"
        }
      >
        <Icon
          className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
          aria-hidden="true"
        />
      </button>
      {feedback ? (
        <span
          role="status"
          className="absolute right-0 top-full z-20 mt-1 w-48 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-700 shadow-lg"
        >
          {feedback}
        </span>
      ) : null}
    </span>
  );
}

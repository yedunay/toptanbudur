"use client";

import { useEffect } from "react";
import { AlertTriangle, X } from "lucide-react";
import { formatOrderNo, type CargoBarcodeMatch } from "@/lib/orders";

interface CargoBarcodeDuplicateModalProps {
  open: boolean;
  barcode: string;
  matches: CargoBarcodeMatch[];
  onClose: () => void;
  onContinue: () => void;
}

const STATUS_LABEL: Record<string, string> = {
  PENDING: "Onay bekliyor",
  PAID: "Ödendi",
  RECEIVED: "Alındı",
  PROCESSING: "Hazırlanıyor",
  SHIPPED: "Kargoya verildi",
  DELIVERED: "Teslim edildi",
  CANCELLED: "İptal",
  REFUNDED: "İade",
  FAILED: "Başarısız",
};

/** Satış kanalı kodlarının okunabilir Türkçe etiketleri (tesekkurler sayfasıyla aynı). */
const MARKETPLACE_LABELS: Record<string, string> = {
  self: "Kendim İçin",
  other: "Diğer Satış Kanalı",
};

function marketplaceLabel(value?: string | null): string | null {
  if (!value) return null;
  const v = value.trim();
  if (!v) return null;
  return MARKETPLACE_LABELS[v.toLowerCase()] ?? v;
}

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("tr-TR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/**
 * Kargo barkodu daha önce kullanılmışsa "Ödemeye Geç" anında çıkan uyarı.
 * Akış aynen devam edebilsin diye "Yine de devam et" butonu var; X / "Kapat"
 * ise müşteriyi /sepet'te tutar, hiçbir şey yapmaz.
 */
export function CargoBarcodeDuplicateModal({
  open,
  barcode,
  matches,
  onClose,
  onContinue,
}: CargoBarcodeDuplicateModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="cargo-dup-title"
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/55 p-4"
      onClick={onClose}
    >
      <div
        className="relative max-h-[90vh] w-full max-w-2xl overflow-hidden rounded-3xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between border-b border-[var(--border)] bg-amber-50 px-6 py-5">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
              <AlertTriangle className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h2
                id="cargo-dup-title"
                className="text-xl font-black text-amber-900"
              >
                Bu kargo barkodu daha önce kullanılmış
              </h2>
              <p className="mt-1 text-sm text-amber-900/85">
                <span className="font-mono font-bold">{barcode}</span> numaralı
                kargo barkodu aşağıdaki sipariş(ler)de zaten girilmiş. Yanlışlık
                değilse devam edebilirsiniz.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Kapat"
            className="rounded-full p-1.5 text-amber-900/70 transition hover:bg-amber-100 hover:text-amber-900"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="max-h-[55vh] space-y-3 overflow-y-auto px-6 py-5">
          {matches.map((m) => (
            <article
              key={m.id}
              className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-4"
            >
              <header className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                    Sipariş No
                  </div>
                  <div className="font-mono text-base font-black text-[var(--text)]">
                    {formatOrderNo(m.humanOrderNo, m.id.slice(0, 8))}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                    Durum
                  </div>
                  <div className="text-sm font-bold text-[var(--text)]">
                    {STATUS_LABEL[m.status] ?? m.status}
                  </div>
                </div>
              </header>

              <dl className="mt-3 grid grid-cols-1 gap-2 border-t border-[var(--border)] pt-3 text-sm text-[var(--text)] sm:grid-cols-2">
                {m.endCustomerName ? (
                  <div>
                    <dt className="text-xs font-semibold text-[var(--text-muted)]">
                      Müşteri
                    </dt>
                    <dd className="font-semibold">{m.endCustomerName}</dd>
                  </div>
                ) : null}
                {m.marketplace ? (
                  <div>
                    <dt className="text-xs font-semibold text-[var(--text-muted)]">
                      Satış Kanalı
                    </dt>
                    <dd className="font-semibold">{marketplaceLabel(m.marketplace)}</dd>
                  </div>
                ) : null}
                {m.cargoCompany ? (
                  <div>
                    <dt className="text-xs font-semibold text-[var(--text-muted)]">
                      Kargo
                    </dt>
                    <dd className="font-semibold">{m.cargoCompany}</dd>
                  </div>
                ) : null}
                <div>
                  <dt className="text-xs font-semibold text-[var(--text-muted)]">
                    Tarih
                  </dt>
                  <dd className="font-semibold">{formatDate(m.createdAt)}</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>

        <footer className="flex flex-col gap-2 border-t border-[var(--border)] bg-white px-6 py-4 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-[var(--border)] bg-white px-4 py-2 text-sm font-black text-[var(--text)] transition hover:bg-[var(--surface-muted)]"
          >
            Kapat
          </button>
          <button
            type="button"
            onClick={onContinue}
            className="rounded-xl bg-amber-600 px-4 py-2 text-sm font-black text-white transition hover:bg-amber-700"
          >
            Yine de devam et
          </button>
        </footer>
      </div>
    </div>
  );
}

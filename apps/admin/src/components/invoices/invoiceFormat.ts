import type { InvoiceBatchStatus } from "../../lib/invoices";

/**
 * Konsolide fatura UI yardımcıları (birfatura.md §9/§11).
 * Tutar formatı için `lib/format.formatAmount` kullanılır; burada yalnızca
 * tarih + durum rozeti + ödeme tipi sunumu var.
 */

/** ISO/null → "05.06.2026 14:30" (saatli) ya da "—". */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString("tr-TR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return value;
  }
}

/** ISO/null → "05.06.2026" (saatsiz) ya da "—". */
export function formatDateOnly(value: string | null | undefined): string {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleDateString("tr-TR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return value;
  }
}

export interface StatusBadge {
  label: string;
  /** Tailwind sınıfları (rozet). */
  className: string;
}

/**
 * InvoiceBatch durumu → rozet. Backend enum'u küçük harf (frozen/invoiced/
 * cancelled); olası başka değerlere karşı küçük harfe indirgenir.
 */
export function batchStatusBadge(status: InvoiceBatchStatus): StatusBadge {
  switch (String(status).toLowerCase()) {
    case "invoiced":
      return {
        label: "Faturalandı",
        className: "bg-emerald-100 text-emerald-700",
      };
    case "frozen":
      return {
        label: "Donduruldu",
        className: "bg-amber-100 text-amber-700",
      };
    case "cancelled":
      return {
        label: "İptal",
        className: "bg-slate-200 text-slate-600",
      };
    case "failed":
      return { label: "Hata", className: "bg-red-100 text-red-700" };
    case "pushed":
      return { label: "Gönderildi", className: "bg-sky-100 text-sky-700" };
    default:
      return {
        label: String(status || "—"),
        className: "bg-slate-100 text-slate-600",
      };
  }
}

/** 'card' → "Kredi Kartı (1)", 'cari' → "Cari Bakiye (2)". */
export function paymentTypeLabel(
  paymentType: string,
  paymentTypeLabelRaw?: string,
): string {
  if (paymentTypeLabelRaw && paymentTypeLabelRaw.trim().length > 0) {
    return paymentTypeLabelRaw;
  }
  return paymentType === "card" ? "Kredi Kartı" : "Cari Bakiye";
}

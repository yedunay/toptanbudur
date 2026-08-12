import type { InvoiceBatchStatus } from "@/lib/customer-types";

export interface InvoiceStatusConfig {
  label: string;
  /** Tailwind classes for the badge container. */
  className: string;
  /** Tailwind class for the status dot. */
  dotClass: string;
}

const STATUS_MAP: Record<InvoiceBatchStatus, InvoiceStatusConfig> = {
  frozen: {
    label: "Faturalanacak",
    className: "bg-amber-50 text-amber-700",
    dotClass: "bg-amber-400",
  },
  invoiced: {
    label: "Faturalandı",
    className: "bg-emerald-50 text-emerald-700",
    dotClass: "bg-emerald-500",
  },
  cancelled: {
    label: "İptal edildi",
    className: "bg-rose-50 text-rose-700",
    dotClass: "bg-rose-400",
  },
};

const FALLBACK_STATUS: InvoiceStatusConfig = {
  label: "Bilinmiyor",
  className: "bg-slate-50 text-slate-600",
  dotClass: "bg-slate-400",
};

export function invoiceStatusConfig(
  status: InvoiceBatchStatus | string,
): InvoiceStatusConfig {
  return STATUS_MAP[status as InvoiceBatchStatus] ?? FALLBACK_STATUS;
}

/** Yalnızca https:// linklerine izin ver — açık yönlendirme/şema enjeksiyonu engellenir. */
export function isSafeUrl(u?: string | null): boolean {
  if (!u) return false;
  try {
    return new URL(u).protocol === "https:";
  } catch {
    return false;
  }
}

/** "5 Haz 2026" gibi kısa tarih. */
export function formatShortDate(iso?: string | null): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("tr-TR", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/** "5 Haz" — dönem aralığı gösterimi için yıl olmadan. */
export function formatDayMonth(iso?: string | null): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("tr-TR", {
      day: "numeric",
      month: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/** "1 Haz – 30 Haz 2026" şeklinde dönem etiketi. */
export function formatPeriod(
  periodStart?: string | null,
  periodEnd?: string | null,
): string {
  if (!periodStart || !periodEnd) return "—";
  return `${formatDayMonth(periodStart)} – ${formatShortDate(periodEnd)}`;
}

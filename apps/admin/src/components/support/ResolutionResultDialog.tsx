import type { OrderUpdateRefundMeta } from "../../lib/orders";

/**
 * Destek talebi karar verildikten sonra ekrana basılan tam-ekran sonuç pop-up'ı.
 * Herhangi bir yere tıklanınca (overlay veya kart içi) kapanır — admin tek
 * tıkla normal listeye döner; pop-up kapanırken parent drawer da kapatılır.
 */
export type ResolutionDialogKind = "approved-cancel" | "approved-refund" | "rejected";

interface Props {
  open: boolean;
  kind: ResolutionDialogKind;
  customerName: string;
  refund: OrderUpdateRefundMeta | null;
  onClose: () => void;
}

function formatTRY(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  try {
    return new Intl.NumberFormat("tr-TR", {
      style: "currency",
      currency: "TRY",
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ₺`;
  }
}

function headlineFor(kind: ResolutionDialogKind): string {
  switch (kind) {
    case "approved-cancel":
      return "Sipariş iptal statüsüne alınmıştır";
    case "approved-refund":
      return "Sipariş iade statüsüne alınmıştır";
    case "rejected":
      return "Talep reddedilmiştir";
  }
}

function subtitleFor(kind: ResolutionDialogKind, hasRefund: boolean): string {
  switch (kind) {
    case "approved-cancel":
      return hasRefund
        ? "Sipariş detayında cariye iade yapılmıştır."
        : "Bu sipariş için cari hesaba yansıyan bir ödeme bulunmadığından iade yapılmamıştır.";
    case "approved-refund":
      return "Para iadesi otomatik yapılmamıştır — gerekirse cari ekranından elle işleyin.";
    case "rejected":
      return "Sipariş durumu değiştirilmedi. Müşteriye reddedildiği bildirildi.";
  }
}

function iconFor(kind: ResolutionDialogKind): string {
  switch (kind) {
    case "approved-cancel":
      return "✓";
    case "approved-refund":
      return "✓";
    case "rejected":
      return "✕";
  }
}

function accentFor(kind: ResolutionDialogKind): string {
  switch (kind) {
    case "approved-cancel":
      return "bg-emerald-100 text-emerald-700";
    case "approved-refund":
      return "bg-amber-100 text-amber-700";
    case "rejected":
      return "bg-slate-200 text-slate-700";
  }
}

export function ResolutionResultDialog({
  open,
  kind,
  customerName,
  refund,
  onClose,
}: Props): React.ReactElement | null {
  if (!open) return null;

  const headline = headlineFor(kind);
  const subtitle = subtitleFor(kind, !!refund);
  const accentClass = accentFor(kind);
  const icon = iconFor(kind);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="resolution-result-headline"
      onClick={onClose}
    >
      {/* Herhangi bir yere tıklayınca kapansın diye iç kart üzerinde
          stopPropagation YOK — bu kasıtlı. */}
      <div className="w-full max-w-md rounded-2xl bg-white p-6 text-center shadow-2xl">
        <div
          className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full text-2xl font-bold ${accentClass}`}
          aria-hidden="true"
        >
          {icon}
        </div>

        <h2
          id="resolution-result-headline"
          className="mt-4 text-lg font-semibold text-[var(--color-text)]"
        >
          {headline}
        </h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          {customerName}
        </p>
        <p className="mt-2 text-sm text-[var(--color-text-muted)]">{subtitle}</p>

        {refund ? (
          <dl className="mt-5 divide-y divide-[var(--color-border)] rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-muted)] text-left text-sm">
            <div className="flex items-center justify-between px-4 py-2.5">
              <dt className="text-[var(--color-text-muted)]">Eski bakiye</dt>
              <dd className="font-mono font-medium text-[var(--color-text)]">
                {formatTRY(refund.previousBalance)}
              </dd>
            </div>
            <div className="flex items-center justify-between px-4 py-2.5">
              <dt className="text-[var(--color-text-muted)]">İade edilen</dt>
              <dd className="font-mono font-semibold text-emerald-700">
                + {formatTRY(refund.amount)}
              </dd>
            </div>
            <div className="flex items-center justify-between px-4 py-2.5">
              <dt className="text-[var(--color-text-muted)]">Yeni bakiye</dt>
              <dd className="font-mono font-semibold text-[var(--color-text)]">
                {formatTRY(refund.newBalance)}
              </dd>
            </div>
          </dl>
        ) : null}

        <p className="mt-5 text-[11px] uppercase tracking-wide text-[var(--color-text-muted)]">
          Kapatmak için herhangi bir yere tıklayın
        </p>
      </div>
    </div>
  );
}

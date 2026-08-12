interface ConfirmDialogProps {
  open?: boolean;
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  open = true,
  title,
  message,
  confirmLabel = "Onayla",
  cancelLabel = "İptal",
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps): React.ReactElement | null {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4"
      onClick={onCancel}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        className="w-full max-w-md rounded-xl bg-white shadow-lg border border-[var(--color-border)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-[var(--color-border)]">
          <h2 id="confirm-title" className="text-lg font-semibold text-[var(--color-text)]">
            {title}
          </h2>
        </div>
        <div className="px-5 py-4 text-sm text-[var(--color-text)]">{message}</div>
        <div className="px-5 py-3 border-t border-[var(--color-border)] flex items-center justify-end gap-2 bg-[var(--color-surface-muted)] rounded-b-xl">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-[var(--color-border)] bg-white px-3 py-1.5 text-sm hover:bg-[var(--color-surface-muted)]"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`rounded-md px-3 py-1.5 text-sm text-white ${
              destructive
                ? "bg-red-600 hover:bg-red-700"
                : "bg-[var(--color-brand-blue)] hover:bg-[var(--color-brand-navy)]"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

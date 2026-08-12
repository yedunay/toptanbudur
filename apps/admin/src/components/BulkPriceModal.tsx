import { useState } from "react";

interface BulkPriceModalProps {
  count: number;
  onClose: () => void;
  onApply: (price: number) => Promise<void>;
}

export default function BulkPriceModal({
  count,
  onClose,
  onApply,
}: BulkPriceModalProps): React.ReactElement {
  const [value, setValue] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<boolean>(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    const price = Number(value);
    if (!Number.isFinite(price) || price < 0) {
      setError("Geçerli bir fiyat gir (0 veya daha büyük)");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await onApply(price);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Toplu güncelleme başarısız");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-md rounded-xl bg-white border border-[var(--color-border)] shadow-xl">
        <header className="px-6 py-4 border-b border-[var(--color-border)]">
          <h2 className="text-lg font-semibold">Toplu fiyat güncelle</h2>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            {count} ürün için yeni fiyat uygulanacak
          </p>
        </header>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {error ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          ) : null}
          <div>
            <label className="block text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
              Yeni fiyat (TRY)
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              required
              autoFocus
              className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-blue)]"
            />
          </div>
          <footer className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--color-border)]">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 text-sm rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-muted)] disabled:opacity-50"
            >
              İptal
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-sm rounded-md bg-[var(--color-brand-blue)] text-white hover:bg-[var(--color-brand-navy)] disabled:opacity-50 inline-flex items-center gap-2"
            >
              {saving ? (
                <span className="inline-block h-4 w-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              ) : null}
              {saving ? "Uygulanıyor…" : "Uygula"}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}

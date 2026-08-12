import { useEffect, useState } from "react";
import { formatTRY, type Product, type ProductPatch } from "../lib/products";

interface ProductEditModalProps {
  product: Product;
  onClose: () => void;
  onSave: (patch: ProductPatch) => Promise<void>;
}

interface FormState {
  name: string;
  // price/stock: manuel düzenleme tamponu. *FeedMode true iken input devre dışı,
  // feed değerini gösterir ve kayıtta null gönderilir (feed yönetimine dönüş).
  price: string;
  priceFeedMode: boolean;
  stock: string;
  stockFeedMode: boolean;
  isActive: boolean;
}

function validate(form: FormState): string | null {
  if (form.name.trim().length === 0) return "İsim boş olamaz";
  // Feed modundaki alanlar doğrulanmaz — değer feed'den gelir.
  if (!form.priceFeedMode) {
    // Boş alan Number('')===0 ile sessizce 0'a düşmesin — manuel fiyat zorunlu.
    if (form.price.trim().length === 0) return "Fiyat gerekli";
    const price = Number(form.price);
    if (!Number.isFinite(price) || price < 0) return "Fiyat 0 veya daha büyük olmalı";
  }
  if (!form.stockFeedMode) {
    // Boş alan Number('')===0 ile sessizce 0'a düşmesin — manuel stok zorunlu.
    if (form.stock.trim().length === 0) return "Stok gerekli";
    const stock = Number(form.stock);
    if (!Number.isInteger(stock) || stock < 0) return "Stok tam sayı, 0 veya daha büyük olmalı";
  }
  return null;
}

export default function ProductEditModal({
  product,
  onClose,
  onSave,
}: ProductEditModalProps): React.ReactElement {
  // İlk açılış: manualX dolu → override modu (input düzenlenebilir, manuel değer);
  // manualX null → feed modu (checkbox işaretli, input feed değerini gösterir).
  const priceIsManual = product.manualPrice != null;
  const stockIsManual = product.manualStock != null;
  const feedPriceVal = product.feedPrice ?? product.price;
  const feedStockVal = product.feedStock ?? product.stock;
  const [form, setForm] = useState<FormState>({
    name: product.name,
    price: priceIsManual ? String(product.manualPrice) : String(feedPriceVal),
    priceFeedMode: !priceIsManual,
    stock: stockIsManual ? String(product.manualStock) : String(feedStockVal),
    stockFeedMode: !stockIsManual,
    isActive: product.isActive,
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<boolean>(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape" && !saving) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    const validationError = validate(form);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      // Feed modu → null (manuel override temizle, feed değeri geri döner).
      const patch: ProductPatch = {
        name: form.name.trim(),
        price: form.priceFeedMode ? null : Number(form.price),
        stock: form.stockFeedMode ? null : Number(form.stock),
        isActive: form.isActive,
      };
      await onSave(patch);
      onClose();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Kayıt başarısız";
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-product-title"
    >
      <div className="w-full max-w-lg rounded-xl bg-white border border-[var(--color-border)] shadow-xl">
        <header className="px-6 py-4 border-b border-[var(--color-border)]">
          <h2 id="edit-product-title" className="text-lg font-semibold text-[var(--color-text)]">
            Ürünü düzenle
          </h2>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            {product.brand ?? ""} {product.sku ? `· SKU: ${product.sku}` : ""}
            {product.barcode ? ` · Barkod: ${product.barcode}` : ""}
          </p>
        </header>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {error ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          ) : null}
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">
              İsim
            </label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              minLength={1}
              maxLength={500}
              className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-blue)]"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">
                SKU
              </label>
              <input
                type="text"
                value={product.sku ?? ""}
                readOnly
                placeholder="—"
                className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2 text-sm font-mono text-[var(--color-text-muted)]"
                aria-label="SKU (salt okunur)"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">
                Barkod
              </label>
              <input
                type="text"
                value={product.barcode ?? ""}
                readOnly
                placeholder="—"
                className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2 text-sm font-mono text-[var(--color-text-muted)]"
                aria-label="Barkod (salt okunur)"
              />
              <span className="mt-1 block text-[10px] text-[var(--color-text-muted)]">
                Orijinal (tedarikçiden)
              </span>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">
              Public Barkod (TBDR)
            </label>
            <input
              type="text"
              value={product.publicBarcode ?? ""}
              readOnly
              placeholder="—"
              className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2 text-sm font-mono text-[var(--color-text-muted)]"
              aria-label="Public barkod (salt okunur)"
            />
            <span className="mt-1 block text-[10px] text-[var(--color-text-muted)]">
              Müşteriye gösterilen barkod
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="flex items-center justify-between gap-2">
                <label className="block text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">
                  Fiyat (TRY)
                </label>
                <label className="flex items-center gap-1.5 text-[11px] text-[var(--color-text-muted)] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.priceFeedMode}
                    onChange={(e) => setForm({ ...form, priceFeedMode: e.target.checked })}
                    className="h-3.5 w-3.5 rounded border-[var(--color-border)]"
                  />
                  <span>Feed&apos;den otomatik</span>
                </label>
              </div>
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.priceFeedMode ? String(feedPriceVal) : form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
                disabled={form.priceFeedMode}
                required={!form.priceFeedMode}
                className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-blue)] disabled:bg-[var(--color-surface-muted)] disabled:text-[var(--color-text-muted)] disabled:cursor-not-allowed"
              />
              <span className="mt-1 block text-[10px] text-[var(--color-text-muted)]">
                {form.priceFeedMode
                  ? "Feed yönetiyor — XML her sync'te günceller"
                  : `Manuel sabit · Feed: ${formatTRY(feedPriceVal)}`}
              </span>
            </div>
            <div>
              <div className="flex items-center justify-between gap-2">
                <label className="block text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">
                  Stok
                </label>
                <label className="flex items-center gap-1.5 text-[11px] text-[var(--color-text-muted)] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.stockFeedMode}
                    onChange={(e) => setForm({ ...form, stockFeedMode: e.target.checked })}
                    className="h-3.5 w-3.5 rounded border-[var(--color-border)]"
                  />
                  <span>Feed&apos;den otomatik</span>
                </label>
              </div>
              <input
                type="number"
                step="1"
                min="0"
                value={form.stockFeedMode ? String(feedStockVal) : form.stock}
                onChange={(e) => setForm({ ...form, stock: e.target.value })}
                disabled={form.stockFeedMode}
                required={!form.stockFeedMode}
                className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-blue)] disabled:bg-[var(--color-surface-muted)] disabled:text-[var(--color-text-muted)] disabled:cursor-not-allowed"
              />
              <span className="mt-1 block text-[10px] text-[var(--color-text-muted)]">
                {form.stockFeedMode
                  ? "Feed yönetiyor — XML her sync'te günceller"
                  : `Manuel sabit · Feed: ${feedStockVal} adet`}
              </span>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
              className="h-4 w-4 rounded border-[var(--color-border)]"
            />
            <span>Aktif</span>
          </label>
          <footer className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--color-border)]">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 text-sm rounded-md border border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-surface-muted)] disabled:opacity-50"
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
              {saving ? "Kaydediliyor…" : "Kaydet"}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}

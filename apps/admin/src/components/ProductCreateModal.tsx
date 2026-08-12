import { useEffect, useState } from "react";
import {
  createManualProduct,
  MANUAL_DEFAULT_TAX_RATE,
  MANUAL_MAX_IMAGES,
  type CreateManualProductInput,
  type CreatedManualProduct,
} from "../lib/products";
import {
  fetchCategoryTree,
  flattenCategoryTree,
  type CategoryNode,
  type CategorySummary,
} from "../lib/categories";
import ImageUploadDropzone from "./ImageUploadDropzone";
import CategoryCreateModal from "./CategoryCreateModal";

interface ProductCreateModalProps {
  onClose: () => void;
  onCreated: (created: CreatedManualProduct) => void;
}

interface FormState {
  name: string;
  description: string;
  brand: string;
  model: string;
  categoryId: string;
  price: string;
  costPrice: string;
  stock: string;
  taxRate: string;
  isActive: boolean;
}

function validate(form: FormState, images: File[]): string | null {
  if (form.name.trim().length < 2) return "Ürün adı en az 2 karakter olmalı.";
  if (form.name.trim().length > 500) return "Ürün adı en fazla 500 karakter olabilir.";
  const price = Number(form.price);
  if (!Number.isFinite(price) || price < 0) return "Satış fiyatı 0 veya daha büyük olmalı.";
  const stock = Number(form.stock);
  if (!Number.isInteger(stock) || stock < 0) return "Stok tam sayı, 0 veya daha büyük olmalı.";
  if (form.costPrice.trim().length > 0) {
    const cost = Number(form.costPrice);
    if (!Number.isFinite(cost) || cost < 0) return "Maliyet fiyatı 0 veya daha büyük olmalı.";
  }
  const tax = Number(form.taxRate);
  if (!Number.isFinite(tax) || tax < 0 || tax > 100) return "KDV oranı 0-100 arasında olmalı.";
  if (images.length === 0) return "En az 1 ürün görseli yüklemelisiniz.";
  if (images.length > MANUAL_MAX_IMAGES) return `En fazla ${MANUAL_MAX_IMAGES} görsel yükleyebilirsiniz.`;
  return null;
}

export default function ProductCreateModal({
  onClose,
  onCreated,
}: ProductCreateModalProps): React.ReactElement {
  const [form, setForm] = useState<FormState>({
    name: "",
    description: "",
    brand: "",
    model: "",
    categoryId: "",
    price: "",
    costPrice: "",
    stock: "0",
    taxRate: String(MANUAL_DEFAULT_TAX_RATE),
    isActive: true,
  });
  const [images, setImages] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<boolean>(false);
  const [tree, setTree] = useState<CategoryNode[]>([]);
  const [treeLoading, setTreeLoading] = useState<boolean>(true);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [showCategoryModal, setShowCategoryModal] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    setTreeLoading(true);
    fetchCategoryTree()
      .then((data) => {
        if (cancelled) return;
        setTree(data);
        setTreeError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setTreeError(err instanceof Error ? err.message : "Kategoriler yüklenemedi.");
      })
      .finally(() => {
        if (!cancelled) setTreeLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape" && !saving && !showCategoryModal) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving, showCategoryModal]);

  const options = flattenCategoryTree(tree);

  const handleCategoryCreated = async (created: CategorySummary): Promise<void> => {
    // Ağacı yeniden çekip yeni kategoriyi seçili hale getiriyoruz.
    try {
      const fresh = await fetchCategoryTree();
      setTree(fresh);
    } catch {
      // Sessizce yut — kullanıcı yine de devam edebilsin.
    }
    setForm((prev) => ({ ...prev, categoryId: created.id }));
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    const validationError = validate(form, images);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const input: CreateManualProductInput = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        brand: form.brand.trim() || null,
        model: form.model.trim() || null,
        categoryId: form.categoryId || null,
        price: Number(form.price),
        costPrice: form.costPrice.trim().length > 0 ? Number(form.costPrice) : null,
        stock: Number(form.stock),
        taxRate: Number(form.taxRate),
        isActive: form.isActive,
        images,
      };
      const created = await createManualProduct(input);
      onCreated(created);
      onClose();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Ürün oluşturulamadı.";
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="product-create-title"
    >
      <div className="w-full max-w-3xl my-8 rounded-xl bg-white border border-[var(--color-border)] shadow-xl">
        <header className="px-6 py-4 border-b border-[var(--color-border)] sticky top-0 bg-white rounded-t-xl z-10">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2
                id="product-create-title"
                className="text-lg font-semibold text-[var(--color-text)]"
              >
                Manuel ürün ekle
              </h2>
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                Stok kodu (TBDR-…) ve barkod sistem tarafından otomatik atanır. KDV
                varsayılanı %{MANUAL_DEFAULT_TAX_RATE}.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-50"
              aria-label="Kapat"
            >
              ✕
            </button>
          </div>
        </header>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-5">
          {error ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          <div>
            <label className="block text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">
              Ürün adı *
            </label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              minLength={2}
              maxLength={500}
              autoFocus
              className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-blue)]"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">
              Açıklama
            </label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={4}
              maxLength={8000}
              className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-blue)]"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">
                Marka
              </label>
              <input
                type="text"
                value={form.brand}
                onChange={(e) => setForm({ ...form, brand: e.target.value })}
                maxLength={120}
                className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-blue)]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">
                Model
              </label>
              <input
                type="text"
                value={form.model}
                onChange={(e) => setForm({ ...form, model: e.target.value })}
                maxLength={120}
                className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-blue)]"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label className="block text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">
                Kategori
              </label>
              <button
                type="button"
                onClick={() => setShowCategoryModal(true)}
                disabled={saving || treeLoading}
                className="text-xs text-[var(--color-brand-blue)] hover:underline disabled:opacity-50"
              >
                + Yeni kategori
              </button>
            </div>
            <select
              value={form.categoryId}
              onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
              disabled={treeLoading}
              className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-blue)] disabled:opacity-50"
            >
              <option value="">— Kategori seçilmedi —</option>
              {options.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
            {treeError ? (
              <p className="mt-1 text-xs text-red-600">{treeError}</p>
            ) : (
              <p className="mt-1 text-[10px] text-[var(--color-text-muted)]">
                {treeLoading ? "Kategoriler yükleniyor…" : `${options.length} mevcut kategori`}
              </p>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">
                Satış fiyatı (TRY) *
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
                required
                className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-blue)]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">
                Maliyet (TRY)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.costPrice}
                onChange={(e) => setForm({ ...form, costPrice: e.target.value })}
                placeholder="Opsiyonel"
                className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-blue)]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">
                KDV (%) *
              </label>
              <input
                type="number"
                step="0.1"
                min="0"
                max="100"
                value={form.taxRate}
                onChange={(e) => setForm({ ...form, taxRate: e.target.value })}
                required
                className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-blue)]"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 items-end">
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">
                Stok *
              </label>
              <input
                type="number"
                step="1"
                min="0"
                value={form.stock}
                onChange={(e) => setForm({ ...form, stock: e.target.value })}
                required
                className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-blue)]"
              />
            </div>
            <label className="flex items-center gap-2 text-sm h-[42px]">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                className="h-4 w-4 rounded border-[var(--color-border)]"
              />
              <span>Aktif (satışa hazır)</span>
            </label>
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">
              Görseller *
            </label>
            <div className="mt-1">
              <ImageUploadDropzone
                files={images}
                onChange={setImages}
                disabled={saving}
              />
            </div>
          </div>

          <div className="rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-800">
            <strong>Bilgi:</strong> Stok kodu (TBDR-XXXXXX) ve barkod sistem
            tarafından otomatik üretilir. Ürün hem müşteri kataloğunda hem de XML
            beslemelerinde "MANUAL" etiketiyle yer alır.
          </div>

          <footer className="flex items-center justify-end gap-2 pt-3 border-t border-[var(--color-border)]">
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
              disabled={saving || treeLoading}
              className="px-4 py-2 text-sm rounded-md bg-[var(--color-brand-blue)] text-white hover:bg-[var(--color-brand-navy)] disabled:opacity-50 inline-flex items-center gap-2"
            >
              {saving ? (
                <span className="inline-block h-4 w-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              ) : null}
              {saving ? "Oluşturuluyor…" : "Ürünü oluştur"}
            </button>
          </footer>
        </form>
      </div>

      {showCategoryModal ? (
        <CategoryCreateModal
          tree={tree}
          defaultParentId={form.categoryId || null}
          onClose={() => setShowCategoryModal(false)}
          onCreated={handleCategoryCreated}
        />
      ) : null}
    </div>
  );
}

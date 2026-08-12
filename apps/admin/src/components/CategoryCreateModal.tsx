import { useEffect, useState } from "react";
import {
  createCategory,
  flattenCategoryTree,
  type CategoryNode,
  type CategorySummary,
} from "../lib/categories";

interface CategoryCreateModalProps {
  tree: CategoryNode[];
  defaultParentId?: string | null;
  onClose: () => void;
  onCreated: (created: CategorySummary) => void;
}

export default function CategoryCreateModal({
  tree,
  defaultParentId = null,
  onClose,
  onCreated,
}: CategoryCreateModalProps): React.ReactElement {
  const [name, setName] = useState<string>("");
  const [parentId, setParentId] = useState<string | "">(defaultParentId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<boolean>(false);

  const options = flattenCategoryTree(tree);

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape" && !saving) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setError("Kategori adı en az 2 karakter olmalı.");
      return;
    }
    if (trimmed.length > 120) {
      setError("Kategori adı en fazla 120 karakter olabilir.");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const created = await createCategory({
        name: trimmed,
        parentId: parentId === "" ? null : parentId,
      });
      onCreated(created);
      onClose();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Kategori oluşturulamadı.";
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="category-create-title"
    >
      <div className="w-full max-w-md rounded-xl bg-white border border-[var(--color-border)] shadow-xl">
        <header className="px-6 py-4 border-b border-[var(--color-border)]">
          <h2
            id="category-create-title"
            className="text-lg font-semibold text-[var(--color-text)]"
          >
            Yeni kategori
          </h2>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            Üst kategori seçmezseniz kök seviyede oluşturulur.
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
              Kategori adı
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              minLength={2}
              maxLength={120}
              autoFocus
              placeholder="Örn. El Aletleri"
              className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-blue)]"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">
              Üst kategori (opsiyonel)
            </label>
            <select
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
              className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-blue)]"
            >
              <option value="">— Kök kategori —</option>
              {options.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[10px] text-[var(--color-text-muted)]">
              {options.length} mevcut kategori
            </p>
          </div>

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
              {saving ? "Oluşturuluyor…" : "Oluştur"}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}

"use client";

import { useEffect } from "react";
import { Package, X } from "lucide-react";
import { formatPrice } from "@/lib/api";
import type { CartSupplierGroup } from "@/lib/cart-split";

interface SupplierSplitModalProps {
  open: boolean;
  groups: CartSupplierGroup[];
  onClose: () => void;
  onConfirm: (supplierId: string) => void;
}

/**
 * "Sepeti Paketlere Ayır" modalı.
 *
 * Müşteri sepetteki ürünleri pakete göre görür ve "Bu paketi şimdi sipariş
 * et" diyerek 1. paketi kasaya götürür. Kalan paketler stash'lenir; sipariş
 * tamamlandığında teşekkür sayfasında otomatik olarak sepete geri eklenir.
 *
 * GİZLİLİK: Tedarikçi adı/UUID gösterilmez. Sadece "1. Paket", "2. Paket"
 * etiketleri ve ürün adetleri/tutarları görünür.
 */
export function SupplierSplitModal({
  open,
  groups,
  onClose,
  onConfirm,
}: SupplierSplitModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    // ESC tuşu desteği — modal açıkken her zaman çalışsın.
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="split-modal-title"
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/55 p-4"
      onClick={onClose}
    >
      <div
        className="relative max-h-[90vh] w-full max-w-2xl overflow-hidden rounded-3xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between border-b border-[var(--border)] bg-amber-50 px-6 py-5">
          <div>
            <h2
              id="split-modal-title"
              className="text-xl font-black text-amber-900"
            >
              Sepeti Paketlere Ayır
            </h2>
            <p className="mt-1 text-sm text-amber-900/85">
              Sepetiniz {groups.length} ayrı pakete bölünmek zorunda. Önce
              hangi paketi sipariş etmek istiyorsunuz?
            </p>
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

        <div className="max-h-[60vh] space-y-4 overflow-y-auto px-6 py-5">
          {groups.map((group) => (
            <article
              key={group.supplierId}
              className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-4"
            >
              <header className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--brand-blue)]/10 text-[var(--brand-blue)]">
                    <Package className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div>
                    <h3 className="text-base font-black text-[var(--text)]">
                      {group.label}
                    </h3>
                    <p className="text-xs font-semibold text-[var(--text-muted)]">
                      {group.items.length} farklı ürün · toplam{" "}
                      {group.totalQty} adet
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs font-semibold text-[var(--text-muted)]">
                    Ara toplam
                  </div>
                  <div className="text-base font-black text-[var(--text)]">
                    {formatPrice(group.subtotal, group.items[0]?.currency ?? "TRY")}
                  </div>
                </div>
              </header>

              <ul className="mt-3 space-y-1.5 border-t border-[var(--border)] pt-3 text-sm text-[var(--text)]">
                {group.items.map((it) => (
                  <li
                    key={it.slug}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="line-clamp-1 font-semibold">
                      {it.name}
                    </span>
                    <span className="shrink-0 font-bold text-[var(--text-muted)]">
                      × {it.qty}
                    </span>
                  </li>
                ))}
              </ul>

              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  onClick={() => onConfirm(group.supplierId)}
                  className="rounded-xl bg-amber-600 px-4 py-2 text-sm font-black text-white transition hover:bg-amber-700"
                >
                  Bu paketi şimdi sipariş et
                </button>
              </div>
            </article>
          ))}
        </div>

        <footer className="border-t border-[var(--border)] bg-white px-6 py-4 text-xs leading-relaxed text-[var(--text-muted)]">
          Seçtiğiniz paket sipariş edildikten sonra kalan paketler
          otomatik olarak sepetinize geri eklenecek. Her paket için ayrı
          kargo barkodu girmeniz gerekmektedir.
        </footer>
      </div>
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { CartItemRow } from "./CartItemRow";
import { formatPrice } from "@/lib/api";
import type { CartItem } from "@/lib/cart";
import type { Customer } from "@/lib/auth";
import {
  cartItemUnitPrice,
  cartSubtotal,
  type EffectivePriceBySlug,
} from "@/lib/dealer-pricing";

interface CartItemsTableProps {
  items: CartItem[];
  /** Login'li bayi — birim fiyatlara indirim uygulamak için. */
  customer: Customer | null;
  selectedSlugs: Set<string>;
  /** ADMIN_DISCOUNT müşterisi için backend'den gelen effectivePrice haritası. */
  effectivePriceBySlug?: EffectivePriceBySlug;
  /** Müşteri ADMIN_DISCOUNT statüsünde mi — UI'da "Admin indirimi" rozeti için. */
  isAdminDiscount?: boolean;
  onToggle: (slug: string) => void;
  onToggleAll: () => void;
  onQtyChange: (slug: string, qty: number) => void;
  onRemove: (slug: string) => void;
}

export function CartItemsTable({
  items,
  customer,
  selectedSlugs,
  effectivePriceBySlug,
  isAdminDiscount = false,
  onToggle,
  onToggleAll,
  onQtyChange,
  onRemove,
}: CartItemsTableProps) {
  const [searchQuery, setSearchQuery] = useState("");

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) =>
        i.name.toLowerCase().includes(q) ||
        (i.sku?.toLowerCase().includes(q) ?? false) ||
        (i.publicBarcode?.toLowerCase().includes(q) ?? false) ||
        i.slug.toLowerCase().includes(q),
    );
  }, [items, searchQuery]);

  const allSelected =
    filtered.length > 0 && filtered.every((i) => selectedSlugs.has(i.slug));

  const selectedSubtotal = cartSubtotal(
    filtered.filter((i) => selectedSlugs.has(i.slug)),
    customer,
    effectivePriceBySlug,
  );

  const selectedCount = filtered.filter((i) =>
    selectedSlugs.has(i.slug),
  ).length;
  const currency = items[0]?.currency ?? "TRY";

  return (
    <section className="rounded-3xl border border-[var(--border)] bg-white p-4 shadow-sm">
      <label className="relative mb-4 block max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          type="search"
          placeholder="Ürün ara (SKU, ad, barkod...)"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="h-11 w-full rounded-xl border border-[var(--border)] bg-white pl-10 pr-3 text-sm font-semibold outline-none transition placeholder:text-slate-400 focus:border-[var(--brand-blue)]"
        />
      </label>

      <div className="overflow-hidden rounded-2xl border border-[var(--border)]">
        <div className="overflow-x-auto">
          <table className="min-w-[1120px] w-full text-left text-sm">
            <thead className="bg-[var(--surface-muted)] text-xs uppercase tracking-wide text-[var(--text-muted)]">
              <tr>
                <th className="px-4 py-3">
                  <label className="inline-flex items-center gap-2 font-black">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={onToggleAll}
                      className="h-4 w-4 accent-[var(--brand-blue)]"
                    />
                    Tümünü seç ({filtered.length})
                  </label>
                </th>
                <th className="px-4 py-3 font-black">SKU</th>
                <th className="px-4 py-3 text-center font-black">Miktar</th>
                <th className="px-4 py-3 text-right font-black">Birim Fiyat</th>
                <th className="px-4 py-3 text-right font-black">Ara Toplam</th>
                <th className="px-4 py-3 font-black">Stok / Durum</th>
                <th className="px-4 py-3 text-right font-black">Sil</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100 bg-white">
              {filtered.map((item) => (
                <CartItemRow
                  key={item.slug}
                  item={item}
                  unitPrice={cartItemUnitPrice(
                    item,
                    customer,
                    effectivePriceBySlug,
                  )}
                  selected={selectedSlugs.has(item.slug)}
                  isAdminDiscount={isAdminDiscount}
                  onToggle={() => onToggle(item.slug)}
                  onQtyChange={(qty) => onQtyChange(item.slug, qty)}
                  onRemove={() => onRemove(item.slug)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm font-black text-[var(--text)]">
          {selectedCount} ürün seçildi
        </p>
        <p className="text-sm font-semibold text-[var(--text-muted)]">
          Seçilen ürünlerin ara toplamı:{" "}
          <span className="text-lg font-black text-[var(--text)]">
            {formatPrice(selectedSubtotal, currency)}
          </span>
        </p>
      </div>
    </section>
  );
}

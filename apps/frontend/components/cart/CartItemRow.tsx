"use client";

import { Info, Trash2 } from "lucide-react";
import { ProductImage } from "@/components/ProductImage";
import { formatPrice } from "@/lib/api";
import type { CartItem } from "@/lib/cart";

interface CartItemRowProps {
  item: CartItem;
  /** Bayi/Admin indirimi uygulanmış birim fiyat (KDV hariç). */
  unitPrice: number;
  selected: boolean;
  /**
   * ADMIN_DISCOUNT müşterisinde indirim "Admin indirimi" olarak etiketlenir;
   * STANDARD müşteride standart bayi indirimi rozeti gösterilir.
   */
  isAdminDiscount?: boolean;
  onToggle: () => void;
  onQtyChange: (qty: number) => void;
  onRemove: () => void;
}


export function CartItemRow({
  item,
  unitPrice,
  selected,
  isAdminDiscount = false,
  onToggle,
  onQtyChange,
  onRemove,
}: CartItemRowProps) {
  const stockCount = item.stock;
  const hasDiscount = unitPrice < item.price;
  const isLowStock = stockCount != null && stockCount > 0 && stockCount <= 10;
  const isInStock = stockCount == null || stockCount > 0;

  return (
    <tr className="transition hover:bg-blue-50/30">
      {/* Ürün bilgisi */}
      <td className="px-4 py-4">
        <div className="flex items-center gap-4">
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            className="h-4 w-4 accent-[var(--brand-blue)]"
          />

          <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-muted)]">
            <ProductImage
              src={item.image}
              alt={item.name}
              fill
              sizes="56px"
              className="object-contain"
              unoptimized
            />
          </div>

          <div className="min-w-0">
            <p className="truncate font-black text-[var(--text)]">{item.name}</p>
            {item.publicBarcode ? (
              <p className="mt-1 text-xs font-semibold text-[var(--text-muted)]">
                &#x2759;&#x2759;&#x2759; {item.publicBarcode}
              </p>
            ) : null}
          </div>
        </div>
      </td>

      {/* SKU */}
      <td className="px-4 py-4 font-semibold text-slate-700">
        {item.sku || "—"}
      </td>

      {/* Miktar */}
      <td className="px-4 py-4">
        <div className="mx-auto grid h-9 w-28 grid-cols-3 overflow-hidden rounded-xl border border-[var(--border)]">
          <button
            type="button"
            onClick={() => (item.qty <= 1 ? onRemove() : onQtyChange(item.qty - 1))}
            aria-label={item.qty <= 1 ? "Ürünü sepetten kaldır" : "Adedi azalt"}
            className={
              item.qty <= 1
                ? "grid place-items-center bg-white text-red-500 transition hover:bg-red-50"
                : "bg-white text-lg font-black text-slate-500 transition hover:bg-slate-50"
            }
          >
            {item.qty <= 1 ? <Trash2 className="h-4 w-4" /> : "−"}
          </button>
          <span className="grid place-items-center border-x border-[var(--border)] bg-[var(--surface-muted)] font-black text-[var(--text)]">
            {item.qty}
          </span>
          <button
            type="button"
            onClick={() => onQtyChange(item.qty + 1)}
            disabled={item.qty >= 99}
            aria-label="Adedi artır"
            className="bg-white text-lg font-black text-slate-500 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            +
          </button>
        </div>
      </td>

      {/* Birim fiyat */}
      <td className="px-4 py-4 text-right">
        {hasDiscount ? (
          <div className="flex flex-col items-end leading-tight">
            <span className="text-xs font-semibold text-[var(--text-muted)] line-through">
              {formatPrice(item.price, item.currency)}
            </span>
            <span className="font-black text-green-700">
              {formatPrice(unitPrice, item.currency)}
            </span>
            <span className="mt-0.5 inline-flex rounded-md bg-green-50 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide text-green-700">
              {isAdminDiscount ? "Admin İndirimi" : "Özel Bayi İndirimi"}
            </span>
          </div>
        ) : (
          <span className="font-semibold text-[var(--text)]">
            {formatPrice(unitPrice, item.currency)}
          </span>
        )}
      </td>

      {/* Ara toplam */}
      <td className="px-4 py-4 text-right font-black text-[var(--text)]">
        {formatPrice(unitPrice * item.qty, item.currency)}
      </td>

      {/* Stok durumu */}
      <td className="px-4 py-4">
        {stockCount != null ? (
          <>
            <span
              className={`inline-flex rounded-lg px-2.5 py-1 text-xs font-black ${
                isLowStock
                  ? "bg-red-50 text-red-700"
                  : isInStock
                    ? "bg-green-50 text-green-700"
                    : "bg-slate-100 text-slate-500"
              }`}
            >
              {isLowStock ? "Az Stok" : isInStock ? "Stokta" : "Tükendi"} (
              {stockCount})
            </span>
            {isLowStock ? (
              <span className="mt-1 flex items-center gap-1 text-xs font-black text-red-600">
                <Info className="h-3.5 w-3.5" />
                Acele
              </span>
            ) : null}
          </>
        ) : (
          <span className="text-xs text-[var(--text-muted)]">—</span>
        )}
      </td>

      {/* Sil */}
      <td className="px-4 py-4 text-right">
        <button
          type="button"
          onClick={onRemove}
          className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-red-100 text-red-500 transition hover:bg-red-50"
          aria-label="Ürünü sepetten kaldır"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </td>
    </tr>
  );
}

"use client";

import type { CartItem } from "@/lib/cart";
import type { Customer } from "@/lib/auth";
import {
  cartItemUnitPrice,
  type EffectivePriceBySlug,
} from "@/lib/dealer-pricing";

/**
 * Sepetteki ürünleri opak tedarikçi UUID'sine göre gruplar ve her gruba
 * "1. Paket", "2. Paket" gibi sıralı etiket atar.
 *
 * Etiketleme tedarikçi UUID'sinin stable string sıralamasına göre yapılır:
 * böylece aynı sepet her render'da aynı sırayla aynı paket numarasını alır.
 *
 * GİZLİLİK: Tedarikçi adı/UUID'si müşteriye ASLA gösterilmez. Dönen
 * `supplierId` yalnız `key` olarak (React list key, modal seçimi) kullanılır.
 */

export interface CartSupplierGroup {
  /** Opak tedarikçi UUID'si — sadece istemci içi key/grup eşleme için. */
  supplierId: string;
  /** "1. Paket", "2. Paket" gibi müşteriye gösterilen etiket. */
  label: string;
  /** 1-bazlı sıra numarası. */
  index: number;
  /** Bu pakete ait sepet kalemleri. */
  items: CartItem[];
  /** Bu paketin toplam ürün adedi (qty toplamı). */
  totalQty: number;
  /** Bu paketin ara toplamı (KDV hariç). */
  subtotal: number;
}

const UNKNOWN_SUPPLIER_KEY = "__unknown__";

export function splitCartBySupplier(
  items: CartItem[],
  customer?: Customer | null,
  effectivePriceBySlug?: EffectivePriceBySlug,
): CartSupplierGroup[] {
  if (items.length === 0) return [];

  const byId = new Map<string, CartItem[]>();
  for (const item of items) {
    const key = item.supplier?.id ?? UNKNOWN_SUPPLIER_KEY;
    const bucket = byId.get(key);
    if (bucket) {
      bucket.push(item);
    } else {
      byId.set(key, [item]);
    }
  }

  const sortedKeys = Array.from(byId.keys()).sort((a, b) =>
    a.localeCompare(b),
  );

  return sortedKeys.map((supplierId, idx) => {
    const groupItems = byId.get(supplierId) ?? [];
    const totalQty = groupItems.reduce((sum, i) => sum + i.qty, 0);
    const subtotal = groupItems.reduce(
      (sum, i) =>
        sum + cartItemUnitPrice(i, customer, effectivePriceBySlug) * i.qty,
      0,
    );
    return {
      supplierId,
      label: `${idx + 1}. Paket`,
      index: idx + 1,
      items: groupItems,
      totalQty,
      subtotal,
    };
  });
}

/**
 * Sepetin birden fazla pakete bölünüp bölünmediğini hızlı kontrol eder.
 * Tek bir taramada distinct supplierId sayısını döner.
 */
export function countDistinctSuppliers(items: CartItem[]): number {
  const set = new Set<string>();
  for (const item of items) {
    set.add(item.supplier?.id ?? UNKNOWN_SUPPLIER_KEY);
  }
  return set.size;
}

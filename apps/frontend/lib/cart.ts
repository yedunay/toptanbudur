"use client";

import { useEffect, useState } from "react";
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { Product, ProductSupplier } from "@/lib/api";
import { productImage } from "@/lib/api";

export interface CartItemSupplier {
  /**
   * Opak tedarikçi UUID'si — sepet "Paket" gruplaması için kullanılır.
   * Müşteriye gösterilmez, sadece istemci içi kıyaslama için.
   */
  id?: string | null;
  name?: string | null;
  /**
   * Tedarikçinin desteklediği/zorunlu kıldığı kargo firmaları (boş dizi →
   * kısıtlama yok). Birden fazla tedarikçi varsa checkout sayfası bu
   * dizilerin kesişimini hesaplar.
   */
  mandatoryCarriers?: string[] | null;
  requiresPdf?: boolean | null;
  /** Backend'den gelen eski tedarikçi bayrağı — checkout akışında kullanılmıyor. */
  pttavmEnabled?: boolean | null;
  leadTimeDays?: number | null;
}

export interface CartItem {
  slug: string;
  name: string;
  image: string | null;
  price: number;
  currency: string;
  qty: number;
  sku?: string | null;
  publicBarcode?: string | null;
  stock?: number | null;
  /** Tedarikçi kuralları — checkout'ta merged rule hesaplamak için. */
  supplier?: CartItemSupplier | null;
}

interface CartState {
  items: CartItem[];
  add: (product: Product, qty?: number) => void;
  remove: (slug: string) => void;
  setQty: (slug: string, qty: number) => void;
  clear: () => void;
  total: () => number;
  count: () => number;
}

const MAX_QTY = 99;

function toCartItem(product: Product, qty: number): CartItem {
  const priceNum = Number(product.price ?? 0);
  const nested = product.supplier ?? null;
  // Hem yeni alan adını (mandatoryCarriers: string[]) hem de düz fallback'i
  // (product.mandatoryCarriers) destekliyoruz; geriye uyumluluk için iki
  // tarafı da kontrol ediyoruz.
  const carriersFromNested = Array.isArray(nested?.mandatoryCarriers)
    ? (nested?.mandatoryCarriers ?? [])
    : null;
  const carriersFromFlat = Array.isArray(product.mandatoryCarriers)
    ? (product.mandatoryCarriers ?? [])
    : null;
  const mandatoryCarriers: string[] | null =
    carriersFromNested ?? carriersFromFlat ?? null;
  const supplierId = nested?.id ?? product.supplierId ?? null;
  const supplier: CartItemSupplier | null =
    nested ||
    supplierId != null ||
    (mandatoryCarriers && mandatoryCarriers.length > 0) ||
    product.requiresPdf != null ||
    product.leadTimeDays != null ||
    product.supplierName != null
      ? {
          id: supplierId,
          name: nested?.name ?? product.supplierName ?? null,
          mandatoryCarriers: mandatoryCarriers ?? [],
          requiresPdf: nested?.requiresPdf ?? product.requiresPdf ?? null,
          pttavmEnabled: nested?.pttavmEnabled ?? null,
          leadTimeDays: nested?.leadTimeDays ?? product.leadTimeDays ?? null,
        }
      : null;
  return {
    slug: product.slug,
    name: product.name,
    image: productImage(product),
    price: Number.isFinite(priceNum) ? priceNum : 0,
    currency: product.currency ?? "TRY",
    qty,
    sku: product.sku ?? null,
    publicBarcode: product.publicBarcode ?? null,
    stock: typeof product.stock === "number" ? product.stock : null,
    supplier,
  };
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      add: (product, qty = 1) => {
        const safeQty = Math.max(1, Math.min(MAX_QTY, Math.floor(qty)));
        set((state) => {
          const existing = state.items.find((i) => i.slug === product.slug);
          if (existing) {
            return {
              items: state.items.map((i) =>
                i.slug === product.slug
                  ? { ...i, qty: Math.min(MAX_QTY, i.qty + safeQty) }
                  : i,
              ),
            };
          }
          return { items: [...state.items, toCartItem(product, safeQty)] };
        });
      },
      remove: (slug) =>
        set((state) => ({
          items: state.items.filter((i) => i.slug !== slug),
        })),
      setQty: (slug, qty) => {
        const safeQty = Math.max(1, Math.min(MAX_QTY, Math.floor(qty)));
        set((state) => ({
          items: state.items.map((i) =>
            i.slug === slug ? { ...i, qty: safeQty } : i,
          ),
        }));
      },
      clear: () => set({ items: [] }),
      total: () =>
        get().items.reduce((sum, i) => sum + i.price * i.qty, 0),
      count: () => get().items.reduce((sum, i) => sum + i.qty, 0),
    }),
    {
      name: "tb-cart-v1",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ items: state.items }),
    },
  ),
);

/**
 * SSR-safe hook wrapper. Returns `undefined` on the server / before hydration,
 * preventing markup mismatch from persisted localStorage state.
 */
export function useHydratedCart<T>(selector: (state: CartState) => T): T | undefined {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);
  const value = useCartStore(selector);
  return hydrated ? value : undefined;
}

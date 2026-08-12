"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { CartItem } from "@/lib/cart";

/**
 * "Sepeti Paketlere Ayır" modalında müşteri 1. paketi sipariş ettiğinde,
 * kalan paketlerdeki ürünler buraya stash'lenir. Sipariş başarıyla
 * tamamlandığında (teşekkür sayfasında) stash boşaltılıp ürünler tekrar
 * sepete eklenir; böylece müşteri 2. paketi de sırayla sipariş edebilir.
 *
 * Anahtar: localStorage `tb-cart-stash-v1` — sepetten (`tb-cart-v1`) ayrı
 * tutuluyor ki sayfa yenilenmesi durumunda da kayıp olmasın.
 */

interface CartStashState {
  items: CartItem[];
  set: (items: CartItem[]) => void;
  pop: () => CartItem[];
  clear: () => void;
  has: () => boolean;
}

export const useCartStashStore = create<CartStashState>()(
  persist(
    (set, get) => ({
      items: [],
      set: (items) => set({ items }),
      pop: () => {
        const current = get().items;
        set({ items: [] });
        return current;
      },
      clear: () => set({ items: [] }),
      has: () => get().items.length > 0,
    }),
    {
      name: "tb-cart-stash-v1",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ items: state.items }),
    },
  ),
);

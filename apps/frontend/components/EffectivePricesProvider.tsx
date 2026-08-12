"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAuth } from "@/components/AuthProvider";
import { apiCustomer } from "@/lib/auth";
import { TENANT_SLUG } from "@/lib/api";

interface EffectivePricesResponse {
  customerStatus: "STANDARD" | "ADMIN_DISCOUNT";
  items: { slug: string; effectivePrice: string }[];
}

interface EffectivePricesContextValue {
  isAdminDiscount: boolean;
  registerSlug: (slug: string) => void;
  getEffectivePrice: (slug: string) => number | null;
  /** Snapshot of all known slug→effectivePrice pairs. */
  pricesBySlug: Readonly<Record<string, number>>;
}

const EffectivePricesContext = createContext<EffectivePricesContextValue | null>(
  null,
);

const FETCH_DEBOUNCE_MS = 30;

export function EffectivePricesProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { customer } = useAuth();
  const isAdminDiscount = customer?.customerStatus === "ADMIN_DISCOUNT";
  // Maliyet/Kâr İndirimi kapsamı: STANDARD müşteride bile en az bir tedarikçide
  // adminDiscount VEYA Kâr İndirimi (profitDiscountPercent>0) varsa, ya da global
  // Kâr İndirimi varsa, backend o slug'lara özel fiyat döner → akışı çalıştır.
  const adminSupplierKey = (customer?.supplierDiscounts ?? [])
    .filter((d) => d.adminDiscount)
    .map((d) => d.supplierId)
    .sort()
    .join(",");
  const profitSupplierKey = (customer?.supplierDiscounts ?? [])
    .filter((d) => (d.profitDiscountPercent ?? 0) > 0)
    .map((d) => d.supplierId)
    .sort()
    .join(",");
  const globalProfit = (customer?.profitDiscountPercent ?? 0) > 0;
  const hasAdminPricing =
    isAdminDiscount ||
    globalProfit ||
    adminSupplierKey.length > 0 ||
    profitSupplierKey.length > 0;

  const [prices, setPrices] = useState<Record<string, number>>({});
  const pendingRef = useRef<Set<string>>(new Set());
  const seenRef = useRef<Set<string>>(new Set());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Sınırlı retry sayacı — geçici ağ hatasında özel fiyat KALICI kaybolmasın
  // (aksi halde profit/admin müşteride vitrin/sepet liste fiyatını gösterir).
  const retryRef = useRef<number>(0);
  // flush'a kendi içinden güvenli referans (yeniden zamanlama için).
  const flushRef = useRef<() => void>(() => {});

  // Reset cache when the customer (status or admin-supplier set) changes so a
  // logout/login or admin-side toggle does not leak stale admin prices.
  useEffect(() => {
    pendingRef.current.clear();
    seenRef.current.clear();
    retryRef.current = 0;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setPrices({});
  }, [
    customer?.id,
    customer?.customerStatus,
    customer?.profitDiscountPercent,
    adminSupplierKey,
    profitSupplierKey,
  ]);

  const flush = useCallback(async () => {
    timerRef.current = null;
    if (!hasAdminPricing) {
      pendingRef.current.clear();
      return;
    }
    const slugs = Array.from(pendingRef.current);
    pendingRef.current.clear();
    if (slugs.length === 0) return;

    try {
      const data = await apiCustomer<EffectivePricesResponse>(
        "/me/pricing/effective",
        {
          general: true,
          method: "POST",
          body: JSON.stringify({ tenantSlug: TENANT_SLUG, slugs }),
        },
      );
      retryRef.current = 0;
      if (!data?.items?.length) return;
      setPrices((prev) => {
        const next = { ...prev };
        for (const item of data.items) {
          const n = Number(item.effectivePrice);
          if (Number.isFinite(n) && n > 0) {
            next[item.slug] = n;
          }
        }
        return next;
      });
    } catch (err) {
      // Geçici hata: slug'ları yeniden kuyruğa al, sınırlı backoff ile tekrar
      // dene. Kalıcı sessiz yutma YAPILMAZ — gösterilen=tahsil edilen korunsun.
      if (process.env.NODE_ENV !== "production") {
        // eslint-disable-next-line no-console
        console.error("effective-price fetch failed", err);
      }
      for (const s of slugs) pendingRef.current.add(s);
      if (retryRef.current < 4) {
        retryRef.current += 1;
        const delay = Math.min(4000, 250 * 2 ** (retryRef.current - 1));
        if (!timerRef.current) {
          timerRef.current = setTimeout(() => flushRef.current(), delay);
        }
      }
    }
  }, [hasAdminPricing]);

  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  const registerSlug = useCallback(
    (slug: string) => {
      if (!hasAdminPricing) return;
      if (!slug) return;
      if (seenRef.current.has(slug)) return;
      seenRef.current.add(slug);
      pendingRef.current.add(slug);
      if (timerRef.current) return;
      timerRef.current = setTimeout(flush, FETCH_DEBOUNCE_MS);
    },
    [hasAdminPricing, flush],
  );

  const getEffectivePrice = useCallback(
    (slug: string): number | null => {
      if (!hasAdminPricing) return null;
      const v = prices[slug];
      return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
    },
    [hasAdminPricing, prices],
  );

  const value = useMemo<EffectivePricesContextValue>(
    () => ({
      isAdminDiscount,
      registerSlug,
      getEffectivePrice,
      // Global admin TÜM slug'larda, tedarikçi-bazlı admin yalnız ilgili
      // slug'larda dolu gelir (backend karar verir) → slug-bazında uygulanır.
      pricesBySlug: hasAdminPricing ? prices : {},
    }),
    [isAdminDiscount, hasAdminPricing, registerSlug, getEffectivePrice, prices],
  );

  return (
    <EffectivePricesContext.Provider value={value}>
      {children}
    </EffectivePricesContext.Provider>
  );
}

export function useEffectivePrices(): EffectivePricesContextValue {
  const ctx = useContext(EffectivePricesContext);
  if (!ctx) {
    // Provider yoksa no-op döndür — ProductPrice STANDARD davranışına düşer.
    return {
      isAdminDiscount: false,
      registerSlug: () => {},
      getEffectivePrice: () => null,
      pricesBySlug: {},
    };
  }
  return ctx;
}

/**
 * Bir ürün slug'ı için effective price (varsa). ADMIN_DISCOUNT olmayan
 * müşterilerde her zaman `null` döner — ProductPrice/cart bunun üzerine
 * normal indirim akışını uygular.
 */
export function useEffectivePrice(slug: string | null | undefined): number | null {
  const { registerSlug, getEffectivePrice } = useEffectivePrices();

  // registerSlug/getEffectivePrice provider içinde "admin kapsamı var mı"
  // (global VEYA tedarikçi-bazlı) kontrolüne tabi; kapsam yoksa no-op.
  useEffect(() => {
    if (!slug) return;
    registerSlug(slug);
  }, [slug, registerSlug]);

  if (!slug) return null;
  return getEffectivePrice(slug);
}

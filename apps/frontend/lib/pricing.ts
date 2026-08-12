import { useEffect, useState } from "react";
import { API_BASE } from "./api";

export interface PublicPricing {
  packagingUnitFee: number;
  kdvRate: number;
}

const FALLBACK: PublicPricing = { packagingUnitFee: 4.8, kdvRate: 20 };

interface RawPricingResponse {
  success?: boolean;
  data?: {
    packagingUnitFee?: string | number;
    kdvRate?: number;
  };
}

function parsePricing(raw: unknown): PublicPricing {
  if (!raw || typeof raw !== "object") return FALLBACK;
  const env = raw as RawPricingResponse;
  const d = env.data ?? {};
  const fee =
    typeof d.packagingUnitFee === "number"
      ? d.packagingUnitFee
      : typeof d.packagingUnitFee === "string"
        ? Number(d.packagingUnitFee)
        : NaN;
  const kdv = typeof d.kdvRate === "number" ? d.kdvRate : NaN;
  return {
    packagingUnitFee: Number.isFinite(fee) ? fee : FALLBACK.packagingUnitFee,
    kdvRate: Number.isFinite(kdv) ? kdv : FALLBACK.kdvRate,
  };
}

export async function fetchPublicPricing(): Promise<PublicPricing> {
  try {
    const res = await fetch(`${API_BASE}/public/pricing`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return FALLBACK;
    const json = (await res.json()) as unknown;
    return parsePricing(json);
  } catch {
    return FALLBACK;
  }
}

export function usePublicPricing(): PublicPricing {
  const [pricing, setPricing] = useState<PublicPricing>(FALLBACK);
  useEffect(() => {
    let cancelled = false;
    fetchPublicPricing().then((p) => {
      if (!cancelled) setPricing(p);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return pricing;
}

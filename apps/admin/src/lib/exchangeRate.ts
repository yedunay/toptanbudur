import { apiFetch, ApiError } from "./auth";

export interface ExchangeRateInfo {
  /** Anlık TCMB kuru — örn. 38.45 */
  rate: number;
  /** Margin (TL cinsinden) — örn. 0.30 */
  margin: number;
  /** rate + margin (kullanıcıya gösterilen efektif kur) */
  effective: number;
  /** TCMB tarafından yayınlanma zamanı (varsa) */
  fetchedAt?: string | null;
  /** Sembol — "USD" / "EUR" */
  currency: string;
}

interface BackendExchangeRate {
  rate?: number | string;
  margin?: number | string;
  effective?: number | string;
  fetchedAt?: string | null;
  currency?: string;
}

function toNum(v: number | string | undefined | null): number {
  if (v === null || v === undefined) return NaN;
  if (typeof v === "number") return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * TCMB anlık kurunu çeker. Backend `/api/admin/exchange-rate/usd?margin=0.30`
 * endpoint'i hazır olmadığı sürece null döner — UI bu durumu fallback ile
 * karşılar.
 */
export async function fetchExchangeRate(
  currency: "usd" | "eur" | "gbp" = "usd",
  margin = 0.3,
): Promise<ExchangeRateInfo | null> {
  try {
    const params = new URLSearchParams();
    if (Number.isFinite(margin)) params.set("margin", String(margin));
    const qs = params.toString();
    const raw = await apiFetch<BackendExchangeRate | { data: BackendExchangeRate }>(
      `/admin/exchange-rate/${currency}${qs ? `?${qs}` : ""}`,
    );
    const body: BackendExchangeRate =
      raw && typeof raw === "object" && "data" in raw && raw.data
        ? (raw.data as BackendExchangeRate)
        : (raw as BackendExchangeRate);
    const rate = toNum(body.rate);
    if (!Number.isFinite(rate) || rate <= 0) return null;
    const m = Number.isFinite(toNum(body.margin)) ? toNum(body.margin) : margin;
    const effective = Number.isFinite(toNum(body.effective))
      ? toNum(body.effective)
      : rate + (Number.isFinite(m) ? m : 0);
    return {
      rate,
      margin: Number.isFinite(m) ? m : margin,
      effective,
      fetchedAt: body.fetchedAt ?? null,
      currency: (body.currency ?? currency).toUpperCase(),
    };
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 501)) {
      return null;
    }
    return null;
  }
}

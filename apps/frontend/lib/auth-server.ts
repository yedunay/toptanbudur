import "server-only";

import { cookies } from "next/headers";

const SESSION_COOKIE_NAME = "tb_session";
const API_BASE =
  process.env.TB_API_BASE ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:4000";

export interface ServerCustomer {
  id: string;
  email: string;
  name: string;
  phone?: string | null;
  discountPercent?: number | null;
  supplierDiscounts?: { supplierId: string; discountPercent: number }[];
  xmlToken?: string | null;
  customerStatus?: "STANDARD" | "ADMIN_DISCOUNT";
}

interface MeResponse {
  customer: ServerCustomer;
}

export async function getServerCustomer(): Promise<ServerCustomer | null> {
  const store = await cookies();
  const session = store.get(SESSION_COOKIE_NAME);
  if (!session?.value) return null;

  try {
    const res = await fetch(`${API_BASE}/api/customer/auth/me`, {
      method: "GET",
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${session.value}`,
        accept: "application/json",
      },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as MeResponse;
    return data?.customer ?? null;
  } catch {
    return null;
  }
}

/**
 * Katalog isteklerinde dedup'suz (tüm aynı-isimli varyant) listeyi yalnızca
 * `ADMIN_DISCOUNT` müşteriye açmak için kullanılan oturum cookie değerini
 * döndürür. Sırayla: cookie yoksa (anonim) hiç ağ çağrısı yapmadan `null`;
 * cookie varsa `getServerCustomer()` ile durum doğrulanır ve yalnızca
 * `ADMIN_DISCOUNT` ise cookie değeri döner. Diğer tüm durumlarda `null` →
 * katalog public, cache'li davranışını aynen korur.
 */
export async function getAdminDiscountSessionCookie(): Promise<string | null> {
  const store = await cookies();
  const value = store.get(SESSION_COOKIE_NAME)?.value;
  if (!value) return null;
  const customer = await getServerCustomer();
  if (customer?.customerStatus !== "ADMIN_DISCOUNT") return null;
  return value;
}

"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";

const API_ROOT =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const AUTH_BASE = `${API_ROOT}/api/customer/auth`;
const API_BASE = `${API_ROOT}/api`;

export interface Customer {
  id: string;
  email: string;
  name: string;
  phone?: string | null;
  /** LEGACY off-list (liste fiyatından) iskonto — fallback. */
  discountPercent?: number | null;
  /** "Kâr İndirimi" (kardan) — global oran. >0 iken legacy off-list yok sayılır. */
  profitDiscountPercent?: number | null;
  supplierDiscounts?: {
    supplierId: string;
    discountPercent: number;
    /** "Kâr İndirimi" (kardan) — bu tedarikçide. >0 iken legacy/global önceliklenir. */
    profitDiscountPercent?: number;
    /** true ise bu tedarikçide Admin İndirimi (maliyet + paketleme) uygulanır. */
    adminDiscount?: boolean;
  }[];
  xmlToken?: string | null;
  profileCompleted?: boolean;
  customerStatus?: "STANDARD" | "ADMIN_DISCOUNT";
}

export interface AuthResponse {
  accessToken: string;
  customer: Customer;
}

export interface ApiErrorBody {
  message?: string;
  /**
   * Backend `BadRequestException({ message, code })` formatında bir hata
   * kodu döner (örn. `PDF_UPLOAD_NOT_PDF`). Çağıran taraf bunu kullanıp
   * kullanıcıya daha açıklayıcı mesaj gösterebilir.
   */
  code?: string;
}

export class ApiError extends Error {
  status: number;
  /** Opsiyonel iş kuralı kodu — backend payload'undaki `code` alanı. */
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export interface ApiCustomerOptions extends RequestInit {
  /** If true, target is relative to /api (general). Otherwise relative to /api/customer/auth */
  general?: boolean;
}

export async function apiCustomer<T>(
  path: string,
  init: ApiCustomerOptions = {},
): Promise<T> {
  const { general, headers, ...rest } = init;
  const base = general ? API_BASE : AUTH_BASE;
  const body = rest.body;
  const isMultipart =
    typeof FormData !== "undefined" && body instanceof FormData;
  const isBlobBody = typeof Blob !== "undefined" && body instanceof Blob;
  const isUrlEncoded =
    typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams;
  const shouldForceJson =
    body !== undefined && !isMultipart && !isBlobBody && !isUrlEncoded;
  const finalHeaders: Record<string, string> = {
    Accept: "application/json",
    ...(shouldForceJson ? { "Content-Type": "application/json" } : {}),
    ...((headers as Record<string, string>) ?? {}),
  };

  const res = await fetch(`${base}${path}`, {
    ...rest,
    credentials: rest.credentials ?? "include",
    headers: finalHeaders,
  });

  if (!res.ok) {
    let message = `İstek başarısız (${res.status})`;
    let code: string | undefined;
    try {
      const body = (await res.json()) as ApiErrorBody | null;
      if (body && typeof body.message === "string" && body.message.trim()) {
        message = body.message;
      }
      if (body && typeof body.code === "string" && body.code.trim()) {
        code = body.code;
      }
    } catch {
      /* ignore parse errors */
    }
    throw new ApiError(message, res.status, code);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return (await res.json()) as T;
}

interface UseCustomerState {
  customer: Customer | null;
  loading: boolean;
}

export function useCustomer(): UseCustomerState {
  const { customer } = useAuth();
  return { customer, loading: false };
}

/**
 * Protect a client page — redirects to /giris when there is no session.
 * The session source of truth is the HttpOnly `tb_session` cookie which is
 * read server-side; the AuthProvider seeds the in-memory customer from SSR.
 */
export function requireCustomer(): UseCustomerState {
  const router = useRouter();
  const { customer } = useAuth();

  useEffect(() => {
    if (customer) return;
    if (typeof window === "undefined") return;
    const next = `${window.location.pathname}${window.location.search}`;
    router.replace(`/giris?next=${encodeURIComponent(next)}`);
  }, [customer, router]);

  return { customer, loading: false };
}

import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

const TOKEN_KEY = "tb_admin_token";
const REFRESH_TOKEN_KEY = "tb_admin_refresh_token";
const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api";

// Multi-tab senkron: Bir sekme refresh yaptığında diğer sekmelerin de
// güncel access+refresh token'a sahip olması için BroadcastChannel
// kullanılır. Aksi halde her sekme bağımsız refresh çağrısı yapar ve
// backend'in reuse-detection mekanizması ikinci çağrıyı "replay" sayıp
// TÜM aktif refresh token'ları revoke eder → kullanıcı her yerden atılır.
type AuthBroadcast =
  | { type: "tokens-updated"; accessToken: string; refreshToken: string | null }
  | { type: "session-cleared" };

const authChannel: BroadcastChannel | null =
  typeof window !== "undefined" && "BroadcastChannel" in window
    ? new BroadcastChannel("tb-admin-auth")
    : null;

// Diğer sekmelerden gelen güncellemeleri yerel storage'a yansıt. `setToken`/
// `setRefreshToken`/`clearSession` çağırmıyoruz; o yardımcılar tekrar
// publish ederek echo loop'a sebep olurdu.
authChannel?.addEventListener("message", (event: MessageEvent<AuthBroadcast>) => {
  const data = event.data;
  if (!data || typeof window === "undefined") return;
  if (data.type === "tokens-updated") {
    window.localStorage.setItem(TOKEN_KEY, data.accessToken);
    if (data.refreshToken) {
      window.localStorage.setItem(REFRESH_TOKEN_KEY, data.refreshToken);
    }
  } else if (data.type === "session-cleared") {
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(REFRESH_TOKEN_KEY);
    window.sessionStorage.removeItem(TOKEN_KEY);
    window.sessionStorage.removeItem(REFRESH_TOKEN_KEY);
  }
});

function broadcastTokens(accessToken: string, refreshToken: string | null): void {
  authChannel?.postMessage({ type: "tokens-updated", accessToken, refreshToken });
}

function broadcastClear(): void {
  authChannel?.postMessage({ type: "session-cleared" });
}

// Tokens are persisted in `localStorage` (not `sessionStorage`) so the admin
// session survives a browser/tab restart. Combined with the 30-day rotating
// refresh token and the `admin_trusted_device` cookie (which skips OTP on a
// known device), this keeps the admin signed in for ~30 days on the same
// device without re-entering credentials. `clearSession()` on a failed
// refresh / 401 is still the single explicit logout path.
//
// One legacy migration: read from `sessionStorage` once if `localStorage`
// is empty, so an admin mid-session is not bounced to the login screen.
function readToken(key: string): string | null {
  if (typeof window === "undefined") return null;
  const stored = window.localStorage.getItem(key);
  if (stored) return stored;
  const legacy = window.sessionStorage.getItem(key);
  if (legacy) {
    window.localStorage.setItem(key, legacy);
    window.sessionStorage.removeItem(key);
  }
  return legacy;
}

export function getToken(): string | null {
  return readToken(TOKEN_KEY);
}

export function setToken(token: string): void {
  window.localStorage.setItem(TOKEN_KEY, token);
}

export function getRefreshToken(): string | null {
  return readToken(REFRESH_TOKEN_KEY);
}

export function setRefreshToken(token: string): void {
  window.localStorage.setItem(REFRESH_TOKEN_KEY, token);
}

/**
 * Login akışından dönen token çiftini yazıp diğer sekmelere yayınlar.
 * `setToken` + `setRefreshToken` ikilisi yerine bunu kullanın; aksi halde
 * diğer sekmeler bir sonraki API çağrısında stale token'la 401 alır.
 */
export function applyTokensFromLogin(
  accessToken: string,
  refreshToken: string | null,
): void {
  setToken(accessToken);
  if (refreshToken) setRefreshToken(refreshToken);
  broadcastTokens(accessToken, refreshToken);
}

export function clearSession(): void {
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(REFRESH_TOKEN_KEY);
  window.sessionStorage.removeItem(TOKEN_KEY);
  window.sessionStorage.removeItem(REFRESH_TOKEN_KEY);
  broadcastClear();
}

/** @deprecated Use clearSession() to also clear the refresh token */
export function clearToken(): void {
  clearSession();
}

/**
 * Explicit sign-out. Revokes the refresh token's `jti` on the server (so the
 * 30-day token can't be replayed) and then clears local storage. The network
 * call is best-effort — a failure (offline, server down) still clears the
 * local session so the user is never stuck "logged in".
 */
export async function logout(): Promise<void> {
  const refreshToken = getRefreshToken();
  if (refreshToken) {
    try {
      await fetch(`${API_BASE}/auth/logout`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${refreshToken}`,
          Accept: "application/json",
        },
        credentials: "include",
      });
    } catch {
      // best-effort — local clear below still runs
    }
  }
  clearSession();
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * Şifresiz / OTP'siz tam giriş — sadece HttpOnly `admin_trusted_device`
 * cookie'sine güvenir. AdminShell mount'unda VE LoginPage mount'unda
 * çağrılır; cookie yoksa/expire ise sessizce `false` döner ve normal akış
 * devam eder.
 *
 * Çok sekme yarışı: birden fazla sekme aynı anda mount olursa hepsi
 * auto-login çağırır; backend her birine ayrı access+refresh çifti üretir
 * (trusted device cookie'si rotate olmaz). Bu reuse-detection'ı
 * tetiklemediği için güvenlidir.
 */
let autoLoginPromise: Promise<boolean> | null = null;

export function tryAutoLogin(): Promise<boolean> {
  if (!autoLoginPromise) {
    autoLoginPromise = doAutoLogin().finally(() => {
      autoLoginPromise = null;
    });
  }
  return autoLoginPromise;
}

async function doAutoLogin(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  try {
    const response = await fetch(`${API_BASE}/auth/auto-login`, {
      method: "POST",
      headers: { Accept: "application/json" },
      credentials: "include",
    });
    if (!response.ok) return false;
    const data = (await response.json()) as {
      accessToken?: string;
      refreshToken?: string;
    };
    if (!data.accessToken) return false;
    applyTokensFromLogin(data.accessToken, data.refreshToken ?? null);
    return true;
  } catch {
    return false;
  }
}

// Refresh tokens rotate on every use: a successful `/auth/refresh` revokes the
// old jti server-side. If several requests 401 at once (e.g. on app boot, when
// the 15-min access token has expired but the 30-day refresh token is still
// valid), firing parallel refreshes would replay the now-revoked token and the
// backend would treat it as reuse — revoking *every* session. So refresh is
// single-flight: concurrent callers share one in-flight promise.
let refreshPromise: Promise<boolean> | null = null;

function tryRefresh(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = doRefresh().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

async function doRefresh(): Promise<boolean> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;

  try {
    const response = await fetch(`${API_BASE}/auth/refresh`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${refreshToken}`,
        Accept: "application/json",
      },
      credentials: "include",
    });
    if (!response.ok) return false;
    const data = (await response.json()) as { accessToken?: string; refreshToken?: string };
    if (!data.accessToken) return false;
    setToken(data.accessToken);
    if (data.refreshToken) setRefreshToken(data.refreshToken);
    broadcastTokens(data.accessToken, data.refreshToken ?? null);
    return true;
  } catch {
    return false;
  }
}

function redirectToLogin(): void {
  if (typeof window !== "undefined" && !window.location.pathname.endsWith("/login")) {
    window.location.assign("/admin/login");
  }
}

// 401 üzerine refresh denenmemesi gereken endpoint'ler. Bunlar credential
// alışverişine ait olduğundan (login/refresh/verify-otp), 401 = "yanlış kimlik"
// anlamına gelir ve burada refresh'i tekrar denemenin manası yoktur. Daha
// önce `/auth/` ile başlayan TÜM yollar skip ediliyordu; bu yüzden `/auth/me`
// gibi normal korumalı endpoint'lerde access-token expire olduğunda kullanıcı
// anında logout'a düşüyordu.
const NO_REFRESH_RETRY_PATHS = new Set<string>([
  "/auth/login",
  "/auth/refresh",
  "/auth/verify-otp",
  "/auth/register",
  "/auth/logout",
]);

function shouldSkipRefreshRetry(path: string): boolean {
  // Query string varsa kırp
  const clean = path.split("?")[0];
  return NO_REFRESH_RETRY_PATHS.has(clean);
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  return apiFetchInternal<T>(path, init, false);
}

async function apiFetchInternal<T>(
  path: string,
  init: RequestInit | undefined,
  retried: boolean,
): Promise<T> {
  const token = getToken();
  const headers = new Headers(init?.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  // FormData için Content-Type'ı tarayıcı (multipart/form-data; boundary=...)
  // kendisi belirler; elle set edersek boundary kaybolur ve backend parse edemez.
  const isFormData =
    typeof FormData !== "undefined" && init?.body instanceof FormData;
  if (init?.body && !headers.has("Content-Type") && !isFormData) {
    headers.set("Content-Type", "application/json");
  }
  headers.set("Accept", "application/json");

  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    credentials: "include",
  });

  if (!response.ok) {
    if (response.status === 401 && !shouldSkipRefreshRetry(path)) {
      // Try refresh first; if that fails, fall back to trusted-device
      // auto-login so a revoked/expired refresh token doesn't kick a known
      // device out. `retried` guards against an endless 401 loop.
      if (!retried) {
        const refreshed = await tryRefresh();
        if (refreshed) {
          return apiFetchInternal<T>(path, init, true);
        }
        const auto = await tryAutoLogin();
        if (auto) {
          return apiFetchInternal<T>(path, init, true);
        }
      }
      clearSession();
      redirectToLogin();
    } else if (response.status === 401) {
      clearSession();
      redirectToLogin();
    }

    let message = `HTTP ${response.status}`;
    try {
      const data = (await response.json()) as { message?: string };
      if (data?.message) message = data.message;
    } catch {
      // ignore parse errors
    }
    throw new ApiError(response.status, message);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export function useRequireAuth(): boolean {
  const navigate = useNavigate();
  const authed = !!getToken();
  useEffect(() => {
    if (!authed) {
      navigate("/login", { replace: true });
    }
  }, [authed, navigate]);
  return authed;
}

import { apiFetch } from "./auth";

// Ortak Finans API — "Hesabım" sayfasındaki anahtar yönetimi istemcisi.
// Yalnız bir finans ortağına bağlı admin kullanıcı veri görür.

export interface FinanceApiKeyMasked {
  id: string;
  prefix: string;
  masked: string;
  label: string | null;
  lastUsedAt: string | null;
  requestCount: number;
  createdAt: string;
}

export interface FinanceApiState {
  isPartner: boolean;
  partner: {
    id: string;
    name: string;
    initials: string | null;
    sharePercent: number;
  } | null;
  key: FinanceApiKeyMasked | null;
}

export async function fetchFinanceApiState(): Promise<FinanceApiState> {
  return apiFetch<FinanceApiState>("/admin/finance-api/state");
}

export async function generateFinanceApiKey(
  label?: string,
): Promise<{ token: string; key: FinanceApiKeyMasked }> {
  return apiFetch("/admin/finance-api/key", {
    method: "POST",
    body: JSON.stringify(label ? { label } : {}),
  });
}

export async function revealFinanceApiKey(): Promise<{
  token: string;
  key: FinanceApiKeyMasked;
}> {
  return apiFetch("/admin/finance-api/key/reveal");
}

export async function revokeFinanceApiKey(): Promise<{ revoked: number }> {
  return apiFetch("/admin/finance-api/key/revoke", { method: "POST" });
}

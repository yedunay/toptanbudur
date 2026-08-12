import { apiFetch } from "./auth";

/**
 * Admin Secrets API — vault-sealed entegrasyon anahtarları.
 *
 * Backend asla plaintext döndürmez; sadece maskelenmiş bir
 * önizleme (`abcd••••wxyz`) ile `configured` durumunu paylaşır.
 * Yeni değer yazılırken `apps/backend/src/secrets/secrets.service.ts`
 * AES-256-GCM ile mühürleyip DB'ye yazar, aynı zamanda
 * `apps/backend/.env` dosyasını da günceller.
 */

export interface SecretSummary {
  key: string;
  label: string;
  description: string | null;
  configured: boolean;
  masked: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
  envKey: string | null;
}

interface RawSecret {
  key?: string;
  label?: string | null;
  description?: string | null;
  configured?: boolean | null;
  masked?: string | null;
  updatedAt?: string | null;
  updatedBy?: string | null;
  envKey?: string | null;
}

interface RawListEnvelope {
  success?: boolean;
  data?: RawSecret[] | null;
}

interface RawSingleEnvelope {
  success?: boolean;
  data?: RawSecret | null;
}

function mapSecret(raw: RawSecret): SecretSummary {
  return {
    key: raw.key ?? "",
    label: raw.label ?? "",
    description: raw.description ?? null,
    configured: !!raw.configured,
    masked: raw.masked ?? null,
    updatedAt: raw.updatedAt ?? null,
    updatedBy: raw.updatedBy ?? null,
    envKey: raw.envKey ?? null,
  };
}

export async function listSecrets(): Promise<SecretSummary[]> {
  const raw = await apiFetch<unknown>("/admin/secrets");
  if (Array.isArray(raw)) {
    return (raw as RawSecret[]).map(mapSecret);
  }
  if (raw && typeof raw === "object" && "data" in (raw as object)) {
    const env = raw as RawListEnvelope;
    return Array.isArray(env.data) ? env.data.map(mapSecret) : [];
  }
  return [];
}

export async function getSecret(key: string): Promise<SecretSummary | null> {
  const raw = await apiFetch<unknown>(`/admin/secrets/${encodeURIComponent(key)}`);
  if (raw && typeof raw === "object" && "data" in (raw as object)) {
    const env = raw as RawSingleEnvelope;
    return env.data ? mapSecret(env.data) : null;
  }
  if (raw && typeof raw === "object") {
    return mapSecret(raw as RawSecret);
  }
  return null;
}

export async function updateSecret(key: string, value: string): Promise<SecretSummary> {
  const raw = await apiFetch<unknown>(`/admin/secrets/${encodeURIComponent(key)}`, {
    method: "PUT",
    body: JSON.stringify({ value }),
  });
  if (raw && typeof raw === "object" && "data" in (raw as object)) {
    const env = raw as RawSingleEnvelope;
    if (env.data) return mapSecret(env.data);
  }
  return mapSecret(raw as RawSecret);
}

export async function clearSecret(key: string): Promise<SecretSummary> {
  const raw = await apiFetch<unknown>(`/admin/secrets/${encodeURIComponent(key)}`, {
    method: "DELETE",
  });
  if (raw && typeof raw === "object" && "data" in (raw as object)) {
    const env = raw as RawSingleEnvelope;
    if (env.data) return mapSecret(env.data);
  }
  return mapSecret(raw as RawSecret);
}

import { apiFetch } from "./auth";

/**
 * Sipariş talebi "Hızlı Yanıtlar" (hazır cevaplar) veri katmanı.
 * Backend: /admin/support-quick-replies (AppSetting JSON deposu).
 */

export type QuickReplyIntent =
  | "cancel_approve"
  | "cancel_reject"
  | "refund_approve"
  | "refund_reject"
  | "received"
  | "general";

export interface QuickReply {
  id: string;
  title: string;
  body: string;
  intent: QuickReplyIntent | null;
  sortOrder: number;
  isActive: boolean;
}

export const QUICK_REPLY_INTENT_LABELS: Record<QuickReplyIntent, string> = {
  cancel_approve: "İptal Onayı",
  cancel_reject: "İptal Reddi",
  refund_approve: "İade Onayı",
  refund_reject: "İade Reddi",
  received: "Talep Alındı",
  general: "Genel",
};

export const QUICK_REPLY_INTENT_OPTIONS: ReadonlyArray<{
  value: QuickReplyIntent | "";
  label: string;
}> = [
  { value: "", label: "Genel / Etiketsiz" },
  { value: "received", label: "Talep Alındı" },
  { value: "cancel_approve", label: "İptal Onayı" },
  { value: "cancel_reject", label: "İptal Reddi" },
  { value: "refund_approve", label: "İade Onayı" },
  { value: "refund_reject", label: "İade Reddi" },
  { value: "general", label: "Genel" },
];

function unwrap<T>(raw: unknown): T {
  if (raw && typeof raw === "object" && "data" in raw) {
    return (raw as { data: T }).data;
  }
  return raw as T;
}

export async function fetchQuickReplies(): Promise<QuickReply[]> {
  const raw = await apiFetch<QuickReply[] | { data: QuickReply[] }>(
    "/admin/support-quick-replies",
  );
  const arr = unwrap<QuickReply[]>(raw);
  return Array.isArray(arr) ? arr : [];
}

export async function createQuickReply(input: {
  title: string;
  body: string;
  intent: QuickReplyIntent | null;
  isActive: boolean;
}): Promise<QuickReply> {
  const raw = await apiFetch<QuickReply | { data: QuickReply }>(
    "/admin/support-quick-replies",
    { method: "POST", body: JSON.stringify(input) },
  );
  return unwrap<QuickReply>(raw);
}

export async function updateQuickReply(
  id: string,
  patch: Partial<{
    title: string;
    body: string;
    intent: QuickReplyIntent | null;
    isActive: boolean;
    sortOrder: number;
  }>,
): Promise<QuickReply> {
  const raw = await apiFetch<QuickReply | { data: QuickReply }>(
    `/admin/support-quick-replies/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(patch) },
  );
  return unwrap<QuickReply>(raw);
}

export async function deleteQuickReply(id: string): Promise<void> {
  await apiFetch(`/admin/support-quick-replies/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

/**
 * Şablon yer tutucularını gerçek değerlerle doldurur. Gönderim ANINDA çağrılır.
 *   {siparisNo} → sipariş numarası
 *   {ad}        → müşteri adı
 */
export function fillQuickReply(
  body: string,
  vars: { orderNumber?: string | null; name?: string | null },
): string {
  const no = vars.orderNumber?.trim();
  const ad = vars.name?.trim();
  return body
    .replace(/\{siparisNo\}/g, no && no.length > 0 ? no : "ilgili")
    .replace(/\{ad\}/g, ad && ad.length > 0 ? ad : "müşterimiz");
}

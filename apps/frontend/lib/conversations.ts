"use client";

import { apiCustomer } from "@/lib/auth";

/**
 * Threaded chat (conversations) istemci API sarmalayıcısı. Tüm çağrılar mevcut
 * `apiCustomer` (cookie oturumu) üzerinden yapılır — yeni bir HTTP client
 * tanımlanmaz.
 */

export type ConversationSenderType = "DEALER" | "ADMIN" | "SYSTEM" | string;

export interface ConversationAttachment {
  url: string;
  filename?: string | null;
  mimetype?: string | null;
}

export interface ConversationMessage {
  id: string;
  senderType: ConversationSenderType;
  /** Karşı taraf adı backend tarafından "Y.E.D." gibi maskeli gelir. */
  senderLabel: string;
  body: string;
  attachments: ConversationAttachment[];
  createdAt: string;
  /** Bu mesajı mevcut bayi mi gönderdi. */
  mine: boolean;
}

export interface ConversationMeta {
  id: string;
  subject?: string | null;
  [key: string]: unknown;
}

export interface ConversationMessagesResponse {
  success: boolean;
  data: {
    conversation: ConversationMeta;
    messages: ConversationMessage[];
  };
}

export async function fetchConversationMessages(
  conversationId: string,
): Promise<ConversationMessagesResponse["data"]> {
  const res = await apiCustomer<ConversationMessagesResponse>(
    `/me/conversations/${encodeURIComponent(conversationId)}/messages`,
    { method: "GET", general: true },
  );
  return res.data;
}

export async function postConversationMessage(
  conversationId: string,
  fd: FormData,
): Promise<void> {
  await apiCustomer<unknown>(
    `/me/conversations/${encodeURIComponent(conversationId)}/messages`,
    { method: "POST", general: true, body: fd },
  );
}

export async function markConversationRead(
  conversationId: string,
): Promise<void> {
  try {
    await apiCustomer<unknown>(
      `/me/conversations/${encodeURIComponent(conversationId)}/read`,
      { method: "POST", general: true },
    );
  } catch {
    /* read işareti opsiyonel — hata akışı bozmaz */
  }
}

/** Göreli attachment URL'lerini API tabanına çözer (support-mapper ile aynı mantık). */
export function buildAttachmentSrc(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  const base = process.env.NEXT_PUBLIC_API_URL ?? "";
  if (!base) return url;
  return `${base.replace(/\/$/, "")}${url.startsWith("/") ? url : `/${url}`}`;
}

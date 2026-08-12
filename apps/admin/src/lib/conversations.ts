import { ApiError, apiFetch } from "./auth";

/**
 * Threaded chat (konuşmalar) admin veri katmanı.
 * Backend:
 *   GET  /admin/conversations?type=SUPPORT|DEALER_RETURN_ORDER
 *   GET  /admin/conversations/:id/messages
 *   POST /admin/conversations/:id/messages   (multipart: body + optional files)
 *   POST /admin/conversations/:id/read
 *
 * Admin tüm konuşmaları gerçek (full) isimlerle görür.
 */

export type ConversationType = "SUPPORT" | "DEALER_RETURN_ORDER";

/** Mesajı kimin gönderdiği — admin/satıcı/alıcı/sistem. Backend serbest
 *  string döndürebileceği için union'ı esnek tutuyoruz. */
export type MessageSenderType =
  | "ADMIN"
  | "DEALER"
  | "CUSTOMER"
  | "SELLER"
  | "BUYER"
  | "SYSTEM"
  | string;

export interface ConversationParticipant {
  id?: string;
  label?: string;
  name?: string;
  fullName?: string;
  role?: string;
}

export interface ConversationListItem {
  id: string;
  type: ConversationType;
  subject?: string | null;
  lastMessageAt: string | null;
  lastMessagePreview?: string | null;
  unread?: number | boolean;
  unreadCount?: number;
  participants?: ConversationParticipant[];
  /** Backend ilişkili kaynak id'leri (ticket) ekleyebilir. */
  supportMessageId?: string | null;
  /** Admin listForAdmin yanıtındaki flat alanlar. */
  orderId?: string | null;
  orderCode?: string | null;
  supportTicketId?: string | null;
  buyerName?: string | null;
  sellerName?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface MessageAttachment {
  url: string | null;
  id?: string;
  filename?: string;
  mimetype?: string;
  size?: number;
}

export interface ConversationMessage {
  id: string;
  senderType: MessageSenderType;
  senderLabel: string;
  body: string;
  attachments: MessageAttachment[];
  createdAt: string;
  /** Mesajın oturum açan admin'e ait olup olmadığı. */
  mine: boolean;
}

export interface AdminConversationContextCustomer {
  id: string | null;
  name: string;
  phone: string | null;
  email: string | null;
}

export interface AdminConversationContextOrder {
  id: string;
  code: string;
  status: string;
  supplierOrderNo: string | null;
  marketplace: string | null;
  cargoCompany: string | null;
  cargoBarcode: string | null;
  trackingNumber: string | null;
}

export interface AdminConversationContextProduct {
  id: string | null;
  name: string;
  slug: string | null;
  barcode: string | null;
  sku: string | null;
  supplierOrderNo: string | null;
}

export interface AdminConversationContextSupplier {
  id: string;
  name: string;
}

export interface AdminConversationContextShipping {
  marketplace: string | null;
  carrier: string | null;
  trackingCode: string | null;
}

export interface AdminConversationContext {
  subject: string | null;
  kind: string | null;
  category: string | null;
  ticketStatus: string | null;
  customer: AdminConversationContextCustomer | null;
  buyer: AdminConversationContextCustomer | null;
  seller: AdminConversationContextCustomer | null;
  order: AdminConversationContextOrder | null;
  product: AdminConversationContextProduct | null;
  supplier: AdminConversationContextSupplier | null;
  shipping: AdminConversationContextShipping | null;
}

export interface ConversationDetail {
  id: string;
  type?: ConversationType;
  subject?: string | null;
  participants?: ConversationParticipant[];
  lastMessageAt?: string | null;
  createdAt?: string;
  orderId?: string | null;
  supportTicketId?: string | null;
  context?: AdminConversationContext | null;
}

export interface ConversationThread {
  conversation: ConversationDetail;
  messages: ConversationMessage[];
}

interface ListEnvelope {
  success?: boolean;
  data: ConversationListItem[];
  meta?: {
    total?: number;
    page?: number;
    pageSize?: number;
    totalPages?: number;
  };
}

interface ThreadEnvelope {
  success?: boolean;
  data: {
    conversation: ConversationDetail;
    messages: ConversationMessage[];
  };
}

interface MessageEnvelope {
  success?: boolean;
  data: ConversationMessage;
}

/** Katılımcı listesini "Ad · Ad" şeklinde okunabilir etikete çevirir. */
export function participantsLabel(
  participants: ConversationParticipant[] | undefined,
): string {
  if (!participants || participants.length === 0) return "—";
  return participants
    .map((p) => p.label ?? p.fullName ?? p.name ?? p.role ?? "—")
    .filter(Boolean)
    .join(" · ");
}

export function conversationUnread(item: ConversationListItem): number {
  if (typeof item.unread === "number") return item.unread;
  if (typeof item.unread === "boolean") return item.unread ? 1 : 0;
  return item.unreadCount ?? 0;
}

export async function fetchConversations(
  type?: ConversationType,
): Promise<ConversationListItem[]> {
  const params = new URLSearchParams();
  if (type) params.set("type", type);
  const qs = params.toString();
  try {
    const raw = await apiFetch<ListEnvelope | ConversationListItem[]>(
      `/admin/conversations${qs ? `?${qs}` : ""}`,
    );
    if (Array.isArray(raw)) return raw;
    return raw.data ?? [];
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return [];
    throw err;
  }
}

export async function fetchConversationThread(
  conversationId: string,
): Promise<ConversationThread> {
  const raw = await apiFetch<ThreadEnvelope | ConversationThread>(
    `/admin/conversations/${encodeURIComponent(conversationId)}/messages`,
  );
  const data =
    raw && typeof raw === "object" && "data" in raw
      ? (raw as ThreadEnvelope).data
      : (raw as ConversationThread);
  return {
    conversation: data.conversation ?? { id: conversationId },
    messages: data.messages ?? [],
  };
}

export async function sendConversationMessage(
  conversationId: string,
  payload: { body: string; files?: File[] },
): Promise<ConversationMessage> {
  const form = new FormData();
  form.append("body", payload.body);
  for (const file of payload.files ?? []) {
    form.append("files", file);
  }
  const raw = await apiFetch<MessageEnvelope | ConversationMessage>(
    `/admin/conversations/${encodeURIComponent(conversationId)}/messages`,
    {
      method: "POST",
      body: form,
    },
  );
  return raw && typeof raw === "object" && "data" in raw
    ? (raw as MessageEnvelope).data
    : (raw as ConversationMessage);
}

export async function markConversationRead(
  conversationId: string,
): Promise<void> {
  await apiFetch<void>(
    `/admin/conversations/${encodeURIComponent(conversationId)}/read`,
    { method: "POST" },
  );
}

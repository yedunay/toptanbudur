import { apiFetch, getToken } from "./auth";

export type NotificationType =
  | "order.new"
  | "order.status"
  | "lead.new"
  | "stock.low"
  | "supplier.balance.low"
  | "support.message"
  | "system";

export type NotificationSeverity = "info" | "success" | "warning" | "error";

export interface AdminNotification {
  id: string;
  type: NotificationType;
  severity: NotificationSeverity;
  title: string;
  body: string;
  link: string | null;
  data: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
}

interface RawNotification {
  id?: string;
  type?: string;
  severity?: string;
  title?: string;
  body?: string;
  link?: string | null;
  data?: Record<string, unknown> | null;
  readAt?: string | null;
  createdAt?: string;
}

interface ListEnvelope {
  success?: boolean;
  data?: RawNotification[] | null;
  meta?: { unreadCount?: number } | null;
}

function mapNotification(raw: RawNotification): AdminNotification {
  return {
    id: raw.id ?? "",
    type: (raw.type as NotificationType) ?? "system",
    severity: (raw.severity as NotificationSeverity) ?? "info",
    title: raw.title ?? "",
    body: raw.body ?? "",
    link: raw.link ?? null,
    data: raw.data ?? null,
    readAt: raw.readAt ?? null,
    createdAt: raw.createdAt ?? new Date().toISOString(),
  };
}

export async function listNotifications(
  filter: "unread" | "all" = "all",
): Promise<{ items: AdminNotification[]; unreadCount: number }> {
  const raw = await apiFetch<unknown>(`/admin/notifications?filter=${filter}`);
  const env = raw as ListEnvelope;
  const items = Array.isArray(env?.data) ? env.data.map(mapNotification) : [];
  return { items, unreadCount: env?.meta?.unreadCount ?? 0 };
}

export async function markNotificationRead(id: string): Promise<void> {
  await apiFetch<unknown>(`/admin/notifications/${encodeURIComponent(id)}/read`, {
    method: "PATCH",
  });
}

export async function markAllNotificationsRead(): Promise<number> {
  const raw = await apiFetch<unknown>(`/admin/notifications/mark-all-read`, {
    method: "PATCH",
  });
  const env = raw as { data?: { count?: number } };
  return env?.data?.count ?? 0;
}

export async function getVapidPublicKey(): Promise<string | null> {
  const raw = await apiFetch<unknown>(`/admin/notifications/vapid-public-key`);
  const env = raw as { data?: { key?: string | null } };
  return env?.data?.key ?? null;
}

export async function subscribeBrowserPush(
  subscription: PushSubscription,
): Promise<void> {
  const json = subscription.toJSON();
  await apiFetch<unknown>(`/admin/notifications/push/subscribe`, {
    method: "POST",
    body: JSON.stringify({
      endpoint: subscription.endpoint,
      p256dh: json.keys?.p256dh ?? "",
      auth: json.keys?.auth ?? "",
      userAgent: navigator.userAgent,
    }),
  });
}

export async function unsubscribeBrowserPush(endpoint: string): Promise<void> {
  await apiFetch<unknown>(`/admin/notifications/push/subscribe`, {
    method: "DELETE",
    body: JSON.stringify({ endpoint }),
  });
}

/**
 * Opens an EventSource against /admin/notifications/stream. EventSource
 * cannot send custom headers, so we pass the JWT as a query parameter that
 * the backend's JwtStrategy reads for this specific route.
 */
export function openNotificationStream(handlers: {
  onMessage: (n: AdminNotification) => void;
  onError?: (e: Event) => void;
}): EventSource | null {
  const token = getToken();
  if (!token) return null;
  const base = (import.meta.env.VITE_API_URL ?? "/api").replace(/\/$/, "");
  const url = `${base}/admin/notifications/stream?access_token=${encodeURIComponent(token)}`;
  const es = new EventSource(url);
  es.addEventListener("notification", (e) => {
    try {
      const data = JSON.parse((e as MessageEvent).data) as RawNotification;
      handlers.onMessage(mapNotification(data));
    } catch {
      // ignore malformed
    }
  });
  if (handlers.onError) {
    es.addEventListener("error", handlers.onError);
  }
  return es;
}

/** Convert base64url VAPID public key to Uint8Array for PushManager.subscribe */
export function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

import { ApiError, apiFetch } from "./auth";

export type SupportMessageStatus = "NEW" | "READ" | "REPLIED" | "ARCHIVED";

export const SUPPORT_STATUS_LABELS: Record<SupportMessageStatus, string> = {
  NEW: "Yeni",
  READ: "Okundu",
  REPLIED: "Yanıtlandı",
  ARCHIVED: "Arşivlendi",
};

export const SUPPORT_STATUS_ORDER: ReadonlyArray<SupportMessageStatus> = [
  "NEW",
  "READ",
  "REPLIED",
  "ARCHIVED",
];

/**
 * Backend `attachUrls()` her ek için imzalı `url` döner; `storageKey` admin
 * tarafına ham geçer (müşteri uçlarında stripped). Galeride yalnızca
 * url + meta lazım.
 */
export interface SupportMessageAttachment {
  id: string;
  filename: string;
  mimetype: string;
  size: number;
  url: string | null;
  storageKey?: string;
  createdAt: string;
}

export interface SupportMessage {
  id: string;
  name: string;
  email: string;
  subject: string | null;
  body: string;
  status: SupportMessageStatus;
  adminNote: string | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  updatedAt: string;
  /** Threaded chat: backend artık her mesaja bağlı bir konuşma id'si döner. */
  conversationId?: string | null;
  /**
   * Anonim iletişim formu mesajları için null; giriş yapmış müşteri mesajlarında dolu.
   * Listede `kind=general` filtresi nedeniyle orderId her zaman null gelir.
   */
  customerId?: string | null;
  orderId?: string | null;
  attachments?: SupportMessageAttachment[];
}

export interface SupportListMeta {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface SupportListResponse {
  data: SupportMessage[];
  meta: SupportListMeta;
}

interface BackendListEnvelope {
  success?: boolean;
  data: SupportMessage[];
  meta?: SupportListMeta;
}

interface BackendItemEnvelope {
  success?: boolean;
  data: SupportMessage;
}

export interface SupportFilters {
  status?: SupportMessageStatus | "";
  page?: number;
  pageSize?: number;
}

export async function fetchSupportMessages(
  filters: SupportFilters = {},
): Promise<SupportListResponse> {
  const params = new URLSearchParams();
  // "Mesajlar & İstekler" sayfası sadece sipariş bağlı OLMAYAN mesajları
  // göstermeli — sipariş talepleri ayrı /siparis-talepleri sayfasında.
  params.set("kind", "general");
  if (filters.status) params.set("status", filters.status);
  if (filters.page) params.set("page", String(filters.page));
  if (filters.pageSize) params.set("pageSize", String(filters.pageSize));
  const qs = params.toString();
  try {
    const raw = await apiFetch<BackendListEnvelope | SupportMessage[]>(
      `/admin/support-messages${qs ? `?${qs}` : ""}`,
    );
    if (Array.isArray(raw)) {
      return {
        data: raw,
        meta: {
          total: raw.length,
          page: 1,
          pageSize: raw.length,
          totalPages: 1,
        },
      };
    }
    return {
      data: raw.data,
      meta: raw.meta ?? {
        total: raw.data.length,
        page: 1,
        pageSize: raw.data.length,
        totalPages: 1,
      },
    };
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      return {
        data: [],
        meta: { total: 0, page: 1, pageSize: 0, totalPages: 1 },
      };
    }
    throw err;
  }
}

export async function fetchNewSupportCount(): Promise<number> {
  try {
    const res = await fetchSupportMessages({ status: "NEW", pageSize: 1 });
    return res.meta.total;
  } catch {
    return 0;
  }
}

export async function updateSupportMessage(
  id: string,
  patch: { status?: SupportMessageStatus; adminNote?: string },
): Promise<SupportMessage> {
  const raw = await apiFetch<BackendItemEnvelope | SupportMessage>(
    `/admin/support-messages/${id}`,
    {
      method: "PATCH",
      body: JSON.stringify(patch),
    },
  );
  return "data" in (raw as object) && (raw as BackendItemEnvelope).data
    ? (raw as BackendItemEnvelope).data
    : (raw as SupportMessage);
}

export async function deleteSupportMessage(
  id: string,
  options: { hard?: boolean } = {},
): Promise<void> {
  const qs = options.hard ? "?hard=true" : "";
  await apiFetch<void>(`/admin/support-messages/${id}${qs}`, {
    method: "DELETE",
  });
}

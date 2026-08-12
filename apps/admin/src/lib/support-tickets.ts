import { ApiError, apiFetch } from "./auth";

/**
 * Sipariş bağlı destek talepleri ("Sipariş Talepleri") için admin veri katmanı.
 * Aynı /admin/support-messages endpoint'ini kullanır, fakat ?kind=order ile
 * sadece sipariş bağlı talepleri döndürür. Genel mesajlar (/mesajlar) sayfası
 * kind=general filtresiyle bu satırları gizler.
 */

export type SupportTicketStatus = "NEW" | "READ" | "REPLIED" | "ARCHIVED";

/** İADE (return) akışı durumu — yalnız category='iade' taleplerde dolu. */
export type ReturnFlowStatus =
  | "REQUESTED"
  | "APPROVED"
  | "SHIPPED_BACK"
  | "REJECTED"
  | "FINALIZED";

export const RETURN_FLOW_STATUS_LABELS: Record<ReturnFlowStatus, string> = {
  REQUESTED: "İade Talebi",
  APPROVED: "Adres İletildi",
  SHIPPED_BACK: "Müşteri Kargoladı",
  REJECTED: "Reddedildi",
  FINALIZED: "İade Edildi",
};

export const SUPPORT_TICKET_STATUS_LABELS: Record<SupportTicketStatus, string> =
  {
    NEW: "Beklemede",
    READ: "İncelemede",
    REPLIED: "Cevaplandı",
    ARCHIVED: "Kapalı",
  };

export const SUPPORT_TICKET_STATUS_ORDER: ReadonlyArray<SupportTicketStatus> = [
  "NEW",
  "READ",
  "REPLIED",
  "ARCHIVED",
];

/**
 * UI filter pills. "PENDING" birleşik bir tampon: hem NEW hem READ'i içerir.
 */
export type SupportTicketFilter = "PENDING" | "REPLIED" | "ARCHIVED" | "ALL";

export const SUPPORT_TICKET_FILTER_LABELS: Record<SupportTicketFilter, string> =
  {
    PENDING: "Bekleyen",
    REPLIED: "Cevaplandı",
    ARCHIVED: "Kapalı",
    ALL: "Tümü",
  };

export const SUPPORT_TICKET_FILTER_ORDER: ReadonlyArray<SupportTicketFilter> = [
  "PENDING",
  "REPLIED",
  "ARCHIVED",
  "ALL",
];

export interface SupportTicketAttachment {
  id: string;
  filename: string;
  mimetype: string;
  size: number;
  storageKey: string;
  url: string | null;
  createdAt: string;
}

export interface SupportTicket {
  id: string;
  name: string;
  email: string;
  subject: string | null;
  body: string;
  status: SupportTicketStatus;
  adminNote: string | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  updatedAt: string;
  customerId: string | null;
  customerPhone: string | null;
  orderId: string | null;
  orderNumber: string | null;
  /** Threaded chat: backend artık her talebe bağlı bir konuşma id'si döner. */
  conversationId: string | null;
  kind: string | null;
  category: string | null;
  marketplace: string | null;
  carrier: string | null;
  trackingCode: string | null;
  /** Bağlı siparişten türetilen tedarikçi + kargo künyesi (list endpoint). */
  supplierName: string | null;
  supplierOrderNo: string | null;
  cargoCompany: string | null;
  cargoBarcode: string | null;
  attachments?: SupportTicketAttachment[];
  /** İADE akışı (yalnız category='iade' taleplerde dolu). */
  returnStatus?: ReturnFlowStatus | null;
  /** Müşterinin yüklediği iade faturası (PDF) — taze imzalı URL. */
  returnInvoiceUrl?: string | null;
  returnInvoiceName?: string | null;
  /** Admin onayında iletilen iade adresi (kayıt). */
  returnAddress?: string | null;
  /** Müşterinin "Ürünü Kargoya Verdim" dediği an (SHIPPED_BACK). */
  returnShippedAt?: string | null;
}

export interface SupportTicketListMeta {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface SupportTicketListResponse {
  data: SupportTicket[];
  meta: SupportTicketListMeta;
}

interface BackendListEnvelope {
  success?: boolean;
  data: SupportTicket[];
  meta?: SupportTicketListMeta;
}

interface BackendItemEnvelope {
  success?: boolean;
  data: SupportTicket;
}

export interface SupportTicketListOptions {
  filter?: SupportTicketFilter;
  page?: number;
  pageSize?: number;
}

function statusForFilter(
  filter: SupportTicketFilter | undefined,
): SupportTicketStatus | undefined {
  switch (filter) {
    case "REPLIED":
      return "REPLIED";
    case "ARCHIVED":
      return "ARCHIVED";
    // PENDING ve ALL -> server-side status filtresi yok; client tarafı PENDING
    // için NEW+READ birleşimini ayrıca filtreler.
    default:
      return undefined;
  }
}

function emptyEnvelope(page: number, pageSize: number): SupportTicketListResponse {
  return {
    data: [],
    meta: { total: 0, page, pageSize, totalPages: 1 },
  };
}

/**
 * /admin/support-messages?kind=order parametresiyle sipariş bağlı talepleri
 * çeker. Filter, status query parametresine eşlenir.
 */
export async function fetchSupportTickets(
  options: SupportTicketListOptions = {},
): Promise<SupportTicketListResponse> {
  const filter = options.filter ?? "PENDING";
  const page = options.page ?? 1;
  const pageSize = options.pageSize ?? 50;

  // PENDING UI birleşimi backend'de iki status'ü kapsar (NEW + READ). Tek
  // request'te bunu yapamadığımız için iki ayrı çağrı yapıp birleştiriyoruz.
  if (filter === "PENDING") {
    const params1 = new URLSearchParams();
    params1.set("kind", "order");
    params1.set("status", "NEW");
    params1.set("page", String(page));
    params1.set("pageSize", String(pageSize));

    const params2 = new URLSearchParams();
    params2.set("kind", "order");
    params2.set("status", "READ");
    params2.set("page", String(page));
    params2.set("pageSize", String(pageSize));

    try {
      const [resNew, resRead] = await Promise.all([
        apiFetch<BackendListEnvelope>(`/admin/support-messages?${params1.toString()}`),
        apiFetch<BackendListEnvelope>(`/admin/support-messages?${params2.toString()}`),
      ]);
      const merged = [...(resNew.data ?? []), ...(resRead.data ?? [])];
      // Yeniden açılan talepler updatedAt'i taze olduğu için en üste gelsin.
      merged.sort((a, b) =>
        (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt),
      );
      const total =
        (resNew.meta?.total ?? resNew.data.length) +
        (resRead.meta?.total ?? resRead.data.length);
      return {
        data: merged,
        meta: {
          total,
          page,
          pageSize,
          totalPages: Math.max(1, Math.ceil(total / pageSize)),
        },
      };
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        return emptyEnvelope(page, pageSize);
      }
      throw err;
    }
  }

  const params = new URLSearchParams();
  params.set("kind", "order");
  const status = statusForFilter(filter);
  if (status) params.set("status", status);
  params.set("page", String(page));
  params.set("pageSize", String(pageSize));

  try {
    const raw = await apiFetch<BackendListEnvelope>(
      `/admin/support-messages?${params.toString()}`,
    );
    return {
      data: raw.data ?? [],
      meta:
        raw.meta ?? {
          total: raw.data?.length ?? 0,
          page,
          pageSize,
          totalPages: 1,
        },
    };
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      return emptyEnvelope(page, pageSize);
    }
    throw err;
  }
}

export async function fetchSupportTicket(id: string): Promise<SupportTicket> {
  const raw = await apiFetch<BackendItemEnvelope | SupportTicket>(
    `/admin/support-messages/${encodeURIComponent(id)}`,
  );
  if (raw && typeof raw === "object" && "data" in raw && (raw as BackendItemEnvelope).data) {
    return (raw as BackendItemEnvelope).data;
  }
  return raw as SupportTicket;
}

/**
 * Yanıt yaz: adminNote'u günceller ve status'ü REPLIED yapar.
 * Backend bu kombinasyonu yakaladığında müşteriye e-posta gönderir.
 */
export async function replyToSupportTicket(
  id: string,
  note: string,
): Promise<SupportTicket> {
  const raw = await apiFetch<BackendItemEnvelope | SupportTicket>(
    `/admin/support-messages/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ status: "REPLIED", adminNote: note }),
    },
  );
  if (raw && typeof raw === "object" && "data" in raw && (raw as BackendItemEnvelope).data) {
    return (raw as BackendItemEnvelope).data;
  }
  return raw as SupportTicket;
}

/**
 * İADE KARARI — approve (müşteriye iade adresi iletir; address zorunlu),
 * reject (aksiyon yok), finalize (sipariş 'İade Edildi' + cari iade). Backend
 * konuşma mesajını + statü/para işlemlerini yapar.
 */
export async function decideReturn(
  id: string,
  payload: {
    action: "approve" | "reject" | "finalize";
    address?: string;
    note?: string;
  },
): Promise<{ id: string; returnStatus: ReturnFlowStatus }> {
  const raw = await apiFetch<{
    success?: boolean;
    data: { id: string; returnStatus: ReturnFlowStatus };
  }>(`/admin/support-messages/${encodeURIComponent(id)}/return`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  return raw.data;
}

/**
 * Talebi kapatır (status -> ARCHIVED). Veriyi silmez; "Yeniden aç" ile
 * geri getirilebilir.
 */
export async function closeSupportTicket(id: string): Promise<SupportTicket> {
  const raw = await apiFetch<BackendItemEnvelope | SupportTicket>(
    `/admin/support-messages/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ status: "ARCHIVED" }),
    },
  );
  if (raw && typeof raw === "object" && "data" in raw && (raw as BackendItemEnvelope).data) {
    return (raw as BackendItemEnvelope).data;
  }
  return raw as SupportTicket;
}

/**
 * Kapatılmış talebi tekrar açar. Cevap varsa REPLIED'a, yoksa READ'e döner.
 */
export async function reopenSupportTicket(
  id: string,
  hadReply: boolean,
): Promise<SupportTicket> {
  const next: SupportTicketStatus = hadReply ? "REPLIED" : "READ";
  const raw = await apiFetch<BackendItemEnvelope | SupportTicket>(
    `/admin/support-messages/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ status: next }),
    },
  );
  if (raw && typeof raw === "object" && "data" in raw && (raw as BackendItemEnvelope).data) {
    return (raw as BackendItemEnvelope).data;
  }
  return raw as SupportTicket;
}

/**
 * NEW gelen bir talebi açtığımızda otomatik READ'e çek. Sessizce başarısız
 * olabilir — admin manuel cevap atınca yine REPLIED'a geçecektir.
 */
export async function markTicketAsRead(id: string): Promise<SupportTicket> {
  const raw = await apiFetch<BackendItemEnvelope | SupportTicket>(
    `/admin/support-messages/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ status: "READ" }),
    },
  );
  if (raw && typeof raw === "object" && "data" in raw && (raw as BackendItemEnvelope).data) {
    return (raw as BackendItemEnvelope).data;
  }
  return raw as SupportTicket;
}

/**
 * Bekleyen (NEW) sipariş taleplerinin sayısı — nav badge'i için.
 */
export async function fetchPendingTicketsCount(): Promise<number> {
  try {
    const params = new URLSearchParams();
    params.set("kind", "order");
    params.set("status", "NEW");
    params.set("pageSize", "1");
    const res = await apiFetch<BackendListEnvelope>(
      `/admin/support-messages?${params.toString()}`,
    );
    return res.meta?.total ?? res.data?.length ?? 0;
  } catch {
    return 0;
  }
}

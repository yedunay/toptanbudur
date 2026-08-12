import { ApiError, apiFetch } from "./auth";

export type FormStatus = "NEW" | "HANDLED" | "ARCHIVED";

export type DealerApplicationStatus =
  | "PENDING"
  | "PRE_REGISTERED"
  | "APPROVED"
  | "REJECTED";

export const FORM_STATUS_LABELS: Record<FormStatus, string> = {
  NEW: "Yeni",
  HANDLED: "İşlendi",
  ARCHIVED: "Arşivlendi",
};

export interface FormSubmission {
  id: string;
  type: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  subject?: string | null;
  message?: string | null;
  integrationSoftware?: string | null;
  package?: string | null;
  // Yapısal başvuru alanları — bayilik (APPLICATION) ve entegrasyon (INTEGRATION)
  // başvurularında dolu olabilir. Backend /admin/forms tüm Form kolonlarını döner.
  company?: string | null;
  vergiNo?: string | null;
  vergiDairesi?: string | null;
  // Reklam atıfı — Google Ads URL son eki + gclid; landing formları doldurur.
  // Organik başvurularda null. Backend /admin/forms select'siz döndüğü için
  // kolonlar otomatik gelir.
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmTerm?: string | null;
  utmContent?: string | null;
  gclid?: string | null;
  referrer?: string | null;
  landingPage?: string | null;
  notes?: string | null;
  status: FormStatus;
  handledAt?: string | null;
  createdAt: string;
  // Sadece type === "APPLICATION" formlarda dolu olur. İlişkili
  // DealerApplication'ın gerçek statüsü — Form.status (NEW/HANDLED/ARCHIVED)
  // onaylandı/reddedildi farkını gösteremediği için backend ayrıca bunu döner.
  dealerApplicationStatus?: DealerApplicationStatus | null;
}

export interface FormsResponse {
  data: FormSubmission[];
  meta?: {
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
}

function unwrap(
  raw:
    | FormsResponse
    | FormSubmission[]
    | { success: boolean; data: FormSubmission[]; meta?: FormsResponse["meta"] },
): FormsResponse {
  if (Array.isArray(raw)) {
    return { data: raw };
  }
  return { data: (raw as { data: FormSubmission[] }).data ?? [], meta: (raw as FormsResponse).meta };
}

export type FormTypeFilter = "APPLICATION" | "CONTACT" | "INTEGRATION" | "";

export async function fetchForms(
  status?: FormStatus | "",
  type?: FormTypeFilter,
): Promise<FormsResponse> {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (type) params.set("type", type);
  const qs = params.toString() ? `?${params.toString()}` : "";
  try {
    const raw = await apiFetch<
      | FormsResponse
      | FormSubmission[]
      | { success: boolean; data: FormSubmission[]; meta?: FormsResponse["meta"] }
    >(`/admin/forms${qs}`);
    return unwrap(raw);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      return { data: [] };
    }
    throw err;
  }
}

export async function fetchNewFormsCount(
  type: FormTypeFilter,
): Promise<number> {
  try {
    const res = await fetchForms("NEW", type);
    return res.meta?.total ?? res.data.length;
  } catch {
    return 0;
  }
}

export async function markFormHandled(id: string): Promise<FormSubmission> {
  return apiFetch<FormSubmission>(`/admin/forms/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "HANDLED" }),
  });
}

export async function updateForm(
  id: string,
  patch: { status?: FormStatus; notes?: string },
): Promise<FormSubmission> {
  const raw = await apiFetch<
    FormSubmission | { success?: boolean; data: FormSubmission }
  >(`/admin/forms/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  const maybeWrapped = raw as { data?: FormSubmission };
  if (maybeWrapped && typeof maybeWrapped === "object" && maybeWrapped.data) {
    return maybeWrapped.data;
  }
  return raw as FormSubmission;
}

export async function deleteForm(id: string): Promise<void> {
  await apiFetch<void>(`/admin/forms/${id}`, { method: "DELETE" });
}

export function whatsappLink(
  phone: string | null | undefined,
  name: string,
  type?: string | null,
): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (!digits) return null;
  const subject =
    type === "APPLICATION"
      ? "Bayilik başvurunuzu"
      : type === "INTEGRATION"
        ? "Entegrasyon başvurunuzu"
        : "İletişim formunuzu";
  const message =
    `Merhaba ${name}, Toptan Budur ekibinden ulaşıyorum. ${subject} aldık. ` +
    "Detayları konuşmak için size bilgi vermek istiyoruz; uygun olduğunuz bir zaman dilimi paylaşabilir misiniz?";
  const text = encodeURIComponent(message);
  return `https://wa.me/${digits}?text=${text}`;
}

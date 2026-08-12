import {
  fetchForms,
  updateForm,
  deleteForm,
  type DealerApplicationStatus,
  type FormStatus,
  type FormSubmission,
  type FormTypeFilter,
} from "./forms";
import {
  fetchSupportMessages,
  updateSupportMessage,
  deleteSupportMessage,
  type SupportMessage,
  type SupportMessageAttachment,
  type SupportMessageStatus,
} from "./supportMessages";
import { cleanNote, mergeNoteWithDealerApplicationIdLine } from "./notes";

/**
 * Unified status for the "Mesajlar & İstekler" page. Mapped to underlying
 * Form / SupportMessage enums by the source-specific helpers below.
 */
export type UnifiedStatus = "NEW" | "READ" | "REPLIED" | "RESOLVED" | "ARCHIVED";

export const UNIFIED_STATUS_LABELS: Record<UnifiedStatus, string> = {
  NEW: "Yeni",
  READ: "Okundu",
  REPLIED: "Yanıtlandı",
  RESOLVED: "Çözüldü",
  ARCHIVED: "Arşivlendi",
};

export const UNIFIED_STATUS_ORDER: ReadonlyArray<UnifiedStatus> = [
  "NEW",
  "READ",
  "REPLIED",
  "RESOLVED",
  "ARCHIVED",
];

export type MessageSource =
  | "CONTACT"
  | "APPLICATION"
  | "INTEGRATION"
  | "SUPPORT"
  | "CALLBACK";

export const SOURCE_LABELS: Record<MessageSource, string> = {
  CONTACT: "İletişim",
  APPLICATION: "Bayilik Başvurusu",
  INTEGRATION: "Entegrasyon Başvurusu",
  SUPPORT: "Destek Talebi",
  CALLBACK: "Geri Arama Talebi",
};

export const SOURCE_BADGE_CLASS: Record<MessageSource, string> = {
  CONTACT: "bg-sky-50 text-sky-700 border-sky-200",
  APPLICATION: "bg-violet-50 text-violet-700 border-violet-200",
  INTEGRATION: "bg-indigo-50 text-indigo-700 border-indigo-200",
  SUPPORT: "bg-amber-50 text-amber-800 border-amber-200",
  CALLBACK: "bg-emerald-50 text-emerald-700 border-emerald-200",
};

export interface UnifiedMessage {
  id: string;
  source: MessageSource;
  name: string;
  email: string | null;
  phone: string | null;
  subject: string | null;
  body: string;
  status: UnifiedStatus;
  adminNote: string | null;
  createdAt: string;
  /**
   * Yalnız SUPPORT için dolu — destek talebi açılırken müşteri görsel
   * (jpg/png/webp, en fazla 5) ekleyebiliyor. CONTACT/APPLICATION/CALLBACK
   * formlarında ek desteği yok, bu alan boş kalır.
   */
  attachments?: SupportMessageAttachment[];
  /**
   * Yalnız source === "APPLICATION" için dolu. İlişkili DealerApplication'ın
   * gerçek statüsü — başvuru işlem paneli (Onayla / sarı uyarı kutusu) bu
   * alana göre koşullu render edilir. APPROVED ise "Onayla" + sarı kutu
   * gizlenir, yalnız "Onayı Geri Al" / "Reddet" kalır.
   */
  dealerApplicationStatus?: DealerApplicationStatus | null;
  // Provenance / extra
  raw: FormSubmission | SupportMessage;
  meta?: {
    integrationSoftware?: string | null;
    package?: string | null;
    company?: string | null;
    vergiNo?: string | null;
    vergiDairesi?: string | null;
    ip?: string | null;
    userAgent?: string | null;
    // Reklam atıfı (Google Ads) — "bu başvuru hangi kelimeden geldi"
    utmSource?: string | null;
    utmMedium?: string | null;
    utmCampaign?: string | null;
    utmTerm?: string | null;
    utmContent?: string | null;
    gclid?: string | null;
    referrer?: string | null;
    landingPage?: string | null;
  };
}

/* ---------- mappers ---------- */

function mapFormStatusToUnified(s: FormStatus): UnifiedStatus {
  switch (s) {
    case "NEW":
      return "NEW";
    case "HANDLED":
      return "RESOLVED";
    case "ARCHIVED":
      return "ARCHIVED";
  }
}

function mapUnifiedToFormStatus(s: UnifiedStatus): FormStatus {
  switch (s) {
    case "NEW":
      return "NEW";
    case "READ":
    case "REPLIED":
    case "RESOLVED":
      return "HANDLED";
    case "ARCHIVED":
      return "ARCHIVED";
  }
}

function mapSupportStatusToUnified(s: SupportMessageStatus): UnifiedStatus {
  switch (s) {
    case "NEW":
      return "NEW";
    case "READ":
      return "READ";
    case "REPLIED":
      return "REPLIED";
    case "ARCHIVED":
      return "ARCHIVED";
  }
}

function mapUnifiedToSupportStatus(s: UnifiedStatus): SupportMessageStatus {
  switch (s) {
    case "NEW":
      return "NEW";
    case "READ":
      return "READ";
    case "REPLIED":
    case "RESOLVED":
      return "REPLIED";
    case "ARCHIVED":
      return "ARCHIVED";
  }
}

function fromForm(f: FormSubmission): UnifiedMessage {
  // Form.type → unified source eşlemesi. APPLICATION (bayilik) ve INTEGRATION
  // (entegrasyon başvurusu) ayrı sekmelerde listelenir; geri kalan tipler
  // (CONTACT, ve eski CALLBACK kayıtları) "İletişim" altında toplanır.
  const source: MessageSource =
    f.type === "APPLICATION"
      ? "APPLICATION"
      : f.type === "INTEGRATION"
        ? "INTEGRATION"
        : "CONTACT";
  // APPLICATION türünde Form.notes backend'in yazdığı teknik referans
  // satırını (`dealerApplicationId=...`) içerir — admin Notu textarea'sında
  // bu görünmemeli. cleanNote ile gizliyoruz; backend resolver için orijinal
  // `notes` değeri `raw` alanında korunuyor ve kaydetme sırasında merge edilir.
  const adminNote =
    source === "APPLICATION" ? (cleanNote(f.notes) || null) : (f.notes ?? null);
  return {
    id: f.id,
    source,
    name: f.name,
    email: f.email ?? null,
    phone: f.phone ?? null,
    subject: f.subject ?? null,
    body: f.message ?? f.notes ?? "",
    status: mapFormStatusToUnified(f.status),
    adminNote,
    createdAt: f.createdAt,
    dealerApplicationStatus: f.dealerApplicationStatus ?? null,
    raw: f,
    meta: {
      integrationSoftware: f.integrationSoftware ?? null,
      package: f.package ?? null,
      company: f.company ?? null,
      vergiNo: f.vergiNo ?? null,
      vergiDairesi: f.vergiDairesi ?? null,
      utmSource: f.utmSource ?? null,
      utmMedium: f.utmMedium ?? null,
      utmCampaign: f.utmCampaign ?? null,
      utmTerm: f.utmTerm ?? null,
      utmContent: f.utmContent ?? null,
      gclid: f.gclid ?? null,
      referrer: f.referrer ?? null,
      landingPage: f.landingPage ?? null,
    },
  };
}

function fromSupport(m: SupportMessage): UnifiedMessage {
  return {
    id: m.id,
    source: "SUPPORT",
    name: m.name,
    email: m.email,
    phone: null,
    subject: m.subject,
    body: m.body,
    status: mapSupportStatusToUnified(m.status),
    adminNote: m.adminNote,
    createdAt: m.createdAt,
    attachments: m.attachments ?? [],
    raw: m,
    meta: {
      ip: m.ip,
      userAgent: m.userAgent,
    },
  };
}

/* ---------- fetch (parallel + merge) ---------- */

export interface FetchAllOptions {
  source?: MessageSource | "ALL";
  status?: UnifiedStatus | "";
}

function shouldFetchForms(filter: MessageSource | "ALL" | undefined): boolean {
  if (!filter || filter === "ALL") return true;
  return (
    filter === "CONTACT" ||
    filter === "APPLICATION" ||
    filter === "INTEGRATION" ||
    filter === "CALLBACK"
  );
}

function shouldFetchSupport(filter: MessageSource | "ALL" | undefined): boolean {
  if (!filter || filter === "ALL") return true;
  return filter === "SUPPORT";
}

export async function fetchAllMessages(
  options: FetchAllOptions = {},
): Promise<UnifiedMessage[]> {
  const { source = "ALL", status } = options;

  const formTypeFilter: FormTypeFilter =
    source === "APPLICATION"
      ? "APPLICATION"
      : source === "INTEGRATION"
        ? "INTEGRATION"
        : source === "CONTACT" || source === "CALLBACK"
          ? "CONTACT"
          : "";

  const formStatus: FormStatus | "" = status ? mapUnifiedToFormStatus(status) : "";
  const supportStatus: SupportMessageStatus | undefined = status
    ? mapUnifiedToSupportStatus(status)
    : undefined;

  const empty: UnifiedMessage[] = [];

  const formsPromise: Promise<UnifiedMessage[]> = shouldFetchForms(source)
    ? fetchForms(formStatus, formTypeFilter)
        .then((res) => res.data.map(fromForm))
        .catch(() => empty)
    : Promise.resolve(empty);

  const supportPromise: Promise<UnifiedMessage[]> = shouldFetchSupport(source)
    ? fetchSupportMessages({ status: supportStatus, pageSize: 200 })
        .then((res) => res.data.map(fromSupport))
        .catch(() => empty)
    : Promise.resolve(empty);

  const [forms, support] = await Promise.all([formsPromise, supportPromise]);
  const merged = [...forms, ...support];
  merged.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return merged;
}

/* ---------- mutations ---------- */

export async function updateMessageStatus(
  msg: UnifiedMessage,
  status: UnifiedStatus,
  adminNote?: string,
): Promise<UnifiedMessage> {
  if (msg.source === "SUPPORT") {
    const next = mapUnifiedToSupportStatus(status);
    const updated = await updateSupportMessage(msg.id, {
      status: next,
      adminNote,
    });
    return fromSupport(updated);
  }
  const next = mapUnifiedToFormStatus(status);
  // APPLICATION türünde admin'in girdiği temiz notun yanına backend resolver'ının
  // ihtiyacı olan `dealerApplicationId=<id>` satırını geri ekliyoruz. Aksi halde
  // kaydetme bu teknik referansı silip Form ↔ DealerApplication bağını koparır.
  const notesToPersist =
    adminNote !== undefined && msg.source === "APPLICATION"
      ? mergeNoteWithDealerApplicationIdLine(
          adminNote,
          (msg.raw as FormSubmission).notes,
        )
      : adminNote;
  const updated = await updateForm(msg.id, {
    status: next,
    notes: notesToPersist,
  });
  return fromForm(updated);
}

export async function deleteMessage(msg: UnifiedMessage): Promise<void> {
  if (msg.source === "SUPPORT") {
    await deleteSupportMessage(msg.id, { hard: true });
  } else {
    await deleteForm(msg.id);
  }
}

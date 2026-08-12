import { ApiError, apiFetch } from "./auth";

export type DealerApplicationStatus = "pending" | "approved" | "rejected" | "pre_registered";

export const DEALER_STATUS_LABELS: Record<DealerApplicationStatus, string> = {
  pending: "Beklemede",
  approved: "Onaylı",
  rejected: "Reddedildi",
  pre_registered: "Ön Kayıtlı",
};

export interface DealerApplication {
  id: string;
  fullName: string;
  companyName?: string | null;
  email: string;
  phone?: string | null;
  status: DealerApplicationStatus;
  createdAt: string;
  notes?: string | null;
  /** Backend artık aşağıdaki alanları yapılandırılmış (structured) olarak döndürüyor. */
  company?: string | null;
  vergiNo?: string | null;
  vergiDairesi?: string | null;
  package?: string | null;
  hasIntegration?: string | null;
  integrationSoftware?: string | null;
  /** Artık SADECE serbest not. */
  message?: string | null;
}

export interface DealerApplicationsResponse {
  data: DealerApplication[];
  meta?: {
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
}

/**
 * Backend (dealer.service.ts → listApplications) ham DealerApplication/Form
 * kayıtlarını döndürüyor; alan adları FE'nin beklediğinden farklı:
 *   - `name`    → FE `fullName`
 *   - `company` → FE `companyName`
 *   - `status`  BÜYÜK harf (PENDING/APPROVED/REJECTED/PRE_REGISTERED) → FE küçük
 * Bu uyumsuzluk yüzünden DealerApplicationsPage'de `a.status === "pending"`
 * kontrolü hiç tutmuyordu ve aksiyon butonları (Onayla/Reddet/Ön Kayıt)
 * görünmüyordu (#27). Burada tek noktada normalize ediyoruz.
 */
interface RawDealerApplication {
  id: string;
  name?: string | null;
  fullName?: string | null;
  email: string;
  phone?: string | null;
  company?: string | null;
  companyName?: string | null;
  status?: string | null;
  createdAt: string;
  notes?: string | null;
  message?: string | null;
  vergiNo?: string | null;
  vergiDairesi?: string | null;
  package?: string | null;
  hasIntegration?: string | null;
  integrationSoftware?: string | null;
}

function normalizeDealerStatus(raw?: string | null): DealerApplicationStatus {
  switch ((raw ?? "").toUpperCase()) {
    case "APPROVED":
      return "approved";
    case "REJECTED":
      return "rejected";
    case "PRE_REGISTERED":
      return "pre_registered";
    case "PENDING":
    default:
      return "pending";
  }
}

function normalizeDealerApplication(raw: RawDealerApplication): DealerApplication {
  const fullName = (raw.fullName ?? raw.name ?? "").trim();
  const company = raw.company ?? raw.companyName ?? null;
  return {
    id: raw.id,
    fullName,
    companyName: company,
    company,
    email: raw.email,
    phone: raw.phone ?? null,
    status: normalizeDealerStatus(raw.status),
    createdAt: raw.createdAt,
    notes: raw.notes ?? null,
    vergiNo: raw.vergiNo ?? null,
    vergiDairesi: raw.vergiDairesi ?? null,
    package: raw.package ?? null,
    hasIntegration: raw.hasIntegration ?? null,
    integrationSoftware: raw.integrationSoftware ?? null,
    message: raw.message ?? null,
  };
}

export async function fetchDealerApplications(
  status?: DealerApplicationStatus,
): Promise<DealerApplicationsResponse> {
  const qs = status ? `?status=${status}` : "";
  const raw = await apiFetch<
    | { data: RawDealerApplication[]; meta?: DealerApplicationsResponse["meta"] }
    | RawDealerApplication[]
  >(`/admin/dealer-applications${qs}`);
  if (Array.isArray(raw)) {
    return { data: raw.map(normalizeDealerApplication) };
  }
  return {
    data: (raw.data ?? []).map(normalizeDealerApplication),
    meta: raw.meta,
  };
}

/**
 * Backend yanıt zarfı:
 *   { success: true, data: { alreadyApproved, application, customer, oneTimePassword? } }
 *
 * `oneTimePassword` SADECE ilk onay (alreadyApproved=false) cevabında döner.
 * Tekrar onay (idempotent path) bu alanı içermez. Admin UI bu değeri tek
 * seferlik gösterip (modal + Kopyala butonu) hiçbir yerde saklamamalıdır.
 */
export interface ApproveDealerApplicationResult {
  alreadyApproved: boolean;
  application: { id: string; status?: string };
  customer: {
    id: string;
    email: string;
    name: string;
    phone?: string | null;
  } | null;
  oneTimePassword?: string;
}

interface ApproveDealerApplicationEnvelope {
  success: boolean;
  data: ApproveDealerApplicationResult;
}

/**
 * Bayi telefonunu WhatsApp deep-link formatına çevirir (sadece rakam, 90 ön ekli).
 * Geçersizse null döner.
 */
export function toWhatsAppNumber(phone?: string | null): string | null {
  if (!phone) return null;
  let d = phone.replace(/\D/g, "");
  if (d.startsWith("90")) {
    // zaten ülke kodlu
  } else if (d.startsWith("0")) {
    d = "90" + d.slice(1);
  } else if (d.length === 10 && d.startsWith("5")) {
    d = "90" + d;
  }
  return d.length >= 12 ? d : null;
}

const WHATSAPP_COMMUNITY_URL = "https://toptanbudur.com/iletisim";
const CUSTOMER_LOGIN_URL = "https://toptanbudur.com/giris";

export interface WelcomeWhatsAppOpts {
  fullName?: string | null;
  /** Giriş e-postası — tempPassword ile birlikte verilirse giriş bilgileri bloğu eklenir. */
  email?: string | null;
  /**
   * Tek kullanımlık parola. SADECE onay anında mevcuttur (backend bir kez
   * döndürür, hiçbir yerde saklanmaz) — MesajlarPage draft prefill'i bu
   * alanı geçemez, blok otomatik atlanır.
   */
  tempPassword?: string | null;
}

/**
 * Onay sonrası bayiye gönderilecek kişiye özel WhatsApp hoş-geldin mesajı —
 * onay E-POSTASIYLA BİREBİR aynı içerik: giriş bilgileri (e-posta + geçici
 * parola), ilk girişte parola değişimi uyarısı, giriş linki, avantajlar ve
 * sonda iletişim bağlantısı.
 *
 * Cinsiyetten bağımsız hitap: "Hoşgeldiniz Sayın <tam ad>" — "Bey/Hanım" eki
 * KULLANILMAZ (kadın bayilere yanlış hitap üretiyordu).
 */
export function buildWelcomeWhatsAppMessage(opts?: WelcomeWhatsAppOpts): string {
  const name = (opts?.fullName ?? "").trim().replace(/\s+/g, " ");
  const greeting = name
    ? `Hoşgeldiniz Sayın ${name} 👋`
    : "Hoşgeldiniz Değerli Bayimiz 👋";
  const email = (opts?.email ?? "").trim();
  const tempPassword = (opts?.tempPassword ?? "").trim();
  const hasCredentials = email.length > 0 && tempPassword.length > 0;
  const intro = hasCredentials
    ? "Bayi başvurunuz onaylandı ve hesabınız aktif hale getirildi. 🎉 Aşağıdaki bilgilerle hemen giriş yapabilirsiniz:"
    : "Bayi başvurunuz onaylandı ve hesabınız aktif hale getirildi. 🎉";
  const credentialLines = hasCredentials
    ? [
        "",
        `📧 E-posta: ${email}`,
        `🔑 Geçici parola: ${tempPassword}`,
        "",
        "⚠️ Güvenliğiniz için ilk girişte parolanızı değiştirmeniz *zorunludur*.",
        "",
        `🔗 Giriş Yap: ${CUSTOMER_LOGIN_URL}`,
      ]
    : [];
  return [
    greeting,
    "",
    intro,
    ...credentialLines,
    "",
    "Artık bayi panelinden tüm kataloğa ve toptan fiyatlara erişebilirsiniz.",
    "",
    "Sizi bekleyen bazı avantajlar:",
    "",
    "✅ Geniş ürün kataloğuna erişim",
    "✅ XML desteği",
    "✅ Hızlı ve modern panel altyapısı",
    "✅ Toplu ve hızlı sipariş oluşturmayı kolaylaştıran satın alma araçları",
    "✅ XML yüklemeden de kullanım imkanı",
    "✅ Hızlı operasyon ve sürdürülebilir stok yönetimi",
    "",
    "Toptan Budur altyapısı sayesinde satış süreçlerinizi daha hızlı, daha pratik ve daha kârlı şekilde yönetebilirsiniz.",
    "",
    "Keyifli satışlar dileriz 🚀",
    "",
    "Sorularınız için bize yazabilirsiniz. Toptan Budur ailesine hoş geldiniz!",
    "",
    "💬 Bize buradan da ulaşabilirsiniz:",
    WHATSAPP_COMMUNITY_URL,
  ].join("\n");
}

/**
 * Tarayıcıda açık WhatsApp Web oturumunda ilgili numaraya, mesaj önceden
 * yazılmış şekilde sohbet açan URL. Telefon geçersizse null.
 */
export function buildWelcomeWhatsAppUrl(
  phone?: string | null,
  opts?: WelcomeWhatsAppOpts,
): string | null {
  const num = toWhatsAppNumber(phone);
  if (!num) return null;
  const text = encodeURIComponent(buildWelcomeWhatsAppMessage(opts));
  return `https://web.whatsapp.com/send?phone=${num}&text=${text}`;
}

export async function approveDealerApplication(
  id: string,
): Promise<ApproveDealerApplicationResult> {
  const response = await apiFetch<
    ApproveDealerApplicationEnvelope | ApproveDealerApplicationResult
  >(`/admin/dealer-applications/${id}/approve`, { method: "POST" });
  // Geriye dönük uyumluluk: zarfsız cevap gelirse direkt döndür.
  if (response && typeof response === "object" && "data" in response) {
    return (response as ApproveDealerApplicationEnvelope).data;
  }
  return response as ApproveDealerApplicationResult;
}

export async function rejectDealerApplication(
  id: string,
  reason?: string,
): Promise<DealerApplication> {
  return apiFetch<DealerApplication>(`/admin/dealer-applications/${id}/reject`, {
    method: "POST",
    body: JSON.stringify({ reason: reason ?? "" }),
  });
}

/**
 * Backend ekibi: yeni endpoint açılacak.
 *   POST /admin/dealer-applications/:id/undo  → status'u tekrar "pending" yapar.
 * Hazır olmadığında bu fonksiyon 404/501 fırlatır; çağıran taraf hata mesajını gösterir.
 */
export async function undoDealerApplication(id: string): Promise<DealerApplication> {
  return apiFetch<DealerApplication>(`/admin/dealer-applications/${id}/undo`, {
    method: "POST",
  });
}

export interface PreRegisterDealerApplicationResult {
  alreadyPreRegistered: boolean;
  application: { id: string; status?: string };
  customer: {
    id: string;
    email: string;
    name: string;
    phone?: string | null;
    isActive: boolean;
  } | null;
}

interface PreRegisterEnvelope {
  success: boolean;
  data: PreRegisterDealerApplicationResult;
}

export async function preRegisterDealerApplication(
  id: string,
): Promise<PreRegisterDealerApplicationResult> {
  const response = await apiFetch<PreRegisterEnvelope | PreRegisterDealerApplicationResult>(
    `/admin/dealer-applications/${id}/pre-register`,
    { method: "POST" },
  );
  if (response && typeof response === "object" && "data" in response) {
    return (response as PreRegisterEnvelope).data;
  }
  return response as PreRegisterDealerApplicationResult;
}

/** Hata 404/400/422 ise ID uyumsuzluğu olarak yorumla. */
export function isDealerApproveIdMismatch(err: unknown): boolean {
  return (
    err instanceof ApiError &&
    (err.status === 404 || err.status === 400 || err.status === 422)
  );
}

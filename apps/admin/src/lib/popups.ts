import { apiFetch } from "./auth";

/**
 * Pop-up / Duyuru yönetimi — admin API istemcisi.
 *
 * Backend: `apps/backend/src/admin/popups/*` (JSON CRUD + ayrı multipart görsel
 * endpoint'i). Envelope `{ success, data }` `unwrap` ile açılır. Görsel
 * yüklemede Content-Type'ı tarayıcı belirler — `apiFetch` FormData'yı otomatik
 * algılar, manuel header set ETME.
 */

// ---- Enum literal union'ları (Prisma enum'larıyla birebir) ----------------

export type PopupPosition =
  | "CENTER"
  | "TOP"
  | "BOTTOM"
  | "TOP_LEFT"
  | "TOP_RIGHT"
  | "BOTTOM_LEFT"
  | "BOTTOM_RIGHT";

export type PopupSize = "SMALL" | "MEDIUM" | "LARGE";

// ---- Görsel blok düzenleyici içerik modeli (backend popup-content.ts mirror) ----

export type PopupAlign = "left" | "center" | "right";
export type PopupTextSize = "sm" | "md" | "lg";
export type PopupSpacerSize = "sm" | "md" | "lg";
export type PopupCalloutVariant =
  | "success"
  | "warning"
  | "info"
  | "danger"
  | "custom";

export interface PopupBadgeBlock {
  type: "badge";
  id?: string;
  text: string;
  bg?: string | null;
  color?: string | null;
  align?: PopupAlign;
}
export interface PopupHeadingBlock {
  type: "heading";
  id?: string;
  text: string;
  level?: 1 | 2 | 3;
  align?: PopupAlign;
  color?: string | null;
}
export interface PopupTextBlock {
  type: "text";
  id?: string;
  text: string;
  align?: PopupAlign;
  color?: string | null;
  size?: PopupTextSize;
}
export interface PopupHeroBlock {
  type: "hero";
  id?: string;
  title: string;
  subtitle?: string | null;
  bg?: string | null;
  gradient?: [string, string] | null;
  color?: string | null;
  align?: PopupAlign;
}
export interface PopupCalloutBlock {
  type: "callout";
  id?: string;
  variant?: PopupCalloutVariant;
  title?: string | null;
  text: string;
  bg?: string | null;
  color?: string | null;
  borderColor?: string | null;
  align?: PopupAlign;
}
export interface PopupImageBlock {
  type: "image";
  id?: string;
  key?: string | null;
  url: string;
  alt?: string | null;
  width?: "full" | number;
  radius?: number;
  align?: PopupAlign;
  /** Admin-only geçici alanlar (kaydetmeden önce strip edilir). */
  _file?: File;
  _localUrl?: string;
}
export interface PopupVideoBlock {
  type: "video";
  id?: string;
  key?: string | null;
  url: string;
  autoplay?: boolean;
  muted?: boolean;
  loop?: boolean;
  controls?: boolean;
  width?: "full" | number;
  align?: PopupAlign;
  _file?: File;
  _localUrl?: string;
}
export interface PopupButtonBlock {
  type: "button";
  id?: string;
  label: string;
  href: string;
  bg?: string | null;
  color?: string | null;
  newTab?: boolean;
  align?: PopupAlign;
  fullWidth?: boolean;
}
export interface PopupDividerBlock {
  type: "divider";
  id?: string;
  color?: string | null;
}
export interface PopupSpacerBlock {
  type: "spacer";
  id?: string;
  size?: PopupSpacerSize;
}

export type PopupBlock =
  | PopupBadgeBlock
  | PopupHeadingBlock
  | PopupTextBlock
  | PopupHeroBlock
  | PopupCalloutBlock
  | PopupImageBlock
  | PopupVideoBlock
  | PopupButtonBlock
  | PopupDividerBlock
  | PopupSpacerBlock;

export type PopupBlockType = PopupBlock["type"];

export type PopupFrequency = "ONCE" | "EVERY_LOGIN" | "LIMITED";

export type PopupAudience = "ALL" | "SEGMENT" | "SPECIFIC";

/** Backend `statusOf()` ile aynı türetim. */
export type PopupStatus = "inactive" | "scheduled" | "active" | "expired";

// ---- TR etiketler ---------------------------------------------------------

export const POPUP_POSITION_LABELS: Record<PopupPosition, string> = {
  CENTER: "Orta (ekran ortası)",
  TOP: "Üst orta",
  BOTTOM: "Alt orta",
  TOP_LEFT: "Sol üst",
  TOP_RIGHT: "Sağ üst",
  BOTTOM_LEFT: "Sol alt",
  BOTTOM_RIGHT: "Sağ alt",
};

export const POPUP_SIZE_LABELS: Record<PopupSize, string> = {
  SMALL: "Küçük",
  MEDIUM: "Orta",
  LARGE: "Büyük",
};

export const POPUP_FREQUENCY_LABELS: Record<PopupFrequency, string> = {
  ONCE: "Bir kez göster (bir daha gösterme)",
  EVERY_LOGIN: "Her girişte göster",
  LIMITED: "Sınırlı sayıda göster",
};

export const POPUP_AUDIENCE_LABELS: Record<PopupAudience, string> = {
  ALL: "Tüm müşteriler",
  SEGMENT: "Sektör / segment numarası",
  SPECIFIC: "Seçili müşteriler",
};

export const POPUP_STATUS_LABELS: Record<PopupStatus, string> = {
  inactive: "Pasif",
  scheduled: "Zamanlanmış",
  active: "Yayında",
  expired: "Süresi doldu",
};

// ---- Tipler ---------------------------------------------------------------

export interface PopupStats {
  seen: number;
  clicks: number;
  dismissed: number;
}

export interface Popup {
  id: string;
  title: string | null;
  body: string | null;
  content: PopupBlock[] | null;
  mediaKeys: string[];
  widthPx: number | null;
  backgroundColor: string | null;
  imageUrl: string | null;
  imageKey: string | null;
  ctaLabel: string | null;
  ctaUrl: string | null;
  ctaNewTab: boolean;
  position: PopupPosition;
  size: PopupSize;
  frequency: PopupFrequency;
  showLimit: number;
  dismissible: boolean;
  audience: PopupAudience;
  segment: string | null;
  customerIds: string[];
  startsAt: string | null;
  endsAt: string | null;
  isActive: boolean;
  priority: number;
  themeColor: string | null;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
  status: PopupStatus;
  stats: PopupStats;
}

/** Oluşturma gövdesi (JSON). Medya ayrı endpoint ile yüklenir. */
export interface CreatePopupInput {
  title?: string | null;
  body?: string | null;
  /** Görsel blok düzenleyici içeriği. null/[] = legacy basit mod. */
  content?: PopupBlock[] | null;
  /** Özel genişlik (px, 280–1200). null = `size` ön ayarı. */
  widthPx?: number | null;
  /** Kart arka plan rengi (hex). null = beyaz. */
  backgroundColor?: string | null;
  ctaLabel?: string | null;
  ctaUrl?: string | null;
  ctaNewTab?: boolean;
  position?: PopupPosition;
  size?: PopupSize;
  frequency?: PopupFrequency;
  showLimit?: number;
  dismissible?: boolean;
  audience?: PopupAudience;
  segment?: string | null;
  customerIds?: string[];
  startsAt?: string | null;
  endsAt?: string | null;
  isActive?: boolean;
  priority?: number;
  themeColor?: string | null;
}

/** Güncelleme gövdesi — tüm alanlar opsiyonel (partial update). */
export type UpdatePopupInput = Partial<CreatePopupInput>;

// ---- Envelope yardımcısı --------------------------------------------------

/** Backend `{ success, data, meta }` zarfını esnekçe açar. */
function unwrap<T>(raw: unknown): T {
  if (raw && typeof raw === "object" && "data" in (raw as object)) {
    return (raw as { data: T }).data;
  }
  return raw as T;
}

// ---- CRUD -----------------------------------------------------------------

export async function fetchPopups(): Promise<Popup[]> {
  const raw = await apiFetch<unknown>("/admin/popups");
  const data = unwrap<Popup[]>(raw);
  return Array.isArray(data) ? data : [];
}

export async function fetchPopup(id: string): Promise<Popup> {
  const raw = await apiFetch<unknown>(`/admin/popups/${id}`);
  return unwrap<Popup>(raw);
}

export async function createPopup(input: CreatePopupInput): Promise<Popup> {
  const raw = await apiFetch<unknown>("/admin/popups", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return unwrap<Popup>(raw);
}

export async function updatePopup(
  id: string,
  input: UpdatePopupInput,
): Promise<Popup> {
  const raw = await apiFetch<unknown>(`/admin/popups/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
  return unwrap<Popup>(raw);
}

export async function deletePopup(id: string): Promise<void> {
  await apiFetch<unknown>(`/admin/popups/${id}`, { method: "DELETE" });
}

// ---- Görsel ---------------------------------------------------------------

/** En fazla 2 MB; backend de aynı sınırı uygular. */
export const MAX_POPUP_IMAGE_BYTES = 2 * 1024 * 1024;

export async function uploadPopupImage(
  id: string,
  file: File,
): Promise<Popup> {
  const form = new FormData();
  form.append("image", file);
  // Content-Type'ı set ETME — apiFetch FormData'yı algılar, tarayıcı boundary'yi koyar.
  const raw = await apiFetch<unknown>(`/admin/popups/${id}/image`, {
    method: "POST",
    body: form,
  });
  return unwrap<Popup>(raw);
}

export async function deletePopupImage(id: string): Promise<Popup> {
  const raw = await apiFetch<unknown>(`/admin/popups/${id}/image`, {
    method: "DELETE",
  });
  return unwrap<Popup>(raw);
}

// ---- Blok medyası (görsel + video) ----------------------------------------

/** Blok görseli üst sınırı (8 MB) — backend de aynı sınırı uygular. */
export const MAX_POPUP_BLOCK_IMAGE_BYTES = 8 * 1024 * 1024;
/** Blok videosu üst sınırı (30 MB) — backend de aynı sınırı uygular. */
export const MAX_POPUP_VIDEO_BYTES = 30 * 1024 * 1024;

export interface UploadedMedia {
  key: string;
  url: string;
  kind: "image" | "video";
}

/**
 * Bir bloğa görsel/video yükler. Pop-up önce kaydedilmiş olmalı (id gerekli);
 * dönen { key, url } bloğa yerleştirilir. Anahtar `mediaKeys`'e eklenir;
 * kullanılmazsa sonraki kaydetmede / süre bitiminde otomatik temizlenir.
 */
export async function uploadPopupMedia(
  id: string,
  file: File,
): Promise<UploadedMedia> {
  const form = new FormData();
  form.append("file", file);
  const raw = await apiFetch<unknown>(`/admin/popups/${id}/media`, {
    method: "POST",
    body: form,
  });
  return unwrap<UploadedMedia>(raw);
}

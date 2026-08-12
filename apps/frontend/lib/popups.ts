import { apiCustomer } from "@/lib/auth";

/**
 * Müşteri tarafı pop-up istemcisi. Backend `/api/me/popups` uçlarını sarmalar:
 * aktif pop-up'ları çeker ve görüldü / kapatıldı / tıklandı sinyallerini
 * sunucuya iletir. Sıklık (frequency) kısıtı tamamen sunucuda PopupImpression
 * tablosu üzerinden uygulanır — localStorage YASAK (CLAUDE.md kuralı).
 *
 * Dönen DTO yalnızca müşteriye gösterilecek alanları içerir; tenantId, segment,
 * customerIds ve dahili sayaçlar backend `toClient` tarafından zaten sızdırılmaz.
 */

export type PopupPosition =
  | "CENTER"
  | "TOP"
  | "BOTTOM"
  | "TOP_LEFT"
  | "TOP_RIGHT"
  | "BOTTOM_LEFT"
  | "BOTTOM_RIGHT";

export type PopupSize = "SMALL" | "MEDIUM" | "LARGE";

// ---- Görsel blok düzenleyici içerik modeli --------------------------------
// (apps/backend/src/admin/popups/popup-content.ts ile birebir mirror — sözleşme
// orada kanonik; burada yalnız okuma/render için tip kopyası tutulur.)

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

export interface ClientPopup {
  id: string;
  title: string | null;
  body: string | null;
  /** Dolu ise blok modu: bloklar render edilir, legacy alanlar yok sayılır. */
  content: PopupBlock[] | null;
  imageUrl: string | null;
  ctaLabel: string | null;
  ctaUrl: string | null;
  ctaNewTab: boolean;
  position: PopupPosition;
  size: PopupSize;
  /** Özel genişlik (px). Null = `size` ön ayarı. */
  widthPx: number | null;
  /** Kart arka plan rengi (hex). Null = beyaz. */
  backgroundColor: string | null;
  dismissible: boolean;
  themeColor: string | null;
  priority: number;
}

interface ActivePopupsResponse {
  success: boolean;
  data: ClientPopup[];
}

/** Bu müşteriye şu an gösterilmesi gereken pop-up'lar (öncelik sırasına göre). */
export async function fetchActivePopups(): Promise<ClientPopup[]> {
  const res = await apiCustomer<ActivePopupsResponse>("/me/popups", {
    general: true,
  });
  return Array.isArray(res?.data) ? res.data : [];
}

function track(id: string, action: "seen" | "dismiss" | "click"): Promise<void> {
  const safe = encodeURIComponent(id);
  return apiCustomer<void>(`/me/popups/${safe}/${action}`, {
    general: true,
    method: "POST",
  });
}

/** Pop-up ekrana çıktı: görüntülenme sayacını artırır. */
export function markPopupSeen(id: string): Promise<void> {
  return track(id, "seen");
}

/** Pop-up kapatıldı: sıklık kuralına göre tekrar gösterilmemesi için işaretler. */
export function markPopupDismissed(id: string): Promise<void> {
  return track(id, "dismiss");
}

/** CTA tıklandı: dönüşüm metriği için işaretler. */
export function markPopupClicked(id: string): Promise<void> {
  return track(id, "click");
}

import { z } from 'zod';

/**
 * Basit Kargo API tipleri. Response'lar dokümandaki örneklere göre gevşek
 * (passthrough) parse edilir — upstream ek alan eklerse kırılmaz; handler /
 * shipmentCode hem top-level hem `shipmentInfo` altından okunabilir.
 */

const handlerSchema = z
  .object({
    name: z.string().nullish(),
    code: z.string().nullish(),
  })
  .partial()
  .passthrough();

const shipmentInfoSchema = z
  .object({
    handler: handlerSchema.nullish(),
    handlerShipmentCode: z.string().nullish(),
    lastState: z.string().nullish(),
  })
  .partial()
  .passthrough();

/** POST /v2/order/barcode ve GET /v2/order/{id} yanıtı (ortak, gevşek). */
export const bkOrderSchema = z
  .object({
    id: z.string(),
    barcode: z.string().nullish(),
    type: z.string().nullish(),
    status: z.string().nullish(),
    validationFailed: z.boolean().nullish(),
    // content.code = bizim humanOrderNo — reconcile (çift-POST önleme) için okunur.
    // foreignCode = BK bazı akışlarda gönderdiğimiz code'u üst-seviye bu alana
    // yansıtabilir → reconcile ikisini de dener.
    content: z
      .object({ code: z.string().nullish() })
      .passthrough()
      .nullish(),
    foreignCode: z.string().nullish(),
    handler: handlerSchema.nullish(),
    handlerShipmentCode: z.string().nullish(),
    shipmentInfo: shipmentInfoSchema.nullish(),
  })
  .passthrough();
export type BkOrder = z.infer<typeof bkOrderSchema>;

/** Durum Değişikliği webhook payload'u. */
export const bkWebhookSchema = z
  .object({
    id: z.string().nullish(),
    barcode: z.string().nullish(),
    status: z.string().nullish(),
    handler: handlerSchema.nullish(),
    handlerShipmentCode: z.string().nullish(),
    shipmentInfo: shipmentInfoSchema.nullish(),
  })
  .passthrough();
export type BkWebhookPayload = z.infer<typeof bkWebhookSchema>;

/** Sipariş oluşturma isteği gövdesi (content + client). */
export interface BkCreateOrderRequest {
  handlerCode: string;
  type: 'OUTGOING' | 'INCOMING';
  content: {
    name: string;
    code: string;
    items: Array<{ name: string; code: string; quantity: string }>;
    packages: Array<{
      height: number;
      width: number;
      depth: number;
      weight: number;
    }>;
  };
  client: {
    name: string;
    phone: string;
    city: string;
    town: string;
    address: string;
  };
}

/** Normalize edilmiş konum kaydı (frontend açılır menüsü için). */
export interface BkLocation {
  id?: string;
  name: string;
}

/**
 * handler kodunu (firma) hem top-level hem shipmentInfo altından çıkarır.
 * Dönen değer UPPERCASE (ARAS/YURTICI/MNG/...) ya da null.
 */
export function extractHandlerCode(order: BkOrder | BkWebhookPayload): string | null {
  const code =
    order.handler?.code ?? order.shipmentInfo?.handler?.code ?? null;
  return code ? code.trim().toUpperCase() : null;
}

/** Kargo firmasının kendi takip numarası (handlerShipmentCode). */
export function extractShipmentCode(
  order: BkOrder | BkWebhookPayload,
): string | null {
  const code =
    order.handlerShipmentCode ??
    order.shipmentInfo?.handlerShipmentCode ??
    null;
  return code ? code.trim() : null;
}

/** ECONOMIC/FAST somut firma değildir → null; SELF_ öneki temizlenir. */
export function concreteHandlerFromCode(code: string | null): string | null {
  if (!code) return null;
  const up = code.trim().toUpperCase();
  if (up === 'ECONOMIC' || up === 'FAST' || up === '') return null;
  return up.replace(/^SELF_/, '');
}

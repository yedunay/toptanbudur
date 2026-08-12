// Müşteri (bayi) tarafında gösterilen sipariş akışı — TEK KAYNAK.
//
// KESKİN KURAL: Müşteri panelinde tedarikçi / otomasyon / maliyet detayı ASLA
// görünmez. Müşteri yalnızca sade, animasyonlu bir akış görür:
//
//     Sipariş Alındı → Hazırlanıyor → Kargoya Verildi        (+ İptal / İade)
//
// "Kargoya Verildi" adımı, siparişin GERÇEK (tedarikçi/otomasyon) kargo anından
// BAĞIMSIZDIR: sipariş verildikten CUSTOMER_SHIP_DISPLAY_HOURS saat sonra
// gösterilir (doğal hazırlık penceresi — anında/aynı-gün "kargoya verildi" görüp
// arkada bir bot olduğunu sezmesin). Gerçek order.status / shippedAt / e-fatura
// akışına DOKUNULMAZ; bu yalnızca müşteriye gösterilen GÖRÜNÜMdür.

export const CUSTOMER_SHIP_DISPLAY_HOURS = 96;

export type CustomerOrderStage =
  | "received" // Sipariş Alındı
  | "preparing" // Hazırlanıyor
  | "shipped" // Kargoya Verildi
  | "cancelled" // İptal Edildi
  | "refunded"; // İade Edildi

export interface CustomerOrderView {
  stage: CustomerOrderStage;
  /** Sipariş oluşturulma anı (parse edilebildiyse). */
  createdAt: Date | null;
  /** Müşteriye gösterilecek "Kargoya Verildi" tarihi (createdAt + N saat). */
  shipDisplayAt: Date | null;
}

const CANCELLED = new Set(["cancelled", "canceled", "iptal"]);
const REFUNDED = new Set(["refunded", "returned", "iade"]);
// Gerçekte kargoya verilmiş/ötesi (terminal). Müşteri modelinde "shipped"
// terminal teslimat statüsüdür — sonrası ayrı adım göstermez.
const SHIP_LIKE = new Set([
  "shipped",
  "delivered",
  "completed",
  "in_transit",
  "on_the_way",
  "out_for_delivery",
]);
const PREPARING_LIKE = new Set(["preparing", "processing"]);

/**
 * Ham order.status + createdAt'ten müşteriye gösterilecek sade aşamayı türetir.
 * Badge ve zaman çizelgesi (TrackingTimeline) BU tek kaynağı kullanır ki ikisi
 * ASLA çelişmesin (ör. badge "kargoya verildi" derken çizelge "hazırlanıyor").
 */
export function deriveCustomerOrderView(
  status: string,
  createdAt: string | Date | null | undefined,
  now: Date = new Date(),
): CustomerOrderView {
  const s = (status ?? "").toString().trim().toLowerCase();

  const parsed =
    createdAt == null
      ? null
      : createdAt instanceof Date
        ? createdAt
        : new Date(createdAt);
  const created =
    parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
  const shipDisplayAt = created
    ? new Date(created.getTime() + CUSTOMER_SHIP_DISPLAY_HOURS * 3600 * 1000)
    : null;

  const base = { createdAt: created, shipDisplayAt };

  if (CANCELLED.has(s)) return { stage: "cancelled", ...base };
  if (REFUNDED.has(s)) return { stage: "refunded", ...base };

  // Gerçekte kargolanmış olsa bile "Kargoya Verildi" ancak 96 saat DOLDUYSA
  // gösterilir; dolmadıysa müşteri "Hazırlanıyor"da tutulur.
  const passedWindow =
    shipDisplayAt != null && now.getTime() >= shipDisplayAt.getTime();

  if (SHIP_LIKE.has(s)) {
    return { stage: passedWindow ? "shipped" : "preparing", ...base };
  }
  if (PREPARING_LIKE.has(s)) {
    return { stage: "preparing", ...base };
  }
  // paid / created / pending / bilinmeyen → "Sipariş Alındı".
  return { stage: "received", ...base };
}

export const CUSTOMER_STAGE_LABEL: Record<CustomerOrderStage, string> = {
  received: "Sipariş Alındı",
  preparing: "Hazırlanıyor",
  shipped: "Kargoya Verildi",
  cancelled: "İptal Edildi",
  refunded: "İade Edildi",
};

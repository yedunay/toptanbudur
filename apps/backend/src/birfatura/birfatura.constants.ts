/**
 * BirFatura kontrat sözlüğü.
 *
 * — Status sözlüğü `/api/orderStatus/` endpoint'inden BirFatura'ya
 *   dönülür. BirFatura paneli admin'e bu listeden hangi statüde fatura
 *   kesileceğini seçtirir. Bizim internal statülerimizi farklı ID olarak
 *   sunuyoruz; admin "Ödendi"yi (id=2) seçerse `mapBirfaturaIdToInternalStatuses`
 *   ile o ID'den sonraki tüm "paid akışı" statülerini de çekeriz (bir kez paid
 *   olduktan sonra preparing/shipped da fatura kesilebilir).
 *
 * — Payment sözlüğü `/api/paymentMethods/` endpoint'inden döner.
 */

export type InternalOrderStatus =
  | 'paid'
  | 'preparing'
  | 'shipped'
  | 'cancelled'
  | 'refunded';

// `pending` ve `processing`/`delivered` OrderStatus'ları sistemden kaldırıldı;
// siparişler artık paid → preparing → shipped akışını izler. Shipped terminal
// teslimat statüsüdür (biz tedarikçiyiz, kargoya teslim sonrası akışla
// ilgilenmiyoruz).
export const ORDER_STATUS_DICTIONARY: ReadonlyArray<{
  Id: number;
  Value: string;
  internal: InternalOrderStatus;
}> = [
  { Id: 2, Value: 'Ödendi', internal: 'paid' },
  { Id: 3, Value: 'Hazırlanıyor', internal: 'preparing' },
  { Id: 5, Value: 'Kargolandı', internal: 'shipped' },
  { Id: 7, Value: 'İptal Edildi', internal: 'cancelled' },
  { Id: 8, Value: 'İade Edildi', internal: 'refunded' },
];

/**
 * Admin BirFatura panelinde "Ödendi"yi seçtiğinde, bizim sistemimizdeki
 * paid + sonraki tüm ileri statüleri faturalanabilir olarak işaretleriz.
 * Yani fatura kesilmesi için status='paid' olması yeterlidir; ama paid
 * olduktan sonra hazırlanıyor/shipped'a geçmiş olabilir, hepsi geçerlidir.
 */
export function mapBirfaturaIdToInternalStatuses(
  id: number,
): InternalOrderStatus[] {
  switch (id) {
    case 1:
      // Legacy "Onay Bekliyor" ID'si: pending kaldırıldı, eşleştirme yok.
      return [];
    case 2:
      return ['paid', 'preparing', 'shipped'];
    case 3:
      return ['preparing', 'shipped'];
    case 4:
      // Legacy "İşleniyor" ID'si: processing kaldırıldı, eşleştirme yok.
      return [];
    case 5:
      return ['shipped'];
    case 6:
      // Legacy "Teslim Edildi" ID'si: delivered kaldırıldı, eşleştirme yok.
      return [];
    case 7:
      return ['cancelled'];
    case 8:
      return ['refunded'];
    default:
      return [];
  }
}

/** Bizim status'ımızdan BirFatura'nın canonical ID'sine eşleme (cargoUpdate için). */
export function mapInternalStatusToBirfaturaId(
  status: InternalOrderStatus,
): number {
  const found = ORDER_STATUS_DICTIONARY.find((s) => s.internal === status);
  return found?.Id ?? 2;
}

export function mapBirfaturaIdToFirstInternalStatus(
  id: number,
): InternalOrderStatus | null {
  const internal = mapBirfaturaIdToInternalStatuses(id);
  return internal[0] ?? null;
}

export const PAYMENT_METHOD_DICTIONARY: ReadonlyArray<{
  Id: number;
  Value: string;
}> = [
  { Id: 1, Value: 'Kredi Kartı' },
  { Id: 2, Value: 'Cari Bakiye' },
];

/**
 * Order.paymentType:
 *   'card'         → 1 (Kredi Kartı)
 *   'cari'         → 2 (Cari Bakiye)
 *   'cari_balance' → 2 (Cari Bakiye) — orders.service.ts bu değeri yazıyor
 */
export function mapPaymentTypeToBirfaturaId(
  paymentType: string | null | undefined,
): number {
  if (paymentType === 'cari' || paymentType === 'cari_balance') return 2;
  return 1; // default 'card'
}

export function mapPaymentTypeToBirfaturaLabel(
  paymentType: string | null | undefined,
): string {
  return mapPaymentTypeToBirfaturaId(paymentType) === 2
    ? 'Cari Bakiye'
    : 'Kredi Kartı';
}

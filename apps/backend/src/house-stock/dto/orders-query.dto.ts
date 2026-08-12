import { z } from 'zod';

/**
 * Depo sipariş sub-tab sorgu enum'u (3 sekme).
 *
 * - `urunlerim`    → bu sekme bu endpoint'ten gelmez (Items endpoint'i kullanılır)
 * - `bekleyen`     → reservedQty>0 AND houseStockDispatchedAt IS NULL AND order.status NOT IN (cancelled, refunded)
 * - `kargoVerilecek` → houseStockDispatchedAt NOT NULL AND order.status='preparing'
 * - `kargoVerildi` → houseStockDispatchedAt NOT NULL AND order.status='shipped' (NİHAİ aşama)
 *
 * "Tamamlandı" sekmesi kaldırıldı — "Kargoya Verildi" son aşamadır.
 */
export const houseStockOrdersTabSchema = z.enum([
  'bekleyen',
  'kargoVerilecek',
  'kargoVerildi',
]);

export type HouseStockOrdersTab = z.infer<typeof houseStockOrdersTabSchema>;

export const houseStockOrdersQuerySchema = z.object({
  ownerId: z.string().min(1, 'ownerId zorunlu'),
  tab: houseStockOrdersTabSchema,
});

export type HouseStockOrdersQuery = z.infer<typeof houseStockOrdersQuerySchema>;

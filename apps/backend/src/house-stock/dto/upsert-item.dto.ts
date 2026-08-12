import { z } from 'zod';

/**
 * TBDR bazlı upsert. `tbdrCode` Product.internalCode ile eşleşir.
 * stockQty = OWNER'ın evindeki TOPLAM fiziksel stok (rezerve + serbest).
 * Yalnızca OWNER kendi (ownerId === req.user.id) kayıtlarını yazabilir;
 * ownerId path/query'den gelmez — controller her zaman req.user.id kullanır.
 */
export const upsertHouseStockItemSchema = z.object({
  tbdrCode: z
    .string()
    .trim()
    .min(1, 'TBDR kodu zorunlu')
    .max(64),
  stockQty: z.number().int().min(0).max(100_000),
  note: z.string().trim().max(500).optional(),
  mode: z.enum(['set', 'add']).optional(),
});

export type UpsertHouseStockItemDto = z.infer<typeof upsertHouseStockItemSchema>;

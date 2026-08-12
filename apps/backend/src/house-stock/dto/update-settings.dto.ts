import { z } from 'zod';

/**
 * OWNER Depo ayarları. Tek alan: tatil modu.
 *
 * FORWARD-ONLY: vacationMode=true yapılması mevcut reserved kalemleri
 * salmaz. Yalnızca YENİ paid Order'lar bu OWNER'a rezerve edilmez.
 */
export const updateHouseStockSettingsSchema = z.object({
  vacationMode: z.boolean(),
});

export type UpdateHouseStockSettingsDto = z.infer<typeof updateHouseStockSettingsSchema>;

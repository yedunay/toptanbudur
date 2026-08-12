import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  ValidateIf,
} from 'class-validator';

const ORDER_STATUSES = [
  'paid',
  'preparing',
  'shipped',
  'cancelled',
  'refunded',
] as const;

export type BulkOrderStatus = (typeof ORDER_STATUSES)[number];

// Toplu güncellemenin HEDEF alabileceği statüler. 'paid' bilinçli olarak HARİÇ:
// statü geçiş matrisinde hiçbir durumdan 'paid'e geçiş yoktur (paid yalnız
// kaynak statüdür). Toplu 'paid' yazımı limbo/çift cari iade riski taşıdığından
// daraltılmıştır. 'fromStatus' ve filtre 'status' alanları tam listeyi kullanır.
const BULK_TARGET_STATUSES = [
  'preparing',
  'shipped',
  'cancelled',
  'refunded',
] as const;

const BULK_MODES = ['selected', 'filtered', 'transition'] as const;
export type BulkUpdateMode = (typeof BULK_MODES)[number];

export const BULK_UPDATE_MAX = 200;

/**
 * Toplu sipariş statü güncelleme DTO'su.
 *
 * Üç mod:
 *  - selected:   `orderIds` listesindeki siparişleri günceller (max 200).
 *  - filtered:   Mevcut admin filtreleriyle eşleşen tüm siparişler (max 200).
 *  - transition: Belirli `fromStatus`'taki siparişleri `toStatus`'a alır
 *                (filtrelerle birlikte; max 200).
 *
 * `notify` true ise her sipariş için müşteriye status değişim e-postası gider.
 * Filtre alanları admin liste endpoint'iyle aynı şemayı kullanır.
 */
export class BulkUpdateOrdersDto {
  @IsIn(BULK_MODES)
  mode!: BulkUpdateMode;

  @IsIn(BULK_TARGET_STATUSES)
  toStatus!: BulkOrderStatus;

  @IsOptional()
  @IsIn(ORDER_STATUSES)
  fromStatus?: BulkOrderStatus;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(BULK_UPDATE_MAX)
  @IsString({ each: true })
  orderIds?: string[];

  @IsOptional()
  @IsBoolean()
  notify?: boolean;

  @IsOptional()
  @IsString()
  notes?: string;

  // Filtre alanları (mode = 'filtered' veya 'transition' için kullanılır).
  @IsOptional()
  @IsIn(ORDER_STATUSES)
  status?: BulkOrderStatus;

  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  supplierId?: string;

  // Çoklu tedarikçi seçimi — admin liste multi-select filtresiyle aynı kapsam.
  // Verildiğinde tekil `supplierId`'yi geçersiz kılar. Boş liste = hiçbiri
  // seçili değil → hiçbir sipariş güncellenmez.
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  supplierIds?: string[];

  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined && v !== '')
  @IsString()
  dateFrom?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined && v !== '')
  @IsString()
  dateTo?: string;
}

import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const SUPPLIER_LEDGER_TYPES = [
  'MANUAL_SET',
  'TOPUP',
  'ORDER_PURCHASE',
  'ORDER_REFUND',
  'ADJUSTMENT',
] as const;

/** Manuel para girişi (admin tedarikçi sitesine para yatırdı). */
export class SupplierTopupDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(50_000_000)
  amount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

/** İşaretli (+/-) manuel düzeltme. */
export class SupplierAdjustDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(-50_000_000)
  @Max(50_000_000)
  amount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

/** Mutlak bakiye değeri set etme. */
export class SupplierSetBalanceDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(-1_000_000)
  @Max(50_000_000)
  newBalance!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

/** Düşük-bakiye eşiği güncelleme. */
export class SupplierThresholdDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(50_000_000)
  threshold!: number;
}

/** Hareket defteri sorgu parametreleri. */
export class SupplierLedgerQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number;

  @IsOptional()
  @IsIn(SUPPLIER_LEDGER_TYPES)
  type?: (typeof SUPPLIER_LEDGER_TYPES)[number];
}

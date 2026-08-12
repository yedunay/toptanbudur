import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ProfitTierDto } from './profit-tier.dto';

export enum SupplierAuthType {
  NONE = 'none',
  BASIC = 'basic',
  BEARER = 'bearer',
}

// Satış kanalı (Order.marketplace). Üçüncü taraf pazaryeri markaları YOK —
// yalnızca iki nötr kanal:
//   'self'  → "Kendim İçin": bayi kendisi için alır. Kargo şirketi/barkodu,
//             son-müşteri ismi SORULMAZ; tek serbest-metin adres yeterlidir
//             (bkz. orders/dto.ts @ValidateIf(o => o.marketplace !== 'self')).
//   'other' → "Diğer Satış Kanalı": bayi başka bir kanal için alır. Kargo,
//             barkod, son-müşteri ismi ve tam adres ZORUNLU (self-DIŞI dal).
export const MARKETPLACE_VALUES = ['self', 'other'] as const;

export type Marketplace = (typeof MARKETPLACE_VALUES)[number];

// Tedarikçinin zorunlu kıldığı kargo firmaları. Null/undefined gelirse
// "tedarikçi serbest" anlamına gelir. OrdersService.create bu alanı
// sipariş kargosu ile karşılaştırır.
export const MANDATORY_CARRIER_VALUES = ['ARAS', 'SURAT', 'PTT', 'DHL', 'YURTICI'] as const;

export type MandatoryCarrier = (typeof MANDATORY_CARRIER_VALUES)[number];

export class SupplierAuthDto {
  @IsEnum(SupplierAuthType)
  type!: SupplierAuthType;

  @ValidateIf((o: SupplierAuthDto) => o.type !== SupplierAuthType.NONE)
  @IsString()
  @MinLength(1)
  credentials?: string;
}

export class CreateSupplierFeedDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsUrl({ require_tld: false, protocols: ['http', 'https'], require_protocol: true })
  feedUrl!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => SupplierAuthDto)
  auth?: SupplierAuthDto;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(168)
  refreshIntervalHours?: number;

  @IsOptional()
  @IsString()
  @MinLength(3)
  feedCurrency?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  exchangeRate?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  exchangeRateMargin?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class CreateSupplierDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1000)
  profitMargin?: number;

  // Kâr tipi: "fixed" (profitMargin+extraCostTry) | "tiered" (profitTiers).
  @IsOptional()
  @IsIn(['fixed', 'tiered'])
  profitType?: 'fixed' | 'tiered';

  // Kademeli kâr baremleri (profitType="tiered"). Yapısal doğrulama burada;
  // bitişiklik/[0,∞) iş kuralı serviste (validateTiers).
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProfitTierDto)
  profitTiers?: ProfitTierDto[] | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  stockThreshold?: number;

  @IsOptional()
  @IsArray()
  @IsIn(MARKETPLACE_VALUES, { each: true })
  marketplaces?: Marketplace[];

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsBoolean()
  includeInOwnFeed?: boolean;

  @IsOptional()
  @IsBoolean()
  priceIncludesVat?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  extraCostTry?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  minPrice?: number;

  // ── TEK KAYNAK ALIŞ ──────────────────────────────────────────────────────
  // KDV oranı (10/20). KDV strip + tedarikçi cüzdanı/kâr gross-up için tek rate.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  purchaseVatRate?: number;

  // Alış indirimi (%) — XML fiyatına uygulanır (TEK indirim alanı).
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(100)
  purchaseDiscountInclVatPct?: number;

  // Alış indirimi (TL) — XML fiyatına uygulanır (yüzdeyle birlikte).
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  purchaseDiscountTl?: number;

  // Alış ek maliyeti (TL) — birim başına net maliyete eklenir.
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  purchaseExtraCostTl?: number;

  @IsOptional()
  @IsArray()
  @IsIn(MANDATORY_CARRIER_VALUES, { each: true })
  mandatoryCarriers?: MandatoryCarrier[];

  @IsOptional()
  @IsBoolean()
  requiresPdf?: boolean;

  @IsOptional()
  @IsBoolean()
  pttavmEnabled?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsIn([1, 2])
  leadTimeDays?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => CreateSupplierFeedDto)
  initialFeed?: CreateSupplierFeedDto;
}

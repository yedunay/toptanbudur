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
import {
  SupplierAuthType,
  MARKETPLACE_VALUES,
  MANDATORY_CARRIER_VALUES,
  type Marketplace,
  type MandatoryCarrier,
} from './create-supplier.dto';
import { ProfitTierDto } from './profit-tier.dto';

class PatchAuthDto {
  @IsEnum(SupplierAuthType)
  type!: SupplierAuthType;

  @ValidateIf((o: PatchAuthDto) => o.type !== SupplierAuthType.NONE)
  @IsString()
  @MinLength(1)
  credentials?: string;
}

export class UpdateSupplierDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1000)
  profitMargin?: number;

  // Kâr tipi: "fixed" | "tiered" (Fiyata Göre Kademeli Kâr).
  @IsOptional()
  @IsIn(['fixed', 'tiered'])
  profitType?: 'fixed' | 'tiered';

  // Kademeli kâr baremleri. Yapısal doğrulama; iş kuralı serviste (validateTiers).
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

  // DEPRECATED: artık kullanılmıyor (tek indirim purchaseDiscountInclVatPct).
  // Geriye dönük uyumluluk için kabul edilir ama yok sayılır.
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(100)
  purchaseDiscountExclVatPct?: number;

  @IsOptional()
  @IsArray()
  @IsIn(MANDATORY_CARRIER_VALUES, { each: true })
  mandatoryCarriers?: MandatoryCarrier[];

  @IsOptional()
  @IsBoolean()
  requiresPdf?: boolean;

  // Eski tedarikçi bayrağı — DB kolonu korunuyor, ancak sipariş akışında
  // artık HİÇBİR kural bu alana bağlı değil (salt veri).
  @IsOptional()
  @IsBoolean()
  pttavmEnabled?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsIn([1, 2])
  leadTimeDays?: number;
}

export class UpdateSupplierFeedDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsUrl({ require_tld: false, protocols: ['http', 'https'], require_protocol: true })
  feedUrl?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => PatchAuthDto)
  auth?: PatchAuthDto;

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
  exchangeRate?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  exchangeRateMargin?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

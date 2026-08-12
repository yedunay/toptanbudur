import {
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ProfitTierDto } from './profit-tier.dto';

/**
 * Kategori bazlı fiyatlandırma override DTO.
 *
 * Her alan bağımsız: gönderilmeyen (undefined) alan DEĞİŞTİRİLMEZ; açıkça
 * `null` gönderilen alan globale döndürülür (override kaldırılır).
 *
 * - profitTypeOverride: kategori kâr tipi override'ı ("fixed"|"tiered"|null=miras).
 * - profitTiers: kademeli kâr baremleri (profitTypeOverride="tiered" iken).
 * - marginPercentOverride / extraCostTryOverride: sabit kâr override'ı.
 */
export class CategoryPricingDto {
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(100000)
  marginPercentOverride?: number | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1000000)
  extraCostTryOverride?: number | null;

  // Kategori kâr tipi override'ı. null = tedarikçiden miras.
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsIn(['fixed', 'tiered'])
  profitTypeOverride?: 'fixed' | 'tiered' | null;

  // Kademeli kâr baremleri (profitTypeOverride="tiered"). İş kuralı serviste.
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProfitTierDto)
  profitTiers?: ProfitTierDto[] | null;
}

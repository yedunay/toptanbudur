import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  Min,
} from 'class-validator';

/**
 * Tek bir kademeli kâr baremi (Fiyata Göre Kademeli Kâr). Aralık [min, max):
 * min dahil, max hariç; max boş (undefined/null) = ∞ (en üst barem). Barem
 * ürünün ALIŞ maliyetine (costPrice) göre seçilir. İş kuralı doğrulaması
 * (bitişiklik [0,∞), ilk min=0, son max=∞) serviste validateTiers ile yapılır.
 */
export class ProfitTierDto {
  /** Alt limit (costPrice >= min). */
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  min!: number;

  /** Üst limit (costPrice < max). null/boş = ∞. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  max?: number | null;

  /** "percent" = % marj; "amount" = TL kâr tutarı. */
  @IsIn(['percent', 'amount'])
  rateType!: 'percent' | 'amount';

  /** rateType'a göre yüzde veya TL. */
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  rate!: number;

  /** Bareme özel ek maliyetler (TL) — satışa eklenir, toplanır. */
  @IsOptional()
  @IsArray()
  @Type(() => Number)
  @IsNumber({}, { each: true })
  @Min(0, { each: true })
  extraCosts?: number[];
}

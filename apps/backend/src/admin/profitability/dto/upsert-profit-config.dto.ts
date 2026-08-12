import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class UpsertProfitConfigDto {
  @IsInt()
  @Min(0)
  purchaseKdvRate!: number;

  @IsIn(['none', 'percent', 'tl'])
  discountType!: string;

  @IsNumber()
  @Min(0)
  discountValue!: number;

  @IsNumber()
  @Min(0)
  extraCostTL!: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

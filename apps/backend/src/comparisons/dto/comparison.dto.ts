import {
  IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, Max, MaxLength, Min,
} from 'class-validator';

export class CreateCompetitorDto {
  @IsString() @MaxLength(120) name!: string;
  @IsOptional() @IsIn(['competitor', 'supplier']) type?: string;
  @IsOptional() @IsString() @MaxLength(600) feedUrl?: string;
  @IsOptional() @IsBoolean() priceKdvIncluded?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(100) purchaseDiscountPercent?: number;
  @IsOptional() @IsNumber() packagingFee?: number;
  @IsOptional() @IsBoolean() isDealerPrice?: boolean;
  @IsOptional() @IsObject() fieldMap?: Record<string, string>;
  @IsOptional() @IsArray() @IsString({ each: true }) cleanupWords?: string[];
}

export class UpdateCompetitorDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsIn(['competitor', 'supplier']) type?: string;
  @IsOptional() @IsString() @MaxLength(600) feedUrl?: string;
  @IsOptional() @IsBoolean() priceKdvIncluded?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(100) purchaseDiscountPercent?: number;
  @IsOptional() @IsNumber() packagingFee?: number;
  @IsOptional() @IsBoolean() isDealerPrice?: boolean;
  @IsOptional() @IsObject() fieldMap?: Record<string, string>;
  @IsOptional() @IsArray() @IsString({ each: true }) cleanupWords?: string[];
  @IsOptional() @IsBoolean() active?: boolean;
}

export class MatchDecisionDto {
  @IsIn(['approved', 'rejected']) status!: 'approved' | 'rejected';
}

export class ManualMatchDto {
  @IsString() @MaxLength(80) code!: string; // bizdeki stok kodu (TBDR-…) veya barkod
}

export class CheaperHintDto {
  @IsString() @MaxLength(40) productId!: string;
  @IsString() @MaxLength(160) supplierName!: string;
  @IsOptional() @IsString() @MaxLength(40) competitorId?: string;
  @IsNumber() theirCost!: number;
  @IsNumber() ourCost!: number;
  @IsOptional() @IsString() @MaxLength(600) productUrl?: string;
}

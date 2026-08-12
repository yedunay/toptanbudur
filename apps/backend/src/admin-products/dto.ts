import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

// Multipart/form-data ile gelen boolean alanları string olarak parse edilir.
// @Type(() => Boolean) tuzağı: Boolean('false') === true → pasif ürün yanlışlıkla
// aktif olur. Bu transform 'true'/'false'/'1'/'0' string'lerini doğru çevirir.
function toBooleanInput({ value }: { value: unknown }): unknown {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (v === 'true' || v === '1' || v === 'yes' || v === 'on') return true;
    if (v === 'false' || v === '0' || v === 'no' || v === 'off' || v === '')
      return false;
  }
  return value;
}

export class AdminProductListQueryDto {
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsString()
  categorySlug?: string;

  @IsOptional()
  @IsString()
  brand?: string;

  // Tedarikçiye göre filtre — Product.supplierId direct match.
  @IsOptional()
  @IsString()
  supplierId?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  inStock?: boolean;

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
}

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  name?: string;

  // null = "feed yönetsin" (manuel override'ı temizle); sayı = manuel override.
  // ValidateIf null'da sayısal kuralları atlar; undefined ise IsOptional atlar.
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(9999999.99)
  price?: number | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000000)
  stock?: number | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class BulkUpdatePatchDto {
  // null = feed moduna döndür (manuel override temizle); sayı = manuel override.
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(9999999.99)
  price?: number | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000000)
  stock?: number | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class BulkUpdateDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsString({ each: true })
  ids!: string[];

  @ValidateNested()
  @Type(() => BulkUpdatePatchDto)
  patch!: BulkUpdatePatchDto;
}

export class BulkDeleteDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsString({ each: true })
  ids!: string[];
}

// Multipart/form-data ile gelen sayı/boolean alanları string olarak parse
// edilir; Type(() => Number/Boolean) ve transformer'lar bu yüzden gereklidir.
export class CreateManualProductDto {
  @IsString()
  @MinLength(2)
  @MaxLength(500)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  brand?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  model?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  categoryId?: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(9999999.99)
  price!: number;

  // Maliyet zorunlu değil; girilmezse price'a eşit kabul edilir.
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(9999999.99)
  costPrice?: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000000)
  stock!: number;

  // KDV oranı yüzde olarak (0-100). Varsayılan UI tarafından 10 gönderilir.
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  taxRate?: number;

  @IsOptional()
  @Transform(toBooleanInput)
  @IsBoolean()
  isActive?: boolean;
}

import { Type } from 'class-transformer';
import {
  IsBooleanString,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class ProductsExportQueryDto {
  @IsOptional()
  @IsString()
  supplierId?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsString()
  category?: string;

  // ?inStock=true / false
  @IsOptional()
  @IsBooleanString()
  inStock?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  minPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  maxPrice?: number;

  /** Ürün adı / SKU / marka üzerinde insensitive contains arama. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  /** Marka üzerinde insensitive contains. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  brand?: string;

  /** UI bayrağı: filtreli vs. tümü. Backend tarafında kullanılmıyor ama
   *  ValidationPipe'ın whitelist davranışı yüzünden DTO'da tanımlı olması gerekiyor. */
  @IsOptional()
  @IsIn(['all', 'filtered'])
  scope?: 'all' | 'filtered';
}

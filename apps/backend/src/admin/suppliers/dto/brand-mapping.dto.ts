import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

/**
 * Brand mapping payload — admin "tedarikçi config" sayfasında bulk upsert
 * için kullanılır. sourceBrandName XML'den gelen ham string (ör. "F.B.I"),
 * targetBrandName bizim normalize markamız (ör. "FBI"). hidden=true ise bu
 * brand'in tüm ürünleri sitede görünmez.
 */
export class BrandMappingItemDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  sourceBrandName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  targetBrandName?: string | null;

  @IsOptional()
  @IsBoolean()
  hidden?: boolean;
}

export class BrandMappingsBulkDto {
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => BrandMappingItemDto)
  mappings!: BrandMappingItemDto[];
}

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
 * SupplierTextRule payload — admin "tedarikçi config" sayfasındaki "Metin
 * Kuralları" panelinde bulk upsert için kullanılır. `search` XML'den gelen
 * ürün adı/açıklamasında aranan LİTERAL düz metindir (regex DEĞİL).
 * `replacement` boşsa SİL, doluysa DEĞİŞTİR. Kurallar hem mağaza gösteriminde
 * hem giden XML feed'inde uygulanır.
 */
export class TextRuleItemDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  search!: string;

  // Boş string = sil. class-validator IsOptional ile undefined da kabul edilir;
  // servis tarafında '' default'una indirgenir.
  @IsOptional()
  @IsString()
  @MaxLength(500)
  replacement?: string;

  @IsOptional()
  @IsBoolean()
  applyToName?: boolean;

  @IsOptional()
  @IsBoolean()
  applyToDescription?: boolean;

  @IsOptional()
  @IsBoolean()
  caseInsensitive?: boolean;

  @IsOptional()
  @IsBoolean()
  wholeWord?: boolean;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class TextRulesBulkDto {
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => TextRuleItemDto)
  rules!: TextRuleItemDto[];
}

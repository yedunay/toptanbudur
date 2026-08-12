import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsHexColor,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  PopupAudience,
  PopupFrequency,
  PopupPosition,
  PopupSize,
} from '@prisma/client';
import { MAX_POPUP_BLOCKS } from '../popup-content';

/**
 * Pop-up güncelleme gövdesi. Tüm alanlar opsiyoneldir; yalnızca gönderilen
 * alanlar değiştirilir (partial update). Nullable alanlara `null` göndermek o
 * alanı temizler (örn. CTA'yı kaldırmak, tarih aralığını silmek). class-validator
 * @IsOptional() null değerinde diğer doğrulayıcıları atladığı için `string | null`
 * tipleri güvenle null kabul eder.
 */
export class UpdatePopupDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  body?: string | null;

  /** Görsel blok düzenleyici içeriği. null/[] = blok modunu kapat (legacy).
   *  Derin doğrulama serviste (validatePopupContent). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_POPUP_BLOCKS)
  content?: unknown[] | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(280)
  @Max(1200)
  widthPx?: number | null;

  @IsOptional()
  @IsHexColor()
  backgroundColor?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  ctaLabel?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  ctaUrl?: string | null;

  @IsOptional()
  @IsBoolean()
  ctaNewTab?: boolean;

  @IsOptional()
  @IsEnum(PopupPosition)
  position?: PopupPosition;

  @IsOptional()
  @IsEnum(PopupSize)
  size?: PopupSize;

  @IsOptional()
  @IsEnum(PopupFrequency)
  frequency?: PopupFrequency;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  showLimit?: number;

  @IsOptional()
  @IsBoolean()
  dismissible?: boolean;

  @IsOptional()
  @IsEnum(PopupAudience)
  audience?: PopupAudience;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  segment?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5000)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  customerIds?: string[];

  @IsOptional()
  @IsDateString()
  startsAt?: string | null;

  @IsOptional()
  @IsDateString()
  endsAt?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000)
  priority?: number;

  @IsOptional()
  @IsHexColor()
  themeColor?: string | null;
}

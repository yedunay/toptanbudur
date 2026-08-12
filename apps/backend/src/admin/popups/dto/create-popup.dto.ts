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
 * Yeni pop-up oluşturma gövdesi (application/json). Görsel ayrı bir multipart
 * endpoint ile yüklenir (bkz. AdminPopupsController.uploadImage), bu yüzden
 * burada imageUrl/imageKey alanları yoktur. Cross-field doğrulama (CTA çifti,
 * tarih aralığı, hedef kitle gereksinimleri) servis katmanında yapılır.
 */
export class CreatePopupDto {
  // Blok modunda (content dolu) başlık/metin zorunlu DEĞİL — görsel/video-only
  // duyuru için boş bırakılabilir. "Tamamen boş" engeli serviste (içerik VEYA
  // başlık VEYA metin VEYA görsel olmalı) uygulanır.
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  body?: string | null;

  /** Görsel blok düzenleyici içeriği. Derin doğrulama serviste yapılır
   *  (validatePopupContent). null/[] = legacy basit mod. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_POPUP_BLOCKS)
  content?: unknown[] | null;

  /** Özel genişlik (px). null = `size` ön ayarı. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(280)
  @Max(1200)
  widthPx?: number | null;

  /** Kart arka plan rengi (hex). null = beyaz. */
  @IsOptional()
  @IsHexColor()
  backgroundColor?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  ctaLabel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  ctaUrl?: string;

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
  segment?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5000)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  customerIds?: string[];

  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @IsOptional()
  @IsDateString()
  endsAt?: string;

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
  themeColor?: string;
}

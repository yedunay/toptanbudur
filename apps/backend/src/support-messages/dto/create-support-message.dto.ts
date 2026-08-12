import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateSupportMessageDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name!: string;

  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  subject?: string;

  @IsString()
  @MinLength(2)
  @MaxLength(8000)
  body!: string;

  // Sipariş bağlantısı (opsiyonel) — public formda kullanılmaz, sadece
  // müşteri panelinden gelen taleplerde dolar.
  @IsOptional()
  @IsString()
  @MaxLength(64)
  orderId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  orderNumber?: string;

  @IsOptional()
  @IsIn(['order', 'general'])
  kind?: 'order' | 'general';

  @IsOptional()
  @IsString()
  @MaxLength(64)
  category?: string;

  // Kargo takip alanları (hepsi opsiyonel)
  @IsOptional()
  @IsString()
  @MaxLength(64)
  marketplace?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  carrier?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  trackingCode?: string;
}

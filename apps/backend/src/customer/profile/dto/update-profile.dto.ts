import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { IsTrPhone } from '../../../common/decorators/is-tr-phone.decorator';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;

  @IsOptional()
  @IsTrPhone()
  phone?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;

  // Kişisel bilgiler
  @IsOptional()
  @IsString()
  @MaxLength(20)
  birthDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  language?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  timezone?: string;

  // Firma bilgileri
  @IsOptional()
  @IsString()
  @MaxLength(300)
  companyTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  vergiNo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  vergiDairesi?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  mersisNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  companyAddress?: string;

  // İletişim bilgileri
  @IsOptional()
  @IsString()
  @MaxLength(200)
  contactName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  contactPhone?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  contactEmail?: string;

  // E-posta bildirim tercihleri (opsiyonel sipariş maillerini aç/kapat)
  @IsOptional()
  @IsBoolean()
  orderConfirmEmailEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  orderStatusEmailEnabled?: boolean;
}

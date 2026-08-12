import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { FormStatus } from '@prisma/client';
import { IsTrPhone } from '../../common/decorators/is-tr-phone.decorator';

export class UpdateFormDto {
  @IsOptional()
  @IsEnum(FormStatus)
  status?: FormStatus;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;

  // Mesaj detayında admin iletişim alanlarını düzeltebilir. FE bu alanları
  // zaten gönderiyordu; eskiden whitelist dışı kaldığı için sessizce
  // yutuluyordu (#34). Hepsi opsiyonel — yalnız gönderilenler güncellenir.
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;

  // Esnek TR telefon doğrulaması — service tarafında normalizeTrPhone uygulanır.
  @IsOptional()
  @IsTrPhone()
  phone?: string;
}

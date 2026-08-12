import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * `currentPassword` zorunlu DEĞİL — `mustChangePassword === true` (bayi
 * onaylandıktan sonra geçici parola atanan) kullanıcılarda boş bırakılır.
 * `auth.service.ts:changePassword` mantığı bu durumu yorumlar.
 *
 * Yeni şifre politikası: min 12 karakter + en az 1 harf + 1 rakam.
 * Service katmanı aynı kontrolü tekrar yapar (defence in depth).
 */
export class ChangePasswordDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  currentPassword?: string;

  @IsString()
  @MinLength(12, {
    message: 'yeni şifre en az 12 karakter olmalı ve en az bir harf ile bir rakam içermeli',
  })
  @MaxLength(128)
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, {
    message: 'yeni şifre en az 12 karakter olmalı ve en az bir harf ile bir rakam içermeli',
  })
  newPassword!: string;
}

import { IsString, MaxLength, MinLength } from 'class-validator';

export class ResetPasswordDto {
  // Ham sıfırlama token'ı (maildeki linkten). Backend sha256'layıp DB'deki
  // hash ile eşler; uzunluk 64 hex ama sabit değere bağlanmıyoruz.
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  token!: string;

  // Yeni şifre — customer profil "şifre değiştir" ile aynı asgari kural (8).
  @IsString()
  @MinLength(8)
  @MaxLength(200)
  newPassword!: string;
}

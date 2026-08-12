import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Sohbete mesaj gönderme gövdesi. Metin opsiyonel — yalnızca görsel ek de
 * geçerli bir mesajdır. Servis katmanı "metin VEYA en az 1 ek" kuralını
 * uygular.
 */
export class PostMessageDto {
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  body?: string;
}

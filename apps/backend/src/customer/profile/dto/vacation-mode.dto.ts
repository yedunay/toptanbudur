import { IsBoolean } from 'class-validator';

/**
 * Müşterinin kendi tatil modu toggle'ı — bayinin geçici olarak siparişe kapalı
 * olduğunu işaretler.
 */
export class SetVacationModeDto {
  @IsBoolean()
  enabled!: boolean;
}

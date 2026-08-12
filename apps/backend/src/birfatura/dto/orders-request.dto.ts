import { IsInt, IsString, Matches, Min } from 'class-validator';
import { TR_DATETIME_REGEX } from '../birfatura.utils';

// §12.5: saat 0-23 (24+ reddedilir) — tek kanonik regex `birfatura.utils`'ten gelir (DRY).
export class OrdersRequestDto {
  @IsInt()
  @Min(1)
  orderStatusId!: number;

  @IsString()
  @Matches(TR_DATETIME_REGEX, {
    message: 'startDateTime must be in dd.MM.yyyy HH:mm:ss format (saat 0-23)',
  })
  startDateTime!: string;

  @IsString()
  @Matches(TR_DATETIME_REGEX, {
    message: 'endDateTime must be in dd.MM.yyyy HH:mm:ss format (saat 0-23)',
  })
  endDateTime!: string;
}

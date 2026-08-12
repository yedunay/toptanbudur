import { IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateSettingDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  value!: string;
}

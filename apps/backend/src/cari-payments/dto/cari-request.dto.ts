import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CariRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

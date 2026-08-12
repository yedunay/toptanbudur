import { IsString, MaxLength, MinLength } from 'class-validator';

export class ValidateResetTokenDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  token!: string;
}

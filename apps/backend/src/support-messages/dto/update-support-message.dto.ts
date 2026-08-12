import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { SupportMessageStatus } from '@prisma/client';

export class UpdateSupportMessageDto {
  @IsOptional()
  @IsEnum(SupportMessageStatus)
  status?: SupportMessageStatus;

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  adminNote?: string;
}

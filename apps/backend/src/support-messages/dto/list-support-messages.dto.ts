import { IsEnum, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { SupportMessageStatus } from '@prisma/client';

export class ListSupportMessagesDto {
  @IsOptional()
  @IsEnum(SupportMessageStatus)
  status?: SupportMessageStatus;

  @IsOptional()
  @IsIn(['order', 'general', 'all'])
  kind?: 'order' | 'general' | 'all';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number;
}

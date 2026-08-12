import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export const MESSAGE_SOURCES = [
  'FORM_CONTACT',
  'FORM_APPLICATION',
  'FORM_CALLBACK',
  'FORM_INTEGRATION',
  'SUPPORT',
] as const;
export type MessageSource = (typeof MESSAGE_SOURCES)[number];

export class ListMessagesDto {
  @IsOptional()
  @IsIn([...MESSAGE_SOURCES])
  source?: MessageSource;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

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

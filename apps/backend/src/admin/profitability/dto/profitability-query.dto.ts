import { IsDateString, IsOptional, IsString } from 'class-validator';

export class ProfitabilityQueryDto {
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @IsOptional()
  @IsString()
  supplierId?: string;
}

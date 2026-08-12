import { IsOptional, IsString, MaxLength } from 'class-validator';

export class GenerateFinanceApiKeyDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  label?: string;
}

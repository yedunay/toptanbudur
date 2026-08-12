import { IsDateString, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class TedarikciCariQueryDto {
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @IsString() supplierId?: string;
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsIn(['cari', 'card']) paymentType?: string;
  @IsOptional() @Type(() => Number) @IsIn([1, 10, 20]) kdvRate?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) pageSize?: number;
}

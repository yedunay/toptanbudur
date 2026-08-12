import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class OrdersExportQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  supplierId?: string;

  /** Müşteri adı / e-postası üzerinde insensitive contains arama. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  customer?: string;

  /** UI bayrağı: filtreli vs. tümü. Backend tarafında kullanılmıyor. */
  @IsOptional()
  @IsIn(['all', 'filtered'])
  scope?: 'all' | 'filtered';
}

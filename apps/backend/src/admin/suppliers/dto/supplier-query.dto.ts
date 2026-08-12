import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

// Query string boolean'ları string olarak gelir ('true'/'false'). Type(()=>Boolean)
// Boolean('false') === true tuzağına düşer; manuel Transform ile doğru parse.
function toOptionalBoolean(value: unknown): unknown {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (v === 'false' || v === '0' || v === 'no') return false;
    if (v === 'true' || v === '1' || v === 'yes') return true;
  }
  return value;
}

export class SupplierQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;

  // Serbest metin araması: tedarikçi adı / e-posta / marka üzerinde contains.
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @Transform(({ value }) => toOptionalBoolean(value))
  @IsBoolean()
  active?: boolean;

  // UI bazı yerlerde `isActive` adıyla gönderiyor — geriye dönük uyumluluk
  // için kabul edilir; service `active ?? isActive` ile birleştirir.
  @IsOptional()
  @Transform(({ value }) => toOptionalBoolean(value))
  @IsBoolean()
  isActive?: boolean;
}

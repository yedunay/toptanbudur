import { IsDateString, IsIn, IsOptional, IsString } from 'class-validator';

export class AuditExportQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsString()
  actorId?: string;

  @IsOptional()
  @IsString()
  action?: string;

  // Aktör tipi filtresi: 'admin' → User aktörleri, 'customer' → Customer
  // aktörleri. Boş bırakılırsa tüm aktörler. UI bu param'ı gönderiyordu ve
  // whitelist nedeniyle 400 dönüyordu (#10).
  @IsOptional()
  @IsIn(['admin', 'customer'])
  audience?: 'admin' | 'customer';

  // Serbest metin: action veya target üzerinde contains.
  @IsOptional()
  @IsString()
  q?: string;
}

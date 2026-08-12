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

/**
 * Admin Makbuzlar liste filtresi. Tüm alanlar opsiyonel — hiçbiri verilmezse
 * tüm makbuzlar (admin'in tenant'ı kapsamında) issuedAt'e göre azalan döner.
 *
 * `kind` yalnızca 'order' | 'cari_topup' kabul eder; sipariş makbuzlarını cari
 * yükleme makbuzlarından ayırmak için kullanılır.
 */
export class AdminReceiptListQueryDto {
  /** issuedAt >= from (ISO tarih). */
  @IsOptional()
  @IsDateString()
  from?: string;

  /** issuedAt <= to (ISO tarih). */
  @IsOptional()
  @IsDateString()
  to?: string;

  /** Tek bir bayiye (müşteriye) daralt. */
  @IsOptional()
  @IsString()
  customerId?: string;

  /** Makbuz türü filtresi. */
  @IsOptional()
  @IsIn(['order', 'cari_topup'])
  kind?: 'order' | 'cari_topup';

  /** 1-tabanlı sayfa numarası. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  /** Sayfa boyutu (max 200). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number;
}

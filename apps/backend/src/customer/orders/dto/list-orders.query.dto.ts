import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { trParts } from '../../../common/utils/tr-time';

export const ORDER_STATUS_VALUES = [
  'paid',
  'preparing',
  'shipped',
  'cancelled',
  'refunded',
] as const;

export type OrderStatusValue = (typeof ORDER_STATUS_VALUES)[number];

export const ORDER_SORT_VALUES = [
  'createdAt:desc',
  'createdAt:asc',
  'total:desc',
  'total:asc',
] as const;

export type OrderSortValue = (typeof ORDER_SORT_VALUES)[number];

export const ORDER_DATE_PRESET_VALUES = [
  'today',
  '7d',
  '30d',
  'thisMonth',
  'lastMonth',
] as const;

export type OrderDatePresetValue = (typeof ORDER_DATE_PRESET_VALUES)[number];

export class ListOrdersQueryDto {
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
  limit?: number;

  @IsOptional()
  @IsString()
  @IsIn(ORDER_STATUS_VALUES as unknown as string[])
  status?: OrderStatusValue;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @IsString()
  @IsIn(ORDER_SORT_VALUES as unknown as string[])
  sort?: OrderSortValue;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  marketplace?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  cargoCompany?: string;

  @IsOptional()
  @IsISO8601()
  dateFrom?: string;

  @IsOptional()
  @IsISO8601()
  dateTo?: string;

  /**
   * Hazır tarih aralığı (today/7d/30d/thisMonth/lastMonth). Açık dateFrom/dateTo
   * verilmediğinde `resolveOrderDateRange` ile aralığa çevrilir. Frontend filtre
   * çubuğu bu alanı gönderir; DTO'da tanımlı olması `forbidNonWhitelisted`
   * pipe'ının isteği 400 ile reddetmesini engeller (Excel dışa aktarma bug'ı).
   */
  @IsOptional()
  @IsString()
  @IsIn(ORDER_DATE_PRESET_VALUES as unknown as string[])
  datePreset?: OrderDatePresetValue;
}

/**
 * Sorgudaki tarih filtresini efektif `{ dateFrom, dateTo }` aralığına çevirir.
 * Açık `dateFrom`/`dateTo` verilmişse onlar kullanılır; yoksa `datePreset`
 * sunucu yerel saatine göre `YYYY-MM-DD` aralığına açılır.
 */
export function resolveOrderDateRange(query: {
  dateFrom?: string;
  dateTo?: string;
  datePreset?: string;
}): { dateFrom?: string; dateTo?: string } {
  if (query.dateFrom || query.dateTo) {
    return { dateFrom: query.dateFrom, dateTo: query.dateTo };
  }
  if (!query.datePreset) return {};

  const pad = (n: number) => String(n).padStart(2, '0');
  // Preset'ler TR takvim gününe göre çözümlenir (sunucu UTC olsa bile). Sadece
  // Y-M-D üretildiği için aritmetik UTC bileşenleriyle yapılır; anchor = TR-bugün.
  const toStr = (d: Date) =>
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const tp = trParts(new Date());
  const trToday = new Date(Date.UTC(tp.year, tp.month - 1, tp.day));

  switch (query.datePreset) {
    case 'today':
      return { dateFrom: toStr(trToday), dateTo: toStr(trToday) };
    case '7d': {
      const from = new Date(trToday);
      from.setUTCDate(from.getUTCDate() - 6);
      return { dateFrom: toStr(from), dateTo: toStr(trToday) };
    }
    case '30d': {
      const from = new Date(trToday);
      from.setUTCDate(from.getUTCDate() - 29);
      return { dateFrom: toStr(from), dateTo: toStr(trToday) };
    }
    case 'thisMonth': {
      const from = new Date(Date.UTC(tp.year, tp.month - 1, 1));
      return { dateFrom: toStr(from), dateTo: toStr(trToday) };
    }
    case 'lastMonth': {
      const from = new Date(Date.UTC(tp.year, tp.month - 2, 1));
      const to = new Date(Date.UTC(tp.year, tp.month - 1, 0));
      return { dateFrom: toStr(from), dateTo: toStr(to) };
    }
    default:
      return {};
  }
}

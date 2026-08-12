import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Genel amaçlı sayfalama DTO'su.
 *
 * İki sayfalama stilini birlikte destekler:
 *   - `page` / `pageSize`  → klasik (1-tabanlı sayfa numarası)
 *   - `limit`  / `offset`  → REST standardı (kayıt sayısı + atlanacak kayıt)
 *
 * İki stil aynı anda verilirse `limit`/`offset` öncelikli kabul edilir.
 *
 * Üst sınırlar:
 *   - `pageSize` max 200 (audit listeleri için)
 *   - `limit`    max 200
 *
 * Bu DTO whitelist+transform pipe ile birlikte kullanılmalıdır:
 *   `app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))`
 */
export class PaginationQueryDto {
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

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

/**
 * `PaginationQueryDto`'dan normalize edilmiş `{ page, pageSize, skip, take }`
 * değerlerini döndüren saf yardımcı.
 *
 * - `limit`/`offset` verilmişse onlar baz alınır; `page` türetilir.
 * - Yalnızca `page`/`pageSize` verilmişse skip/take hesaplanır.
 * - Hiçbiri verilmemişse `defaults` uygulanır.
 *
 * `pageSize` ve `limit` üst sınırı DTO'da `@Max(200)` ile zaten zorlanır;
 * burada ek olarak `maxPageSize` parametresi ile çağırma yerinde de
 * sıkıştırılabilir (örn. dış arama endpoint'leri 60 ile sınırlamak isteyebilir).
 */
export interface ResolvedPagination {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
}

export interface ResolvePaginationOptions {
  defaultPage?: number;
  defaultPageSize?: number;
  maxPageSize?: number;
}

export function resolvePagination(
  query: PaginationQueryDto,
  options: ResolvePaginationOptions = {},
): ResolvedPagination {
  const defaultPage = options.defaultPage ?? 1;
  const defaultPageSize = options.defaultPageSize ?? 50;
  const maxPageSize = options.maxPageSize ?? 200;

  // limit/offset stili öncelikli.
  if (query.limit !== undefined || query.offset !== undefined) {
    const take = Math.min(maxPageSize, Math.max(1, query.limit ?? defaultPageSize));
    const skip = Math.max(0, query.offset ?? 0);
    const page = Math.floor(skip / take) + 1;
    return { page, pageSize: take, skip, take };
  }

  const page = Math.max(1, query.page ?? defaultPage);
  const pageSize = Math.min(
    maxPageSize,
    Math.max(1, query.pageSize ?? defaultPageSize),
  );
  return {
    page,
    pageSize,
    skip: (page - 1) * pageSize,
    take: pageSize,
  };
}

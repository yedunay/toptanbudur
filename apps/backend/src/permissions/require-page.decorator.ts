import { SetMetadata } from '@nestjs/common';
import type { PageKey } from './permission-keys';

export const REQUIRE_PAGE_KEY = 'permissions:require_page';
export const REQUIRE_ANY_PAGE_KEY = 'permissions:require_any_page';

/**
 * `@RequirePage('orders')` — handler veya controller seviyesinde uygulanır.
 * JwtAuthGuard'dan sonra çalışan `PagePermissionGuard` bu metadata'yı
 * okur ve kullanıcının izin listesini kontrol eder.
 *
 * - OWNER (`permissions: ['*']`) → her zaman geçer.
 * - Diğer roller → izin listesinde TÜM keyler bulunmalı (AND), aksi halde 403.
 */
export function RequirePage(...keys: PageKey[]): MethodDecorator & ClassDecorator {
  return SetMetadata(REQUIRE_PAGE_KEY, keys);
}

/**
 * `@RequireAnyPage('customers', 'comparisons')` — keylerden HERHANGİ BİRİ
 * yeterlidir (OR). Birden fazla sayfanın ortak kullandığı yardımcı uçlar
 * için (ör. muhasebe arama picker'ları). Metod seviyesinde kullanıldığında
 * sınıftaki `@RequirePage` metadata'sını Nest'in getAllAndOverride kuralı
 * gereği ezmez — guard iki metadata'yı ayrı ayrı okur ve İKİSİNİ DE uygular.
 */
export function RequireAnyPage(...keys: PageKey[]): MethodDecorator & ClassDecorator {
  return SetMetadata(REQUIRE_ANY_PAGE_KEY, keys);
}

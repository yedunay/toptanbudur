import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { RequestUser } from '../auth/jwt.strategy';
import {
  REQUIRE_ANY_PAGE_KEY,
  REQUIRE_PAGE_KEY,
} from './require-page.decorator';
import type { PageKey } from './permission-keys';
import { PermissionsService } from './permissions.service';

/**
 * `@RequirePage('orders')` (AND) ve `@RequireAnyPage(...)` (OR) ile
 * işaretlenmiş handler/controller'lar için kullanıcının sayfa izinlerini
 * kontrol eder.
 *
 * İzinler DB'den CANLI okunur (PermissionsService içinde kısa süreli
 * cache ile) — JWT'deki `permissions` claim'i yalnız frontend'in ilk
 * boyaması içindir. Böylece patron matristen bir izni kapattığında
 * çalışanın eski access token'ı o sayfayı AÇIK TUTAMAZ (eski davranış:
 * token TTL'i boyunca, 1 saate kadar, bayat izin geçerliydi).
 *
 * OWNER → PermissionsService `['*']` döner, her zaman geçer.
 *
 * NOT: Bu guard `JwtAuthGuard`'dan SONRA çalıştırılmalıdır — request.user
 * dolu olmalı. Kullanım: `@UseGuards(JwtAuthGuard, PagePermissionGuard)`.
 */
@Injectable()
export class PagePermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissions: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredAll = this.reflector.getAllAndOverride<PageKey[] | undefined>(
      REQUIRE_PAGE_KEY,
      [context.getHandler(), context.getClass()],
    );
    const requiredAny = this.reflector.getAllAndOverride<PageKey[] | undefined>(
      REQUIRE_ANY_PAGE_KEY,
      [context.getHandler(), context.getClass()],
    );
    const hasAll = !!requiredAll && requiredAll.length > 0;
    const hasAny = !!requiredAny && requiredAny.length > 0;
    if (!hasAll && !hasAny) return true;

    const req = context
      .switchToHttp()
      .getRequest<{ user?: RequestUser; livePermissions?: readonly string[] }>();
    const user = req.user;
    if (!user?.id) {
      throw new ForbiddenException('Bu sayfaya erişim yetkiniz yok');
    }

    // Fail-closed: kullanıcı silinmişse / DB hatasında erişim yok.
    let perms: readonly string[];
    try {
      perms = await this.permissions.getLivePermissions(user.id);
    } catch {
      throw new ForbiddenException('Bu sayfaya erişim yetkiniz yok');
    }

    // Controller'lar yetenek anahtarlarını (yetki_maliyet_kar,
    // yetki_para_islemleri) buradan okur — ikinci bir DB turu olmasın.
    req.livePermissions = perms;

    if (perms.includes('*')) return true;

    if (hasAll && requiredAll.some((k) => !perms.includes(k))) {
      throw new ForbiddenException('Bu sayfaya erişim yetkiniz yok');
    }
    if (hasAny && !requiredAny.some((k) => perms.includes(k))) {
      throw new ForbiddenException('Bu sayfaya erişim yetkiniz yok');
    }

    return true;
  }
}

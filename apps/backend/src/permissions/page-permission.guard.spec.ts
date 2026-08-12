import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PagePermissionGuard } from './page-permission.guard';
import { RequireAnyPage, RequirePage } from './require-page.decorator';

/**
 * PagePermissionGuard — canlı (DB-bazlı) sayfa izni kontrolü.
 *
 * Guard artık JWT claim'ine değil PermissionsService.getLivePermissions'a
 * bakar: patron izni kapattığı anda (cache TTL'i içinde) API reddetmeli.
 * Gerçek Reflector + gerçek decorator'lar kullanılır ki metadata anahtar
 * uyuşmazlığı da testte yakalansın.
 */

class WithClassAnd {
  handler(): void {}
}
RequirePage('orders')(WithClassAnd);

class WithMethodAny {
  handler(): void {}
}
RequireAnyPage('customers', 'comparisons')(
  WithMethodAny.prototype,
  'handler',
  Object.getOwnPropertyDescriptor(WithMethodAny.prototype, 'handler')!,
);

class NoMetadata {
  handler(): void {}
}

function ctxFor(
  cls: new () => unknown,
  user: { id: string; permissions?: string[] } | undefined,
): ExecutionContext {
  return {
    getHandler: () => (cls.prototype as { handler: () => void }).handler,
    getClass: () => cls,
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as ExecutionContext;
}

function buildGuard(livePerms: string[] | Error) {
  const permissions = {
    getLivePermissions: jest.fn(() =>
      livePerms instanceof Error
        ? Promise.reject(livePerms)
        : Promise.resolve(livePerms),
    ),
  };
  const guard = new PagePermissionGuard(
    new Reflector(),
    permissions as never,
  );
  return { guard, permissions };
}

describe('PagePermissionGuard', () => {
  const user = { id: 'u1', permissions: [] as string[] };

  it('metadata yoksa geçirir (RolesGuard hâlâ devrede)', async () => {
    const { guard, permissions } = buildGuard([]);
    await expect(guard.canActivate(ctxFor(NoMetadata, user))).resolves.toBe(
      true,
    );
    // Metadata yoksa DB'ye hiç gidilmez.
    expect(permissions.getLivePermissions).not.toHaveBeenCalled();
  });

  it('kullanıcı yoksa 403 (fail-closed)', async () => {
    const { guard } = buildGuard(['orders']);
    await expect(
      guard.canActivate(ctxFor(WithClassAnd, undefined)),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("canlı izinde anahtar varsa geçirir — JWT claim'i boş olsa bile", async () => {
    const { guard } = buildGuard(['orders']);
    await expect(
      guard.canActivate(ctxFor(WithClassAnd, { id: 'u1', permissions: [] })),
    ).resolves.toBe(true);
  });

  it('canlı izinde anahtar yoksa 403 — JWT claim içinde OLSA BİLE (bayat token)', async () => {
    const { guard } = buildGuard(['mesajlar']);
    await expect(
      guard.canActivate(
        ctxFor(WithClassAnd, { id: 'u1', permissions: ['orders'] }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("canlı '*' (OWNER) her kapıdan geçer", async () => {
    const { guard } = buildGuard(['*']);
    await expect(
      guard.canActivate(ctxFor(WithClassAnd, user)),
    ).resolves.toBe(true);
  });

  it('RequireAnyPage: anahtarlardan biri yeterli (OR)', async () => {
    const { guard } = buildGuard(['comparisons']);
    await expect(
      guard.canActivate(ctxFor(WithMethodAny, user)),
    ).resolves.toBe(true);
  });

  it('RequireAnyPage: hiçbiri yoksa 403', async () => {
    const { guard } = buildGuard(['orders']);
    await expect(
      guard.canActivate(ctxFor(WithMethodAny, user)),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('canlı izin okuması hata verirse 403 (fail-closed, 500 sızdırmaz)', async () => {
    const { guard } = buildGuard(new Error('db down'));
    await expect(
      guard.canActivate(ctxFor(WithClassAnd, user)),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

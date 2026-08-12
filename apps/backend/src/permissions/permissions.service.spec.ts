import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PermissionsService } from './permissions.service';
import { PAGE_KEYS } from './permission-keys';
import { ROLE_PAGE_DEFAULTS } from './role-templates';

/**
 * PermissionsService — çalışan (MEMBER) izin modelinin çekirdek testleri.
 *
 * Prisma ve Audit mock'lanır; DB davranışı basit in-memory map ile taklit
 * edilir. Amaç: efektif izin hesabı, MEMBER-yasak sayfa reddi, canlı cache
 * ve override yazım kuralları.
 */

type UserRow = { id: string; role: string; tenantId: string; email: string };

function buildMocks(opts: {
  users: UserRow[];
  overrides?: Array<{ userId: string; pageKey: string; granted: boolean }>;
}) {
  const overrideRows = [...(opts.overrides ?? [])];
  const prismaBase = {
    user: {
      findUnique: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(opts.users.find((u) => u.id === where.id) ?? null),
      ),
      findFirst: jest.fn(
        ({ where }: { where: { id: string; tenantId?: string } }) =>
          Promise.resolve(
            opts.users.find(
              (u) =>
                u.id === where.id &&
                (where.tenantId === undefined || u.tenantId === where.tenantId),
            ) ?? null,
          ),
      ),
    },
    userPagePermission: {
      findMany: jest.fn(({ where }: { where: { userId: string } }) =>
        Promise.resolve(
          overrideRows
            .filter((r) => r.userId === where.userId)
            .map((r) => ({ pageKey: r.pageKey, granted: r.granted })),
        ),
      ),
      deleteMany: jest.fn(
        ({ where }: { where: { userId: string; pageKey: string } }) => {
          const before = overrideRows.length;
          for (let i = overrideRows.length - 1; i >= 0; i--) {
            if (
              overrideRows[i].userId === where.userId &&
              overrideRows[i].pageKey === where.pageKey
            ) {
              overrideRows.splice(i, 1);
            }
          }
          return Promise.resolve({ count: before - overrideRows.length });
        },
      ),
      upsert: jest.fn(
        ({
          where,
          create,
        }: {
          where: { userId_pageKey: { userId: string; pageKey: string } };
          create: { userId: string; pageKey: string; granted: boolean };
          update: { granted: boolean };
        }) => {
          const existing = overrideRows.find(
            (r) =>
              r.userId === where.userId_pageKey.userId &&
              r.pageKey === where.userId_pageKey.pageKey,
          );
          if (existing) existing.granted = create.granted;
          else overrideRows.push({ ...create });
          return Promise.resolve(create);
        },
      ),
    },
  };
  const prisma = {
    ...prismaBase,
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(prismaBase),
    ),
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const service = new PermissionsService(
    prisma as never,
    audit as never,
  );
  return { prisma, audit, service, overrideRows };
}

const OWNER: UserRow = {
  id: 'owner-1',
  role: 'OWNER',
  tenantId: 't1',
  email: 'owner@x.com',
};
const MEMBER: UserRow = {
  id: 'member-1',
  role: 'MEMBER',
  tenantId: 't1',
  email: 'calisan@x.com',
};
const ADMIN: UserRow = {
  id: 'admin-1',
  role: 'ADMIN',
  tenantId: 't1',
  email: 'admin@x.com',
};

describe('Çalışan izin sözleşmesi (patron kontrolü)', () => {
  it('MEMBER varsayılanı yalnız Hesabım — geri kalan her şey KAPALI gelir', () => {
    expect(ROLE_PAGE_DEFAULTS.MEMBER).toEqual(['ayarlar_hesap']);
  });

  it('maliyet/kâr ve para işlemleri ayrı birer AÇILABİLİR yetki satırıdır', () => {
    expect(PAGE_KEYS).toContain('yetki_maliyet_kar');
    expect(PAGE_KEYS).toContain('yetki_para_islemleri');
    // Varsayılan KAPALI: MEMBER şablonunda yoklar.
    expect(ROLE_PAGE_DEFAULTS.MEMBER).not.toContain('yetki_maliyet_kar');
    expect(ROLE_PAGE_DEFAULTS.MEMBER).not.toContain('yetki_para_islemleri');
    // ADMIN'de varsayılan açık (depo_stogu hariç tüm anahtarlar).
    expect(ROLE_PAGE_DEFAULTS.ADMIN).toContain('yetki_maliyet_kar');
    expect(ROLE_PAGE_DEFAULTS.ADMIN).toContain('yetki_para_islemleri');
  });
});

describe('PermissionsService.getEffectivePermissions', () => {
  it('OWNER → unbounded, tüm sayfalar', async () => {
    const { service } = buildMocks({ users: [OWNER] });
    const eff = await service.getEffectivePermissions(OWNER.id);
    expect(eff.unbounded).toBe(true);
    expect(eff.effective).toEqual([...PAGE_KEYS]);
  });

  it('MEMBER default = yalnız ayarlar_hesap (deny-by-default)', async () => {
    const { service } = buildMocks({ users: [MEMBER] });
    const eff = await service.getEffectivePermissions(MEMBER.id);
    expect(eff.unbounded).toBe(false);
    expect(eff.effective).toEqual(['ayarlar_hesap']);
  });

  it('MEMBER + orders/mesajlar grant override → efektif listeye girer', async () => {
    const { service } = buildMocks({
      users: [MEMBER],
      overrides: [
        { userId: MEMBER.id, pageKey: 'orders', granted: true },
        { userId: MEMBER.id, pageKey: 'mesajlar', granted: true },
      ],
    });
    const eff = await service.getEffectivePermissions(MEMBER.id);
    expect(eff.effective).toEqual(
      expect.arrayContaining(['orders', 'mesajlar', 'ayarlar_hesap']),
    );
    expect(eff.effective).not.toContain('muhasebe_kar_dagilimi');
  });

  it('ADMIN + deny override → sayfa efektiften düşer', async () => {
    const { service } = buildMocks({
      users: [ADMIN],
      overrides: [
        { userId: ADMIN.id, pageKey: 'muhasebe_kar_dagilimi', granted: false },
      ],
    });
    const eff = await service.getEffectivePermissions(ADMIN.id);
    expect(eff.effective).not.toContain('muhasebe_kar_dagilimi');
    expect(eff.effective).toContain('orders');
  });

  it("patronun açtığı sayfa rol MEMBER'a düşse de AÇIK kalır", async () => {
    const { service } = buildMocks({
      users: [MEMBER],
      overrides: [
        { userId: MEMBER.id, pageKey: 'muhasebe_bayi_hesap', granted: true },
      ],
    });
    const eff = await service.getEffectivePermissions(MEMBER.id);
    expect(eff.effective).toContain('muhasebe_bayi_hesap');
  });

  it('patron açtığı her anahtar canlı izin listesine girer', async () => {
    const { service } = buildMocks({
      users: [MEMBER],
      overrides: [
        { userId: MEMBER.id, pageKey: 'orders', granted: true },
        { userId: MEMBER.id, pageKey: 'yetki_maliyet_kar', granted: true },
      ],
    });
    const perms = await service.getLivePermissions(MEMBER.id);
    expect(perms).toContain('orders');
    expect(perms).toContain('yetki_maliyet_kar');
  });

  it('tenantId verilirse başka tenant kullanıcısı 404', async () => {
    const { service } = buildMocks({ users: [MEMBER] });
    await expect(
      service.getEffectivePermissions(MEMBER.id, 'BASKA-TENANT'),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('PermissionsService.getLivePermissions (canlı cache)', () => {
  it('cache: aynı kullanıcı için ikinci çağrı DB’ye gitmez', async () => {
    const { service, prisma } = buildMocks({ users: [MEMBER] });
    await service.getLivePermissions(MEMBER.id);
    await service.getLivePermissions(MEMBER.id);
    expect(prisma.user.findFirst).toHaveBeenCalledTimes(1);
  });

  it('invalidateLiveCache sonrası DB yeniden okunur', async () => {
    const { service, prisma } = buildMocks({ users: [MEMBER] });
    await service.getLivePermissions(MEMBER.id);
    service.invalidateLiveCache(MEMBER.id);
    await service.getLivePermissions(MEMBER.id);
    expect(prisma.user.findFirst).toHaveBeenCalledTimes(2);
  });

  it('OWNER için ["*"] döner', async () => {
    const { service } = buildMocks({ users: [OWNER] });
    await expect(service.getLivePermissions(OWNER.id)).resolves.toEqual(['*']);
  });
});

describe('PermissionsService.setOverrides', () => {
  const actor = { id: OWNER.id, tenantId: 't1' };

  it('geçersiz sayfa anahtarı → 400', async () => {
    const { service } = buildMocks({ users: [OWNER, MEMBER] });
    await expect(
      service.setOverrides(
        MEMBER.id,
        [{ pageKey: 'boyle_sayfa_yok', granted: true }],
        actor,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('OWNER hedefi kısıtlanamaz → 400', async () => {
    const { service } = buildMocks({ users: [OWNER, ADMIN] });
    await expect(
      service.setOverrides(
        OWNER.id,
        [{ pageKey: 'orders', granted: false }],
        { id: ADMIN.id, tenantId: 't1' },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('aktör kendi izinlerini düzenleyemez → 403', async () => {
    const { service } = buildMocks({ users: [ADMIN] });
    await expect(
      service.setOverrides(
        ADMIN.id,
        [{ pageKey: 'orders', granted: false }],
        { id: ADMIN.id, tenantId: 't1' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('granted alanı hiç gönderilmezse (undefined) override silinir, 500 atmaz', async () => {
    const { service, overrideRows } = buildMocks({
      users: [OWNER, MEMBER],
      overrides: [{ userId: MEMBER.id, pageKey: 'orders', granted: true }],
    });
    await service.setOverrides(
      MEMBER.id,
      [{ pageKey: 'orders' } as { pageKey: string; granted: boolean | null }],
      actor,
    );
    expect(
      overrideRows.find(
        (r) => r.userId === MEMBER.id && r.pageKey === 'orders',
      ),
    ).toBeUndefined();
  });

  it('yazım sonrası canlı cache düşer (izin ANINDA etkili)', async () => {
    const { service } = buildMocks({ users: [OWNER, MEMBER] });
    // cache'i doldur — MEMBER'da orders yok
    const before = await service.getLivePermissions(MEMBER.id);
    expect(before).not.toContain('orders');
    await service.setOverrides(
      MEMBER.id,
      [{ pageKey: 'orders', granted: true }],
      actor,
    );
    const after = await service.getLivePermissions(MEMBER.id);
    expect(after).toContain('orders');
  });

  it('cross-tenant hedef → 404', async () => {
    const { service } = buildMocks({
      users: [{ ...MEMBER, tenantId: 't2' }],
    });
    await expect(
      service.setOverrides(
        MEMBER.id,
        [{ pageKey: 'orders', granted: true }],
        actor,
      ),
    ).rejects.toMatchObject({ status: 404 });
  });
});

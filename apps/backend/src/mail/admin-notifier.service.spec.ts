/* eslint-disable @typescript-eslint/unbound-method */
import { AdminNotifierService } from './admin-notifier.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { MailService } from './mail.service';

interface PrismaMock {
  user: {
    findMany: jest.Mock;
    count: jest.Mock;
  };
  tenant: {
    findFirst: jest.Mock;
  };
}

const makePrismaMock = (): PrismaMock => ({
  user: {
    findMany: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
  },
  tenant: {
    findFirst: jest.fn().mockResolvedValue(null),
  },
});

const makeMailMock = () =>
  ({
    sendHtml: jest.fn().mockResolvedValue(undefined),
  }) as unknown as MailService;

const build = (overrides: Partial<PrismaMock> = {}) => {
  const prisma = { ...makePrismaMock(), ...overrides };
  const mail = makeMailMock();
  const svc = new AdminNotifierService(
    prisma as unknown as PrismaService,
    mail,
  );
  return { svc, prisma, mail };
};

describe('AdminNotifierService', () => {
  describe('resolveAdminEmails', () => {
    it('returns empty array when no admins exist', async () => {
      const { svc } = build();
      const result = await svc.resolveAdminEmails('t1');
      expect(result).toEqual([]);
    });

    it('returns unique emails of OWNER/ADMIN users', async () => {
      const { svc, prisma } = build();
      prisma.user.findMany.mockResolvedValue([
        { email: 'owner@x.com' },
        { email: 'admin@x.com' },
      ]);
      const result = await svc.resolveAdminEmails('t1');
      expect(result).toEqual(['owner@x.com', 'admin@x.com']);
      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: { tenantId: 't1', role: { in: ['OWNER', 'ADMIN'] } },
        select: { email: true },
      });
    });

    it('deduplicates repeated emails', async () => {
      const { svc, prisma } = build();
      prisma.user.findMany.mockResolvedValue([
        { email: 'a@x.com' },
        { email: 'a@x.com' },
        { email: 'b@x.com' },
      ]);
      const result = await svc.resolveAdminEmails('t1');
      expect(result).toEqual(['a@x.com', 'b@x.com']);
    });

    it('filters out empty/null emails', async () => {
      const { svc, prisma } = build();
      prisma.user.findMany.mockResolvedValue([
        { email: '' },
        { email: null },
        { email: 'real@x.com' },
      ]);
      const result = await svc.resolveAdminEmails('t1');
      expect(result).toEqual(['real@x.com']);
    });
  });

  describe('resolveDefaultTenantId', () => {
    it('returns null when no tenant exists', async () => {
      const { svc } = build();
      const result = await svc.resolveDefaultTenantId();
      expect(result).toBeNull();
    });

    it('prefers tenant matching DEFAULT_TENANT_SLUG', async () => {
      const { svc, prisma } = build();
      prisma.tenant.findFirst.mockResolvedValueOnce({ id: 'tenant-by-slug' });
      const result = await svc.resolveDefaultTenantId();
      expect(result).toBe('tenant-by-slug');
    });

    it('falls back to first tenant when slug not found', async () => {
      const { svc, prisma } = build();
      prisma.tenant.findFirst
        .mockResolvedValueOnce(null) // slug lookup
        .mockResolvedValueOnce({ id: 'first-tenant' });
      const result = await svc.resolveDefaultTenantId();
      expect(result).toBe('first-tenant');
    });
  });

  describe('notifyAdmins', () => {
    it('skips send when no admin emails exist (logs warning, does not throw)', async () => {
      const { svc, mail } = build();
      await expect(
        svc.notifyAdmins({
          tenantId: 't1',
          subject: 's',
          html: '<p>x</p>',
          context: 'test-ctx',
        }),
      ).resolves.toBeUndefined();
      expect(mail.sendHtml).not.toHaveBeenCalled();
    });

    it('sends html to admins using info account by default', async () => {
      const { svc, prisma, mail } = build();
      prisma.user.findMany.mockResolvedValue([{ email: 'admin@x.com' }]);
      await svc.notifyAdmins({
        tenantId: 't1',
        subject: 'Subj',
        html: '<p>Body</p>',
      });
      expect(mail.sendHtml).toHaveBeenCalledWith({
        account: 'info',
        to: ['admin@x.com'],
        subject: 'Subj',
        html: '<p>Body</p>',
      });
    });

    it('respects explicit account override', async () => {
      const { svc, prisma, mail } = build();
      prisma.user.findMany.mockResolvedValue([{ email: 'admin@x.com' }]);
      await svc.notifyAdmins({
        tenantId: 't1',
        subject: 'S',
        html: 'h',
        account: 'donotreply',
      });
      expect(mail.sendHtml).toHaveBeenCalledWith(
        expect.objectContaining({ account: 'donotreply' }),
      );
    });

    it('swallows SMTP errors so caller flow is not broken', async () => {
      const { svc, prisma, mail } = build();
      prisma.user.findMany.mockResolvedValue([{ email: 'admin@x.com' }]);
      (mail.sendHtml as jest.Mock).mockRejectedValueOnce(
        new Error('SMTP down'),
      );
      await expect(
        svc.notifyAdmins({ tenantId: 't1', subject: 's', html: 'h' }),
      ).resolves.toBeUndefined();
    });
  });

  describe('onApplicationBootstrap', () => {
    const originalEnv = process.env.NODE_ENV;
    afterEach(() => {
      process.env.NODE_ENV = originalEnv;
    });

    it('is a no-op when NODE_ENV=test', async () => {
      process.env.NODE_ENV = 'test';
      const { svc, prisma } = build();
      await svc.onApplicationBootstrap();
      expect(prisma.user.count).not.toHaveBeenCalled();
    });

    it('counts admins with non-empty email in non-test env', async () => {
      process.env.NODE_ENV = 'development';
      const { svc, prisma } = build();
      prisma.user.count.mockResolvedValue(2);
      prisma.tenant.findFirst.mockResolvedValue({ id: 't1' });
      await svc.onApplicationBootstrap();
      expect(prisma.user.count).toHaveBeenCalledWith({
        where: {
          role: { in: ['OWNER', 'ADMIN'] },
          email: { not: '' },
        },
      });
    });

    it('does not throw when prisma fails', async () => {
      process.env.NODE_ENV = 'development';
      const { svc, prisma } = build();
      prisma.user.count.mockRejectedValue(new Error('db down'));
      await expect(svc.onApplicationBootstrap()).resolves.toBeUndefined();
    });
  });
});

import * as bcrypt from 'bcrypt';
import { createHash } from 'crypto';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { PasswordCryptoService } from '../vault/password-crypto.service';
import { AuditService } from '../audit/audit.service';
import { CustomerAuthService } from './customer-auth.service';

/**
 * Bug #9 — login flow regression guard. Storefront login must:
 *   - normalize email (trim + lowercase) before lookup
 *   - return UnauthorizedException with a non-leaking message in production
 *   - log the real failure code on the server side
 *
 * Ayrıca: forgot-password / reset-password akışının güvenlik davranışları.
 */

interface CustomerRow {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  passwordHash: string;
  discountPercent: number;
  mustChangePassword: boolean;
  xmlToken: string | null;
  isActive?: boolean;
  encryptedPassword?: string | null;
  passwordResetTokenHash?: string | null;
  passwordResetExpiresAt?: Date | null;
  tokenVersion?: number;
}

function makePrisma(seed: Record<string, CustomerRow>): PrismaService {
  const rows = Object.values(seed);
  return {
    customer: {
      findUnique: jest.fn(
        async (args: {
          where: {
            email?: string;
            id?: string;
            passwordResetTokenHash?: string;
          };
        }) => {
          if (args.where.email !== undefined) {
            return rows.find((r) => r.email === args.where.email) ?? null;
          }
          if (args.where.id !== undefined) {
            return rows.find((r) => r.id === args.where.id) ?? null;
          }
          if (args.where.passwordResetTokenHash !== undefined) {
            return (
              rows.find(
                (r) =>
                  r.passwordResetTokenHash === args.where.passwordResetTokenHash,
              ) ?? null
            );
          }
          return null;
        },
      ),
      update: jest.fn(
        async (args: { where: { id: string }; data: Partial<CustomerRow> }) => {
          const row = rows.find((r) => r.id === args.where.id);
          if (row) applyData(row, args.data as Record<string, unknown>);
          return row ?? null;
        },
      ),
      // Generic updateMany: where'deki her alanı (undefined/null'ı eş sayarak)
      // eşler, data'yı ({increment} dahil) uygular, eşleşen satır sayısını döner.
      updateMany: jest.fn(
        async (args: {
          where: Record<string, unknown>;
          data: Record<string, unknown>;
        }) => {
          const matched = rows.filter((r) =>
            Object.entries(args.where ?? {}).every(
              ([k, v]) =>
                ((r as unknown as Record<string, unknown>)[k] ?? null) ===
                (v ?? null),
            ),
          );
          for (const r of matched) applyData(r, args.data ?? {});
          return { count: matched.length };
        },
      ),
    },
  } as unknown as PrismaService;
}

function applyData(row: object, data: Record<string, unknown>): void {
  const r = row as Record<string, unknown>;
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === 'object' && 'increment' in (v as object)) {
      r[k] = ((r[k] as number) ?? 0) + (v as { increment: number }).increment;
    } else {
      r[k] = v;
    }
  }
}

function makeJwt(): JwtService {
  return {
    sign: jest.fn().mockReturnValue('signed-token'),
  } as unknown as JwtService;
}

function makeMail(): jest.Mocked<MailService> {
  return {
    sendPasswordReset: jest.fn().mockResolvedValue(undefined),
    sendPasswordChanged: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<MailService>;
}

function makePasswordCrypto(): PasswordCryptoService {
  return {
    seal: jest.fn().mockReturnValue('sealed'),
    open: jest.fn(),
  } as unknown as PasswordCryptoService;
}

function makeAudit(): AuditService {
  return { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
}

function makeConfig(): ConfigService {
  return {
    get: jest.fn().mockReturnValue('https://toptanbudur.com'),
  } as unknown as ConfigService;
}

function makeService(
  prisma: PrismaService,
  overrides: {
    mail?: MailService;
    crypto?: PasswordCryptoService;
    audit?: AuditService;
    config?: ConfigService;
  } = {},
): CustomerAuthService {
  return new CustomerAuthService(
    prisma,
    makeJwt(),
    overrides.mail ?? makeMail(),
    overrides.crypto ?? makePasswordCrypto(),
    overrides.audit ?? makeAudit(),
    overrides.config ?? makeConfig(),
  );
}

const flush = () => new Promise((r) => setImmediate(r));

function row(over: Partial<CustomerRow> = {}): CustomerRow {
  return {
    id: 'c1',
    email: 'firma@example.com',
    name: 'Firma',
    phone: null,
    passwordHash: 'x',
    discountPercent: 0,
    mustChangePassword: false,
    xmlToken: 'tok',
    isActive: true,
    ...over,
  };
}

describe('CustomerAuthService.login — bug #9 regression', () => {
  it('finds customer when login email differs in case from stored email', async () => {
    const passwordHash = await bcrypt.hash('hunter22', 4);
    const prisma = makePrisma({
      a: row({ passwordHash, mustChangePassword: true }),
    });
    const svc = makeService(prisma);

    const result = await svc.login({
      email: 'Firma@Example.COM',
      password: 'hunter22',
    });

    expect(result.accessToken).toBe('signed-token');
    expect(result.mustChangePassword).toBe(true);
  });

  it('finds customer when login email has surrounding whitespace', async () => {
    const passwordHash = await bcrypt.hash('hunter22', 4);
    const prisma = makePrisma({ a: row({ passwordHash }) });
    const svc = makeService(prisma);

    const result = await svc.login({
      email: '  firma@example.com  ',
      password: 'hunter22',
    });

    expect(result.accessToken).toBe('signed-token');
  });

  it('rejects unknown email with UnauthorizedException', async () => {
    const prisma = makePrisma({});
    const svc = makeService(prisma);

    await expect(
      svc.login({ email: 'yok@example.com', password: 'whatever' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects wrong password with UnauthorizedException', async () => {
    const passwordHash = await bcrypt.hash('correct-horse', 4);
    const prisma = makePrisma({ a: row({ passwordHash }) });
    const svc = makeService(prisma);

    await expect(
      svc.login({ email: 'firma@example.com', password: 'wrong' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('emails a reset link after 3 consecutive wrong passwords', async () => {
    const passwordHash = await bcrypt.hash('correct-horse', 4);
    const prisma = makePrisma({ a: row({ passwordHash }) });
    const mail = makeMail();
    const svc = makeService(prisma, { mail });

    for (let i = 0; i < 3; i++) {
      await svc
        .login({ email: 'firma@example.com', password: 'wrong' })
        .catch(() => undefined);
    }
    await flush();

    // 3. yanlıştan sonra tam bir kez link maili (mevcut şifre değiştirilmez).
    expect(mail.sendPasswordReset).toHaveBeenCalledTimes(1);
  });
});

describe('CustomerAuthService — password reset', () => {
  it('requestPasswordReset returns generic ok for unknown email (no throw, no mail)', async () => {
    const prisma = makePrisma({});
    const mail = makeMail();
    const svc = makeService(prisma, { mail });

    await expect(
      svc.requestPasswordReset('yok@example.com'),
    ).resolves.toEqual({ ok: true });
    await flush();
    expect(mail.sendPasswordReset).not.toHaveBeenCalled();
  });

  it('requestPasswordReset emails a link for a known active dealer', async () => {
    const prisma = makePrisma({ a: row() });
    const mail = makeMail();
    const svc = makeService(prisma, { mail });

    await svc.requestPasswordReset('firma@example.com');
    await flush();

    expect(mail.sendPasswordReset).toHaveBeenCalledTimes(1);
    const arg = (mail.sendPasswordReset as jest.Mock).mock.calls[0][0];
    expect(arg.to).toBe('firma@example.com');
    expect(arg.resetUrl).toContain('/sifre-sifirla?token=');
  });

  it('requestPasswordReset does NOT email an inactive account', async () => {
    const prisma = makePrisma({ a: row({ isActive: false }) });
    const mail = makeMail();
    const svc = makeService(prisma, { mail });

    await svc.requestPasswordReset('firma@example.com');
    await flush();
    expect(mail.sendPasswordReset).not.toHaveBeenCalled();
  });

  it('resetPassword with a valid token updates password and clears the token', async () => {
    const raw = 'a'.repeat(64);
    const hash = createHash('sha256').update(raw).digest('hex');
    const r = row({
      passwordResetTokenHash: hash,
      passwordResetExpiresAt: new Date(Date.now() + 60_000),
    });
    const prisma = makePrisma({ a: r });
    const svc = makeService(prisma);

    await expect(svc.resetPassword(raw, 'brand-new-pass')).resolves.toEqual({
      ok: true,
    });
    expect(r.passwordResetTokenHash).toBeNull();
    expect(r.passwordResetExpiresAt).toBeNull();
    expect(r.mustChangePassword).toBe(false);
    // oturum sürümü +1 → reset öncesi JWT'ler geçersizleşir
    expect(r.tokenVersion).toBe(1);
    // yeni hash ile doğrulanır
    await expect(bcrypt.compare('brand-new-pass', r.passwordHash)).resolves.toBe(
      true,
    );
  });

  it('resetPassword is single-use: a second submit with the same token 400s', async () => {
    const raw = 'd'.repeat(64);
    const hash = createHash('sha256').update(raw).digest('hex');
    const prisma = makePrisma({
      a: row({
        passwordResetTokenHash: hash,
        passwordResetExpiresAt: new Date(Date.now() + 60_000),
      }),
    });
    const svc = makeService(prisma);

    await expect(svc.resetPassword(raw, 'brand-new-pass')).resolves.toEqual({
      ok: true,
    });
    // token null'landı → aynı token tekrar reddedilir
    await expect(
      svc.resetPassword(raw, 'another-pass'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('requestPasswordReset applies an email cooldown (no second mail within window)', async () => {
    const prisma = makePrisma({ a: row() });
    const mail = makeMail();
    const svc = makeService(prisma, { mail });

    await svc.requestPasswordReset('firma@example.com');
    await flush();
    await svc.requestPasswordReset('firma@example.com');
    await flush();

    // İkinci istek cooldown içinde → yeni mail yok.
    expect(mail.sendPasswordReset).toHaveBeenCalledTimes(1);
  });

  it('resetPassword rejects an expired token', async () => {
    const raw = 'b'.repeat(64);
    const hash = createHash('sha256').update(raw).digest('hex');
    const prisma = makePrisma({
      a: row({
        passwordResetTokenHash: hash,
        passwordResetExpiresAt: new Date(Date.now() - 1000),
      }),
    });
    const svc = makeService(prisma);

    await expect(svc.resetPassword(raw, 'brand-new-pass')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('resetPassword rejects an unknown token', async () => {
    const prisma = makePrisma({ a: row() });
    const svc = makeService(prisma);

    await expect(
      svc.resetPassword('nope', 'brand-new-pass'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('validateResetToken reflects validity/expiry', async () => {
    const raw = 'c'.repeat(64);
    const hash = createHash('sha256').update(raw).digest('hex');
    const prisma = makePrisma({
      a: row({
        passwordResetTokenHash: hash,
        passwordResetExpiresAt: new Date(Date.now() + 60_000),
      }),
    });
    const svc = makeService(prisma);

    await expect(svc.validateResetToken(raw)).resolves.toEqual({ valid: true });
    await expect(svc.validateResetToken('wrong')).resolves.toEqual({
      valid: false,
    });
  });
});

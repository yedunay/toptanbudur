import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';
import { AdminNotifierService } from '../mail/admin-notifier.service';
import { BayiNumberService } from '../receipts/bayi-number.service';
import { DealerService } from './dealer.service';

/**
 * Bug #9 — bayilik onayı sonrası geçici parola ile login akışı kırılmıştı.
 * Bu spec dosyası onay akışının dört kritik senaryosunu kapsar:
 *   A) Yeni customer (email DB'de yok) → upsert.create dalı, passwordHash set.
 *   B) Existing customer (email DB'de var) → upsert.update dalı,
 *      passwordHash + mustChangePassword GÜNCELLENİYOR (regression guard).
 *   C) Email farklı case ile başvuruldu → onay akışı normalize edip aynı
 *      kanonik formu kullanıyor, login lookup'u eşleşiyor.
 *   D) Email başında/sonunda boşluk → normalize sonrası lookup başarılı.
 *
 * Mock'lanan tek dış bağımlılık Prisma + bcrypt davranışı; AuditService ve
 * MailService no-op stub'lardır (yan etki testin kapsamı dışında).
 */

interface UpsertCall {
  where: { email: string };
  update: Record<string, unknown>;
  create: Record<string, unknown>;
}

interface MockState {
  customerByEmail: Record<
    string,
    { id: string; mustChangePassword?: boolean; isActive?: boolean } | undefined
  >;
  upsertCalls: UpsertCall[];
  applicationStatusUpdates: Array<{ id: string; status: string }>;
  customerCreated?: { id: string; email: string };
}

const APP_ID = 'app-1';

function buildApplication(overrides: Partial<{ email: string }> = {}) {
  return {
    id: APP_ID,
    name: 'Test Bayi',
    email: overrides.email ?? 'firma@example.com',
    phone: '5551112233',
    company: null,
    message: null,
    vergiDairesi: 'Kadıköy',
    status: 'PENDING',
    createdAt: new Date(),
  };
}

function makeMocks(application: ReturnType<typeof buildApplication>): {
  state: MockState;
  prisma: PrismaService;
  audit: AuditService;
  mail: MailService;
  adminNotifier: AdminNotifierService;
  bayiNumbers: BayiNumberService;
} {
  const state: MockState = {
    customerByEmail: {},
    upsertCalls: [],
    applicationStatusUpdates: [],
  };

  const prisma = {
    dealerApplication: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
        where.id === application.id ? application : null,
      ),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: { status: string };
        }) => {
          state.applicationStatusUpdates.push({
            id: where.id,
            status: data.status,
          });
          return { ...application, status: data.status };
        },
      ),
    },
    form: {
      findUnique: jest.fn(async () => null),
      findFirst: jest.fn(async () => null),
      update: jest.fn(),
    },
    user: {
      findUnique: jest.fn(async () => null),
    },
    customer: {
      findUnique: jest.fn(
        async ({ where }: { where: { email: string } }) =>
          state.customerByEmail[where.email] ?? null,
      ),
      upsert: jest.fn(async (call: UpsertCall) => {
        state.upsertCalls.push(call);
        const existing = state.customerByEmail[call.where.email];
        if (existing) {
          // simulate update branch
          return {
            id: existing.id,
            email: call.where.email,
            name: (call.update.name as string) ?? '',
            phone: (call.update.phone as string) ?? null,
          };
        }
        const created = {
          id: 'new-customer-1',
          email: (call.create.email as string) ?? call.where.email,
          name: (call.create.name as string) ?? '',
          phone: (call.create.phone as string) ?? null,
        };
        state.customerCreated = { id: created.id, email: created.email };
        state.customerByEmail[created.email] = { id: created.id };
        return created;
      }),
    },
    $transaction: jest.fn(async (operations: Array<Promise<unknown>>) =>
      Promise.all(operations),
    ),
  } as unknown as PrismaService;

  const audit = { log: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
  const mail = {
    sendDealerWelcome: jest.fn().mockResolvedValue(undefined),
  } as unknown as MailService;
  const adminNotifier = {
    resolveAdminEmails: jest.fn().mockResolvedValue([]),
    resolveDefaultTenantId: jest.fn().mockResolvedValue(null),
    notifyAdmins: jest.fn().mockResolvedValue(undefined),
  } as unknown as AdminNotifierService;

  const bayiNumbers = {
    ensureForCustomer: jest.fn().mockResolvedValue('BN-0001'),
    generateBayiNo: jest.fn().mockResolvedValue('BN-0001'),
  } as unknown as BayiNumberService;

  return { state, prisma, audit, mail, adminNotifier, bayiNumbers };
}

describe('DealerService.approveApplication — bug #9 regression', () => {
  const actor = { id: 'admin-1', tenantId: 'tenant-1' };

  it('A) creates a new Customer with hashed password when email is unseen', async () => {
    // Arrange
    const application = buildApplication();
    const { state, prisma, audit, mail, adminNotifier, bayiNumbers } =
      makeMocks(application);
    const svc = new DealerService(prisma, audit, mail, adminNotifier, bayiNumbers);

    // Act
    const result = await svc.approveApplication(APP_ID, actor);

    // Assert
    expect(state.upsertCalls).toHaveLength(1);
    const call = state.upsertCalls[0];
    expect(call.where.email).toBe('firma@example.com');
    expect(typeof call.create.passwordHash).toBe('string');

    // The one-time password returned to admin must verify against the hash.
    const oneTime = (result as { data: { oneTimePassword: string } }).data
      .oneTimePassword;
    const hashUsed = call.create.passwordHash as string;
    await expect(bcrypt.compare(oneTime, hashUsed)).resolves.toBe(true);
  });

  it('B) on EXISTING customer, upsert.update refreshes passwordHash + mustChangePassword (root cause of bug #9)', async () => {
    // Arrange
    const application = buildApplication();
    const { state, prisma, audit, mail, adminNotifier, bayiNumbers } =
      makeMocks(application);
    // Service hardened (security): admin can only refresh credentials of a
    // pre-registered (mustChangePassword=true) customer. An already-active
    // customer must reset via self-service flow.
    state.customerByEmail['firma@example.com'] = {
      id: 'existing-1',
      mustChangePassword: true,
      isActive: false,
    };
    const svc = new DealerService(prisma, audit, mail, adminNotifier, bayiNumbers);

    // Act
    const result = await svc.approveApplication(APP_ID, actor);

    // Assert — update branch executed with refreshed credentials.
    const call = state.upsertCalls[0];
    expect(call.update.passwordHash).toBeDefined();
    expect(call.update.mustChangePassword).toBe(true);

    // The hash in update must match the returned one-time password — this is
    // the regression that broke login.
    const oneTime = (result as { data: { oneTimePassword: string } }).data
      .oneTimePassword;
    const hashUsed = call.update.passwordHash as string;
    await expect(bcrypt.compare(oneTime, hashUsed)).resolves.toBe(true);
  });

  it('C) normalizes uppercased application email before upsert/lookup', async () => {
    // Arrange
    const application = buildApplication({ email: 'Firma@Example.COM' });
    const { state, prisma, audit, mail, adminNotifier, bayiNumbers } =
      makeMocks(application);
    const svc = new DealerService(prisma, audit, mail, adminNotifier, bayiNumbers);

    // Act
    await svc.approveApplication(APP_ID, actor);

    // Assert — Postgres unique index is case-sensitive; we must persist the
    // canonical lowercase form so storefront login can find the row.
    const call = state.upsertCalls[0];
    expect(call.where.email).toBe('firma@example.com');
    expect(call.create.email).toBe('firma@example.com');
  });

  it('D) trims whitespace around the application email', async () => {
    // Arrange
    const application = buildApplication({ email: '  firma@example.com  ' });
    const { state, prisma, audit, mail, adminNotifier, bayiNumbers } =
      makeMocks(application);
    const svc = new DealerService(prisma, audit, mail, adminNotifier, bayiNumbers);

    // Act
    await svc.approveApplication(APP_ID, actor);

    // Assert
    const call = state.upsertCalls[0];
    expect(call.where.email).toBe('firma@example.com');
    expect(call.create.email).toBe('firma@example.com');
  });
});

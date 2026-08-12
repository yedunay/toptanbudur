import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { PasswordCryptoService } from '../../vault/password-crypto.service';
import { MailService } from '../../mail/mail.service';
import { DealerService } from '../../dealer/dealer.service';
import { CariBalanceService } from '../../cari-balance/cari-balance.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { BayiNumberService } from '../../receipts/bayi-number.service';
import { AdminCustomersService } from './admin-customers.service';

const makeAudit = (): AuditService =>
  ({
    log: jest.fn().mockResolvedValue(undefined),
  }) as unknown as AuditService;

const makeCrypto = (overrides: Partial<PasswordCryptoService> = {}): PasswordCryptoService =>
  ({
    seal: jest.fn().mockReturnValue('sealed-blob'),
    open: jest.fn().mockReturnValue('plain-secret'),
    ...overrides,
  }) as unknown as PasswordCryptoService;

const makeMail = (): MailService =>
  ({
    sendDealerApprovalEmail: jest.fn().mockResolvedValue(undefined),
  }) as unknown as MailService;

const makeDealer = (): DealerService =>
  ({
    approveApplication: jest.fn().mockResolvedValue(undefined),
  }) as unknown as DealerService;

const makeCariBalance = (): CariBalanceService =>
  ({
    adjustBalanceByAdmin: jest.fn().mockResolvedValue(undefined),
    listLedgerForCustomer: jest.fn().mockResolvedValue({ data: [], meta: {} }),
  }) as unknown as CariBalanceService;

const makeNotifications = (): NotificationsService =>
  ({
    emit: jest.fn().mockResolvedValue(undefined),
  }) as unknown as NotificationsService;

const makeBayiNumbers = (): BayiNumberService =>
  ({
    ensureForCustomer: jest.fn().mockResolvedValue('BN-0001'),
    generateBayiNo: jest.fn().mockResolvedValue('BN-0001'),
  }) as unknown as BayiNumberService;

const makePrisma = (customer: unknown): PrismaService =>
  ({
    customer: {
      findUnique: jest.fn().mockResolvedValue(customer),
      update: jest.fn(),
      delete: jest.fn(),
      upsert: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
    },
    order: {
      groupBy: jest.fn().mockResolvedValue([]),
    },
  }) as unknown as PrismaService;

describe('AdminCustomersService.getPassword', () => {
  it('throws NotFoundException when customer does not exist', async () => {
    // Arrange
    const svc = new AdminCustomersService(
      makePrisma(null),
      makeAudit(),
      makeCrypto(),
      makeMail(),
      makeDealer(),
      makeCariBalance(),
      makeNotifications(),
      makeBayiNumbers(),
    );

    // Act + Assert
    await expect(
      svc.getPassword('missing-id', { id: 'admin1', tenantId: 't1' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns decrypted plaintext when encryptedPassword is set', async () => {
    // Arrange
    const customer = {
      id: 'c1',
      email: 'musteri@example.com',
      encryptedPassword: 'sealed-blob',
    };
    const open = jest.fn().mockReturnValue('hunter2');
    const audit = makeAudit();
    const svc = new AdminCustomersService(
      makePrisma(customer),
      audit,
      makeCrypto({ open }),
      makeMail(),
      makeDealer(),
      makeCariBalance(),
      makeNotifications(),
      makeBayiNumbers(),
    );

    // Act
    const result = await svc.getPassword('c1', {
      id: 'admin1',
      tenantId: 't1',
    });

    // Assert
    expect(result.success).toBe(true);
    expect(result.data.password).toBe('hunter2');
    expect(result.data.hasEncryptedPassword).toBe(true);
    expect(open).toHaveBeenCalledWith('sealed-blob');
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CUSTOMER_PASSWORD_VIEWED',
        target: 'c1',
        actorId: 'admin1',
        tenantId: 't1',
      }),
    );
    // Plaintext must NEVER appear in audit metadata.
    const metadata = (audit.log as jest.Mock).mock.calls[0][0].metadata;
    expect(JSON.stringify(metadata)).not.toContain('hunter2');
  });

  it('returns null password when encryptedPassword is missing (legacy customer)', async () => {
    // Arrange — sealed kopya yok; UI "şifre kayıtlı değil" akışına yönlenir.
    const customer = {
      id: 'c2',
      email: 'eski@example.com',
      encryptedPassword: null,
    };
    const open = jest.fn();
    const audit = makeAudit();
    const svc = new AdminCustomersService(
      makePrisma(customer),
      audit,
      makeCrypto({ open }),
      makeMail(),
      makeDealer(),
      makeCariBalance(),
      makeNotifications(),
      makeBayiNumbers(),
    );

    // Act
    const result = await svc.getPassword('c2', {
      id: 'admin1',
      tenantId: 't1',
    });

    // Assert
    expect(result.data.password).toBeNull();
    expect(result.data.hasEncryptedPassword).toBe(false);
    expect(open).not.toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CUSTOMER_PASSWORD_VIEWED' }),
    );
  });

  it('returns null when decrypt throws (corrupt sealed blob)', async () => {
    // Arrange — sealed kayıt var ama anahtar değişmiş / blob bozuk.
    const customer = {
      id: 'c3',
      email: 'bozuk@example.com',
      encryptedPassword: 'corrupt',
    };
    const open = jest.fn().mockImplementation(() => {
      throw new Error('decryption failed');
    });
    const svc = new AdminCustomersService(
      makePrisma(customer),
      makeAudit(),
      makeCrypto({ open }),
      makeMail(),
      makeDealer(),
      makeCariBalance(),
      makeNotifications(),
      makeBayiNumbers(),
    );

    // Act
    const result = await svc.getPassword('c3', {
      id: 'admin1',
      tenantId: 't1',
    });

    // Assert
    expect(result.data.password).toBeNull();
    expect(result.data.hasEncryptedPassword).toBe(false);
  });
});

import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { PasswordCryptoService } from '../../vault/password-crypto.service';
import { MailService } from '../../mail/mail.service';
import { AuditService } from '../../audit/audit.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { CustomerProfileService } from './customer-profile.service';

function makePrisma(customerFindUnique: unknown, addressMock = {}) {
  const base = {
    customer: {
      findUnique: jest.fn().mockResolvedValue(customerFindUnique),
      update: jest.fn(),
      // Varsayılan adres eklendiğinde legacy companyAddress'i senkronlamak için
      // syncCompanyAddressFromDefault tx.customer.updateMany çağırır.
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      findFirst: jest.fn(),
    },
    customerAddress: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
      ...addressMock,
    },
    order: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  // Service refactored createAddress/updateAddress to atomic $transaction blocks;
  // the tx callback receives the same model namespaces, so re-use `base`.
  (base as unknown as { $transaction: jest.Mock }).$transaction = jest
    .fn()
    .mockImplementation(async (fn: (t: typeof base) => Promise<unknown>) => fn(base));
  return base as unknown as PrismaService;
}

const makePasswordCrypto = (): PasswordCryptoService =>
  ({
    seal: jest.fn().mockReturnValue('sealed'),
    open: jest.fn().mockReturnValue('plain'),
  }) as unknown as PasswordCryptoService;

const makeMail = (): MailService =>
  ({ sendPasswordChanged: jest.fn().mockResolvedValue(undefined) }) as unknown as MailService;

const makeAudit = (): AuditService =>
  ({
    record: jest.fn().mockResolvedValue(undefined),
    log: jest.fn().mockResolvedValue(undefined),
  }) as unknown as AuditService;

const makeNotifications = (): NotificationsService =>
  ({
    emit: jest.fn().mockResolvedValue(undefined),
  }) as unknown as NotificationsService;

describe('CustomerProfileService', () => {
  describe('getProfile', () => {
    it('throws NotFoundException when customer not found', async () => {
      const svc = new CustomerProfileService(makePrisma(null), makePasswordCrypto(), makeMail(), makeAudit(), makeNotifications());
      await expect(svc.getProfile('c1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns customer profile', async () => {
      const customer = { id: 'c1', email: 'a@b.com', name: 'Ali', phone: null, createdAt: new Date() };
      const svc = new CustomerProfileService(makePrisma(customer), makePasswordCrypto(), makeMail(), makeAudit(), makeNotifications());
      const result = await svc.getProfile('c1');
      expect(result.success).toBe(true);
      expect(result.data.email).toBe('a@b.com');
    });
  });

  describe('changePassword', () => {
    it('throws UnauthorizedException on wrong current password', async () => {
      const hash = await bcrypt.hash('correct', 10);
      const customer = { id: 'c1', passwordHash: hash };
      const svc = new CustomerProfileService(makePrisma(customer), makePasswordCrypto(), makeMail(), makeAudit(), makeNotifications());
      await expect(
        svc.changePassword('c1', { currentPassword: 'wrong', newPassword: 'newpass123' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('returns success on correct current password', async () => {
      const hash = await bcrypt.hash('correct', 10);
      const prisma = makePrisma({ id: 'c1', passwordHash: hash });
      (prisma.customer.update as jest.Mock).mockResolvedValue({});
      const crypto = makePasswordCrypto();
      const svc = new CustomerProfileService(prisma, crypto, makeMail(), makeAudit(), makeNotifications());
      const result = await svc.changePassword('c1', {
        currentPassword: 'correct',
        newPassword: 'newpass123',
      });
      expect(result.success).toBe(true);
      // Yeni şifre değiştiğinde sealed kopya da güncellenmeli.
      expect(crypto.seal).toHaveBeenCalledWith('newpass123');
    });
  });

  describe('listAddresses', () => {
    it('orders default first, then createdAt desc', async () => {
      const prisma = makePrisma(null, {
        findMany: jest.fn().mockResolvedValue([
          { id: 'a1', isDefault: true, title: 'Ev', createdAt: new Date('2026-01-01') },
          { id: 'a2', isDefault: false, title: 'İş', createdAt: new Date('2026-02-01') },
        ]),
      });
      const svc = new CustomerProfileService(prisma, makePasswordCrypto(), makeMail(), makeAudit(), makeNotifications());
      const result = await svc.listAddresses('c1');
      expect(result.success).toBe(true);
      expect(prisma.customerAddress.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { customerId: 'c1' },
          orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
        }),
      );
      expect(result.data).toHaveLength(2);
    });
  });

  describe('createAddress', () => {
    it('creates an address scoped to customerId', async () => {
      const prisma = makePrisma(null, {
        create: jest
          .fn()
          .mockResolvedValue({ id: 'a1', title: 'Ev', isDefault: false }),
      });
      const svc = new CustomerProfileService(prisma, makePasswordCrypto(), makeMail(), makeAudit(), makeNotifications());
      const result = await svc.createAddress('c1', {
        title: 'Ev',
        fullName: 'Ali Veli',
        line1: 'Sokak No 1',
        city: 'İstanbul',
      });
      expect(result.success).toBe(true);
      expect(prisma.customerAddress.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            customerId: 'c1',
            title: 'Ev',
            fullName: 'Ali Veli',
            line1: 'Sokak No 1',
            city: 'İstanbul',
          }),
        }),
      );
    });

    it('unsets other defaults when isDefault=true', async () => {
      const prisma = makePrisma(null, {
        create: jest
          .fn()
          .mockResolvedValue({ id: 'a1', title: 'Ev', isDefault: true }),
      });
      const svc = new CustomerProfileService(prisma, makePasswordCrypto(), makeMail(), makeAudit(), makeNotifications());
      await svc.createAddress('c1', {
        title: 'Ev',
        fullName: 'Ali Veli',
        line1: 'Sokak No 1',
        city: 'İstanbul',
        isDefault: true,
      });
      expect(prisma.customerAddress.updateMany).toHaveBeenCalledWith({
        where: { customerId: 'c1' },
        data: { isDefault: false },
      });
    });
  });

  describe('updateAddress (ownership)', () => {
    it('throws NotFoundException when address belongs to another customer', async () => {
      const prisma = makePrisma(null, {
        findFirst: jest.fn().mockResolvedValue(null),
      });
      const svc = new CustomerProfileService(prisma, makePasswordCrypto(), makeMail(), makeAudit(), makeNotifications());
      await expect(
        svc.updateAddress('c1', 'addr-of-c2', { title: 'Ev' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      // Ownership scoped query is the gate.
      expect(prisma.customerAddress.findFirst).toHaveBeenCalledWith({
        where: { id: 'addr-of-c2', customerId: 'c1' },
        select: { id: true },
      });
      // Mutation must not happen if ownership fails.
      expect(prisma.customerAddress.update).not.toHaveBeenCalled();
    });
  });

  describe('deleteAddress', () => {
    it('throws NotFoundException when address not found', async () => {
      const svc = new CustomerProfileService(
        makePrisma({ id: 'c1', passwordHash: '' }),
        makePasswordCrypto(),
        makeMail(),
        makeAudit(),
        makeNotifications(),
      );
      await expect(svc.deleteAddress('c1', 'addr-bad')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws NotFoundException when address belongs to another customer', async () => {
      const prisma = makePrisma(null, {
        findFirst: jest.fn().mockResolvedValue(null),
      });
      const svc = new CustomerProfileService(prisma, makePasswordCrypto(), makeMail(), makeAudit(), makeNotifications());
      await expect(
        svc.deleteAddress('c1', 'addr-of-c2'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.customerAddress.delete).not.toHaveBeenCalled();
    });

    it('deletes an address owned by the customer', async () => {
      const prisma = makePrisma(null, {
        findFirst: jest.fn().mockResolvedValue({ id: 'a1' }),
        delete: jest.fn().mockResolvedValue({ id: 'a1' }),
      });
      const svc = new CustomerProfileService(prisma, makePasswordCrypto(), makeMail(), makeAudit(), makeNotifications());
      const result = await svc.deleteAddress('c1', 'a1');
      expect(result.success).toBe(true);
      expect(prisma.customerAddress.delete).toHaveBeenCalledWith({
        where: { id: 'a1' },
      });
    });
  });

  describe('setDefaultAddress', () => {
    it('throws NotFoundException when address not found', async () => {
      const prisma = makePrisma(null, {
        findFirst: jest.fn().mockResolvedValue(null),
      });
      const svc = new CustomerProfileService(prisma, makePasswordCrypto(), makeMail(), makeAudit(), makeNotifications());
      await expect(
        svc.setDefaultAddress('c1', 'missing'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('runs unset-others + set-this inside a transaction', async () => {
      const updateMany = jest.fn().mockResolvedValue({ count: 2 });
      const update = jest
        .fn()
        .mockResolvedValue({ id: 'a1', title: 'Ev', isDefault: true, updatedAt: new Date() });
      const tx = {
        customerAddress: { updateMany, update },
      };
      const prisma = makePrisma(null, {
        findFirst: jest.fn().mockResolvedValue({ id: 'a1' }),
      }) as unknown as PrismaService & {
        $transaction: jest.Mock;
      };
      (prisma as unknown as { $transaction: jest.Mock }).$transaction = jest
        .fn()
        .mockImplementation(async (fn: (t: typeof tx) => Promise<unknown>) =>
          fn(tx),
        );

      const svc = new CustomerProfileService(prisma, makePasswordCrypto(), makeMail(), makeAudit(), makeNotifications());
      const result = await svc.setDefaultAddress('c1', 'a1');

      expect(result.success).toBe(true);
      expect(
        (prisma as unknown as { $transaction: jest.Mock }).$transaction,
      ).toHaveBeenCalledTimes(1);
      // Unset others — restricted to this customer, excluding target.
      expect(updateMany).toHaveBeenCalledWith({
        where: { customerId: 'c1', NOT: { id: 'a1' } },
        data: { isDefault: false },
      });
      // Set the target address as default.
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'a1' },
          data: { isDefault: true },
        }),
      );
    });
  });
});

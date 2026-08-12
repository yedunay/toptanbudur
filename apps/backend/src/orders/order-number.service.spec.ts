import { OrderNumberService } from './order-number.service';
import type { PrismaService } from '../prisma/prisma.service';

interface FakePrisma {
  $queryRaw: jest.Mock;
}

const ORDER_NO_REGEX = /^61\d{6,8}$/;

function buildService(queryImpl: () => Promise<unknown>): {
  service: OrderNumberService;
  prisma: FakePrisma;
} {
  // Service uses tagged template `$queryRaw`SELECT nextval(...)``; jest mock is
  // invoked with (TemplateStringsArray, ...values). queryImpl ignores both.
  const prisma: FakePrisma = {
    $queryRaw: jest.fn(queryImpl),
  };
  const service = new OrderNumberService(
    prisma as unknown as PrismaService,
  );
  return { service, prisma };
}

describe('OrderNumberService', () => {
  it('generates a number that matches the public 61xxxxxx format', async () => {
    const { service } = buildService(async () => [{ nextval: 1 }]);

    const orderNo = await service.generateHumanOrderNo();

    expect(orderNo).toMatch(ORDER_NO_REGEX);
    expect(orderNo).toBe('61000001');
  });

  it('pads small sequence values to six digits', async () => {
    const { service } = buildService(async () => [{ nextval: 42 }]);

    const orderNo = await service.generateHumanOrderNo();

    expect(orderNo).toBe('61000042');
    expect(orderNo).toMatch(ORDER_NO_REGEX);
  });

  it('keeps natural width when sequence exceeds six digits', async () => {
    const { service } = buildService(async () => [
      { nextval: 1234567 },
    ]);

    const orderNo = await service.generateHumanOrderNo();

    expect(orderNo).toBe('611234567');
    expect(orderNo).toMatch(ORDER_NO_REGEX);
  });

  it('handles bigint sequence values', async () => {
    const { service } = buildService(async () => [
      { nextval: 99999999n },
    ]);

    const orderNo = await service.generateHumanOrderNo();

    expect(orderNo).toBe('6199999999');
    expect(orderNo).toMatch(ORDER_NO_REGEX);
  });

  it('throws when sequence returns no value', async () => {
    const { service } = buildService(async () => []);

    await expect(service.generateHumanOrderNo()).rejects.toThrow(
      /order_human_no_seq/,
    );
  });
});

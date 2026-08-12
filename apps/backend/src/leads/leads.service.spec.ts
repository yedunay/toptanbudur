import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { LeadsService } from './leads.service';

const makePrisma = (leadCreate: jest.Mock) =>
  ({ lead: { create: leadCreate } }) as unknown as PrismaService;

const makeAudit = (): AuditService =>
  ({
    record: jest.fn().mockResolvedValue(undefined),
    log: jest.fn().mockResolvedValue(undefined),
  }) as unknown as AuditService;

describe('LeadsService', () => {
  it('creates a lead and returns its id', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'lead1' });
    const svc = new LeadsService(makePrisma(create), makeAudit());

    const result = await svc.create(
      { ad: 'Ali', telefon: '+905550000000' },
      '1.2.3.4',
    );

    expect(result.success).toBe(true);
    expect(result.data.id).toBe('lead1');
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ad: 'Ali',
          telefon: '+905550000000',
          ip: '1.2.3.4',
        }),
      }),
    );
  });

  it('stores null ip when ip is undefined', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'lead2' });
    const svc = new LeadsService(makePrisma(create), makeAudit());
    await svc.create({ ad: 'Veli', telefon: '05550000000' }, undefined);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ ip: null }),
      }),
    );
  });
});

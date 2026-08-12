import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { AppSetting } from '@prisma/client';
import { AppSettingsService } from './app-settings.service';

type SettingOverrides = Partial<AppSetting>;

const buildSetting = (overrides: SettingOverrides): AppSetting =>
  ({
    key: 'pricing.kdvRate',
    value: '20',
    type: 'number',
    category: 'pricing',
    label: 'KDV',
    description: null,
    minValue: null,
    maxValue: null,
    updatedAt: new Date(0),
    updatedBy: null,
    ...overrides,
  }) as AppSetting;

describe('AppSettingsService.set — structural-config guard (#6)', () => {
  const actor = { id: 'admin-1', tenantId: 'tenant-1' };

  const makeService = (existing: AppSetting | null) => {
    const update = jest.fn().mockResolvedValue(
      buildSetting({ ...(existing ?? {}), value: '21' }),
    );
    const prisma = {
      appSetting: {
        findUnique: jest.fn().mockResolvedValue(existing),
        update,
      },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const service = new AppSettingsService(
      prisma as never,
      audit as never,
    );
    return { service, update, audit };
  };

  it('updates a UI-manageable scalar setting', async () => {
    const { service, update } = makeService(
      buildSetting({ key: 'pricing.kdvRate', category: 'pricing' }),
    );

    await service.set('pricing.kdvRate', '21', actor);

    expect(update).toHaveBeenCalledTimes(1);
  });

  it('rejects overwriting a dealer XML JSON config by category', async () => {
    const { service, update } = makeService(
      buildSetting({
        key: 'xml.dealer.cust-9',
        category: 'xml-dealer',
        type: 'string',
        value: '{"enabled":true}',
      }),
    );

    await expect(
      service.set('xml.dealer.cust-9', 'garbage', actor),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects a dealer key even if its category metadata is tampered', async () => {
    const { service, update } = makeService(
      buildSetting({
        key: 'xml.dealer.cust-9',
        category: 'pricing', // spoofed category — prefix guard still blocks
        type: 'string',
      }),
    );

    await expect(
      service.set('xml.dealer.cust-9', 'garbage', actor),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects overwriting a protected-category setting', async () => {
    const { service, update } = makeService(
      buildSetting({ key: 'kategori.mapping', category: 'kategori' }),
    );

    await expect(
      service.set('kategori.mapping', 'evil-id', actor),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(update).not.toHaveBeenCalled();
  });

  it('throws NotFound for unknown keys', async () => {
    const { service } = makeService(null);

    await expect(service.set('nope', '1', actor)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

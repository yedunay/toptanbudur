import { ConfigService } from '@nestjs/config';
import { SupportMessagesService } from './support-messages.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { MailService } from '../mail/mail.service';
import type { AdminNotifierService } from '../mail/admin-notifier.service';
import type { IFileStorage } from '../storage/storage.interface';
import type { NotificationsService } from '../notifications/notifications.service';
import type { ConversationsService } from '../conversations/conversations.service';
import type { AdminOrdersService } from '../admin/orders/admin-orders.service';
import type { AppSettingsService } from '../app-settings/app-settings.service';

/**
 * Unit tests for SupportMessagesService — focus on the new attachment
 * pipeline: magic-byte validation, oversize rejection, count cap, ownership
 * scoping, and signed-URL generation.
 */

const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG_HEADER = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const WEBP_HEADER = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0x00, 0x00, 0x00, 0x00]),
  Buffer.from('WEBP'),
]);

function pad(buf: Buffer, len: number): Buffer {
  if (buf.length >= len) return buf;
  return Buffer.concat([buf, Buffer.alloc(len - buf.length, 0)]);
}

function makeServices(overrides: {
  ticketCreate?: jest.Mock;
  attachmentCreate?: jest.Mock;
  storage?: IFileStorage;
  ticketFindUnique?: jest.Mock;
  ticketFindFirst?: jest.Mock;
  ticketFindMany?: jest.Mock;
  ticketCount?: jest.Mock;
  ticketUpdate?: jest.Mock;
  ticketUpdateMany?: jest.Mock;
  attachmentFindMany?: jest.Mock;
  conversationFindUnique?: jest.Mock;
}) {
  const prisma = {
    supportMessage: {
      create: overrides.ticketCreate ?? jest.fn(),
      findUnique: overrides.ticketFindUnique ?? jest.fn(),
      findFirst: overrides.ticketFindFirst ?? jest.fn(),
      findMany: overrides.ticketFindMany ?? jest.fn(),
      count: overrides.ticketCount ?? jest.fn(),
      update: overrides.ticketUpdate ?? jest.fn(),
      updateMany: overrides.ticketUpdateMany ?? jest.fn(),
      delete: jest.fn(),
    },
    supportMessageAttachment: {
      create: overrides.attachmentCreate ?? jest.fn(),
      findMany: overrides.attachmentFindMany ?? jest.fn(),
    },
    conversation: {
      findUnique: overrides.conversationFindUnique ?? jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    },
  } as unknown as PrismaService;

  const audit = { log: jest.fn(), record: jest.fn() } as unknown as AuditService;
  const mail = {
    sendSupportReply: jest.fn(),
    sendSupportReceived: jest.fn().mockResolvedValue(undefined),
  } as unknown as MailService;
  const adminNotifier = {
    resolveAdminEmails: jest.fn().mockResolvedValue([]),
    resolveDefaultTenantId: jest.fn().mockResolvedValue(null),
    notifyAdmins: jest.fn().mockResolvedValue(undefined),
  } as unknown as AdminNotifierService;
  const config = new ConfigService({});
  const notifications = {
    emit: jest.fn().mockResolvedValue(undefined),
  } as unknown as NotificationsService;
  const conversations = {
    getOrCreateForSupportTicket: jest
      .fn()
      .mockResolvedValue({ id: 'conv-1' }),
    postMessage: jest.fn().mockResolvedValue({ id: 'msg-1' }),
  } as unknown as ConversationsService;
  // İptal oto-onay akışının bağımlılıkları — attachment testleri bu yolu hiç
  // tetiklemez (category 'iptal' değil) ama constructor artık ikisini de ister.
  const adminOrders = {
    updateOrder: jest.fn().mockResolvedValue(undefined),
  } as unknown as AdminOrdersService;
  const appSettings = {
    getString: jest.fn().mockResolvedValue(''),
  } as unknown as AppSettingsService;
  const svc = new SupportMessagesService(
    prisma,
    audit,
    config,
    mail,
    adminNotifier,
    notifications,
    conversations,
    adminOrders,
    appSettings,
    overrides.storage,
  );
  return { svc, prisma };
}

describe('SupportMessagesService — attachments', () => {
  const baseDto = {
    name: 'Ali',
    email: 'ali@example.com',
    body: 'Yardım rica ederim',
    subject: 'Sipariş sorunu',
  };

  it('rejects more than 5 attachments', async () => {
    const { svc } = makeServices({});
    const tooMany = Array.from({ length: 6 }, () => ({
      buffer: pad(JPEG_HEADER, 32),
      originalname: 'a.jpg',
      size: 32,
      mimetype: 'image/jpeg',
    }));
    await expect(
      svc.create(baseDto, { attachments: tooMany }),
    ).rejects.toThrow(/En fazla 5/);
  });

  it('rejects files over 100 MB (foto+video sınırı, 2026-08-02)', async () => {
    const { svc } = makeServices({});
    const big = {
      buffer: pad(JPEG_HEADER, 32),
      originalname: 'big.mp4',
      // size attribute is what we trust for the byte-cap (matches multer
      // which reports the actual stream length)
      size: 101 * 1024 * 1024,
      mimetype: 'video/mp4',
    };
    await expect(
      svc.create(baseDto, { attachments: [big] }),
    ).rejects.toThrow(/100 MB/);
  });

  it('rejects files whose magic bytes are not a known photo/video type', async () => {
    const { svc } = makeServices({});
    const fake = {
      buffer: Buffer.from('PK\u0003\u0004 zip-not-an-image'),
      originalname: 'evil.jpg',
      size: 32,
      mimetype: 'image/jpeg',
    };
    await expect(
      svc.create(baseDto, { attachments: [fake] }),
    ).rejects.toThrow(/Desteklenmeyen dosya türü/);
  });

  it('accepts iPhone HEIC photo and MP4 video (validation passes, storage gate throws)', async () => {
    const { svc } = makeServices({});
    const ftyp = (brand: string) => {
      const b = Buffer.alloc(32);
      b.writeUInt32BE(24, 0);
      b.write('ftyp', 4, 'latin1');
      b.write(brand, 8, 'latin1');
      return b;
    };
    const heic = {
      buffer: ftyp('heic'),
      originalname: 'IMG_0001.heic',
      size: 32,
      mimetype: 'image/heic',
    };
    const mp4 = {
      buffer: ftyp('isom'),
      originalname: 'video.mp4',
      size: 32,
      mimetype: 'video/mp4',
    };
    // Tür doğrulamasını GEÇTİKLERİNİN kanıtı: hata artık tür reddi değil,
    // bir sonraki kapı olan "storage yapılandırılmamış".
    await expect(
      svc.create(baseDto, { attachments: [heic, mp4] }),
    ).rejects.toThrow(/depolama servisi/);
  });

  it('throws when attachments are present but no storage driver is wired', async () => {
    const { svc } = makeServices({});
    const valid = {
      buffer: pad(JPEG_HEADER, 32),
      originalname: 'ok.jpg',
      size: 32,
      mimetype: 'image/jpeg',
    };
    await expect(
      svc.create(baseDto, { attachments: [valid] }),
    ).rejects.toThrow(/depolama servisi/);
  });

  it('uploads valid jpeg/png/webp attachments and persists them', async () => {
    const ticketCreate = jest.fn().mockResolvedValue({ id: 'tkt1' });
    const attachmentCreate = jest.fn().mockResolvedValue({ id: 'att' });
    const upload = jest.fn().mockResolvedValue({ url: '/x', key: 'x' });
    const storage: IFileStorage = {
      upload,
      getSignedUrl: jest.fn(),
      getPublicUrl: jest.fn(),
      delete: jest.fn(),
      read: jest.fn(),
    };
    const { svc } = makeServices({
      ticketCreate,
      attachmentCreate,
      storage,
    });

    await svc.create(baseDto, {
      attachments: [
        {
          buffer: pad(JPEG_HEADER, 64),
          originalname: 'a.jpg',
          size: 64,
          mimetype: 'image/jpeg',
        },
        {
          buffer: pad(PNG_HEADER, 64),
          originalname: 'b.png',
          size: 64,
          mimetype: 'image/png',
        },
        {
          buffer: pad(WEBP_HEADER, 64),
          originalname: 'c.webp',
          size: 64,
          mimetype: 'image/webp',
        },
      ],
    });

    expect(ticketCreate).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenCalledTimes(3);
    expect(attachmentCreate).toHaveBeenCalledTimes(3);
    const keys = upload.mock.calls.map((c) => c[0] as string);
    expect(keys.every((k) => k.startsWith('support/tkt1/'))).toBe(true);
    expect(keys.some((k) => k.endsWith('.jpg'))).toBe(true);
    expect(keys.some((k) => k.endsWith('.png'))).toBe(true);
    expect(keys.some((k) => k.endsWith('.webp'))).toBe(true);
  });

  it('findOneForCustomer returns NotFound for foreign tickets', async () => {
    const ticketFindFirst = jest.fn().mockResolvedValue(null);
    const { svc } = makeServices({ ticketFindFirst });
    await expect(
      svc.findOneForCustomer('tkt1', 'other-customer'),
    ).rejects.toThrow(/ticket not found/);
    expect(ticketFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'tkt1', customerId: 'other-customer' },
      }),
    );
  });

  it('attaches signed URLs to listed attachments', async () => {
    const item = {
      id: 'tkt1',
      createdAt: new Date('2024-01-01'),
      attachments: [
        {
          id: 'a1',
          filename: 'a.jpg',
          mimetype: 'image/jpeg',
          size: 64,
          storageKey: 'support/tkt1/a.jpg',
          createdAt: new Date(),
          // 30 günlük R2 saklama: purge edilmemiş ek → signed URL üretilir.
          purgedAt: null,
        },
      ],
    };
    const ticketFindFirst = jest.fn().mockResolvedValue(item);
    const getSignedUrl = jest
      .fn()
      .mockResolvedValue('/uploads/support/tkt1/a.jpg');
    const storage: IFileStorage = {
      upload: jest.fn(),
      getSignedUrl,
      getPublicUrl: jest.fn(),
      delete: jest.fn(),
      read: jest.fn(),
    };
    const { svc } = makeServices({ ticketFindFirst, storage });

    const res = await svc.findOneForCustomer('tkt1', 'cust1');
    expect(res.success).toBe(true);
    const data = res.data as {
      attachments: Array<{
        url: string | null;
        purged: boolean;
        storageKey?: string;
      }>;
    };
    expect(data.attachments[0].url).toBe('/uploads/support/tkt1/a.jpg');
    // Purge edilmemiş ek: purged=false, URL dolu.
    expect(data.attachments[0].purged).toBe(false);
    // #H-2 — storageKey customer-facing response'tan strip ediliyor;
    // signed URL `url` alanı üzerinden expose edilir.
    expect(data.attachments[0].storageKey).toBeUndefined();
    expect(getSignedUrl).toHaveBeenCalledWith('support/tkt1/a.jpg', 600);
  });
});

describe('SupportMessagesService — closeForCustomer (müşteri kendi talebini kapatır)', () => {
  it('throws NotFound when the ticket belongs to another customer', async () => {
    const ticketFindFirst = jest.fn().mockResolvedValue(null);
    const ticketUpdate = jest.fn();
    const { svc } = makeServices({ ticketFindFirst, ticketUpdate });

    await expect(
      svc.closeForCustomer('tkt1', 'other-customer'),
    ).rejects.toThrow(/not found/);
    // Sahiplik filtresi sorguya yansımalı.
    expect(ticketFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'tkt1', customerId: 'other-customer' },
      }),
    );
    // Sahiplik doğrulanamadıysa hiçbir yazma yapılmamalı.
    expect(ticketUpdate).not.toHaveBeenCalled();
  });

  it('is idempotent — already ARCHIVED ticket is not written again', async () => {
    const ticketFindFirst = jest
      .fn()
      .mockResolvedValue({ id: 'tkt1', status: 'ARCHIVED' });
    const ticketUpdate = jest.fn();
    const { svc } = makeServices({ ticketFindFirst, ticketUpdate });

    const res = await svc.closeForCustomer('tkt1', 'cust1');
    expect(res).toEqual({
      success: true,
      data: { closed: true, alreadyClosed: true, id: 'tkt1' },
    });
    expect(ticketUpdate).not.toHaveBeenCalled();
  });

  it('archives an open ticket and reports closed=true', async () => {
    const ticketFindFirst = jest
      .fn()
      .mockResolvedValue({ id: 'tkt1', status: 'NEW' });
    const ticketUpdate = jest
      .fn()
      .mockResolvedValue({ id: 'tkt1', status: 'ARCHIVED' });
    const { svc } = makeServices({ ticketFindFirst, ticketUpdate });

    const res = await svc.closeForCustomer('tkt1', 'cust1');
    expect(ticketUpdate).toHaveBeenCalledWith({
      where: { id: 'tkt1' },
      data: { status: 'ARCHIVED' },
    });
    expect(res.success).toBe(true);
    const data = res.data as { closed: boolean; alreadyClosed: boolean };
    expect(data.closed).toBe(true);
    expect(data.alreadyClosed).toBe(false);
  });
});

describe('SupportMessagesService — autoCloseStaleTickets (2 gün hareketsiz → kapat)', () => {
  it('archives tickets untouched for >2 days, excluding already-archived', async () => {
    const ticketUpdateMany = jest.fn().mockResolvedValue({ count: 3 });
    const { svc } = makeServices({ ticketUpdateMany });

    // Sabit bir "now" ile eşik hesabını deterministik test ediyoruz.
    const now = new Date('2026-06-12T00:00:00.000Z');
    const res = await svc.autoCloseStaleTickets(now);

    expect(ticketUpdateMany).toHaveBeenCalledTimes(1);
    const call = ticketUpdateMany.mock.calls[0][0] as {
      where: { status: { not: string }; updatedAt: { lt: Date } };
      data: { status: string };
    };
    // ARCHIVED hariç tutuluyor.
    expect(call.where.status).toEqual({ not: 'ARCHIVED' });
    // Eşik tam 2 gün öncesi (2026-06-10).
    expect(call.where.updatedAt.lt.toISOString()).toBe(
      '2026-06-10T00:00:00.000Z',
    );
    expect(call.data).toEqual({ status: 'ARCHIVED' });

    expect(res.success).toBe(true);
    const data = res.data as { closed: number; threshold: Date };
    expect(data.closed).toBe(3);
    expect(data.threshold.toISOString()).toBe('2026-06-10T00:00:00.000Z');
  });

  it('returns closed=0 when nothing is stale', async () => {
    const ticketUpdateMany = jest.fn().mockResolvedValue({ count: 0 });
    const { svc } = makeServices({ ticketUpdateMany });

    const res = await svc.autoCloseStaleTickets(
      new Date('2026-06-12T00:00:00.000Z'),
    );
    const data = res.data as { closed: number };
    expect(data.closed).toBe(0);
  });
});

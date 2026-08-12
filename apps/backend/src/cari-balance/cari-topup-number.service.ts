import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const PREFIX = 'C';
const PAD_WIDTH = 6;

type SequenceRow = { nextval: bigint | number | string };

/**
 * Postgres `cari_topup_human_no_seq` sequence'inden bir sonraki değeri çekip
 * `CXXXXXX` formatına getirir (örn. `C000001`). Transaction içinde çağrılmak
 * üzere tasarlandı — opsiyonel `tx` (Prisma transaction client) verilebilir,
 * verilmezse varsayılan PrismaService kullanılır. Sequence pozitif tamsayı
 * üretir; 6 haneyi aşarsa olduğu gibi yazılır (kapasite yıllarca yeterli).
 *
 * Sequence migration tarihinde mevcut `CariTopup` satır sayısı + 1'den başlar;
 * eski kayıtların `humanTopupNo`'su NULL kalsa bile yeni numaralar son
 * talepten devam eder.
 */
@Injectable()
export class CariTopupNumberService {
  constructor(private readonly prisma: PrismaService) {}

  async generateHumanTopupNo(
    tx?: Prisma.TransactionClient,
  ): Promise<string> {
    const client = tx ?? this.prisma;
    const rows = await client.$queryRaw<SequenceRow[]>`SELECT nextval('cari_topup_human_no_seq') AS nextval`;
    const raw = rows[0]?.nextval;
    if (raw === undefined || raw === null) {
      throw new Error('cari_topup_human_no_seq returned no value');
    }
    const num = typeof raw === 'bigint' ? raw.toString() : String(raw);
    return `${PREFIX}${num.padStart(PAD_WIDTH, '0')}`;
  }
}

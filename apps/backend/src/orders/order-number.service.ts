import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const PREFIX = '61';
const PAD_WIDTH = 6;

type SequenceRow = { nextval: bigint | number | string };

/**
 * Postgres `order_human_no_seq` sequence'inden bir sonraki değeri çekip
 * 61xxxxxx formatına getirir. Transaction içinde çağrılmak üzere tasarlandı —
 * argümana isteğe bağlı `tx` (Prisma transaction client) verilebilir; verilmezse
 * varsayılan PrismaService kullanılır. Sequence her zaman pozitif tamsayı
 * üretir; 6 haneyi aşarsa olduğu gibi yazılır (yıllarca kapasitede sorun yok).
 */
@Injectable()
export class OrderNumberService {
  constructor(private readonly prisma: PrismaService) {}

  async generateHumanOrderNo(
    tx?: Prisma.TransactionClient,
  ): Promise<string> {
    const client = tx ?? this.prisma;
    const rows = await client.$queryRaw<SequenceRow[]>`SELECT nextval('order_human_no_seq') AS nextval`;
    const raw = rows[0]?.nextval;
    if (raw === undefined || raw === null) {
      throw new Error('order_human_no_seq returned no value');
    }
    const num = typeof raw === 'bigint' ? raw.toString() : String(raw);
    return `${PREFIX}${num.padStart(PAD_WIDTH, '0')}`;
  }
}

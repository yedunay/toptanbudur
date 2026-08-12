import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const PREFIX = 'MBZ';
const PAD_WIDTH = 6;

type SequenceRow = { nextval: bigint | number | string };

/**
 * Makbuz numarası üretici. Format: `MBZ-{YIL}-{6 hane}` (ör. MBZ-2026-000123).
 *
 * Sipariş ve cari makbuzları TEK ortak `makbuz_no_seq` sequence'ini kullanır
 * (README önerisi: sürekli artan global seri). Yıl yalnızca ön ektir; sayaç
 * yıldan bağımsız global artar — backfill kronolojik sırayla çalıştığı için
 * eski→yeni monoton sayılar üretilir.
 *
 * Transaction içinde çağrılmak üzere tasarlandı: argümana isteğe bağlı `tx`
 * (Prisma transaction client) verilebilir; verilmezse PrismaService kullanılır.
 * Sequence'tan bir numara çekilip insert düşerse o numara "yanar" (sırada delik
 * açar, sorun değil) — order-number.service.ts ile aynı garanti.
 */
@Injectable()
export class ReceiptNumberService {
  constructor(private readonly prisma: PrismaService) {}

  async generateHumanReceiptNo(
    year: number,
    tx?: Prisma.TransactionClient,
  ): Promise<string> {
    const client = tx ?? this.prisma;
    const rows = await client.$queryRaw<SequenceRow[]>`SELECT nextval('makbuz_no_seq') AS nextval`;
    const raw = rows[0]?.nextval;
    if (raw === undefined || raw === null) {
      throw new Error('makbuz_no_seq returned no value');
    }
    const num = typeof raw === 'bigint' ? raw.toString() : String(raw);
    const safeYear = Number.isFinite(year) && year > 0 ? Math.trunc(year) : new Date().getFullYear();
    return `${PREFIX}-${safeYear}-${num.padStart(PAD_WIDTH, '0')}`;
  }
}

import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const PREFIX = 'BAYI';
const PAD_WIDTH = 6;

type SequenceRow = { nextval: bigint | number | string };

/**
 * Bayi numarası üretici. Format: `BAYI-{6 hane}` (ör. BAYI-000123). Makbuzdaki
 * {{BAYI_ID}} alanı. Mevcut müşterilere migration kronolojik backfill yaptı;
 * yeni müşteriler `bayi_no_seq` üzerinden devam eder.
 *
 * Bir müşterinin `bayiNo`'su NULL ise (teorik kenar durum) makbuz üretiminde
 * bu servis ile atanır. Transaction-aware: opsiyonel `tx` verilir.
 */
@Injectable()
export class BayiNumberService {
  constructor(private readonly prisma: PrismaService) {}

  async generateBayiNo(tx?: Prisma.TransactionClient): Promise<string> {
    const client = tx ?? this.prisma;
    const rows = await client.$queryRaw<SequenceRow[]>`SELECT nextval('bayi_no_seq') AS nextval`;
    const raw = rows[0]?.nextval;
    if (raw === undefined || raw === null) {
      throw new Error('bayi_no_seq returned no value');
    }
    const num = typeof raw === 'bigint' ? raw.toString() : String(raw);
    return `${PREFIX}-${num.padStart(PAD_WIDTH, '0')}`;
  }

  /**
   * Müşterinin `bayiNo`'su yoksa atar (idempotent). Müşteri OLUŞTURMA
   * yollarından çağrılır (bayilik başvuru onayı, ön-kayıt, admin manuel) ki yeni
   * müşteri kaydedildiği anda numarasını alsın — eskiden numara yalnız ilk kredi
   * kartı makbuzu kesilirken `ReceiptsService.ensureBayiNo` ile atanıyordu, bu
   * yüzden kartla ödeme yapmayan müşteriler `bayiNo=null` kalıyordu.
   *
   * Mevcut numara varsa sequence'tan değer TÜKETMEZ (boşluk açmaz). Makbuz
   * akışındaki {@link generateBayiNo} ile aynı `bayi_no_seq` serisini kullanır.
   * Müşteri yoksa (silinmiş) `null` döner — çağıran akışı kırmaz.
   */
  async ensureForCustomer(
    customerId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<string | null> {
    const client = tx ?? this.prisma;
    const current = await client.customer.findUnique({
      where: { id: customerId },
      select: { bayiNo: true },
    });
    if (!current) return null;
    if (current.bayiNo) return current.bayiNo;
    const bayiNo = await this.generateBayiNo(tx);
    await client.customer.update({
      where: { id: customerId },
      data: { bayiNo },
    });
    return bayiNo;
  }
}

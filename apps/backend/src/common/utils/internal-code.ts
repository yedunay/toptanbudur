import { PrismaClient } from '@prisma/client';

/**
 * TBDR-XXXXXX dahili stok kodu üretici.
 *
 * Her ürün ilk ingest anında bir kez bu kodu alır; sonsuza kadar değişmez.
 * Tedarikçi kodu (externalCode) ne olursa olsun bu kod sabit kalır.
 *
 * Format: TBDR- + 6 haneli sıralı sayı (zero-padded)
 *   Örnek: TBDR-000001, TBDR-000042, TBDR-123456
 *
 * Strateji: DB'deki mevcut en büyük sıra numarasını bul, +1 artır.
 * @unique constraint race condition'a karşı son savunma hattıdır.
 */

const PREFIX = 'TBDR-';
const PAD_LENGTH = 6;

export function formatInternalCode(n: number): string {
  return `${PREFIX}${String(n).padStart(PAD_LENGTH, '0')}`;
}

/** Mevcut en büyük sıra numarasını DB'den çeker. */
async function getMaxSequence(prisma: PrismaClient): Promise<number> {
  const result = await prisma.$queryRaw<Array<{ seq: string | null }>>`
    SELECT MAX(SUBSTRING("internalCode" FROM 6)::INTEGER) AS seq
    FROM "Product"
    WHERE "internalCode" LIKE 'TBDR-%'
      AND "internalCode" ~ '^TBDR-[0-9]+$'
  `;
  const val = result[0]?.seq;
  return val ? Number(val) : 0;
}

/**
 * Benzersiz bir internalCode üretir ve döndürür.
 * Çakışma durumunda (race) 10 deneme yapar; hepsinde başarısız olursa hata fırlatır.
 */
export async function generateUniqueInternalCode(
  prisma: PrismaClient,
): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const max = await getMaxSequence(prisma);
    const candidate = formatInternalCode(max + 1);
    const exists = await prisma.product.findUnique({
      where: { internalCode: candidate },
      select: { id: true },
    });
    if (!exists) return candidate;
  }
  throw new Error('internalCode generation exceeded retry budget');
}

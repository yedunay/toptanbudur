/**
 * Backfill script: existing products with internalCode IS NULL get assigned
 * TBDR-XXXXXX codes sequentially. Safe to run multiple times (idempotent).
 *
 * Usage (from repo root):
 *   docker exec tb-backend node dist/scripts/backfill-internal-codes.mjs
 *   OR locally:
 *   cd apps/backend && node --experimental-vm-modules scripts/backfill-internal-codes.mjs
 */

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const PREFIX = 'TBDR-';
const PAD_LENGTH = 6;

function format(n) {
  return `${PREFIX}${String(n).padStart(PAD_LENGTH, '0')}`;
}

async function getMaxSequence(prisma) {
  const result = await prisma.$queryRaw`
    SELECT MAX(SUBSTRING("internalCode" FROM 6)::INTEGER) AS seq
    FROM "Product"
    WHERE "internalCode" LIKE 'TBDR-%'
      AND "internalCode" ~ '^TBDR-[0-9]+$'
  `;
  const val = result[0]?.seq;
  return val ? Number(val) : 0;
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  const adapter = new PrismaPg({ connectionString, ssl: { rejectUnauthorized: false } });
  const prisma = new PrismaClient({ adapter });

  try {
    const nullProducts = await prisma.product.findMany({
      where: { internalCode: null },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });

    console.log(`Found ${nullProducts.length} products without internalCode`);

    let seq = await getMaxSequence(prisma);

    let assigned = 0;
    for (const product of nullProducts) {
      seq += 1;
      const candidate = format(seq);

      await prisma.product.update({
        where: { id: product.id },
        data: { internalCode: candidate },
      });
      assigned++;

      if (assigned % 100 === 0) {
        console.log(`Assigned ${assigned}/${nullProducts.length} — latest: ${candidate}`);
      }
    }

    console.log(`Done. Assigned ${assigned} internal codes.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

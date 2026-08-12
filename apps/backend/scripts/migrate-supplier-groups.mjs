/**
 * One-time migration: group existing suppliers that share the same name
 * within the same tenant under a SupplierGroup record.
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." node scripts/migrate-supplier-groups.mjs
 *
 * Safe to re-run: uses upsert so duplicate runs are idempotent.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Find all (tenantId, name) pairs that appear more than once.
  const duplicates = await prisma.$queryRaw`
    SELECT "tenantId", LOWER("name") AS "nameLower", MIN("name") AS "name", COUNT(*) AS "cnt"
    FROM "Supplier"
    GROUP BY "tenantId", LOWER("name")
    HAVING COUNT(*) > 1
  `;

  console.log(`Found ${duplicates.length} duplicate supplier names to group.`);

  for (const row of duplicates) {
    const { tenantId, name } = row;

    // Upsert the group.
    const group = await prisma.supplierGroup.upsert({
      where: { tenantId_name: { tenantId, name } },
      update: {},
      create: { tenantId, name },
      select: { id: true },
    });

    // Wire all ungrouped suppliers with this name to the group.
    const result = await prisma.supplier.updateMany({
      where: {
        tenantId,
        name: { equals: name, mode: 'insensitive' },
        groupId: null,
      },
      data: { groupId: group.id },
    });

    console.log(`  group="${name}" (${group.id}) — wired ${result.count} feeds`);
  }

  console.log('Migration complete.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());

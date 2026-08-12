import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const XML_SUFFIX_REGEX = /\s*\(\s*xml\s*\)\s*$/i;

function toTitleCaseTr(input: string): string {
  const lower = input.toLocaleLowerCase('tr');
  return lower.replace(/(^|[\s\-/&()])(\p{L})/gu, (_, sep, ch) =>
    sep + ch.toLocaleUpperCase('tr'),
  );
}

function normalizeName(raw: string): string {
  return toTitleCaseTr(raw.replace(XML_SUFFIX_REGEX, '').trim()).trim();
}

function normalizePath(path: string): string {
  return path
    .split('>')
    .map((s) => normalizeName(s))
    .filter(Boolean)
    .join(' > ');
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL not set');

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });

  const cats = await prisma.category.findMany({
    select: { id: true, tenantId: true, name: true, path: true },
  });

  let updated = 0;
  let merged = 0;
  let skipped = 0;

  // Group by (tenantId, normalized path) — if collision, merge products into
  // the keeper and delete the dup.
  const byKey = new Map<string, { id: string; name: string; path: string }[]>();
  for (const c of cats) {
    const newPath = normalizePath(c.path);
    const key = `${c.tenantId}::${newPath}`;
    const arr = byKey.get(key) ?? [];
    arr.push({ id: c.id, name: c.name, path: c.path });
    byKey.set(key, arr);
  }

  // Phase 1: merge collisions and stamp keepers with a temp path to avoid
  // unique constraint races against not-yet-updated rows.
  const finals: { id: string; newName: string; newPath: string }[] = [];
  for (const [key, group] of byKey) {
    const [, newPath] = key.split('::');
    const segments = newPath.split(' > ');
    const newName = segments[segments.length - 1];

    const [keeper, ...dups] = group;
    for (const d of dups) {
      await prisma.product.updateMany({
        where: { categoryId: d.id },
        data: { categoryId: keeper.id },
      });
      await prisma.category.updateMany({
        where: { parentId: d.id },
        data: { parentId: keeper.id },
      });
      await prisma.category.delete({ where: { id: d.id } });
      merged++;
    }

    if (keeper.name === newName && keeper.path === newPath && dups.length === 0) {
      skipped++;
      continue;
    }

    await prisma.category.update({
      where: { id: keeper.id },
      data: { path: `__tmp__${keeper.id}` },
    });
    finals.push({ id: keeper.id, newName, newPath });
  }

  // Phase 2: write final names/paths now that no collisions are possible.
  for (const f of finals) {
    await prisma.category.update({
      where: { id: f.id },
      data: { name: f.newName, path: f.newPath },
    });
    updated++;
  }

  console.log(JSON.stringify({ total: cats.length, updated, merged, skipped }));
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

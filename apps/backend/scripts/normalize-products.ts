/**
 * normalize-products.ts
 *
 * Two cleanup operations applied to every Product row in the database:
 *
 * 1. ALL-CAPS name → Turkish Title Case
 *    Triggered when the name contains no lowercase letters at all.
 *    Words that contain a digit keep their original casing (128GB, 5G, A25).
 *
 * 2. "ÜRÜNLER ADET FİYATIDIR." dedup + normalise
 *    Only for products whose description already contains this phrase.
 *    All occurrences are removed; exactly one normalised copy
 *    ("Ürünler adet fiyatıdır.") is placed where the first occurrence was.
 *
 * Usage:
 *   DRY_RUN=true  npx ts-node -P tsconfig.json scripts/normalize-products.ts
 *   DRY_RUN=false npx ts-node -P tsconfig.json scripts/normalize-products.ts
 *
 * DRY_RUN defaults to "true" — no writes happen unless you explicitly pass false.
 */

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const DRY_RUN = (process.env.DRY_RUN ?? 'true') !== 'false';
const BATCH_SIZE = 500;

// ─── Turkish text helpers ─────────────────────────────────────────────────────

const TR_LOWER: Record<string, string> = {
  I: 'ı',
  İ: 'i',
  Ş: 'ş',
  Ğ: 'ğ',
  Ç: 'ç',
  Ö: 'ö',
  Ü: 'ü',
};

const TR_UPPER: Record<string, string> = {
  i: 'İ',
  ı: 'I',
  ş: 'Ş',
  ğ: 'Ğ',
  ç: 'Ç',
  ö: 'Ö',
  ü: 'Ü',
};

function trLower(ch: string): string {
  return TR_LOWER[ch] ?? ch.toLowerCase();
}

function trUpper(ch: string): string {
  return TR_UPPER[ch] ?? ch.toUpperCase();
}

/**
 * Converts an all-caps Turkish product name to Title Case.
 * Words that contain a digit (e.g. "128GB", "5G", "A25") are kept as-is
 * because they are technical specs, not plain words.
 */
function turkishTitleCase(str: string): string {
  return str
    .split(/(\s+)/)
    .map((token) => {
      if (/^\s+$/.test(token)) return token;
      if (/\d/.test(token)) return token; // keep technical tokens intact
      const lower = Array.from(token).map(trLower).join('');
      if (!lower) return lower;
      return trUpper(lower[0]) + lower.slice(1);
    })
    .join('');
}

/**
 * Returns true when every letter in `str` is uppercase (Turkish-aware).
 * Strings with no letters at all return false.
 */
function isAllCaps(str: string): boolean {
  if (!/[a-zA-ZşğçöüıiŞĞÇÖÜİI]/.test(str)) return false;
  return !/[a-zşğçöüiı]/.test(str);
}

// ─── "ÜRÜNLER ADET FİYATIDIR." helpers ───────────────────────────────────────

const ADET_RAW = 'ÜRÜNLER ADET FİYATIDIR.';
const ADET_NORMALISED = 'Ürünler adet fiyatıdır.';

/**
 * If `desc` contains ADET_RAW one or more times:
 *   - replaces the first occurrence with ADET_NORMALISED
 *   - removes all subsequent occurrences
 *   - collapses triple+ newlines that result from the removals
 * Returns desc unchanged when the phrase is absent.
 */
function normaliseAdetPhrase(desc: string): string {
  if (!desc.includes(ADET_RAW)) return desc;

  let firstReplaced = false;
  let result = desc.replace(new RegExp(ADET_RAW.replace(/\./g, '\\.'), 'g'), () => {
    if (!firstReplaced) {
      firstReplaced = true;
      return ADET_NORMALISED;
    }
    return '';
  });

  // Collapse blank lines created by removed occurrences
  result = result.replace(/\n{3,}/g, '\n\n').trim();
  return result;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set');

  const adapter = new PrismaPg({ connectionString: databaseUrl });
  const prisma = new PrismaClient({ adapter });

  console.log(`\n🔧 normalize-products  |  DRY_RUN=${DRY_RUN}\n`);
  if (DRY_RUN) {
    console.log('ℹ  Dry-run mode — no writes.  Pass DRY_RUN=false to apply.\n');
  }

  const stats = {
    total: 0,
    nameFixed: 0,
    adetFixed: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
  };

  let cursor: string | undefined;

  for (;;) {
    const batch = await prisma.product.findMany({
      take: BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
      select: { id: true, name: true, description: true },
    });

    if (batch.length === 0) break;
    cursor = batch[batch.length - 1].id;
    stats.total += batch.length;

    for (const p of batch) {
      let newName = p.name;
      let newDesc = p.description ?? null;
      const changes: string[] = [];

      // 1. ALL-CAPS name fix
      if (isAllCaps(p.name)) {
        const candidate = turkishTitleCase(p.name);
        if (candidate !== p.name) {
          newName = candidate;
          changes.push('name');
          stats.nameFixed++;
          if (DRY_RUN) {
            console.log(`[name]  "${p.name}"`);
            console.log(`     →  "${newName}"`);
          }
        }
      }

      // 2. "ÜRÜNLER ADET FİYATIDIR." dedup
      if (newDesc && newDesc.includes(ADET_RAW)) {
        const candidate = normaliseAdetPhrase(newDesc);
        if (candidate !== newDesc) {
          newDesc = candidate;
          changes.push('adet');
          stats.adetFixed++;
        }
      }

      if (changes.length === 0) {
        stats.skipped++;
        continue;
      }

      if (!DRY_RUN) {
        try {
          await prisma.product.update({
            where: { id: p.id },
            data: { name: newName, description: newDesc },
          });
          stats.updated++;
        } catch (err) {
          console.error(`[ERROR] ${p.id}:`, err);
          stats.errors++;
        }
      } else {
        stats.updated++;
      }
    }

    process.stdout.write(`  … ${stats.total} products scanned\r`);
  }

  console.log(`\n\n── Results ${'─'.repeat(40)}`);
  console.log(`Total scanned      : ${stats.total}`);
  console.log(`Names fixed        : ${stats.nameFixed}`);
  console.log(`Adet deduped       : ${stats.adetFixed}`);
  console.log(`Products to update : ${stats.updated}${DRY_RUN ? '  (dry run, no writes)' : ''}`);
  console.log(`Skipped (no change): ${stats.skipped}`);
  if (stats.errors > 0) console.log(`Errors             : ${stats.errors}`);
  console.log('');

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * One-off backfill: `Customer.companyAddress` ("Firma Adresi" düz metni) boş olan
 * müşterilerde, yapısal adres defterindeki (CustomerAddress) adresten doldurur.
 *
 * NEDEN: Adres iki ayrı yerde tutuluyor — companyAddress (düz string) ve
 * CustomerAddress[] (yapısal defter). Bazı müşteriler defterini doldurmuş ama
 * companyAddress'i boş kalmış; admin/profil ekranlarında adres "girilmemiş gibi"
 * görünüyor. Bu script o boşluğu mevcut defter verisinden kapatır.
 *
 * KAPSAM: companyAddress IS NULL veya '' OLAN müşteriler.
 * KAYNAK ÖNCELİĞİ: 1) varsayılan adres (isDefault=true), yoksa 2) en eski adres.
 *                  3) Hiç adres yoksa ATLA (uydurma veri yazılmaz).
 *
 * GÜVENLİK: Dolu companyAddress ASLA ezilmez (updateMany where guard: null/'').
 * Idempotenttir — tekrar çalıştırmak güvenlidir. Boş format sonucu yazılmaz.
 *
 * Kullanım (apps/backend dizininden):
 *   pnpm tsx scripts/backfill-companyaddress-from-default.ts --dry-run
 *   pnpm tsx scripts/backfill-companyaddress-from-default.ts --limit 5
 *   pnpm tsx scripts/backfill-companyaddress-from-default.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { formatCompanyAddress } from '../src/common/utils/address';

interface Args {
  dryRun: boolean;
  limit: number | null;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { dryRun: false, limit: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--limit') {
      const n = Number(argv[++i]);
      args.limit = Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
    }
  }
  return args;
}

async function main(): Promise<void> {
  const { dryRun, limit } = parseArgs(process.argv.slice(2));
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString, ssl: { rejectUnauthorized: false } }),
  });

  console.log(`[backfill-companyaddress] mode=${dryRun ? 'DRY-RUN' : 'APPLY'}${limit ? ` limit=${limit}` : ''}`);

  try {
    const targets = await prisma.customer.findMany({
      where: { OR: [{ companyAddress: null }, { companyAddress: '' }] },
      ...(limit ? { take: limit } : {}),
      select: {
        id: true,
        name: true,
        email: true,
        addresses: {
          // Varsayılan önce, yoksa en eski adres ilk gelsin.
          orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
          select: {
            line1: true,
            line2: true,
            city: true,
            district: true,
            postalCode: true,
            isDefault: true,
          },
        },
      },
    });

    let updated = 0;
    let skippedNoAddress = 0;
    let skippedEmptyFormat = 0;

    for (const c of targets) {
      const addr = c.addresses[0]; // isDefault desc → varsayılan, yoksa en eski
      if (!addr) {
        skippedNoAddress++;
        continue;
      }
      const formatted = formatCompanyAddress(addr);
      if (!formatted) {
        skippedEmptyFormat++;
        continue;
      }

      if (dryRun) {
        console.log(
          `  [dry] ${c.name ?? c.email ?? c.id} (${c.id}) ${addr.isDefault ? '[default]' : '[oldest]'} -> "${formatted}"`,
        );
        updated++;
        continue;
      }

      // where guard: yalnızca companyAddress hâlâ boşken yaz (yarış + ezme koruması)
      const res = await prisma.customer.updateMany({
        where: { id: c.id, OR: [{ companyAddress: null }, { companyAddress: '' }] },
        data: { companyAddress: formatted },
      });
      if (res.count > 0) {
        updated++;
        console.log(`  [ok] ${c.name ?? c.email ?? c.id} (${c.id}) -> "${formatted}"`);
      }
    }

    console.log(
      `[backfill-companyaddress] done. candidates=${targets.length} ${dryRun ? 'wouldUpdate' : 'updated'}=${updated} skippedNoAddress=${skippedNoAddress} skippedEmptyFormat=${skippedEmptyFormat}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error('[backfill-companyaddress] ERROR', e);
  process.exit(1);
});

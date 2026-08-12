/**
 * Tek seferlik catch-up: `bayiNo` (BAYI-XXXXXX) atanmamış (NULL) TÜM müşterilere
 * numara atar.
 *
 * NEDEN GEREKLİ: `bayiNo` müşteri oluşturulurken atanmıyordu; yalnızca
 * 2026-06-16 migration'ı o an mevcut müşterileri kronolojik backfill etmiş,
 * sonrasında numara YALNIZ ilk kredi-kartı makbuzu kesilirken lazy atanıyordu
 * (ReceiptsService.ensureBayiNo). Bu yüzden migration'dan SONRA kaydolmuş ve hiç
 * kartla ödeme yapmamış müşteriler `bayiNo=NULL` kaldı. Artık oluşturma anında
 * atanıyor (DealerService/AdminCustomersService → BayiNumberService.ensureForCustomer);
 * bu script geçmişteki boşlukları kapatır.
 *
 * YÖNTEM (migration'ın kanıtlanmış mantığının aynısı, script biçiminde):
 *   1. NULL müşteriler kronolojik sıralanır (createdAt ASC, id ASC).
 *   2. `bayi_no_seq` sequence'ı n kadar İLERİ rezerve edilir (setval) → atanan
 *      numaralar base+1..base+n; hepsi mevcut tüm numaralardan büyük (çakışma yok),
 *      lazy nextval base+n+1'den devam eder.
 *   3. ROW_NUMBER + base ile 'BAYI-XXXXXX' yazılır. Tamamı tek transaction'da;
 *      bir çakışma olursa UNIQUE index rollback ettirir (güvenli — tekrar çalıştır).
 *
 * Mevcut (NULL olmayan) `bayiNo` ASLA ezilmez (where filtresi NULL'a kısıtlı).
 * İdempotent: tekrar çalıştırılınca yalnız kalan NULL'ları doldurur.
 *
 * Kullanım:
 *   pnpm tsx scripts/backfill-bayi-no.ts --dry-run
 *   pnpm tsx scripts/backfill-bayi-no.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const PREFIX = 'BAYI';
const PAD_WIDTH = 6;

interface Args {
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--dry-run') args.dryRun = true;
  }
  return args;
}

function fmt(n: number): string {
  return `${PREFIX}-${String(n).padStart(PAD_WIDTH, '0')}`;
}

async function main() {
  const args = parseArgs(process.argv);
  const tag = `[backfill-bayi-no] mode=${args.dryRun ? 'DRY-RUN' : 'APPLY'}`;

  const nullCount = await prisma.customer.count({ where: { bayiNo: null } });
  const totalCount = await prisma.customer.count();
  console.log(
    `${tag} müşteri: ${totalCount} toplam, ${nullCount} bayiNo=NULL`,
  );

  if (nullCount === 0) {
    console.log(`${tag} doldurulacak müşteri yok — temiz.`);
    return;
  }

  // Sequence'in mevcut konumu = şimdiye dek dağıtılmış en yüksek numara.
  const seqRows = await prisma.$queryRaw<
    { last_value: bigint; is_called: boolean }[]
  >`SELECT last_value, is_called FROM bayi_no_seq`;
  const lastValue = Number(seqRows[0].last_value);
  const isCalled = seqRows[0].is_called;
  // is_called=false → henüz değer dağıtılmamış (sequence START WITH 1, çağrılmadı).
  const base = isCalled ? lastValue : lastValue - 1;

  console.log(
    `${tag} aralık: ${fmt(base + 1)} … ${fmt(base + nullCount)} ` +
      `(sequence base=${base}, +${nullCount})`,
  );

  if (args.dryRun) {
    console.log(`${tag} --dry-run: değişiklik yapılmadı`);
    return;
  }

  await prisma.$transaction(async (tx) => {
    // Bloğu rezerve et: base+1..base+nullCount bizim; nextval base+nullCount+1'den.
    await tx.$queryRaw`SELECT setval('bayi_no_seq', ${base + nullCount}, true)`;

    // Kronolojik (createdAt, id) ROW_NUMBER ile yaz; o.rn 1..nullCount.
    await tx.$executeRaw`
      WITH ordered AS (
        SELECT "id",
          ROW_NUMBER() OVER (ORDER BY "createdAt" ASC, "id" ASC) AS rn
        FROM "Customer"
        WHERE "bayiNo" IS NULL
      )
      UPDATE "Customer" c
      SET "bayiNo" = 'BAYI-' || LPAD((o.rn + ${base})::text, ${PAD_WIDTH}, '0')
      FROM ordered o
      WHERE c."id" = o."id"`;
  });

  const nullAfter = await prisma.customer.count({ where: { bayiNo: null } });
  console.log(
    `${tag} tamamlandı: ${nullCount - nullAfter} müşteriye bayiNo atandı ` +
      `(NULL: ${nullCount} → ${nullAfter}).`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });

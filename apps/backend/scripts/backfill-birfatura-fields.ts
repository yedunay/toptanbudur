/**
 * Mevcut paid siparişlere BirFatura alanlarını doldurur:
 *   - paidAt = updatedAt (eski siparişlerde paid'a geçiş zamanı yoksa
 *     en yakın yaklaşım)
 *   - invoiceHoldUntil = paidAt + 144h
 *   - billing snapshot Customer'dan + default address'ten kopyalanır
 *   - shippingDistrict CustomerAddress.district'ten doldurulur
 *
 * Volume uyarısı: paid sipariş sayısı yüksekse ilk BirFatura cron'unda
 * hepsi tek seferde çekilebilir. `--limit N` ile partial backfill ya da
 * `--dry-run` ile sayım önerilir.
 *
 * Kullanım:
 *   pnpm tsx scripts/backfill-birfatura-fields.ts --dry-run
 *   pnpm tsx scripts/backfill-birfatura-fields.ts --limit 100
 *   pnpm tsx scripts/backfill-birfatura-fields.ts
 */
import { PrismaClient, Prisma, OrderStatus } from '@prisma/client';

const prisma = new PrismaClient();

const PAID_LIKE_STATUSES: OrderStatus[] = [
  OrderStatus.paid,
  OrderStatus.preparing,
  OrderStatus.shipped,
];

interface Args {
  dryRun: boolean;
  limit: number | null;
  holdHours: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { dryRun: false, limit: null, holdHours: 144 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--limit') {
      args.limit = Number(argv[++i]);
      if (!Number.isFinite(args.limit) || args.limit <= 0) {
        throw new Error('--limit must be a positive number');
      }
    } else if (a === '--hold-hours') {
      args.holdHours = Number(argv[++i]);
      if (!Number.isFinite(args.holdHours)) {
        throw new Error('--hold-hours must be numeric');
      }
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);

  const totalCount = await prisma.order.count({
    where: {
      status: { in: PAID_LIKE_STATUSES },
      paidAt: null,
    },
  });
  console.log(`Backfill kapsamı: ${totalCount} sipariş (paidAt=null, paid-akış statüsünde)`);

  if (args.dryRun) {
    console.log('--dry-run: değişiklik yapılmadı');
    return;
  }

  const orders = await prisma.order.findMany({
    where: {
      status: { in: PAID_LIKE_STATUSES },
      paidAt: null,
    },
    take: args.limit ?? undefined,
    select: {
      id: true,
      humanOrderNo: true,
      updatedAt: true,
      customerId: true,
      addressLine1: true,
      addressCity: true,
      addressPostal: true,
      customer: {
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          companyTitle: true,
          vergiNo: true,
          vergiDairesi: true,
          tcKimlik: true,
          companyAddress: true,
          contactPhone: true,
          addresses: {
            where: { isDefault: true },
            take: 1,
            select: {
              line1: true,
              city: true,
              district: true,
              postalCode: true,
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`${orders.length} sipariş işlenecek...`);

  let updated = 0;
  let skipped = 0;

  for (const o of orders) {
    if (!o.customer) {
      skipped++;
      continue;
    }
    const paidAt = o.updatedAt;
    const invoiceHoldUntil = new Date(
      paidAt.getTime() + args.holdHours * 3_600_000,
    );
    const addr = o.customer.addresses[0];

    await prisma.order.update({
      where: { id: o.id },
      data: {
        paidAt,
        invoiceHoldUntil,
        billingName: o.customer.name,
        billingCompanyTitle: o.customer.companyTitle,
        billingVergiNo: o.customer.vergiNo,
        billingVergiDairesi: o.customer.vergiDairesi,
        billingTcNo: o.customer.tcKimlik,
        billingEmail: o.customer.email,
        billingPhone: o.customer.phone,
        billingMobilePhone:
          o.customer.contactPhone ?? o.customer.phone ?? null,
        billingAddressLine: addr?.line1 ?? o.customer.companyAddress ?? o.addressLine1,
        billingDistrict: addr?.district ?? null,
        billingCity: addr?.city ?? o.addressCity,
        billingPostal: addr?.postalCode ?? o.addressPostal,
        shippingDistrict: addr?.district ?? null,
      },
    });
    updated++;

    if (updated % 50 === 0) {
      console.log(`  ${updated}/${orders.length}...`);
    }
  }

  console.log(`Tamamlandı: ${updated} güncellendi, ${skipped} atlandı (customer null)`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });

// Prisma import güvence (treeshake olmasın diye)
void Prisma;

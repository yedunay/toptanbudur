/**
 * Faz 9 — Tarihsel catch-up (birfatura.md §12.9): `shippedAt` set noktası
 * eklenmeden ÖNCE kargolanmış siparişlerde `Order.shippedAt` boş kalmıştır.
 *
 * `shippedAt`, konsolide fatura kesim uygunluğunun TEK kaynağıdır (§3.2 / §4:
 * `status='shipped' AND shippedAt <= cutoff`). Boş kaldığı sürece bu siparişler
 * hiçbir kesime girmez. Bu script o boşluğu tarihsel verilerden doldurur.
 *
 * Kapsam: `status='shipped' AND shippedAt IS NULL`.
 *
 * Kaynak önceliği (en güvenilirden en zayıfa):
 *   1. `statusChangedAt`  — sipariş şu an 'shipped' olduğundan son geçiş = kargo
 *      geçişidir; en doğru kargo zamanı.
 *   2. En son `OrderTrackingEvent(status='shipped').occurredAt` — bağımsız kargo
 *      olay kaydı.
 *   3. `updatedAt`        — yukarıdakiler yoksa en yakın yaklaşım (fallback).
 *
 * Mevcut (null olmayan) `shippedAt` ASLA ezilmez (where filtresi null'a kısıtlı).
 *
 * Kullanım:
 *   pnpm tsx scripts/backfill-shipped-at.ts --dry-run
 *   pnpm tsx scripts/backfill-shipped-at.ts --limit 100
 *   pnpm tsx scripts/backfill-shipped-at.ts
 *
 * Tamamlandıktan SONRA: konsolide kesim taraması (freeze sweep) çalıştırılır —
 * admin panelden "Tümünü Dondur" ya da otomatik cron (consolidationEnabled) ile.
 * Açık uçlu uygunluk sayesinde geçmiş dönemlere ait kargolar bir sonraki kesime
 * süpürülür (§12.9).
 */
import { PrismaClient, OrderStatus } from '@prisma/client';

const prisma = new PrismaClient();

interface Args {
  dryRun: boolean;
  limit: number | null;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { dryRun: false, limit: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--limit') {
      args.limit = Number(argv[++i]);
      if (!Number.isFinite(args.limit) || args.limit <= 0) {
        throw new Error('--limit must be a positive number');
      }
    }
  }
  return args;
}

/** Kaynak önceliği etiketi — dry-run raporunda dağılımı göstermek için. */
type ShippedAtSource = 'statusChangedAt' | 'trackingEvent' | 'updatedAt';

async function main() {
  const args = parseArgs(process.argv);

  const totalCount = await prisma.order.count({
    where: { status: OrderStatus.shipped, shippedAt: null },
  });
  console.log(
    `Backfill kapsamı: ${totalCount} sipariş (status='shipped', shippedAt=null)`,
  );

  if (totalCount === 0) {
    console.log('Doldurulacak sipariş yok — temiz.');
    return;
  }

  const orders = await prisma.order.findMany({
    where: { status: OrderStatus.shipped, shippedAt: null },
    take: args.limit ?? undefined,
    select: {
      id: true,
      humanOrderNo: true,
      statusChangedAt: true,
      updatedAt: true,
      trackingEvents: {
        where: { status: 'shipped' },
        orderBy: { occurredAt: 'desc' },
        take: 1,
        select: { occurredAt: true },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  // Kaynak önceliğini uygula; dağılımı say (dry-run görünürlüğü).
  const resolved = orders.map((o) => {
    let shippedAt: Date;
    let source: ShippedAtSource;
    if (o.statusChangedAt) {
      shippedAt = o.statusChangedAt;
      source = 'statusChangedAt';
    } else if (o.trackingEvents[0]?.occurredAt) {
      shippedAt = o.trackingEvents[0].occurredAt;
      source = 'trackingEvent';
    } else {
      shippedAt = o.updatedAt;
      source = 'updatedAt';
    }
    return { id: o.id, humanOrderNo: o.humanOrderNo, shippedAt, source };
  });

  const dist: Record<ShippedAtSource, number> = {
    statusChangedAt: 0,
    trackingEvent: 0,
    updatedAt: 0,
  };
  for (const r of resolved) dist[r.source]++;
  console.log(
    `Kaynak dağılımı → statusChangedAt: ${dist.statusChangedAt}, ` +
      `trackingEvent: ${dist.trackingEvent}, updatedAt(fallback): ${dist.updatedAt}`,
  );

  if (args.dryRun) {
    console.log('--dry-run: değişiklik yapılmadı');
    return;
  }

  console.log(`${resolved.length} sipariş işlenecek...`);

  let updated = 0;
  for (const r of resolved) {
    // Yarış koruması: arada gerçek bir set noktası shippedAt yazdıysa dokunma.
    await prisma.order.updateMany({
      where: { id: r.id, shippedAt: null },
      data: { shippedAt: r.shippedAt },
    });
    updated++;

    if (updated % 50 === 0) {
      console.log(`  ${updated}/${resolved.length}...`);
    }
  }

  console.log(`Tamamlandı: ${updated} sipariş güncellendi.`);
  console.log(
    'Sonraki adım: konsolide kesim taraması (freeze sweep) çalıştır — ' +
      'admin panel "Tümünü Dondur" veya otomatik cron (consolidationEnabled).',
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

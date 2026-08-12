/**
 * Faz 4 — Kredi Kartı Tahsilat Makbuzu tarihsel catch-up (backfill).
 *
 * NEDEN: Makbuz otomasyonu (confirmCardPayment / systemApproveCardTopup
 * post-commit kancaları) eklenmeden ÖNCE kart ile ödenmiş siparişler ve kart
 * ile yapılmış cari yüklemeler için makbuz kesilmemiştir. Bu script o boşluğu
 * tarihsel verilerden, canlı akışla BİREBİR aynı servis (ReceiptsService) üzerinden
 * doldurur — böylece numara/şablon/idempotency garantileri tek noktadan gelir.
 *
 * EN ÖNEMLİ KURAL: Makbuz YALNIZCA kredi kartı işlemine kesilir. Bu script de
 * sadece kart işlemlerini kapsar (aşağıdaki uygunluk filtreleri) ve ReceiptsService
 * de `paymentType==='card'` / `method==='card'` dışını ikinci bir savunma katmanı
 * olarak null döndürerek reddeder.
 *
 * KAPSAM (uygunluk = "kartla para gerçekten tahsil edildi" kanıtı):
 *   Siparişler:  paymentType='card' AND ( paidAt IS NOT NULL
 *                  OR  başarılı bir PaymentTransaction{kind:'order',status:'success'} )
 *                — `paidAt` ile başarılı POS kaydının ikisi de gerçek tahsilat
 *                  kanıtıdır. OR sayesinde, canlı kancanın (status uyumsuzluğu
 *                  yüzünden) kaçırdığı "para çekildi ama makbuz kesilmedi"
 *                  durumları da yakalanır (örn. iptal edilmiş ama kartı çekilmiş).
 *   Yüklemeler:  method='card' AND ( status='APPROVED'
 *                  OR  başarılı bir PaymentTransaction{kind:'cari_topup',status:'success'} )
 *
 * KRONOLOJİ: İki kategori, gerçek tahsilat zamanına (sipariş: paidAt ?? createdAt,
 * yükleme: decidedAt ?? createdAt) göre TEK akışta birleştirilip eskiden yeniye
 * işlenir — makbuz numaraları (MBZ-YIL-NNNNNN) kronolojik monoton artsın diye.
 *
 * İDEMPOTENT: ReceiptsService.createForOrder/createForTopup zaten idempotenttir
 * (orderId/topupId UNIQUE; P2002 → mevcut kayıt). Tekrar çalıştırmak güvenlidir;
 * mevcut makbuz ASLA ezilmez/çoğaltılmaz. Script makbuz başına bayiNo + humanTopupNo
 * eksikliklerini de servis içinden (ensureBayiNo / ensureTopupNo) tamamlar.
 *
 * PDF: Tembel üretilir (lazy). Bu script PDF render ETMEZ; storage'a dokunmaz.
 * PDF, müşteri/admin ilk görüntülemede ensurePdf ile üretilir. (Storage stub'ı
 * çağrılırsa fırlatır — çağrılmamalı.)
 *
 * Kullanım (apps/backend dizininden):
 *   pnpm tsx scripts/backfill-receipts.ts --dry-run
 *   pnpm tsx scripts/backfill-receipts.ts --limit 5
 *   pnpm tsx scripts/backfill-receipts.ts
 *
 * --limit N: kronolojik en eski N uygun kayıt (sipariş+yükleme birleşik) işlenir.
 */
import 'reflect-metadata';
import 'dotenv/config';
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

import type { PrismaService } from '../src/prisma/prisma.service';
import type { IFileStorage } from '../src/storage/storage.interface';
import { ReceiptsService } from '../src/receipts/receipts.service';
import { ReceiptNumberService } from '../src/receipts/receipt-number.service';
import { BayiNumberService } from '../src/receipts/bayi-number.service';
import { ReceiptPdfService } from '../src/receipts/receipt-pdf.service';
import { CariTopupNumberService } from '../src/cari-balance/cari-topup-number.service';

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

/**
 * Tek-geçişli kronolojik tasarımın bellek tavanı. Makbuz numaraları iki tabloyu
 * (sipariş + yükleme) gerçek tahsilat zamanına göre TEK akışta birleştirip
 * monoton artırdığı için, uygun kayıtların TAMAMI aynı anda bellekte tutulmak
 * zorundadır (gerçek streaming/sayfalama monoton numaralandırmayı bozar). Bu
 * yüzden `--limit` OOM'u ÇÖZMEZ — slice yalnızca tüm kayıtlar yüklendikten sonra
 * uygulanır. Uygun kayıt sayısı bu tavanı aşarsa script sessizce OOM ile
 * çökmek yerine DB-tarafı count ile ÖNCEDEN ve sesli durur.
 */
const MAX_SAFE_BACKFILL_ROWS = 250_000;

/** Birleşik kronolojik iş kuyruğu öğesi. */
interface WorkItem {
  type: 'order' | 'topup';
  id: string;
  sortAt: Date;
  human: string | null;
  hasCustomer: boolean;
  /** Çalışma ÖNCESİNDE makbuzu zaten var mıydı? (created vs existing ayrımı için) */
  preExisting: boolean;
}

// Yerel host'larda (Docker dev DB) SSL kapalı; uzak host'larda açık.
function shouldUseSsl(connectionString: string): boolean {
  try {
    const url = new URL(connectionString);
    const sslmode = url.searchParams.get('sslmode');
    if (sslmode === 'disable') return false;
    if (sslmode === 'require' || sslmode === 'prefer') return true;
    const host = url.hostname;
    return host !== 'localhost' && host !== '127.0.0.1' && host !== '::1';
  } catch {
    // URL parse edilemezse güvenli tarafta kal: SSL dene.
    return true;
  }
}

async function main(): Promise<void> {
  const { dryRun, limit } = parseArgs(process.argv.slice(2));

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');

  // Yerel Docker Postgres SSL desteklemez; prod (Hetzner/uzak host) ister.
  // Host'a göre SSL'i koşullu aç: localhost/127.0.0.1/sslmode=disable → kapalı.
  const ssl = shouldUseSsl(connectionString)
    ? { rejectUnauthorized: false }
    : undefined;

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString, ssl }),
  });

  try {
    await runBackfill(prisma, { dryRun, limit });
  } finally {
    await prisma.$disconnect();
  }
}

async function runBackfill(
  prisma: PrismaClient,
  { dryRun, limit }: Args,
): Promise<void> {
  // ReceiptsService canlı akışta PrismaService (PrismaClient'i extend eder) bekler;
  // servisler yalnızca PrismaClient yüzeyini (findUnique/$transaction/$queryRaw)
  // kullandığından adapter'lı PrismaClient güvenle PrismaService olarak verilir.
  const prismaService = prisma as unknown as PrismaService;

  // PDF tembel üretildiğinden bu akışta storage'a HİÇ dokunulmaz; çağrılırsa fırlat.
  const notUsed = (): never => {
    throw new Error(
      'backfill-receipts: storage erişimi beklenmiyordu — makbuz PDF tembel üretilir',
    );
  };
  const storageStub: IFileStorage = {
    upload: notUsed,
    getSignedUrl: notUsed,
    getPublicUrl: notUsed,
    read: notUsed,
    delete: notUsed,
  };

  const receipts = new ReceiptsService(
    prismaService,
    new ReceiptNumberService(prismaService),
    new BayiNumberService(prismaService),
    new CariTopupNumberService(prismaService),
    new ReceiptPdfService(),
    storageStub,
  );

  const tag = `[backfill-receipts] mode=${dryRun ? 'DRY-RUN' : 'APPLY'}${limit ? ` limit=${limit}` : ''}`;
  console.log(tag);

  // ─── Uygunluk filtreleri ────────────────────────────────────────────────
  const orderWhere: Prisma.OrderWhereInput = {
    paymentType: 'card',
    OR: [
      { paidAt: { not: null } },
      { paymentTransactions: { some: { kind: 'order', status: 'success' } } },
    ],
  };
  const topupWhere: Prisma.CariTopupWhereInput = {
    method: 'card',
    OR: [
      { status: 'APPROVED' },
      { paymentTransactions: { some: { kind: 'cari_topup', status: 'success' } } },
    ],
  };

  // ─── Bellek güvenlik tavanı (DB-tarafı count → yüklemeden ÖNCE) ──────────
  // findMany TÜM uygun kayıtları belleğe alır (kronolojik tek-geçiş şart).
  // Çok büyük veri setinde sessiz OOM yerine ucuz count ile önceden ve sesli dur.
  const [eligibleOrderCount, eligibleTopupCount] = await Promise.all([
    prisma.order.count({ where: orderWhere }),
    prisma.cariTopup.count({ where: topupWhere }),
  ]);
  const eligibleTotalCount = eligibleOrderCount + eligibleTopupCount;
  if (eligibleTotalCount > MAX_SAFE_BACKFILL_ROWS) {
    throw new Error(
      `[backfill-receipts] GÜVENLİK DURDURMASI: ${eligibleTotalCount} uygun ` +
        `kayıt (sipariş ${eligibleOrderCount} + yükleme ${eligibleTopupCount}) ` +
        `bellek tavanı ${MAX_SAFE_BACKFILL_ROWS} üzerinde. Kronolojik tek-geçiş ` +
        `tasarımı tüm kayıtları aynı anda bellekte tutar; --limit OOM'u ÇÖZMEZ ` +
        `(slice yüklemeden sonra uygulanır). Bu boyutta veri için script'e ` +
        `gerçek sayfalama/batch eklenmeli VEYA host belleği yeterliyse ve maliyeti ` +
        `kabul ediyorsanız MAX_SAFE_BACKFILL_ROWS yükseltilmeli.`,
    );
  }

  const [eligibleOrders, eligibleTopups] = await Promise.all([
    prisma.order.findMany({
      where: orderWhere,
      select: {
        id: true,
        status: true,
        paidAt: true,
        createdAt: true,
        humanOrderNo: true,
        customerId: true,
      },
    }),
    prisma.cariTopup.findMany({
      where: topupWhere,
      select: {
        id: true,
        status: true,
        decidedAt: true,
        createdAt: true,
        humanTopupNo: true,
        customerId: true,
      },
    }),
  ]);

  // Çalışma öncesi mevcut makbuzlar (created vs existing ayrımı için).
  const orderIds = eligibleOrders.map((o) => o.id);
  const topupIds = eligibleTopups.map((t) => t.id);
  const [existingForOrders, existingForTopups] = await Promise.all([
    prisma.paymentReceipt.findMany({
      where: { orderId: { in: orderIds } },
      select: { orderId: true },
    }),
    prisma.paymentReceipt.findMany({
      where: { topupId: { in: topupIds } },
      select: { topupId: true },
    }),
  ]);
  const preOrderReceiptIds = new Set(
    existingForOrders.map((r) => r.orderId).filter((v): v is string => v !== null),
  );
  const preTopupReceiptIds = new Set(
    existingForTopups.map((r) => r.topupId).filter((v): v is string => v !== null),
  );

  // bayiNo / humanTopupNo eksiklik sayaçları (çalışma öncesi).
  const [bayiNullBefore, topupNoNullBefore] = await Promise.all([
    prisma.customer.count({ where: { bayiNo: null } }),
    prisma.cariTopup.count({ where: { method: 'card', humanTopupNo: null } }),
  ]);

  // ─── Kronolojik birleşik kuyruk ─────────────────────────────────────────
  const work: WorkItem[] = [
    ...eligibleOrders.map<WorkItem>((o) => ({
      type: 'order',
      id: o.id,
      sortAt: o.paidAt ?? o.createdAt,
      human: o.humanOrderNo,
      hasCustomer: o.customerId !== null,
      preExisting: preOrderReceiptIds.has(o.id),
    })),
    ...eligibleTopups.map<WorkItem>((t) => ({
      type: 'topup',
      id: t.id,
      sortAt: t.decidedAt ?? t.createdAt,
      human: t.humanTopupNo,
      hasCustomer: t.customerId !== null,
      preExisting: preTopupReceiptIds.has(t.id),
    })),
  ].sort((a, b) => a.sortAt.getTime() - b.sortAt.getTime());

  const queue = limit ? work.slice(0, limit) : work;

  // ─── Çalışma öncesi rapor ───────────────────────────────────────────────
  const orderStatusBuckets = tally(eligibleOrders.map((o) => o.status));
  const topupStatusBuckets = tally(eligibleTopups.map((t) => t.status));
  console.log('\n──────── UYGUNLUK (çalışma öncesi) ────────');
  console.log(`Uygun sipariş           : ${eligibleOrders.length}  (makbuzu olan: ${preOrderReceiptIds.size})`);
  console.log(`  durum dağılımı        : ${fmtBuckets(orderStatusBuckets)}`);
  console.log(`Uygun yükleme           : ${eligibleTopups.length}  (makbuzu olan: ${preTopupReceiptIds.size})`);
  console.log(`  durum dağılımı        : ${fmtBuckets(topupStatusBuckets)}`);
  console.log(`Müşterisiz (atlanacak)  : sipariş=${eligibleOrders.filter((o) => o.customerId === null).length}  yükleme=${eligibleTopups.filter((t) => t.customerId === null).length}`);
  console.log(`Customer.bayiNo boş     : ${bayiNullBefore}`);
  console.log(`Kart yükleme humanTopupNo boş: ${topupNoNullBefore}`);
  console.log(`İşlenecek kuyruk        : ${queue.length}${limit && work.length > queue.length ? ` (toplam ${work.length} içinden en eski ${queue.length})` : ''}`);

  // ─── DRY-RUN: yazma yok, projeksiyon ────────────────────────────────────
  if (dryRun) {
    const wouldCreate = queue.filter((w) => !w.preExisting && w.hasCustomer).length;
    const wouldSkipNoCustomer = queue.filter((w) => !w.hasCustomer).length;
    const alreadyHave = queue.filter((w) => w.preExisting).length;
    console.log('\n──────── DRY-RUN PROJEKSİYON ────────');
    console.log(`Kesilecek (yeni)        : ${wouldCreate}`);
    console.log(`Zaten var (atlanacak)   : ${alreadyHave}`);
    console.log(`Müşterisiz (atlanacak)  : ${wouldSkipNoCustomer}`);
    console.log('\nDRY-RUN — hiçbir kayıt yazılmadı.');
    return;
  }

  // ─── APPLY: kronolojik sırayla idempotent üretim ────────────────────────
  let created = 0;
  let existed = 0;
  let skipped = 0;
  const failures: Array<{ type: string; id: string; error: string }> = [];

  for (const item of queue) {
    try {
      const receipt =
        item.type === 'order'
          ? await receipts.createForOrder(item.id)
          : await receipts.createForTopup(item.id);

      if (receipt === null) {
        // Servis null döndü: kart dışı / müşteri yok / kayıt yok → atla.
        skipped++;
      } else if (item.preExisting) {
        existed++;
      } else {
        created++;
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      failures.push({ type: item.type, id: item.id, error: msg });
      console.error(`  ✗ ${item.type} ${item.id} (${item.human ?? '—'}): ${msg}`);
    }
  }

  // ─── Çalışma sonrası doğrulama ──────────────────────────────────────────
  const [orderReceiptsAfter, topupReceiptsAfter, bayiNullAfter, topupNoNullAfter] =
    await Promise.all([
      prisma.paymentReceipt.count({ where: { orderId: { in: orderIds } } }),
      prisma.paymentReceipt.count({ where: { topupId: { in: topupIds } } }),
      prisma.customer.count({ where: { bayiNo: null } }),
      prisma.cariTopup.count({ where: { method: 'card', humanTopupNo: null } }),
    ]);

  console.log('\n──────── SONUÇ ────────');
  console.log(`Yeni kesilen makbuz     : ${created}`);
  console.log(`Zaten vardı (idempotent): ${existed}`);
  console.log(`Atlanan (null/müşterisiz): ${skipped}`);
  console.log(`Hata                    : ${failures.length}`);

  console.log('\n──────── DOĞRULAMA ────────');
  console.log(`Uygun sipariş ${eligibleOrders.length} → makbuzu olan ${orderReceiptsAfter}`);
  console.log(`Uygun yükleme ${eligibleTopups.length} → makbuzu olan ${topupReceiptsAfter}`);
  console.log(`Customer.bayiNo boş     : ${bayiNullBefore} → ${bayiNullAfter}`);
  console.log(`Kart yükleme humanTopupNo boş: ${topupNoNullBefore} → ${topupNoNullAfter}`);

  // Müşterisi olan her uygun kayıt artık makbuza sahip olmalı.
  const orderGap = eligibleOrders.filter((o) => o.customerId !== null).length - orderReceiptsAfter;
  const topupGap = eligibleTopups.filter((t) => t.customerId !== null).length - topupReceiptsAfter;
  const ok = failures.length === 0 && orderGap <= 0 && topupGap <= 0;
  if (ok) {
    console.log('\n✅ PASS — müşterisi olan tüm uygun kart işlemlerinin makbuzu var.');
  } else {
    console.log(
      `\n⚠️  İNCELE — orderGap=${orderGap} topupGap=${topupGap} hata=${failures.length}`,
    );
    if (failures.length > 0) {
      console.log('Hatalı kayıtlar:');
      for (const f of failures) console.log(`  - ${f.type} ${f.id}: ${f.error}`);
    }
    process.exitCode = 1;
  }
}

/** Bir değer dizisini {değer: adet} sayımına indirger. */
function tally(values: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) out[v] = (out[v] ?? 0) + 1;
  return out;
}

function fmtBuckets(buckets: Record<string, number>): string {
  const entries = Object.entries(buckets);
  if (entries.length === 0) return '—';
  return entries.map(([k, n]) => `${k}=${n}`).join('  ');
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });

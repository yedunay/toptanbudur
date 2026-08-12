/**
 * OrderItem.supplierIdSnapshot / supplierNameSnapshot BACKFILL.
 *
 * Tedarikçi snapshot kolonları (migration 20260622000000_orderitem_supplier_snapshot)
 * eklendikten SONRA bir kez çalıştırılır. Mevcut sipariş kalemlerine sipariş
 * anındaki tedarikçiyi geriye dönük yazar — böylece ürün hard-delete edilmiş olsa
 * bile karlılık ve tedarikçi-cari raporları doğru tedarikçiye atfeder.
 *
 * Çözümleme kaynakları (öncelik sırasıyla):
 *   A) Ürün hâlâ varsa            → product.supplierId + supplier.name
 *   B) supplierIdOverride varsa    → override tedarikçisi (zaten öncelikli; tutarlılık için yazılır)
 *   C) Ürün silinmiş, tek tedarikçili sipariş → SupplierAccountLedger(orderId) tek supplier
 *   D) Ürün silinmiş, SKU/barkod   → aynı externalCode/barcode'lu güncel Product'ın tedarikçisi
 *   (Hiçbiri yoksa) → null bırakılır; rapor "Ürün Silinmiş" kovasına yazar.
 *
 * GÜVENLİK: Yalnızca supplierIdSnapshot=NULL satırlara dokunur (mevcut snapshot'ı
 * ASLA ezmez), idempotenttir. VARSAYILAN: DRY-RUN (hiçbir şey yazmaz). Gerçekten
 * yazmak için:  node scripts/backfill-orderitem-supplier-snapshot.mjs --apply
 *
 * Çalıştırma (canlı, backend container içinden):
 *   docker cp apps/backend/scripts/backfill-orderitem-supplier-snapshot.mjs tb-backend:/app/
 *   docker exec -w /app tb-backend node backfill-orderitem-supplier-snapshot.mjs           # dry-run
 *   docker exec -w /app tb-backend node backfill-orderitem-supplier-snapshot.mjs --apply   # yaz
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const APPLY = process.argv.includes('--apply');
const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  }),
});

async function update(id, supplierId, name) {
  if (!APPLY) return;
  await prisma.orderItem.update({
    where: { id },
    data: { supplierIdSnapshot: supplierId, supplierNameSnapshot: name ?? null },
  });
}

async function main() {
  console.log(APPLY ? '*** APPLY MODE — yazılacak ***' : '--- DRY-RUN (yazmaz; --apply ile yaz) ---');

  const suppliers = await prisma.supplier.findMany({ select: { id: true, name: true } });
  const supName = new Map(suppliers.map((s) => [s.id, s.name]));

  // ── PASS A: ürün hâlâ var, snapshot boş ──────────────────────────────────
  const aItems = await prisma.orderItem.findMany({
    where: { supplierIdSnapshot: null, productId: { not: null } },
    select: {
      id: true,
      product: { select: { supplierId: true, supplier: { select: { name: true } } } },
    },
  });
  let aFilled = 0;
  for (const it of aItems) {
    const sid = it.product?.supplierId;
    if (!sid) continue;
    const name = it.product?.supplier?.name ?? supName.get(sid) ?? null;
    await update(it.id, sid, name);
    aFilled++;
  }
  console.log(`PASS A (ürün mevcut):           ${aFilled} / ${aItems.length}`);

  // ── Silinmiş ürünlü kalemler (productId null, snapshot boş) ───────────────
  const delItems = await prisma.orderItem.findMany({
    where: { supplierIdSnapshot: null, productId: null },
    select: {
      id: true,
      orderId: true,
      supplierIdOverride: true,
      supplierSku: true,
      supplierBarcode: true,
    },
  });

  // Sipariş → tedarikçi(ler) (ORDER_PURCHASE/REFUND ledger'ından)
  const txns = await prisma.supplierAccountLedger.findMany({
    where: { type: { in: ['ORDER_PURCHASE', 'ORDER_REFUND'] } },
    select: { orderId: true, supplierId: true },
  });
  const orderToSup = new Map();
  for (const t of txns) {
    if (!t.orderId) continue;
    const set = orderToSup.get(t.orderId) ?? new Set();
    set.add(t.supplierId);
    orderToSup.set(t.orderId, set);
  }

  let bFilled = 0; // override
  let cFilled = 0; // ledger tek-tedarikçi
  let dFilled = 0; // SKU/barkod
  let unresolved = 0;

  for (const it of delItems) {
    let sid = null;
    let src = '';

    if (it.supplierIdOverride) {
      sid = it.supplierIdOverride;
      src = 'B';
    }
    if (!sid) {
      const set = orderToSup.get(it.orderId);
      if (set && set.size === 1) {
        sid = [...set][0];
        src = 'C';
      }
    }
    if (!sid && (it.supplierSku || it.supplierBarcode)) {
      // externalCode yalnız (tenant, supplier) içinde benzersiz; barcode'un
      // benzersizlik kısıtı YOK → aynı SKU/barkod birden çok tedarikçide
      // olabilir. YANLIŞ atıf null'dan (→ "Ürün Silinmiş") DAHA KÖTÜ olduğu için
      // yalnızca TEK distinct tedarikçi eşleşirse kullan. Barkod daha spesifik,
      // önce o denenir, yoksa externalCode.
      const distinctSupplier = async (where) => {
        const rows = await prisma.product.findMany({
          where,
          select: { supplierId: true },
          distinct: ['supplierId'],
          take: 2,
        });
        return rows.length === 1 ? rows[0].supplierId : null;
      };
      let match = null;
      if (it.supplierBarcode) match = await distinctSupplier({ barcode: it.supplierBarcode });
      if (!match && it.supplierSku) match = await distinctSupplier({ externalCode: it.supplierSku });
      if (match) {
        sid = match;
        src = 'D';
      }
    }

    if (!sid) {
      unresolved++;
      continue;
    }
    await update(it.id, sid, supName.get(sid) ?? null);
    if (src === 'B') bFilled++;
    else if (src === 'C') cFilled++;
    else dFilled++;
  }

  console.log(`PASS B (override):              ${bFilled}`);
  console.log(`PASS C (ledger tek-tedarikçi):  ${cFilled}`);
  console.log(`PASS D (SKU/barkod eşleşme):    ${dFilled}`);
  console.log(`Atfedilemeyen (Ürün Silinmiş):  ${unresolved} / ${delItems.length}`);
  console.log(
    `\nTOPLAM doldurulan: ${aFilled + bFilled + cFilled + dFilled}  ` +
      `(silinmiş ${bFilled + cFilled + dFilled}/${delItems.length}, ` +
      `${unresolved} atfedilemedi → "Ürün Silinmiş")`,
  );
  if (!APPLY) console.log('\n--- DRY-RUN bitti; hiçbir şey yazılmadı. --apply ile çalıştır. ---');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

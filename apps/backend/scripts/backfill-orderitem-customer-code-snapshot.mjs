// Backfill — OrderItem MÜŞTERİ-YÜZLÜ stok kodu snapshot'ı.
//
// AMAÇ: e-faturada/panelde silinmiş ürünlerin "Stok Kodu" yerine çirkin URL
// slug'ı görünmesi bug'ının GEÇMİŞ veride telafisi. İleriye dönük çözüm zaten
// sipariş anında + silme öncesi snapshot ile kod tarafında halledildi; bu script
// migration (internalCodeSnapshot/publicBarcodeSnapshot kolonları) CANLIYA
// alındıktan SONRA bir kez çalıştırılır.
//
// STRATEJİ (yalnız snapshot'ı NULL olan kalemlere dokunur, mevcut donmuşu EZMEZ):
//   1) productId DOLU  → canlı Product.internalCode/publicBarcode'dan doldur.
//   2) productId NULL (silinmiş ürün) & slug hâlâ yaşayan bir ürünle eşleşiyor →
//      o ürünün kodundan doldur (kurtarılabilir azınlık).
//   3) Kalan (silinmiş, kurtarılamaz) → slug'dan deterministik temiz STK-XXXXXX
//      kodu üret (runtime fallback ile AYNI algoritma). Slug bir daha ASLA basılmaz.
//
// ÇALIŞTIRMA (canlı sunucu, backend container):
//   docker exec -i tb-backend node scripts/backfill-orderitem-customer-code-snapshot.mjs
//   (önce DRY_RUN=1 ile sayıları gör: docker exec -e DRY_RUN=1 -i tb-backend node scripts/...)

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const DRY_RUN = process.env.DRY_RUN === '1';
const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  }),
});

// runtime customerSafeFallbackCode (batch-mapper.ts) ile BİREBİR aynı algoritma.
function hashStringToInt(s) {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = (hash << 5) - hash + s.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}
function fallbackCode(slug, productId) {
  const seed = slug && slug.trim() ? slug : String(productId ?? '');
  const n = hashStringToInt(seed) % 1_000_000;
  return `STK-${String(n).padStart(6, '0')}`;
}

async function main() {
  console.log(`Backfill başlıyor${DRY_RUN ? ' (DRY_RUN — yazma yok)' : ''}.`);

  const need = await prisma.orderItem.count({
    where: { internalCodeSnapshot: null },
  });
  console.log(`snapshot'ı NULL kalem: ${need}`);

  // ── 1) productId DOLU → canlı üründen ───────────────────────────────────
  let step1 = 0;
  if (!DRY_RUN) {
    step1 = await prisma.$executeRaw`
      UPDATE "OrderItem" AS oi
      SET "internalCodeSnapshot" = p."internalCode",
          "publicBarcodeSnapshot" = p."publicBarcode"
      FROM "Product" AS p
      WHERE oi."productId" = p."id"
        AND oi."internalCodeSnapshot" IS NULL
    `;
  } else {
    step1 = await prisma.orderItem.count({
      where: { internalCodeSnapshot: null, productId: { not: null } },
    });
  }
  console.log(`1) productId dolu → canlı üründen dolduruldu: ${step1}`);

  // ── Kalan: productId NULL (silinmiş ürün), snapshot hâlâ NULL ────────────
  const orphan = await prisma.orderItem.findMany({
    where: { internalCodeSnapshot: null, productId: null },
    select: { id: true, productSlug: true },
  });
  console.log(`kalan (productId NULL) kalem: ${orphan.length}`);

  // Yaşayan ürünle slug eşleşmesi → kurtarılabilir kod haritası.
  const slugs = [...new Set(orphan.map((o) => o.productSlug))];
  const alive = await prisma.product.findMany({
    where: { slug: { in: slugs } },
    select: { slug: true, internalCode: true, publicBarcode: true },
  });
  const recover = new Map(
    alive.map((p) => [p.slug, { ic: p.internalCode, pb: p.publicBarcode }]),
  );
  console.log(`2) slug eşleşmesiyle kurtarılabilir benzersiz slug: ${recover.size}`);

  let step2 = 0;
  let step3 = 0;
  for (const it of orphan) {
    const hit = recover.get(it.productSlug);
    const data = hit
      ? { internalCodeSnapshot: hit.ic, publicBarcodeSnapshot: hit.pb }
      : { internalCodeSnapshot: fallbackCode(it.productSlug, null) };
    if (hit) step2++;
    else step3++;
    if (!DRY_RUN) {
      await prisma.orderItem.update({ where: { id: it.id }, data });
    }
  }
  console.log(`2) kurtarılan kalem: ${step2}`);
  console.log(`3) sentetik STK kod verilen (kurtarılamaz) kalem: ${step3}`);

  const remaining = await prisma.orderItem.count({
    where: { internalCodeSnapshot: null },
  });
  console.log(`Bitti. Kalan snapshot'ı NULL kalem: ${remaining}`);
}

main()
  .catch((e) => {
    console.error('HATA:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

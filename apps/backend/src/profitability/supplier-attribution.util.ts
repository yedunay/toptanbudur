import { Prisma } from '@prisma/client';

// ──────────────────────────────────────────────────────────────────────────
//  TEDARİKÇİ ATFI — TEK KAYNAK (single source of truth)
//
//  Bir sipariş kaleminin hangi tedarikçiye ait olduğu HER YERDE aynı öncelikle
//  çözülür:
//
//      supplierIdOverride  →  supplierIdSnapshot  →  product.supplierId
//
//  • supplierIdOverride : bayinin FİİLEN alım yaptığı tedarikçi (auto-route /
//    "daha ucuz" önerisi). Varsa her şeyi ezer.
//  • supplierIdSnapshot : sipariş anındaki tedarikçi snapshot'ı. Ürün
//    hard-delete edilse (productId → SET NULL) bile atıf korunur; ürün
//    sonradan başka tedarikçiye taşınsa bile sipariş anındaki gerçek
//    tedarikçiyi yansıtır (tarihsel doğruluk). costPriceSnapshot ile eş koruma.
//  • product.supplierId : snapshot'ı olmayan (backfill öncesi) kalemler için
//    güncel ürün tedarikçisine düşüş.
//
//  Hem rapor WHERE filtreleri (supplierMatchOr) hem de aggregate çözümlemesi
//  (resolveSupplierId) bu dosyayı kullanır — ikisi BİRBİRİNDEN ASLA SAPMASIN
//  diye. Sapma, "tedarikçi X'i filtrele" sonucuyla "tedarikçi X'e atfedilen
//  toplam" arasında tutarsızlık yaratır.
// ──────────────────────────────────────────────────────────────────────────

/**
 * "Bu kalem `supplierId` tedarikçisine mi ait?" sorusunu çözümleme önceliğini
 * BİREBİR yansıtarak bir Prisma OR filtresine çevirir. Hard-delete edilmiş
 * (productId null) kalemler snapshot dalıyla yakalanır.
 */
export function supplierMatchOr(
  supplierId: string,
): Prisma.OrderItemWhereInput[] {
  return [
    // 1) Override doğrudan eşleşiyor (snapshot/product'a bakılmaz).
    { supplierIdOverride: supplierId },
    // 2) Override yok, snapshot eşleşiyor (silinmiş ürünler dahil).
    { supplierIdOverride: null, supplierIdSnapshot: supplierId },
    // 3) Override ve snapshot yok, güncel ürün tedarikçisi eşleşiyor.
    {
      supplierIdOverride: null,
      supplierIdSnapshot: null,
      product: { supplierId },
    },
  ];
}

/**
 * Atfı tamamen kaybolmuş (override/snapshot/product yok) kalemler için sentetik
 * tedarikçi kovası — TÜM raporlar (karlılık, cari, business-reports) aynı kimliği
 * kullansın diye TEK KAYNAK. Aksi halde aynı kalem farklı raporlarda
 * '__deleted__' / 'unknown' / isim-anahtarı gibi farklı kovalara düşer.
 */
export const DELETED_SUPPLIER_ID = '__deleted__';
export const DELETED_SUPPLIER_NAME = 'Ürün Silinmiş';

/** resolveSupplierId'nin ihtiyaç duyduğu minimal kalem şekli. */
export interface SupplierAttributableItem {
  supplierIdOverride?: string | null;
  supplierIdSnapshot?: string | null;
  product?: { supplierId?: string | null } | null;
}

/**
 * Kalemin atfedildiği tedarikçi kimliği. override → snapshot → product.
 * Hiçbiri yoksa null (çağıran "Ürün Silinmiş" kovasına yazar).
 */
export function resolveSupplierId(item: SupplierAttributableItem): string | null {
  return (
    item.supplierIdOverride ??
    item.supplierIdSnapshot ??
    item.product?.supplierId ??
    null
  );
}

/** resolveSupplier'ın ihtiyaç duyduğu kalem şekli (id + ad alanları). */
export interface SupplierResolvableItem extends SupplierAttributableItem {
  supplierOverride?: { name?: string | null } | null;
  supplierNameSnapshot?: string | null;
  product?: {
    supplierId?: string | null;
    supplier?: { name?: string | null } | null;
  } | null;
}

/**
 * Kalemin tedarikçi kimliği VE adını TEK çözümlemeyle döndürür — ad daima
 * çözülen id ile UYUMLU olur (eski kod id'yi override→snapshot→product, adı ise
 * override→product→snapshot ile çözüyordu; ürün başka tedarikçiye taşınınca
 * kova yanlış adla etiketleniyordu).
 *
 * Ad seçimi, id'yi belirleyen dala göre yapılır:
 *  - override kazandıysa  → override adı (yoksa snapshot adı)
 *  - snapshot kazandıysa  → ürün HÂLÂ aynı tedarikçideyse onun GÜNCEL adı
 *    (yeniden adlandırma yansısın), değilse snapshot adı (tarihsel doğruluk)
 *  - product kazandıysa   → ürünün güncel tedarikçi adı
 *  - hiçbiri yoksa        → fallback (varsayılan "Ürün Silinmiş")
 */
export function resolveSupplier(
  item: SupplierResolvableItem,
  fallback: string = DELETED_SUPPLIER_NAME,
): { id: string | null; name: string } {
  if (item.supplierIdOverride) {
    return {
      id: item.supplierIdOverride,
      name: item.supplierOverride?.name ?? item.supplierNameSnapshot ?? fallback,
    };
  }
  if (item.supplierIdSnapshot) {
    // Ürün hâlâ snapshot'taki tedarikçideyse güncel adını tercih et (rename),
    // taşınmış/silinmişse snapshot adına düş (atıf-id ile uyumlu kalır).
    const liveName =
      item.product?.supplierId === item.supplierIdSnapshot
        ? item.product?.supplier?.name
        : null;
    return {
      id: item.supplierIdSnapshot,
      name: liveName ?? item.supplierNameSnapshot ?? fallback,
    };
  }
  if (item.product?.supplierId) {
    return {
      id: item.product.supplierId,
      name: item.product.supplier?.name ?? fallback,
    };
  }
  return { id: null, name: fallback };
}

// PrismaService (PrismaClient) ve $transaction client'ının ortak alt kümesi —
// PrismaClient, TransactionClient'a yapısal olarak atanabilir, ikisi de geçer.
type SnapshotDb = Prisma.TransactionClient;

/**
 * SAVUNMA HATTI — ürünleri hard-delete ETMEDEN ÖNCE çağrılır. Silinecek
 * ürünlere bağlı, henüz snapshot'ı OLMAYAN sipariş kalemlerine İKİ snapshot
 * grubunu yazar:
 *   1) TEDARİKÇİ atfı (supplierIdSnapshot/supplierNameSnapshot) → karlılık/cari
 *      raporu ürün silinse bile doğru tedarikçiye atfeder.
 *   2) MÜŞTERİ-yüzlü stok kodu (internalCodeSnapshot/publicBarcodeSnapshot) →
 *      e-faturada gösterilen "Stok Kodu" donar; ürün silinince ASLA URL slug'ına
 *      düşmez. (Bu, slug-sızıntı bug'ının yapısal savunmasıdır.)
 *
 * Sipariş anında snapshot zaten yazıldığı için (orders.service) normalde
 * eşleşen satır ~0'dır; bu yalnızca eski/backfill öncesi kalemler ve
 * snapshot'ı atlayan olası yeni kod yolları için güvenlik ağıdır → ucuz.
 * Yalnızca snapshot'ı null olan satırlara dokunur (mevcut snapshot'ı EZMEZ).
 *
 * @returns tedarikçi snapshot'ı doldurulan kalem sayısı.
 */
export async function snapshotSupplierBeforeProductDelete(
  db: SnapshotDb,
  where: Prisma.ProductWhereInput,
): Promise<number> {
  const products = await db.product.findMany({
    where,
    select: { id: true, supplierId: true, supplier: { select: { name: true } } },
  });
  if (products.length === 0) return 0;

  // Tedarikçiye göre grupla — updateMany tek seferde tek tedarikçi/ad yazar.
  const bySupplier = new Map<string, { name: string | null; ids: string[] }>();
  const allIds: string[] = [];
  for (const p of products) {
    allIds.push(p.id);
    if (!p.supplierId) continue;
    const entry =
      bySupplier.get(p.supplierId) ?? { name: p.supplier?.name ?? null, ids: [] };
    entry.ids.push(p.id);
    bySupplier.set(p.supplierId, entry);
  }

  let filled = 0;
  for (const [supplierId, { name, ids }] of bySupplier) {
    // PG parametre limiti için chunk'la.
    for (let i = 0; i < ids.length; i += 1000) {
      const chunk = ids.slice(i, i + 1000);
      const res = await db.orderItem.updateMany({
        where: { productId: { in: chunk }, supplierIdSnapshot: null },
        data: { supplierIdSnapshot: supplierId, supplierNameSnapshot: name },
      });
      filled += res.count;
    }
  }

  // MÜŞTERİ-yüzlü kod snapshot'ı: her ürünün kendi internalCode/publicBarcode'u
  // farklı olduğundan grupla­namaz → tek raw UPDATE...FROM ile join ederek toplu
  // doldururuz (ürün başına ayrı sorgu yerine chunk başına 1 sorgu; binlerce
  // ürünlük tedarikçi silmesinde bile hızlı). Yalnız snapshot'ı null olan
  // kalemlere dokunulur (mevcut donmuş kodu EZMEZ).
  for (let i = 0; i < allIds.length; i += 1000) {
    const chunk = allIds.slice(i, i + 1000);
    await db.$executeRaw`
      UPDATE "OrderItem" AS oi
      SET "internalCodeSnapshot" = p."internalCode",
          "publicBarcodeSnapshot" = p."publicBarcode"
      FROM "Product" AS p
      WHERE oi."productId" = p."id"
        AND oi."productId" IN (${Prisma.join(chunk)})
        AND oi."internalCodeSnapshot" IS NULL
    `;
  }

  return filled;
}

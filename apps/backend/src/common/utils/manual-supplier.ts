import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';

/**
 * Manuel ürünler için tenant başına tek "Manuel Ürünler" supplier kaydı
 * üretir. Admin panelden elle eklenen ürünler herhangi bir XML feed'e bağlı
 * olmadığı için (feedId=null) yine de bir supplier'a sahip olmalıdır;
 * Product.supplierId NOT NULL'dur.
 *
 * Slug `manual` sabittir; manuel ürünleri tedarikçi bazlı sorgularda
 * ayırt etmek için kullanılır.
 *
 * Idempotent: aynı tenantId için tekrar tekrar çağrılabilir, ilkinde
 * yaratır sonrakilerde mevcut kaydı döndürür. `(tenantId, slug)` üzerinde
 * Supplier modeli unique constraint taşımıyor — bu yüzden findFirst ile
 * yoklayıp yoksa create ediyoruz; eşzamanlı çift create riskine karşı
 * P2002 hatasını yutup tekrar arama yapıyoruz.
 */

const MANUAL_SUPPLIER_NAME = 'Manuel Ürünler';
const MANUAL_SUPPLIER_SLUG_MARKER = 'manual';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

export async function ensureManualSupplier(
  prisma: PrismaLike,
  tenantId: string,
): Promise<{ id: string; tenantId: string }> {
  const existing = await prisma.supplier.findFirst({
    where: { tenantId, name: MANUAL_SUPPLIER_NAME },
    select: { id: true, tenantId: true },
  });
  if (existing) return existing;

  try {
    const created = await prisma.supplier.create({
      data: {
        tenantId,
        name: MANUAL_SUPPLIER_NAME,
        // Manuel ürünlerde fiyat doğrudan admin tarafından girilir; marj
        // hesabı yok. profitMargin'i 0 tutmak ingest tarafındaki kar payı
        // hesaplarının bu kayıtlara dokunmamasını sağlar.
        profitMargin: new Prisma.Decimal(0),
        stockThreshold: 0,
        // Kendi bayi XML feed'imize otomatik dahil olmasın; karar render
        // sırasında supplier slug'ına göre veriliyor.
        includeInOwnFeed: false,
        active: true,
      },
      select: { id: true, tenantId: true },
    });
    return created;
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      const racer = await prisma.supplier.findFirst({
        where: { tenantId, name: MANUAL_SUPPLIER_NAME },
        select: { id: true, tenantId: true },
      });
      if (racer) return racer;
    }
    throw err;
  }
}

export function isManualSupplierName(name: string | null | undefined): boolean {
  return (name ?? '').trim().toLowerCase() === MANUAL_SUPPLIER_NAME.toLowerCase();
}

/// Admin panelden elle eklenen ürünlerin externalCode prefix'i (tek kaynak).
/// Manuel ürünler feedId=null taşır (XML'e bağlı değil); bu prefix onları
/// feed'i silinmiş "yetim" ürünlerden ayırır — manuel ürün üretimi
/// (admin-products) ve dead-orphan purge muafiyeti (stock-reconcile) burayı
/// kullanır.
export const MANUAL_EXTERNAL_PREFIX = 'TBDR-MAN-';

export const MANUAL_SUPPLIER = {
  name: MANUAL_SUPPLIER_NAME,
  slugMarker: MANUAL_SUPPLIER_SLUG_MARKER,
  externalPrefix: MANUAL_EXTERNAL_PREFIX,
} as const;

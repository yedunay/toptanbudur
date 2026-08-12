import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { buildIndex, matchOne, type OurProduct } from './comparison-match.util';

/**
 * Eşleştirme servisi: bizim aktif ürünleri RAM'e alıp indeks kurar, bir rakibin
 * tüm CompetitorProduct'larını eşler ve CompetitorMatch'e yazar.
 *
 * KURAL: İnsan kararları (approved/rejected) ASLA ezilmez — yeniden çalıştırınca
 * yalnız yeni/oto/pending satırlar güncellenir. Eşleşme bulunamayan rakip ürün =
 * "Envanterimizde Olmayan" (match satırı oluşturulmaz).
 *
 * type='supplier' feed'lerde tüm eşleşmeler 'auto' işaretlenir (onay kuyruğuna
 * GİRMEZ; maliyet kıyası kendi içinde çalışır).
 */
@Injectable()
export class ComparisonMatchService {
  private readonly log = new Logger('ComparisonMatch');
  constructor(private readonly prisma: PrismaService) {}

  async runMatch(
    competitorId: string,
    tenantId: string,
  ): Promise<{ auto: number; pending: number; unmatched: number }> {
    const comp = await this.prisma.competitor.findFirst({ where: { id: competitorId, tenantId } });
    if (!comp) return { auto: 0, pending: 0, unmatched: 0 };
    const isSupplier = comp.type === 'supplier';
    const cleanupWords = (comp.cleanupWords as string[]) ?? [];

    // bizim aktif ürünler → indeks
    const ours = await this.prisma.product.findMany({
      where: { tenantId, active: true },
      select: { id: true, name: true, barcode: true, price: true, taxRate: true, stock: true },
    });
    const our: OurProduct[] = ours.map((p) => {
      const tax = p.taxRate != null && Number(p.taxRate) >= 0 && Number(p.taxRate) <= 100 ? Number(p.taxRate) : 20;
      return {
        id: p.id,
        name: p.name ?? '',
        barcode: p.barcode ?? null,
        gross: p.price != null ? Number(p.price) * (1 + tax / 100) : 0,
        stock: p.stock ?? 0,
      };
    });
    const idx = buildIndex(our);

    const products = await this.prisma.competitorProduct.findMany({
      where: { competitorId, active: true },
      select: { id: true, name: true, barcode: true, externalCode: true },
    });
    // insan kararlarını koru: mevcut approved/rejected eşleşmeleri çıkar
    const decided = new Set(
      (
        await this.prisma.competitorMatch.findMany({
          where: { tenantId, status: { in: ['approved', 'rejected'] }, competitorProductId: { in: products.map((p) => p.id) } },
          select: { competitorProductId: true, productId: true },
        })
      ).map((m) => `${m.competitorProductId}:${m.productId}`),
    );

    let auto = 0, pending = 0, unmatched = 0;
    for (const cp of products) {
      const r = matchOne({ name: cp.name, barcode: cp.barcode, externalCode: cp.externalCode, cleanupWords }, idx);
      if (!r) { unmatched++; continue; }
      if (decided.has(`${cp.id}:${r.productId}`)) { continue; } // insan karar vermiş — dokunma
      const status = isSupplier ? 'auto' : r.status;
      await this.prisma.competitorMatch.upsert({
        where: { competitorProductId_productId: { competitorProductId: cp.id, productId: r.productId } },
        create: { tenantId, competitorProductId: cp.id, productId: r.productId, status, confidence: r.confidence, matchedBy: r.matchedBy },
        update: { status, confidence: r.confidence, matchedBy: r.matchedBy },
      });
      if (status === 'pending') pending++; else auto++;
    }
    this.log.log(`match ${comp.name}: oto ${auto} · bekleyen ${pending} · bizde yok ${unmatched}`);
    return { auto, pending, unmatched };
  }
}

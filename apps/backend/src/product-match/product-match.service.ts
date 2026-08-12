import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AppSettingsService } from '../app-settings/app-settings.service';
import { PRODUCT_MATCH_SETTING_KEYS } from './product-match.constants';
import {
  matchKey as buildMatchKey,
  groupConfidence,
  normName,
  signature as sigOf,
  type MatchConfidence,
} from '../common/utils/product-match-key';
import { ProductMatchAiService } from './product-match-ai.service';

interface CandidateRow {
  id: string;
  supplierId: string;
  barcode: string | null;
  name: string;
  price: Prisma.Decimal;
  costPrice: Prisma.Decimal;
  stock: number;
  createdAt: Date;
  matchGroupId: string | null;
  supplier: { stockThreshold: number | null } | null;
}

export interface MatchRecomputeResult {
  scannedProducts: number;
  crossSupplierGroups: number;
  high: number;
  pendingReview: number;
  rejectedSkipped: number;
  membersLinked: number;
  membersUnlinked: number;
  aiMatched: number;
  durationMs: number;
}

/**
 * Çapraz-tedarikçi ürün eşleştirme motoru (Vitrin/Satın-Alma ayrımı).
 *
 * recompute(): kapsam içindeki tedarikçilerin (varsayılan: tüm aktif
 * tedarikçiler) aktif ürünlerini product-match-key.ts anahtarıyla gruplar; ≥2 FARKLI
 * tedarikçi içeren grupları ProductMatchGroup'a yazar ve üyelerin
 * Product.matchGroupId kolonunu set/clear eder. Idempotent.
 *
 * TAM OTOMATİK (onay kuyruğu YOK):
 *  - Tüm deterministik eşleşmeler (EAN+isim / sadece-EAN aynı imza / %100 aynı
 *    isim) doğrudan status='active'. Belirsiz/şüpheli kalanlar AI ile çözülür
 *    (runAiPass, ANTHROPIC_API_KEY gated). Hiç uyuşmayan → katalogda çift kalır.
 * GÜVENLİK:
 *  - Model imzası anahtara gömülü → aynı barkod farklı model ASLA birleşmez.
 *  - status='rejected' grup yeniden kurulmaz (üyeleri çözülür); source='manual'
 *    (admin display pinlemiş) display değişmez. Idempotent.
 */
@Injectable()
export class ProductMatchService {
  private readonly logger = new Logger(ProductMatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly appSettings: AppSettingsService,
    private readonly ai: ProductMatchAiService,
  ) {}

  /**
   * Kapsam tedarikçileri. AppSetting `productmatch.scopeSupplierIds` virgülle
   * ayrılmış supplierId listesi bekler; BOŞ ise tenant'ın tüm AKTİF
   * tedarikçileri kapsama girer (jenerik varsayılan).
   */
  async getScopeSupplierIds(tenantId: string): Promise<string[]> {
    const configured = await this.appSettings.getString(
      PRODUCT_MATCH_SETTING_KEYS.SCOPE_SUPPLIER_IDS,
      '',
    );
    const explicit = configured
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (explicit.length > 0) return explicit;

    const suppliers = await this.prisma.supplier.findMany({
      where: { tenantId, active: true },
      select: { id: true },
    });
    return suppliers.map((s) => s.id);
  }

  async recompute(
    tenantId: string,
    opts?: { supplierIds?: string[] },
  ): Promise<MatchRecomputeResult> {
    const start = Date.now();
    const supplierIds =
      opts?.supplierIds && opts.supplierIds.length > 0
        ? opts.supplierIds
        : await this.getScopeSupplierIds(tenantId);

    if (supplierIds.length < 2) {
      this.logger.warn(
        `product-match.recompute skipped: <2 scope suppliers configured (${supplierIds.length})`,
      );
      return {
        scannedProducts: 0,
        crossSupplierGroups: 0,
        high: 0,
        pendingReview: 0,
        rejectedSkipped: 0,
        membersLinked: 0,
        membersUnlinked: 0,
        aiMatched: 0,
        durationMs: Date.now() - start,
      };
    }

    const products: CandidateRow[] = await this.prisma.product.findMany({
      where: { tenantId, active: true, supplierId: { in: supplierIds } },
      select: {
        id: true,
        supplierId: true,
        barcode: true,
        name: true,
        price: true,
        costPrice: true,
        stock: true,
        createdAt: true,
        matchGroupId: true,
        supplier: { select: { stockThreshold: true } },
      },
    });

    // 1) matchKey ile grupla, yalnız ≥2 FARKLI tedarikçi içeren grupları tut.
    const byKey = new Map<string, CandidateRow[]>();
    for (const p of products) {
      const { key } = buildMatchKey(p.barcode, p.name);
      const bucket = byKey.get(key);
      if (bucket) bucket.push(p);
      else byKey.set(key, [p]);
    }
    const crossGroups: Array<{ key: string; members: CandidateRow[] }> = [];
    for (const [key, members] of byKey) {
      const suppliers = new Set(members.map((m) => m.supplierId));
      if (suppliers.size >= 2) crossGroups.push({ key, members });
    }

    // 2) Mevcut grupları yükle (admin kararlarını korumak için).
    const existingGroups = await this.prisma.productMatchGroup.findMany({
      where: { tenantId },
      select: {
        id: true,
        matchKey: true,
        status: true,
        source: true,
        displayProductId: true,
      },
    });
    const existingByKey = new Map(existingGroups.map((g) => [g.matchKey, g]));

    let high = 0;
    let pendingReview = 0;
    let rejectedSkipped = 0;
    let crossSupplierGroups = 0;

    // Create/update planı (performans: sıralı create yerine createMany + batched).
    const toCreate: Prisma.ProductMatchGroupCreateManyInput[] = [];
    const toUpdate: Array<{
      id: string;
      confidence: MatchConfidence;
      displayProductId: string;
    }> = [];
    // key → bu gruba ait üye ürünler (id'ler create sonrası requery ile çözülür).
    const keyToMembers = new Map<string, CandidateRow[]>();

    for (const grp of crossGroups) {
      const existing = existingByKey.get(grp.key);

      // Admin reddetmişse: grubu yeniden kurma, üyeleri çöz (desired null kalır).
      if (existing && existing.status === 'rejected') {
        rejectedSkipped++;
        continue;
      }

      const memberIds = new Set(grp.members.map((m) => m.id));
      const winner = this.pickDisplay(grp.members);
      const confidence = groupConfidence(
        grp.members.map((m) => ({ barcode: m.barcode, name: m.name })),
      );

      if (existing) {
        // display: admin pinlemişse (source='manual') ve pinli ürün hâlâ üyeyse koru.
        const keepPinned =
          existing.source === 'manual' &&
          memberIds.has(existing.displayProductId);
        toUpdate.push({
          id: existing.id,
          confidence,
          displayProductId: keepPinned ? existing.displayProductId : winner.id,
        });
      } else {
        // TAM OTOMATİK: deterministik eşleşmeler (EAN+isim / sadece-EAN aynı imza /
        // sadece-isim %100 aynı) onay kuyruğu OLMADAN doğrudan 'active'. Aynı
        // barkod farklı model zaten anahtar gereği gruplanmaz (şüpheli kalmaz).
        toCreate.push({
          tenantId,
          matchKey: grp.key,
          displayProductId: winner.id,
          confidence,
          status: 'active',
          source: 'auto',
        });
      }

      keyToMembers.set(grp.key, grp.members);
      crossSupplierGroups++;
      if (confidence === 'high') high++;
      else pendingReview++;
    }

    // createMany (tek round-trip) — matchKey @@unique → skipDuplicates güvenli.
    if (toCreate.length > 0) {
      await this.prisma.productMatchGroup.createMany({
        data: toCreate,
        skipDuplicates: true,
      });
    }
    // update'ler (steady-state'te az; ilk çalıştırmada genelde 0).
    for (const u of toUpdate) {
      await this.prisma.productMatchGroup.update({
        where: { id: u.id },
        data: { confidence: u.confidence, displayProductId: u.displayProductId },
      });
    }

    // 3) key → groupId haritasını (create sonrası) requery ile çöz.
    const wantKeys = [...keyToMembers.keys()];
    const keyToId = new Map<string, string>();
    const KEY_CHUNK = 1000;
    for (let i = 0; i < wantKeys.length; i += KEY_CHUNK) {
      const chunk = wantKeys.slice(i, i + KEY_CHUNK);
      const rows = await this.prisma.productMatchGroup.findMany({
        where: { tenantId, matchKey: { in: chunk } },
        select: { id: true, matchKey: true },
      });
      for (const r of rows) keyToId.set(r.matchKey, r.id);
    }

    // desired: her aday ürün için olması gereken matchGroupId (null = grupsuz).
    const desired = new Map<string, string | null>();
    for (const p of products) desired.set(p.id, null);
    for (const [key, members] of keyToMembers) {
      const gid = keyToId.get(key);
      if (!gid) continue;
      for (const m of members) desired.set(m.id, gid);
    }

    // 4) Üyelik diff'ini uygula (join + leave), batch'li.
    const toLink: Array<{ id: string; groupId: string }> = [];
    const toUnlink: string[] = [];
    const currentById = new Map(products.map((p) => [p.id, p.matchGroupId]));
    for (const [pid, wantGroupId] of desired) {
      const current = currentById.get(pid) ?? null;
      if (wantGroupId && current !== wantGroupId) {
        toLink.push({ id: pid, groupId: wantGroupId });
      } else if (!wantGroupId && current) {
        toUnlink.push(pid);
      }
    }

    const BATCH = 500;
    if (toLink.length > 0 || toUnlink.length > 0) {
      // Link'leri groupId'ye göre grupla → updateMany ile toplu yaz.
      const linkByGroup = new Map<string, string[]>();
      for (const l of toLink) {
        const arr = linkByGroup.get(l.groupId);
        if (arr) arr.push(l.id);
        else linkByGroup.set(l.groupId, [l.id]);
      }
      await this.prisma.$transaction(
        async (tx) => {
          for (const [gid, ids] of linkByGroup) {
            for (let i = 0; i < ids.length; i += BATCH) {
              await tx.product.updateMany({
                where: { id: { in: ids.slice(i, i + BATCH) } },
                data: { matchGroupId: gid },
              });
            }
          }
          for (let i = 0; i < toUnlink.length; i += BATCH) {
            await tx.product.updateMany({
              where: { id: { in: toUnlink.slice(i, i + BATCH) } },
              data: { matchGroupId: null },
            });
          }
        },
        { timeout: 120_000 },
      );
    }

    // 5) AI geçişi — deterministik birleştirmeden SONRA kalan şüphelileri
    // (aynı marka + aynı model imzası, hâlâ grupsuz, ≥2 tedarikçi) yapay zekâ
    // ile çözer. ANTHROPIC_API_KEY yoksa NO-OP.
    let aiMatched = 0;
    if (this.ai.isEnabled()) {
      try {
        aiMatched = await this.runAiPass(tenantId, supplierIds);
      } catch (e) {
        this.logger.warn(
          `product-match AI pass failed (tenant=${tenantId}): ${(e as Error).message}`,
        );
      }
    }

    const durationMs = Date.now() - start;
    this.logger.log(
      `product-match.recompute { tenantId:'${tenantId}', scanned:${products.length}, crossGroups:${crossSupplierGroups}, high:${high}, pending:${pendingReview}, rejectedSkipped:${rejectedSkipped}, linked:${toLink.length}, unlinked:${toUnlink.length}, aiMatched:${aiMatched}, durationMs:${durationMs} }`,
    );

    return {
      scannedProducts: products.length,
      crossSupplierGroups,
      high,
      pendingReview,
      rejectedSkipped,
      membersLinked: toLink.length,
      membersUnlinked: toUnlink.length,
      aiMatched,
      durationMs,
    };
  }

  /**
   * AI geçişi: hâlâ grupsuz scope ürünlerini (marka, model imzası) ile bucket'lar;
   * ≥2 farklı tedarikçi içeren bucket'ları yapay zekâya sorar; "aynı" denen
   * kümeler için ProductMatchGroup (confidence 'low_fuzzy', status 'active',
   * source 'ai') kurar ve üyeleri bağlar. Maliyet/oran sınırı: en fazla
   * AI_MAX_BUCKETS bucket işlenir; aşılırsa loglanır (sessiz kırpma yok).
   */
  private async runAiPass(
    tenantId: string,
    supplierIds: string[],
  ): Promise<number> {
    const AI_MAX_BUCKETS = Number(process.env.PRODUCT_MATCH_AI_MAX_BUCKETS || 300);

    const unmatched = await this.prisma.product.findMany({
      where: {
        tenantId,
        active: true,
        stock: { gt: 0 },
        supplierId: { in: supplierIds },
        matchGroupId: null,
      },
      select: {
        id: true,
        supplierId: true,
        barcode: true,
        name: true,
        price: true,
        costPrice: true,
        stock: true,
        createdAt: true,
        matchGroupId: true,
        supplier: { select: { stockThreshold: true } },
      },
    });
    if (unmatched.length < 2) return 0;

    // (normName ilk token = marka) + model imzası ile bucket.
    const buckets = new Map<string, CandidateRow[]>();
    for (const p of unmatched) {
      const nn = normName(p.name);
      const brand = nn.split(' ')[0] ?? '';
      const key = `${brand}#${sigOf(nn)}`;
      const b = buckets.get(key);
      if (b) b.push(p);
      else buckets.set(key, [p]);
    }

    const supplierName = new Map<string, string>();
    {
      const sup = await this.prisma.supplier.findMany({
        where: { id: { in: supplierIds } },
        select: { id: true, name: true },
      });
      for (const s of sup) supplierName.set(s.id, s.name);
    }

    // ≥2 farklı tedarikçili bucket'ları seç.
    const eligible: CandidateRow[][] = [];
    for (const arr of buckets.values()) {
      if (arr.length < 2) continue;
      if (new Set(arr.map((x) => x.supplierId)).size < 2) continue;
      eligible.push(arr);
    }
    if (eligible.length > AI_MAX_BUCKETS) {
      this.logger.warn(
        `product-match AI: ${eligible.length} eligible bucket > limit ${AI_MAX_BUCKETS}; ` +
          `processing first ${AI_MAX_BUCKETS} (kalanı sonraki recompute'ta).`,
      );
    }

    const byId = new Map(unmatched.map((p) => [p.id, p]));
    let created = 0;
    for (const arr of eligible.slice(0, AI_MAX_BUCKETS)) {
      const clusters = await this.ai.clusterSameProducts(
        arr.map((p) => ({
          id: p.id,
          supplier: supplierName.get(p.supplierId) ?? p.supplierId,
          name: p.name,
        })),
      );
      for (const ids of clusters) {
        const members = ids.map((id) => byId.get(id)).filter(Boolean) as CandidateRow[];
        if (members.length < 2) continue;
        if (members.some((m) => m.matchGroupId !== null)) continue; // başka kümeye girmiş
        const matchKey = `ai:${[...ids].sort()[0]}`;
        // Admin daha önce bu kümeyi reddettiyse (tombstone) yeniden kurma.
        const existing = await this.prisma.productMatchGroup.findUnique({
          where: { tenantId_matchKey: { tenantId, matchKey } },
          select: { id: true, status: true },
        });
        if (existing) continue;
        const display = this.pickDisplay(members);
        try {
          const created1 = await this.prisma.productMatchGroup.create({
            data: {
              tenantId,
              matchKey,
              displayProductId: display.id,
              confidence: 'low_fuzzy',
              status: 'active',
              source: 'ai',
            },
            select: { id: true },
          });
          await this.prisma.product.updateMany({
            where: { id: { in: members.map((m) => m.id) } },
            data: { matchGroupId: created1.id },
          });
          for (const m of members) m.matchGroupId = created1.id;
          created++;
        } catch (e) {
          this.logger.warn(
            `product-match AI group create skipped (${matchKey}): ${(e as Error).message}`,
          );
        }
      }
    }
    return created;
  }

  /**
   * Vitrin (display) ürünü seç: önce stoktakiler (effectiveStock>0); aday grubu
   * içinde en pahalı (price DESC → stock DESC → createdAt DESC → id ASC).
   * ProductDedupService.pickWinner ile aynı mantık.
   */
  private pickDisplay(members: CandidateRow[]): CandidateRow {
    const flagged = members.map((p) => {
      const threshold = p.supplier?.stockThreshold ?? 0;
      const effectiveStock =
        threshold > 0 && p.stock < threshold ? 0 : p.stock;
      return { p, inStock: effectiveStock > 0 };
    });
    const anyInStock = flagged.some((x) => x.inStock);
    const candidates = (anyInStock ? flagged.filter((x) => x.inStock) : flagged).map(
      (x) => x.p,
    );
    let best = candidates[0];
    for (let i = 1; i < candidates.length; i++) {
      if (this.beats(candidates[i], best)) best = candidates[i];
    }
    return best;
  }

  private beats(a: CandidateRow, b: CandidateRow): boolean {
    const priceCmp = a.price.comparedTo(b.price);
    if (priceCmp !== 0) return priceCmp > 0;
    if (a.stock !== b.stock) return a.stock > b.stock;
    const ta = a.createdAt.getTime();
    const tb = b.createdAt.getTime();
    if (ta !== tb) return ta > tb;
    return a.id < b.id;
  }

  /** Güven seviyesinden status türet (yeni grup oluştururken). */
  static statusFor(confidence: MatchConfidence): 'active' | 'pending_review' {
    return confidence === 'high' ? 'active' : 'pending_review';
  }
}

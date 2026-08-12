import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import { XmlParserService } from '../ingest/xml-parser.service';
import { ProductDedupService } from '../product-core/product-dedup.service';
import { assertSafeFeedUrl } from '../common/utils/safe-feed-url';
import { MANUAL_EXTERNAL_PREFIX } from '../common/utils/manual-supplier';

export interface SupplierReconcileResult {
  supplierId: string;
  supplierName: string;
  ok: boolean;
  skippedReason: string | null;
  feedCount: number;
  liveCodeCount: number;
  activeWithStock: number;
  zeroed: number;
}

export interface ReconcileRunResult {
  startedAt: string;
  durationMs: number;
  suppliers: SupplierReconcileResult[];
  totalZeroed: number;
}

/**
 * Stok mutabakatı (reconcile) — tedarikçi feed'lerinde ARTIK BULUNMAYAN
 * ürünlerin stoğunu 0'a çeker (hem mağaza vitrini hem bayi XML çıktısı 0 görür,
 * marketplaceListed=false ile pazaryeri listelemesinden de düşer).
 *
 * NEDEN AYRI BİR SERVİS:
 * Normal ingest "deactivation" adımı `WHERE feedId = <feed>` ile çalışıyor.
 * Bir SupplierFeed silindiğinde Prisma `onDelete: SetNull` kuralı o feed'in
 * ürünlerinin feedId'sini NULL yapıyor; bu yetim ürünleri hiçbir feed senkronu
 * temizleyemiyordu. Tedarikçi (örn. bir XML tedarikçisi) stoğu biteni feed'den komple
 * sildiği için bu yetimler "stokta" görünüp HAYALET SATIŞA yol açtı.
 *
 * Bu servis feedId'ye HİÇ bakmaz: tedarikçinin TÜM aktif feed'lerini canlı
 * indirir, gerçek ürün kodları kümesini çıkarır, bu kümede olmayan her
 * aktif+stoklu ürünü stock=0 + marketplaceListed=false yapar.
 *
 * GÜVENLİK:
 *  - Bir feed bile indirilemez/parse edilemezse o tedarikçi ATLANIR — eksik
 *    kod kümesiyle yanlışlıkla tüm katalog sıfırlanmasın.
 *  - Sıfırlanacak ürün oranı canlı sellable katalogun MAX_ZERO_RATIO'sunu
 *    aşarsa iptal edilir (staleness guard) ve manuel inceleme için log düşer.
 *  - Stoğa geri dönen ürünler normal ingest senkronu tarafından otomatik
 *    düzeltilir (feed stoğu ≠ DB stoğu → upsert → stok geri yazılır).
 */
@Injectable()
export class StockReconcileService {
  private readonly logger = new Logger(StockReconcileService.name);

  /// Sıfırlanacak ürün oranı bu eşiği aşarsa tedarikçi atlanır — YALNIZ baseline
  /// yokken (ingest henüz feed sayısını yazmadıysa) emniyet ağı olarak kullanılır.
  /// Baseline varsa truncation kontrolü feed sayısına göre yapılır (#lockout-fix).
  private readonly MAX_ZERO_RATIO = Number(
    process.env.STOCK_RECONCILE_MAX_RATIO ?? '0.5',
  );

  /// #lockout-fix — Feed truncation eşiği: bir feed'in canlı ürün sayısı, son
  /// sağlıklı sayısının (SupplierFeed.lastFeedItemCount, ingest yazar) bu
  /// oranından aşağı düşerse feed bozuk kabul edilir ve tedarikçi atlanır.
  /// Meşru büyük churn (kod şeması değişimi) feed sayısını düşürmediği için
  /// kalıcı kilit oluşturmaz.
  private readonly FEED_DROP_FACTOR = Number(
    process.env.STOCK_RECONCILE_FEED_DROP_FACTOR ?? '0.5',
  );

  /// Baseline truncation kontrolü için minimum feed büyüklüğü — küçük feed'lerde
  /// gürültüyü önler.
  private readonly MIN_FEED_ITEMS = Number(
    process.env.STOCK_RECONCILE_MIN_FEED_ITEMS ?? '50',
  );

  /// "Ölü yetim" eşiği (gün) — stok=0 + feedId=NULL bir ürün bu kadar gün
  /// böyle kalırsa tamamen pasiflenir (purgeDeadOrphans).
  private readonly DEAD_ORPHAN_DAYS = Number(
    process.env.STOCK_DEAD_ORPHAN_DAYS ?? '7',
  );

  /// Stoğu bu kadar gündür 0 olan ürünler PASİFE ALINIR (SİLİNMEZ) —
  /// purgeZeroStockProducts. Kayıt + tbdr (internalCode) korunur; stok gelince
  /// ingest aynı ürünü externalCode'dan bulup yeniden aktif eder → eski tbdr ile
  /// devam. Manuel eklenen ürünler (TBDR-MAN-… / manualStock dolu) MUAF.
  private readonly DELETE_ZERO_AFTER_DAYS = Number(
    process.env.STOCK_DELETE_ZERO_AFTER_DAYS ?? '3',
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly xml: XmlParserService,
    private readonly productDedup: ProductDedupService,
  ) {}

  /**
   * outOfStockSince bakımı: efektif stoğu 0 olan ürünlere (ilk kez) zaman
   * damgası basar, stoğa dönenlerde temizler. Müşteri XML feed'i bu alana
   * göre 3+ gündür 0 stoklu ürünleri çıktıdan eler. Tüm stok=0 yollarını
   * (ingest, stale-delist, reconcile) tek noktada kapsasın diye iki global
   * UPDATE ile çalışır. Cron (3 saatte bir) çağırır; deploy sonrası bir kez
   * elle de tetiklenebilir.
   */
  async maintainOutOfStockSince(): Promise<{ marked: number; cleared: number }> {
    const marked = await this.prisma.$executeRaw`
      UPDATE "Product" SET "outOfStockSince" = NOW()
      WHERE "stock" = 0 AND "outOfStockSince" IS NULL
    `;
    const cleared = await this.prisma.$executeRaw`
      UPDATE "Product" SET "outOfStockSince" = NULL
      WHERE "stock" > 0 AND "outOfStockSince" IS NOT NULL
    `;
    this.logger.log(
      `outOfStockSince bakım: marked=${Number(marked)} cleared=${Number(cleared)}`,
    );
    return { marked: Number(marked), cleared: Number(cleared) };
  }

  /**
   * 3+ gündür stoğu 0 olan ürünleri katalogdan düşürür — SİLMEZ, PASİFE ALIR
   * (active=false, marketplaceListed=false).
   *
   * KULLANICI KARARI (2026-07-30): 0-stok ürünler ARTIK SİLİNMEZ. Eski davranış
   * (DB'den deleteMany) stok geri gelince ürünü YENİ TBDR koduyla yeniden
   * ürettiriyordu — tedarikçi tatilinde yüzlerce ürün yeni kod aldı, eski kodlar
   * kayboldu. Pasife alınca Product kaydı + `internalCode` (tbdr) KORUNUR; stok
   * gelince ingest aynı ürünü externalCode'dan bulup finalActive ile yeniden
   * AKTİF eder → ESKİ tbdr ile devam eder (yeni kod üretilmez).
   *
   *  - Yalnızca `stock = 0` VE `outOfStockSince <= now - N gün` VE hâlâ aktif.
   *    (0-stok ürün genelde ingest'te zaten pasiflenir; bu, sipariş tüketimiyle
   *    aktif kalan uç kalanları da güvenceye alır.)
   *  - MANUEL ürünler MUAF (externalCode `TBDR-MAN-…` / manualStock dolu).
   *  - HİÇBİR SİLME YOK → sipariş/iade/görsel/tbdr geçmişi tam korunur.
   */
  async purgeZeroStockProducts(): Promise<{ deactivated: number }> {
    const cutoff = new Date(
      Date.now() - this.DELETE_ZERO_AFTER_DAYS * 24 * 3600 * 1000,
    );

    const res = await this.prisma.product.updateMany({
      where: {
        stock: 0,
        active: true,
        outOfStockSince: { not: null, lte: cutoff },
        manualStock: null,
        externalCode: { not: { startsWith: MANUAL_EXTERNAL_PREFIX } },
      },
      data: { active: false, marketplaceListed: false },
    });

    if (res.count > 0) {
      this.logger.log(
        `zero-stock deactivate: ${res.count} ürün pasife alındı ` +
          `(stok=0 + ${this.DELETE_ZERO_AFTER_DAYS}+ gün; SİLİNMEDİ → tbdr korundu, manuel muaf)`,
      );
    }
    return { deactivated: res.count };
  }

  /// Tüm aktif tedarikçiler için mutabakat. Cron buradan çağırır.
  async reconcileAll(): Promise<ReconcileRunResult> {
    const startedAt = new Date();

    // Aktif feed'i olan + kendisi aktif tedarikçiler.
    const feeds = await this.prisma.supplierFeed.findMany({
      where: { active: true, supplier: { active: true } },
      select: { supplierId: true },
    });
    const supplierIds = [...new Set(feeds.map((f) => f.supplierId))];

    const results: SupplierReconcileResult[] = [];
    for (const supplierId of supplierIds) {
      try {
        results.push(await this.reconcileSupplier(supplierId));
      } catch (err) {
        this.logger.error(
          `reconcileSupplier failed supplier=${supplierId}: ${(err as Error).message}`,
        );
        results.push({
          supplierId,
          supplierName: supplierId,
          ok: false,
          skippedReason: `error: ${(err as Error).message}`,
          feedCount: 0,
          liveCodeCount: 0,
          activeWithStock: 0,
          zeroed: 0,
        });
      }
    }

    const totalZeroed = results.reduce((a, r) => a + r.zeroed, 0);
    const durationMs = Date.now() - startedAt.getTime();
    this.logger.log(
      `stock-reconcile tamamlandı: ${supplierIds.length} tedarikçi, ` +
        `${totalZeroed} ürün stock=0, ${durationMs}ms`,
    );
    return {
      startedAt: startedAt.toISOString(),
      durationMs,
      suppliers: results,
      totalZeroed,
    };
  }

  /// Tek tedarikçi mutabakatı. Tüm aktif feed'lerini indirir, kayıp ürünleri
  /// stock=0 yapar.
  async reconcileSupplier(
    supplierId: string,
  ): Promise<SupplierReconcileResult> {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { id: true, name: true, tenantId: true, active: true },
    });

    const feeds = await this.prisma.supplierFeed.findMany({
      where: { supplierId, active: true },
      select: {
        id: true,
        name: true,
        feedUrl: true,
        lastFeedItemCount: true,
      },
    });

    const base = (
      over: Partial<SupplierReconcileResult>,
    ): SupplierReconcileResult => ({
      supplierId,
      supplierName: supplier?.name ?? supplierId,
      ok: true,
      skippedReason: null,
      feedCount: feeds.length,
      liveCodeCount: 0,
      activeWithStock: 0,
      zeroed: 0,
      ...over,
    });

    if (!supplier || !supplier.active) {
      return base({ ok: true, skippedReason: 'supplier_inactive' });
    }
    if (feeds.length === 0) {
      return base({ ok: true, skippedReason: 'no_active_feed' });
    }

    // TÜM feed'leri canlı indir. Bir tanesi bile başarısızsa tüm tedarikçiyi
    // atla — eksik kod kümesiyle yanlış toplu sıfırlama yapmayalım.
    // Ayrıca her feed KENDİ baseline'ına (lastFeedItemCount) göre truncation
    // kontrolünden geçer: canlı sayı, son sağlıklı sayının FEED_DROP_FACTOR'undan
    // aşağı düştüyse feed bozuk demektir → tedarikçi atlanır (#lockout-fix).
    const liveCodes = new Set<string>();
    let anyFeedMissingBaseline = false;
    for (const feed of feeds) {
      const codes = await this.fetchFeedCodes(feed.feedUrl);
      if (codes === null) {
        this.logger.warn(
          `stock-reconcile atlandı: supplier='${supplier.name}' ` +
            `feed='${feed.name}' indirilemedi/parse edilemedi`,
        );
        return base({
          ok: false,
          skippedReason: `feed_fetch_failed: ${feed.name}`,
        });
      }
      const baseline = feed.lastFeedItemCount ?? null;
      if (baseline == null) {
        anyFeedMissingBaseline = true;
      } else if (
        baseline >= this.MIN_FEED_ITEMS &&
        codes.size < baseline * this.FEED_DROP_FACTOR
      ) {
        this.logger.error(
          `stock-reconcile atlandı (feed truncated): supplier='${supplier.name}' ` +
            `feed='${feed.name}' live=${codes.size} baseline=${baseline} ` +
            `(<%${(this.FEED_DROP_FACTOR * 100).toFixed(0)}) — manuel inceleme gerek`,
        );
        return base({
          ok: false,
          skippedReason: `feed_truncated: ${feed.name} live ${codes.size} vs baseline ${baseline}`,
        });
      }
      for (const c of codes) liveCodes.add(c);
    }

    if (liveCodes.size === 0) {
      return base({ ok: false, skippedReason: 'empty_live_codes' });
    }

    // Stoklu ürünler (active durumundan BAĞIMSIZ — #ghost-stock). Eskiden yalnız
    // `active:true` alınıyordu; başka nedenle pasiflenmiş ama hâlâ stoklu bir ürün
    // tedarikçi feed'inden düşse bile sıfırlanmıyor, kirli kalıyor ve tekrar
    // aktifleşince hayalet stokla satışa açılıyordu. Manuel stok override'lı
    // ürünler muaf — admin stoğu sabitlemiş, sıfırlanmaz (ingest guard ile simetrik).
    const stockedProducts = await this.prisma.product.findMany({
      where: {
        tenantId: supplier.tenantId,
        supplierId: supplier.id,
        stock: { gt: 0 },
        manualStock: null,
      },
      select: { id: true, externalCode: true, nameKey: true },
    });

    const phantoms = stockedProducts.filter(
      (p) => !liveCodes.has(p.externalCode),
    );
    const phantomIds = phantoms.map((p) => p.id);

    // Emniyet ağı: bir feed'in baseline'ı YOKSA (ingest henüz yazmadı)
    // truncation kontrolü o feed için yapılamadı → eski oran-guard'ı uygula.
    // Tüm feed'lerin baseline'ı varsa bu blok atlanır; koruma yukarıdaki
    // per-feed truncation kontrolündedir (biriken yetim oranı artık kilit yaratmaz).
    if (
      anyFeedMissingBaseline &&
      stockedProducts.length > 0 &&
      phantomIds.length / stockedProducts.length > this.MAX_ZERO_RATIO
    ) {
      this.logger.error(
        `stock-reconcile staleness guard (no baseline): supplier='${supplier.name}' ` +
          `${phantomIds.length}/${stockedProducts.length} ürün sıfırlanacaktı ` +
          `(>%${(this.MAX_ZERO_RATIO * 100).toFixed(0)}) — İPTAL, manuel inceleme gerek`,
      );
      return base({
        ok: false,
        skippedReason: `staleness_guard: ${phantomIds.length}/${stockedProducts.length}`,
        liveCodeCount: liveCodes.size,
        activeWithStock: stockedProducts.length,
      });
    }

    let zeroed = 0;
    if (phantomIds.length > 0) {
      // Büyük IN listesini parçalara böl.
      for (let i = 0; i < phantomIds.length; i += 1000) {
        const chunk = phantomIds.slice(i, i + 1000);
        const res = await this.prisma.product.updateMany({
          where: { id: { in: chunk } },
          data: { stock: 0, marketplaceListed: false },
        });
        zeroed += res.count;
      }
      this.logger.log(
        `stock-reconcile: supplier='${supplier.name}' ${zeroed} ürün ` +
          `stock=0 (tedarikçi feed'inde artık yok)`,
      );

      // Sıfırlanan ürünlerin isim grupları: 0'a düşen bir canonical, aynı
      // isimdeki STOKLU kardeşine (örn. başka tedarikçi) devretmeli — yoksa
      // feed `isCanonical=true AND stock>0` filtresiyle ürün komple kaybolur.
      // Hedefli recompute (yalnız etkilenen nameKey'ler). Hata yutulur.
      try {
        await this.productDedup.recomputeCanonicalForKeys(
          supplier.tenantId,
          phantoms.map((p) => p.nameKey),
        );
      } catch (e) {
        this.logger.warn(
          `canonical recompute after reconcile failed (supplier='${supplier.name}'): ${(e as Error).message}`,
        );
      }
    }

    return base({
      ok: true,
      liveCodeCount: liveCodes.size,
      activeWithStock: stockedProducts.length,
      zeroed,
    });
  }

  /// "Ölü yetim" temizliği — DEAD_ORPHAN_DAYS gündür stok=0 + feedId=NULL
  /// kalan ürünleri tamamen pasifler (active=false + marketplaceListed=false):
  /// mağaza vitrininden, bayi XML'inden ve pazaryerinden komple kalkarlar.
  ///
  /// Mantık: feedId=NULL = hiçbir feed'e bağlı değil (yetim); stok=0 + bir
  /// hafta hareketsiz = tedarikçide karşılığı yok, geri dönmüyor. Katalogu
  /// şişirmemek için temizlenir. Ürün gerçekten geri gelirse (kodu tekrar bir
  /// feed'de görünürse) normal ingest senkronu upsert ile yeniden aktive eder.
  ///
  /// İSTİSNA: Admin panelden elle eklenen MANUEL ürünler (externalCode
  /// `TBDR-MAN-…`) de feedId=NULL taşır ama "yetim" değildir — admin bilerek
  /// ekledi. Bunlar stoğu 0'a düşse bile pasiflenmez; aksi halde elle eklenen
  /// ürün bir hafta sonra sessizce kaybolurdu. Stok kararı admin'e aittir.
  async purgeDeadOrphans(): Promise<{ deactivated: number }> {
    const cutoff = new Date(
      Date.now() - this.DEAD_ORPHAN_DAYS * 24 * 3600 * 1000,
    );
    const res = await this.prisma.product.updateMany({
      where: {
        active: true,
        stock: 0,
        feedId: null,
        updatedAt: { lt: cutoff },
        // Manuel ürünleri muaf tut — feedId=NULL olmaları onları yetim yapmaz.
        externalCode: { not: { startsWith: MANUAL_EXTERNAL_PREFIX } },
      },
      data: { active: false, marketplaceListed: false },
    });
    if (res.count > 0) {
      this.logger.log(
        `dead-orphan purge: ${res.count} ürün active=false ` +
          `(stok=0 + feedId=NULL + ${this.DEAD_ORPHAN_DAYS}+ gün)`,
      );
    }
    return { deactivated: res.count };
  }

  /// Bir feed URL'ini indirir + parse eder, ürün kodu kümesini döner.
  /// Hata olursa veya hiç ürün çıkmazsa null döner (caller tedarikçiyi atlar).
  private async fetchFeedCodes(feedUrl: string): Promise<Set<string> | null> {
    try {
      await assertSafeFeedUrl(feedUrl);
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), 90_000);
      let xmlText: string;
      try {
        const resp = await axios.get<string>(feedUrl, {
          timeout: 90_000,
          signal: abort.signal as never,
          responseType: 'text',
          maxContentLength: 1024 * 1024 * 200,
          maxBodyLength: 1024 * 1024 * 200,
          headers: {
            'User-Agent':
              'TB-B2B-StockReconcile/1.0 (+https://toptanbudur.com)',
            Accept: 'application/xml, text/xml, text/plain, */*',
            'Accept-Encoding': 'gzip, deflate',
          },
          transformResponse: [
            (d: unknown) => (typeof d === 'string' ? d : String(d)),
          ],
        });
        xmlText = resp.data.replace(/^\uFEFF/, '');
      } finally {
        clearTimeout(timer);
      }

      const parsed = this.xml.parse(xmlText);
      const codes = new Set<string>();
      for (const p of parsed) {
        const code = (p.externalCode ?? '').trim();
        if (code) codes.add(code);
      }
      // Parser hiç ürün bulamadıysa feed bozuk/boş demektir — null dön ki
      // caller tedarikçiyi atlasın (yanlış toplu sıfırlama olmasın).
      return codes.size > 0 ? codes : null;
    } catch (err) {
      this.logger.warn(`feed indirme/parse hatası: ${(err as Error).message}`);
      return null;
    }
  }
}

import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, OrderStatus, SupplierLedgerType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { CariBalanceService } from '../../cari-balance/cari-balance.service';
import { AppSettingsService } from '../../app-settings/app-settings.service';
import { MailService } from '../../mail/mail.service';
import { SupplierAccountService } from '../../supplier-account/supplier-account.service';
import { getMonthlyTopSellers } from '../customers/monthly-top-sellers';
import { topSellerAutoTag } from '../customers/admin-customers.service';
import { STORAGE_SERVICE } from '../../storage/storage.constants';
import type { IFileStorage } from '../../storage/storage.interface';
import { markOrderPaid } from './mark-order-paid.helper';
import { supplierMatchOr } from '../../profitability/supplier-attribution.util';
import {
  trDateRange,
  trDayStart,
  trDayEndExclusive,
  trStartOfDay,
  trAddDays,
} from '../../common/utils/tr-time';
import { getOrderEmailPrefs } from '../../common/utils/notification-prefs';
import { computeNameKey } from '../../common/utils/name-key';
import {
  PRODUCT_MATCH_SETTING_KEYS,
  PRODUCT_MATCH_DEFAULTS,
} from '../../product-match/product-match.constants';
import type { AdminOrderQueryDto } from './dto/admin-order-query.dto';
import type { UpdateOrderDto } from './dto/update-order.dto';
import {
  BULK_UPDATE_MAX,
  type BulkOrderStatus,
  type BulkUpdateOrdersDto,
} from './dto/bulk-update.dto';
import { BadRequestException, ConflictException } from '@nestjs/common';

const DEFAULT_PAGE_SIZE = 30;
const TERMINAL_STATES = new Set(['cancelled', 'refunded']);

// Dashboard istatistikleri için kısa-ömürlü memo TTL'i. Panel /orders'ı ~23sn'de
// bir poll ediyor; ağır istatistik sorgularını 60sn cache'leyince poll başına 6+
// ağır Order sorgusu kalkıyor, liste (rows/total) yine taze kalıyor.
const ORDERS_STATS_TTL_MS = 60_000;

export interface OrdersStats {
  totalRevenue: number;
  today: { count: number; revenue: number };
  yesterday: { count: number; revenue: number };
  topCustomer: {
    customerId: string | null;
    name: string;
    orderCount: number;
    revenue: number;
  } | null;
}

const STATUS_LABELS: Record<string, string> = {
  paid: 'Ödendi',
  preparing: 'Hazırlanıyor',
  shipped: 'Kargoya Verildi',
  cancelled: 'İptal edildi',
  refunded: 'İade edildi',
};

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

// Statü geçiş matrisi (limbo önleme). Detay sayfasındaki STATUS_TRANSITIONS
// (apps/admin/.../OrderDetailPage.tsx) ile birebir aynı kurallar — UI gizlese
// de backend son savunma hattı. cancelled/refunded TERMINAL: geri dönüş YASAK
// (terminalden diriliş cancelOrder'da eklenen stoğu tekrar düşürür → stok
// şişmesi / çift cari iade). awaiting_payment bu matriste YOKTUR — kart ödeme
// callback akışına ait iç durum, admin updateOrder ile zorlanmaz (guard bypass).
const ALLOWED_STATUS_TRANSITIONS: Record<string, ReadonlySet<string>> = {
  paid: new Set(['preparing', 'cancelled']),
  preparing: new Set(['shipped', 'cancelled']),
  shipped: new Set(['refunded']),
  cancelled: new Set<string>(),
  refunded: new Set<string>(),
};

function isAllowedStatusTransition(from: string, to: string): boolean {
  if (from === to) return true; // aynı statü = no-op, izinli
  const allowed = ALLOWED_STATUS_TRANSITIONS[from];
  // from matriste yoksa (örn. awaiting_payment) guard'a takılmaz — mevcut
  // davranış korunur (kart ödeme akışı bozulmasın).
  if (!allowed) return true;
  return allowed.has(to);
}

@Injectable()
export class AdminOrdersService {
  private readonly logger = new Logger(AdminOrdersService.name);
  // Dashboard istatistik memo cache'i — anahtar filtre imzası, değer {at, stats}.
  // Singleton servis olduğu için poll'lar arası kalıcı; sadece küçük sayılar tutar.
  private readonly ordersStatsCache = new Map<
    string,
    { at: number; stats: OrdersStats }
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly cariBalance: CariBalanceService,
    private readonly settings: AppSettingsService,
    private readonly mail: MailService,
    private readonly supplierAccount: SupplierAccountService,
    @Inject(STORAGE_SERVICE) private readonly storage: IFileStorage,
  ) {}

  /**
   * Dashboard istatistikleri (ciro / bugün / dün / top-müşteri / iade) — list()'ten
   * ayrıldı. Sorgular birebir aynı; tek fark çağrı yeri ve 60sn memoize. Liste
   * (rows/total) her zaman taze kalır, sadece bu ağır küme cache'lenir.
   */
  private async computeOrdersStats(p: {
    revenueWhere: Prisma.OrderWhereInput;
    todayWhere: Prisma.OrderWhereInput;
    todayRevenueWhere: Prisma.OrderWhereInput;
    yesterdayWhere: Prisma.OrderWhereInput;
    yesterdayRevenueWhere: Prisma.OrderWhereInput;
    canSubtractRefund: boolean;
    tenantId: string;
    dateFrom?: string;
    dateTo?: string;
    todayStart: Date;
    todayEnd: Date;
    yesterdayStart: Date;
    yesterdayEnd: Date;
  }): Promise<OrdersStats> {
    const [
      revenueAgg,
      todayCountRaw,
      todayRevenueAgg,
      yesterdayCountRaw,
      yesterdayRevenueAgg,
      topCustomersGroup,
    ] = await Promise.all([
      this.prisma.order.aggregate({
        where: p.revenueWhere,
        _sum: { total: true },
      }),
      this.prisma.order.count({ where: p.todayWhere }),
      this.prisma.order.aggregate({
        where: p.todayRevenueWhere,
        _sum: { total: true },
      }),
      this.prisma.order.count({ where: p.yesterdayWhere }),
      this.prisma.order.aggregate({
        where: p.yesterdayRevenueWhere,
        _sum: { total: true },
      }),
      this.prisma.order.groupBy({
        by: ['customerId', 'customerName'],
        where: p.revenueWhere,
        _count: { _all: true },
        _sum: { total: true },
        orderBy: { _count: { customerId: 'desc' } },
        take: 1,
      }),
    ]);

    const [refundAll, refundToday, refundYesterday] = p.canSubtractRefund
      ? await Promise.all([
          this.cariBalance.refundTotalInWindow({
            tenantId: p.tenantId,
            orderCreatedFrom: trDayStart(p.dateFrom) ?? undefined,
            orderCreatedTo: trDayEndExclusive(p.dateTo) ?? undefined,
          }),
          this.cariBalance.refundTotalInWindow({
            tenantId: p.tenantId,
            orderCreatedFrom: p.todayStart,
            orderCreatedTo: p.todayEnd,
          }),
          this.cariBalance.refundTotalInWindow({
            tenantId: p.tenantId,
            orderCreatedFrom: p.yesterdayStart,
            orderCreatedTo: p.yesterdayEnd,
          }),
        ])
      : [0, 0, 0];

    const grossTotalRevenue = revenueAgg._sum.total
      ? Number(revenueAgg._sum.total)
      : 0;
    const totalRevenue = Math.max(0, grossTotalRevenue - refundAll);
    const todayCount = todayCountRaw ?? 0;
    const grossTodayRevenue = todayRevenueAgg._sum.total
      ? Number(todayRevenueAgg._sum.total)
      : 0;
    const todayRevenue = Math.max(0, grossTodayRevenue - refundToday);
    const yesterdayCount = yesterdayCountRaw ?? 0;
    const grossYesterdayRevenue = yesterdayRevenueAgg._sum.total
      ? Number(yesterdayRevenueAgg._sum.total)
      : 0;
    const yesterdayRevenue = Math.max(
      0,
      grossYesterdayRevenue - refundYesterday,
    );
    const topCustomerRow = topCustomersGroup[0];
    const topCustomer = topCustomerRow
      ? {
          customerId: topCustomerRow.customerId,
          name: topCustomerRow.customerName ?? 'Bilinmiyor',
          orderCount: topCustomerRow._count._all,
          revenue: topCustomerRow._sum.total
            ? Number(topCustomerRow._sum.total)
            : 0,
        }
      : null;

    return {
      totalRevenue,
      today: { count: todayCount, revenue: todayRevenue },
      yesterday: { count: yesterdayCount, revenue: yesterdayRevenue },
      topCustomer,
    };
  }

  /**
   * @param canSeeCost false ise (çalışan/MEMBER rolü) yanıttan ALIŞ MALİYETİ
   *   türevli alanlar çıkarılır: "daha ucuz tedarikçi" ipucu tamamen atlanır
   *   (hesabı da yapılmaz — maliyet sorgusu hiç koşmaz). Maliyet/kâr yalnız
   *   OWNER/ADMIN'e görünür.
   */
  async list(
    tenantId: string,
    query: AdminOrderQueryDto,
    canSeeCost = true,
  ) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, query.pageSize ?? DEFAULT_PAGE_SIZE));

    const where: Prisma.OrderWhereInput = { tenantId };
    // awaiting_payment iç ara durumdur (kart ödemesi henüz alınmadı) —
    // admin sipariş listesinde gösterilmez; ödeme gelince 'paid' olarak düşer.
    if (query.status) where.status = query.status as OrderStatus;
    else where.status = { not: 'awaiting_payment' };
    // Tamamlanmamış kart denemeleri (cancelled & hiç ödenmemiş, paidAt=null)
    // admin sipariş listesinde/dökümünde GÖRÜNMEZ — aynı tutarlı tekrar iptal
    // kayıtları listeyi şişiriyordu. Ödenip iptal edilenler (paidAt dolu) kalır.
    where.AND = [
      ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
      { NOT: { status: 'cancelled', paidAt: null } },
    ];

    // ── Sözde-durum (special) filtresi — gerçek OrderStatus değil, durum
    // filtresinden bağımsız. Yalnız 'paid' (alınmamış) sipariş.
    const andList = where.AND as Prisma.OrderWhereInput[];
    if (query.special === 'manual_pending') {
      where.status = 'paid';
      andList.push({
        items: {
          some: {
            supplierOrderNo: null,
            houseStockReservedQty: 0,
            houseStockDispatchedAt: null,
          },
        },
      });
    }

    if (query.customerId) where.customerId = query.customerId;
    // Pazaryerine göre filtre — Order.marketplace exact eşleşme. null pazaryerili
    // (eski/self) siparişler bir seçim yapıldığında eşleşmez (doğru davranış).
    if (query.marketplace) where.marketplace = query.marketplace;
    // Çoklu tedarikçi seçimi (multi-select). `supplierIds` tanımlıysa tekil
    // `supplierId`'yi geçersiz kılar. undefined → filtre yok ("tümü"); boş liste
    // → bilinçli olarak hiçbir sipariş; ≥1 → en az bir kalemi seçili
    // tedarikçilerden birine atıf edilen siparişler.
    const supplierIdList: string[] | null =
      query.supplierIds !== undefined
        ? query.supplierIds
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : null;
    if (supplierIdList !== null) {
      if (supplierIdList.length === 0) {
        // "Tümünü kapat" → hiçbiri seçili değil → hiçbir sipariş göster.
        where.AND = [
          ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
          { id: '__no_supplier_selected__' },
        ];
      } else {
        where.items = {
          some: { OR: supplierIdList.flatMap((id) => supplierMatchOr(id)) },
        };
      }
    } else if (query.supplierId) {
      // TEK KAYNAK atıf (override→snapshot→product) — admin EXPORT'u ile BİREBİR
      // aynı filtre. Eski hali yalnız product.supplierId'ye bakıyordu → liste ile
      // döküm "tedarikçi X'in N siparişi" rakamı sapıyordu (override/snapshot
      // kalemleri kaçıyordu).
      where.items = { some: { OR: supplierMatchOr(query.supplierId) } };
    }
    // Tarih filtresi TR takvim gününe göre: başlangıç dahil, bitiş günü de DAHİL
    // (yarı-açık üst sınır = ertesi TR günü başı). UTC sınır kullanılmaz.
    {
      const range = trDateRange(query.dateFrom, query.dateTo);
      if (range) where.createdAt = range;
    }

    // Universal arama: sipariş doğal anahtarları (humanOrderNo, supplierOrderNo,
    // cargoBarcode/trackingNumber), sipariş anındaki snapshot'lar (müşteri ad/
    // email/telefon, billing snapshot, son müşteri), bayinin cari hesabı
    // (Customer relation: email/name/phone/companyTitle/vergiNo), SKU ve ürün
    // adı (OrderItem snapshot + Product). Sadece rakamdan oluşan sorgu
    // humanOrderNo'da unique-index'e equals olarak da gönderilir (fast path).
    if (query.q) {
      const q = query.q.trim();
      if (q.length > 0) {
        const uuidRe =
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        const orClauses: Prisma.OrderWhereInput[] = [];
        if (uuidRe.test(q)) {
          orClauses.push({ id: q });
        }
        if (/^\d+$/.test(q)) {
          orClauses.push({ humanOrderNo: { equals: q } });
        }
        orClauses.push(
          { humanOrderNo: { contains: q, mode: 'insensitive' } },
          { supplierOrderNo: { contains: q, mode: 'insensitive' } },
          { cargoBarcode: { contains: q, mode: 'insensitive' } },
          { trackingNumber: { contains: q, mode: 'insensitive' } },
          { customerName: { contains: q, mode: 'insensitive' } },
          { customerEmail: { contains: q, mode: 'insensitive' } },
          { customerPhone: { contains: q, mode: 'insensitive' } },
          { endCustomerName: { contains: q, mode: 'insensitive' } },
          { billingEmail: { contains: q, mode: 'insensitive' } },
          { billingPhone: { contains: q, mode: 'insensitive' } },
          { billingMobilePhone: { contains: q, mode: 'insensitive' } },
          { billingCompanyTitle: { contains: q, mode: 'insensitive' } },
          { billingVergiNo: { contains: q, mode: 'insensitive' } },
          {
            customer: {
              is: {
                OR: [
                  { email: { contains: q, mode: 'insensitive' } },
                  { name: { contains: q, mode: 'insensitive' } },
                  { phone: { contains: q, mode: 'insensitive' } },
                  { companyTitle: { contains: q, mode: 'insensitive' } },
                  { vergiNo: { contains: q, mode: 'insensitive' } },
                ],
              },
            },
          },
          {
            items: {
              some: {
                OR: [
                  { productName: { contains: q, mode: 'insensitive' } },
                  { supplierSku: { contains: q, mode: 'insensitive' } },
                  { supplierBarcode: { contains: q, mode: 'insensitive' } },
                  // Manuel/auto tedarikçi değişiminde efektif SKU/barkod override
                  // alanına yazılır — yeni tedarikçinin koduyla da aranabilsin.
                  { supplierSkuOverride: { contains: q, mode: 'insensitive' } },
                  {
                    supplierBarcodeOverride: { contains: q, mode: 'insensitive' },
                  },
                  { supplierOrderNo: { contains: q, mode: 'insensitive' } },
                  {
                    product: {
                      OR: [
                        { name: { contains: q, mode: 'insensitive' } },
                        { externalCode: { contains: q, mode: 'insensitive' } },
                        { barcode: { contains: q, mode: 'insensitive' } },
                        { publicBarcode: { contains: q, mode: 'insensitive' } },
                      ],
                    },
                  },
                ],
              },
            },
          },
        );
        where.OR = orClauses;
      }
    }

    // Bugün/dün karşılaştırması için TR yerel günü sınırlarını kullanıyoruz
    // (tek kaynak: tr-time). "Saat 02:00'da yapılan sipariş hâlâ aynı güne ait".
    const todayStart = trStartOfDay(new Date());
    const todayEnd = trAddDays(todayStart, 1);
    const yesterdayStart = trAddDays(todayStart, -1);
    const yesterdayEnd = todayStart;

    // Stats için, filtreye uyan tüm siparişler üzerinde aggregate. Bugün/dün
    // sayaçları aynı filtreyi `createdAt` üzerinde daraltarak hesaplanır.
    const todayWhere: Prisma.OrderWhereInput = {
      ...where,
      createdAt: { gte: todayStart, lt: todayEnd },
    };
    const yesterdayWhere: Prisma.OrderWhereInput = {
      ...where,
      createdAt: { gte: yesterdayStart, lt: yesterdayEnd },
    };

    // Ciro istatistikleri net olmalı: iptal/iade edilen siparişler hariç
    // tutulur. Kullanıcı açıkça bir statüye göre filtrelediyse (query.status)
    // o filtreye saygı gösterilir; aksi halde notIn ile dışlanır. Sayaçlar
    // (today/yesterday count) ise tüm siparişleri kapsamaya devam eder.
    const netStatusClause: Prisma.OrderWhereInput = query.status
      ? {}
      : { status: { notIn: ['cancelled', 'refunded'] as OrderStatus[] } };
    const revenueWhere: Prisma.OrderWhereInput = { ...where, ...netStatusClause };
    const todayRevenueWhere: Prisma.OrderWhereInput = {
      ...todayWhere,
      ...netStatusClause,
    };
    const yesterdayRevenueWhere: Prisma.OrderWhereInput = {
      ...yesterdayWhere,
      ...netStatusClause,
    };
    // Kısmi iade düşümü (REFUND ledger) yalnızca tenant + tarih penceresiyle
    // doğru ölçeklenir; müşteri/tedarikçi/statü/arama filtreleri varken
    // refundTotalInWindow o kümeye daraltılamayacağı için iade düşümü atlanır.
    const hasTextSearch = !!(query.q && query.q.trim().length > 0);
    const hasSupplierFilter = supplierIdList !== null || !!query.supplierId;
    const canSubtractRefund =
      !query.status &&
      !query.customerId &&
      !query.marketplace &&
      !hasSupplierFilter &&
      !hasTextSearch;

    // Liste (total + rows) HER ZAMAN taze — sayfalama/sıralama anlık olmalı.
    // Ağır dashboard istatistikleri aşağıda ayrı + 60sn memoize edilir.
    const [total, rows] = await Promise.all([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          status: true,
          total: true,
          subtotal: true,
          kdvAmount: true,
          kdvRate: true,
          packagingCost: true,
          packagingUnitFee: true,
          currency: true,
          humanOrderNo: true,
          marketplace: true,
          cargoCompany: true,
          cargoBarcode: true,
          supplierOrderNo: true,
          customerId: true,
          customerName: true,
          customerEmail: true,
          endCustomerName: true,
          trackingNumber: true,
          // Sipariş notu (müşterinin checkout'ta yazdığı not). Liste satırında
          // gözden kaçmasın diye rozet + önizleme çiziyoruz — detaya girmeden.
          notes: true,
          // Auto-route yönlendirme notu (ADMIN-ONLY): hangi kural hangi
          // tedarikçiye çekti. Müşteriye dönen select'lerde YOK.
          dispatchRoutingNote: true,
          createdAt: true,
          updatedAt: true,
          // PDF kolonu: satırda indirilebilir bir sipariş PDF'i var mı? Liste
          // sorgusunda imzalı URL üretmiyoruz (her satır için pahalı) — sadece
          // varlığını döndürüyoruz; taze URL tıklamada findOne() ile alınır.
          pdfKey: true,
          pdfUrl: true,
          pdfPurgedAt: true,
          // Bayi kodu (BAYI-XXXXXX) — tedarikçiye giden CSV/export'ta bayi adı
          // yerine kod paylaşılır.
          customer: {
            select: {
              bayiNo: true,
              // Bayi MANUEL etiketleri (YALNIZ ADMIN — sipariş listesinde bayi
              // adının altında gösterilir; müşteri-yüzlü select'e eklenmez).
              tags: {
                select: { id: true, name: true, color: true },
                orderBy: { name: 'asc' },
              },
            },
          },
          _count: { select: { items: true } },
          // Tedarikçi adlarını (distinct) + ürün adları + thumbnail için.
          // Admin liste UI'sinde küçük (16x16) avatar + isim kolonu çiziyoruz.
          // unitPrice + supplierId, "daha ucuz tedarikçi" hint'i için kullanılır.
          items: {
            select: {
              id: true,
              productId: true,
              productName: true,
              qty: true,
              unitPrice: true,
              supplierOrderNo: true,
              supplierIdOverride: true,
              // Depo durumu: rezerve (reservedQty>0) veya Depodan
              // gönderilmiş (dispatchedAt!=null) kalemler "manuel alım bekliyor"
              // rozetinden hariç tutulur — bunları bot/manuel değil OWNER yönetir.
              houseStockReservedQty: true,
              houseStockDispatchedAt: true,
              supplierOverride: { select: { name: true } },
              product: {
                select: {
                  supplierId: true,
                  supplier: { select: { name: true } },
                  images: {
                    orderBy: { position: 'asc' },
                    take: 1,
                    select: { url: true },
                  },
                },
              },
            },
          },
        },
      }),
    ]);

    // AĞIR dashboard istatistikleri (3 count + 3 aggregate + groupBy + iade) ayrı
    // ve 60sn memoize edilir; panel poll'larında tekrar tekrar koşmaz. Filtre
    // imzası anahtarı oluşturur → farklı filtre = taze hesap. Staleness ≤60sn.
    const statsKey = JSON.stringify({
      t: tenantId,
      s: query.status ?? null,
      c: query.customerId ?? null,
      mkt: query.marketplace ?? null,
      sup: query.supplierId ?? null,
      supIds: query.supplierIds ?? null,
      q: query.q ?? null,
      df: query.dateFrom ?? null,
      dt: query.dateTo ?? null,
    });
    const cachedStats = this.ordersStatsCache.get(statsKey);
    let stats: OrdersStats;
    if (cachedStats && Date.now() - cachedStats.at < ORDERS_STATS_TTL_MS) {
      stats = cachedStats.stats;
    } else {
      stats = await this.computeOrdersStats({
        revenueWhere,
        todayWhere,
        todayRevenueWhere,
        yesterdayWhere,
        yesterdayRevenueWhere,
        canSubtractRefund,
        tenantId,
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
        todayStart,
        todayEnd,
        yesterdayStart,
        yesterdayEnd,
      });
      this.ordersStatsCache.set(statsKey, { at: Date.now(), stats });
    }

    // Görünen sayfa için "daha ucuz tedarikçi" hint'i hesapla. Tek batch query
    // — aynı isimli tüm aktif ürünleri (her tedarikçide) çek, bellekte gruplayıp
    // her order için en büyük tasarruflu kalemi belirle.
    const distinctNames = new Set<string>();
    for (const o of rows) {
      for (const it of o.items) {
        if (it.productName) distinctNames.add(it.productName);
      }
    }
    const altByName = new Map<
      string,
      Array<{ supplierId: string | null; supplierName: string | null; price: number }>
    >();
    // Maliyet göremeyen rol → alternatif tedarikçi/maliyet sorgusunu hiç koşma.
    if (canSeeCost && distinctNames.size > 0) {
      const alts = await this.prisma.product.findMany({
        where: {
          tenantId,
          active: true,
          name: { in: Array.from(distinctNames) },
        },
        select: {
          name: true,
          price: true,
          costPrice: true,
          supplierId: true,
          supplier: { select: { name: true } },
        },
      });
      for (const a of alts) {
        const bucket = altByName.get(a.name) ?? [];
        bucket.push({
          supplierId: a.supplierId,
          supplierName: a.supplier?.name ?? null,
          price: Number(a.costPrice ?? a.price),
        });
        altByName.set(a.name, bucket);
      }
    }

    // Ayın en çok satan ilk 5 bayisi (🏆) — sipariş satırında da göster.
    const topSellers = await getMonthlyTopSellers(this.prisma, tenantId);

    return {
      success: true,
      data: rows.map((o) => {
        const supplierSet = new Set<string>();
        const products: Array<{
          itemId: string;
          productId: string | null;
          name: string;
          qty: number;
          imageUrl: string | null;
          supplierOrderNo: string | null;
          supplierId: string | null;
          supplierName: string | null;
          manualPurchasePending: boolean;
        }> = [];
        /// Sipariş HÂLÂ 'paid' (henüz alınmamış) ve supplierOrderNo'su olmayan
        /// en az bir kalem varsa true. Sipariş 'preparing'e geçince
        /// (= tedarikçiden alındı) rozet kaybolur.
        let manualPurchasePending = false;
        let bestHint: {
          productName: string;
          currentSupplierName: string | null;
          cheaperSupplierName: string;
          currentUnitPrice: number;
          cheaperUnitPrice: number;
          saving: number;
          savingPercent: number;
        } | null = null;

        for (const it of o.items) {
          // Override varsa effective tedarikçi onun adı; yoksa ürünün asıl tedarikçisi.
          const effectiveSupplierId = it.supplierIdOverride ?? it.product?.supplierId ?? null;
          const effectiveSupplierName =
            it.supplierOverride?.name ?? it.product?.supplier?.name ?? null;
          if (effectiveSupplierName) supplierSet.add(effectiveSupplierName);
          /// Manuel alım bekliyor: yalnızca sipariş 'paid' iken ve kalem henüz
          /// satın alınmamışsa (supplierOrderNo yok).
          /// 'preparing'/'shipped'/terminal'de gösterilmez — o aşamada alım
          /// zaten yapılmış sayılır.
          const itemManualPending =
            o.status === 'paid' &&
            !!effectiveSupplierId &&
            !(it.supplierOrderNo && it.supplierOrderNo.trim()) &&
            // Depo kalemi (rezerve/gönderilmiş) manuel alım beklemez —
            // OWNER kendi deposundan karşılıyor; tedarikçiye devredilirse
            // (reservedQty 0'a döner) rozet yeniden görünür.
            it.houseStockReservedQty === 0 &&
            it.houseStockDispatchedAt === null;
          if (itemManualPending) manualPurchasePending = true;
          if (it.productName) {
            products.push({
              itemId: it.id,
              productId: it.productId ?? null,
              name: it.productName,
              qty: it.qty,
              imageUrl: it.product?.images?.[0]?.url ?? null,
              supplierOrderNo: it.supplierOrderNo ?? null,
              supplierId: effectiveSupplierId,
              supplierName: effectiveSupplierName,
              manualPurchasePending: itemManualPending,
            });
          }
          // "Daha ucuz tedarikçi" rozeti YALNIZCA 'paid' (alım öncesi). 'preparing'
          // ve sonrası: alım yapılmış, tedarikçi kilitli → rozet gösterilmez
          // (kullanıcı kararı 2026-06-29).
          if (o.status === 'paid' && it.productName) {
            const currentPrice = Number(it.unitPrice);
            const currentSupplierId = it.product?.supplierId ?? null;
            const candidates = altByName.get(it.productName);
            if (candidates && candidates.length > 0) {
              let cheapestPrice = currentPrice;
              let cheapestName: string | null = null;
              for (const c of candidates) {
                if (currentSupplierId && c.supplierId === currentSupplierId)
                  continue;
                if (!c.supplierName) continue;
                if (c.price < cheapestPrice) {
                  cheapestPrice = c.price;
                  cheapestName = c.supplierName;
                }
              }
              if (cheapestName && cheapestPrice < currentPrice) {
                const saving = (currentPrice - cheapestPrice) * it.qty;
                const savingPercent =
                  currentPrice > 0
                    ? ((currentPrice - cheapestPrice) / currentPrice) * 100
                    : 0;
                if (!bestHint || saving > bestHint.saving) {
                  bestHint = {
                    productName: it.productName,
                    currentSupplierName: it.product?.supplier?.name ?? null,
                    cheaperSupplierName: cheapestName,
                    currentUnitPrice: currentPrice,
                    cheaperUnitPrice: cheapestPrice,
                    saving,
                    savingPercent: Math.round(savingPercent * 10) / 10,
                  };
                }
              }
            }
          }
        }

        return {
          id: o.id,
          status: o.status,
          total: Number(o.total),
          subtotal: o.subtotal !== null ? Number(o.subtotal) : null,
          kdvAmount: o.kdvAmount !== null ? Number(o.kdvAmount) : null,
          kdvRate: o.kdvRate ?? null,
          packagingCost:
            o.packagingCost !== null ? Number(o.packagingCost) : null,
          packagingUnitFee:
            o.packagingUnitFee !== null ? Number(o.packagingUnitFee) : null,
          currency: o.currency,
          humanOrderNo: o.humanOrderNo,
          marketplace: o.marketplace,
          cargoCompany: o.cargoCompany,
          cargoBarcode: o.cargoBarcode,
          supplierOrderNo: o.supplierOrderNo,
          // Bayi (Customer) detay sayfasına link için — liste satırında bayi
          // adı tıklanınca /customers/{customerId}'e gider.
          customerId: o.customerId ?? null,
          customerName: o.customerName,
          customerEmail: o.customerEmail,
          endCustomerName: o.endCustomerName,
          bayiNo: o.customer?.bayiNo ?? null,
          // Bayi MANUEL etiketleri (YALNIZ ADMIN) — bayi adının altında çip.
          customerTags: o.customer?.tags ?? [],
          // Bayi OTOMATİK etiketleri — 🏆 ayın en çok satanı (varsa). "Hiç almamış"
          // sipariş satırında geçersiz (bu siparişi var) → yalnız top-seller.
          customerAutoTags:
            o.customerId && topSellers.has(o.customerId)
              ? [topSellerAutoTag(topSellers.get(o.customerId)!)]
              : [],
          // PDF saklama süresi (pdfPurgedAt) dolmadıysa ve elimizde key/url
          // varsa indirilebilir kabul ediyoruz.
          hasPdf: o.pdfPurgedAt === null && Boolean(o.pdfKey || o.pdfUrl),
          trackingNumber: o.trackingNumber,
          notes: o.notes ?? null,
          dispatchRoutingNote: o.dispatchRoutingNote ?? null,
          itemCount: o._count.items,
          suppliers: Array.from(supplierSet).sort(),
          supplierNames: Array.from(supplierSet).sort(),
          products,
          cheaperSupplierHint: canSeeCost ? bestHint : null,
          manualPurchasePending,
          createdAt: o.createdAt,
          updatedAt: o.updatedAt,
        };
      }),
      meta: { total, page, limit: pageSize, totalPages: Math.ceil(total / pageSize) },
      stats,
    };
  }

  /** @param canSeeCost bkz. list() — false ise kalem başına maliyet ipucu
   *  (cheaperHint: theirCost/ourCost) yanıta KONULMAZ. */
  async findOne(tenantId: string, id: string, canSeeCost = true) {
    const order = await this.prisma.order.findFirst({
      where: { id, tenantId },
      select: {
        id: true,
        status: true,
        total: true,
        subtotal: true,
        kdvAmount: true,
        kdvRate: true,
        packagingCost: true,
        packagingUnitFee: true,
        cargoCost: true,
        paymentType: true,
        cardCommissionRate: true,
        cardCommissionAmount: true,
        posProviderKey: true,
        currency: true,
        humanOrderNo: true,
        marketplace: true,
        cargoCompany: true,
        cargoBarcode: true,
        supplierOrderNo: true,
        customerName: true,
        customerEmail: true,
        customerPhone: true,
        endCustomerName: true,
        addressLine1: true,
        addressCity: true,
        addressPostal: true,
        addressCountry: true,
        billingName: true,
        billingAddressLine: true,
        billingDistrict: true,
        billingCity: true,
        billingPostal: true,
        trackingNumber: true,
        notes: true,
        pdfUrl: true,
        pdfKey: true,
        pdfPurgedAt: true,
        createdAt: true,
        updatedAt: true,
        // Konsolide fatura durumu (birfatura.md §11) — sipariş bir batch'e
        // donduruldu mu? invoicedAt dolduysa BirFatura faturayı bağladı.
        invoicedAt: true,
        invoiceBatchId: true,
        invoiceBatch: {
          select: {
            id: true,
            status: true,
            periodStart: true,
            periodEnd: true,
            orderCode: true,
            birfaturaOrderId: true,
            invoiceUrl: true,
            invoiceNumber: true,
            invoiceDate: true,
            invoicedAt: true,
          },
        },
        customer: { select: { id: true, email: true, name: true } },
        customerId: true,
        supportMessages: {
          where: { kind: 'order' },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            status: true,
            kind: true,
            category: true,
            subject: true,
            createdAt: true,
          },
        },
        items: {
          select: {
            id: true,
            productId: true,
            productSlug: true,
            productName: true,
            unitPrice: true,
            unitPriceOriginal: true,
            discountPercent: true,
            qty: true,
            // Tedarikçi kod/barkod snapshot'ı — sipariş anında dondurulur.
            // YALNIZCA admin sipariş detayında gösterilir, müşteriye sızmaz.
            supplierSku: true,
            supplierBarcode: true,
            supplierIdOverride: true,
            supplierOrderNo: true,
            product: {
              select: {
                supplier: {
                  select: {
                    id: true,
                    name: true,
                    mandatoryCarriers: true,
                    requiresPdf: true,
                    leadTimeDays: true,
                  },
                },
                // Kalem thumbnail'i — liste ucuyla aynı kalıp (ilk görsel).
                images: {
                  orderBy: { position: 'asc' },
                  take: 1,
                  select: { url: true },
                },
              },
            },
            supplierOverride: {
              select: {
                id: true,
                name: true,
                mandatoryCarriers: true,
                requiresPdf: true,
                leadTimeDays: true,
              },
            },
          },
        },
        trackingEvents: {
          orderBy: { occurredAt: 'desc' },
          select: {
            id: true,
            status: true,
            description: true,
            location: true,
            occurredAt: true,
          },
        },
      },
    });
    if (!order) throw new NotFoundException('order not found');

    const supplierSet = new Set<string>();
    for (const it of order.items) {
      // Override varsa onu, yoksa product.supplier'ı say. Ciro/cari
      // analizleriyle aynı kuralı kullanıyoruz.
      const name = it.supplierOverride?.name ?? it.product?.supplier?.name;
      if (name) supplierSet.add(name);
    }

    // PDF URL ömrü 7 gün (AWS SigV4 max). Admin "Görüntüle" tıkladığında
    // süresi dolmuş olabileceği için kalıcı `pdfKey` üzerinden taze 1 saatlik
    // URL üretiyoruz. Eski sipariş kayıtlarında pdfKey null kalabilir — o
    // durumda DB'deki pdfUrl'i fallback olarak veriyoruz.
    // 30 günlük R2 saklama süresi dolduysa (pdfPurgedAt) URL üretmeyiz;
    // UI "Sipariş PDF'i bulunamadı (30 günlük saklama süresi doldu)" gösterir.
    let pdfUrl: string | null = order.pdfUrl;
    const pdfPurged = order.pdfPurgedAt !== null;
    if (pdfPurged) {
      pdfUrl = null;
    } else if (order.pdfKey) {
      try {
        pdfUrl = await this.storage.getSignedUrl(order.pdfKey, 3600);
      } catch (err) {
        this.logger.warn(
          `admin order ${order.id}: pdf signing failed (${(err as Error).message}); falling back to stored url`,
        );
      }
    }

    // "Daha ucuz tedarikçi" MANUEL işaretleri (Yeni Tedarikçi Analizi → "Geçiş Yap").
    // Sadece admin uyarısı; hiçbir otomasyon YAPMAZ. Ürünü hard-delete ise productId null → atla.
    const hintProductIds = order.items.map((i) => i.productId).filter((x): x is string => !!x);
    const cheaperHintMap = new Map<string, { supplierName: string; theirCost: number; ourCost: number; savingPerUnit: number; productUrl: string | null }>();
    if (canSeeCost && hintProductIds.length) {
      const hints = await this.prisma.cheaperSupplierHint.findMany({
        where: { tenantId, productId: { in: hintProductIds } },
        select: { productId: true, supplierName: true, theirCost: true, ourCost: true, savingPerUnit: true, productUrl: true },
      });
      for (const h of hints) {
        cheaperHintMap.set(h.productId, {
          supplierName: h.supplierName, theirCost: Number(h.theirCost), ourCost: Number(h.ourCost),
          savingPerUnit: Number(h.savingPerUnit), productUrl: h.productUrl,
        });
      }
    }

    return {
      success: true,
      data: {
        id: order.id,
        status: order.status,
        total: Number(order.total),
        subtotal: order.subtotal !== null ? Number(order.subtotal) : null,
        kdvAmount: order.kdvAmount !== null ? Number(order.kdvAmount) : null,
        kdvRate: order.kdvRate ?? null,
        packagingCost:
          order.packagingCost !== null ? Number(order.packagingCost) : null,
        packagingUnitFee:
          order.packagingUnitFee !== null
            ? Number(order.packagingUnitFee)
            : null,
        // "Kendim İçin" sabit kargo bedeli (self-DIŞI'nda null) — total'a dahildir.
        cargoCost: order.cargoCost !== null ? Number(order.cargoCost) : null,
        // Ödeme türü + kart komisyonu snapshot'ı — komisyon yalnızca kartlı
        // ödemede dolu, cari ödemede null. Çekilen = total + cardCommissionAmount.
        paymentType: order.paymentType,
        cardCommissionRate:
          order.cardCommissionRate !== null
            ? Number(order.cardCommissionRate)
            : null,
        cardCommissionAmount:
          order.cardCommissionAmount !== null
            ? Number(order.cardCommissionAmount)
            : null,
        posProviderKey: order.posProviderKey,
        currency: order.currency,
        humanOrderNo: order.humanOrderNo,
        marketplace: order.marketplace,
        cargoCompany: order.cargoCompany,
        cargoBarcode: order.cargoBarcode,
        supplierOrderNo: order.supplierOrderNo,
        trackingNumber: order.trackingNumber,
        notes: order.notes,
        pdfUrl,
        pdfPurged,
        // Düz (flat) müşteri/teslimat alanları — admin paneli normalizer'ı
        // bu anahtarları doğrudan okuyor.
        customerName: order.customerName,
        customerEmail: order.customerEmail,
        customerPhone: order.customerPhone,
        // Müşteri ismi — Bayi'nin kendi son müşterisi (teslimat adıyla karışmaz).
        endCustomerName: order.endCustomerName,
        shippingAddress: {
          fullName: order.customerName,
          phone: order.customerPhone,
          line1: order.addressLine1,
          city: order.addressCity,
          postalCode: order.addressPostal,
          country: order.addressCountry,
        },
        billingAddress: order.billingAddressLine
          ? {
              fullName: order.billingName ?? undefined,
              line1: order.billingAddressLine,
              district: order.billingDistrict ?? undefined,
              city: order.billingCity ?? undefined,
              postalCode: order.billingPostal ?? undefined,
              country: 'TR',
            }
          : null,
        // Geriye dönük uyumluluk için iç içe customer envelope da koruyoruz.
        customer: {
          id: order.customer?.id ?? null,
          name: order.customerName,
          email: order.customerEmail,
          phone: order.customerPhone,
          address: {
            line1: order.addressLine1,
            city: order.addressCity,
            postalCode: order.addressPostal,
            country: order.addressCountry,
          },
        },
        suppliers: Array.from(supplierSet).sort(),
        items: order.items.map((i) => ({
          id: i.id,
          productId: i.productId ?? null,
          /// Tedarikçi deep-link anahtarı — alım botları çıkarıldı, artık yok.
          supplierKey: null,
          slug: i.productSlug,
          name: i.productName,
          productName: i.productName,
          imageUrl: i.product?.images?.[0]?.url ?? null,
          price: Number(i.unitPrice),
          unitPrice: Number(i.unitPrice),
          priceOriginal:
            i.unitPriceOriginal !== null ? Number(i.unitPriceOriginal) : null,
          discountPercent: i.discountPercent,
          qty: i.qty,
          quantity: i.qty,
          total: Number(i.unitPrice) * i.qty,
          // Tedarikçi kod/barkod — sipariş anındaki snapshot. Sadece admin görür.
          supplierSku: i.supplierSku,
          supplierBarcode: i.supplierBarcode,
          // Bayinin gerçekte alım yaptığı tedarikçi numarası (varsa).
          supplierOrderNo: i.supplierOrderNo ?? null,
          // Override edilmiş tedarikçi ID (UI selector'ında işaretli göstermek için).
          supplierIdOverride: i.supplierIdOverride ?? null,
          // Etkin tedarikçi: override varsa onu, yoksa product.supplier.
          // UI bu alanı gösterir; ciro/cari analizleri de bunu kullanır.
          supplier: i.supplierOverride
            ? {
                id: i.supplierOverride.id,
                name: i.supplierOverride.name,
                mandatoryCarriers: i.supplierOverride.mandatoryCarriers,
                requiresPdf: i.supplierOverride.requiresPdf,
                leadTimeDays: i.supplierOverride.leadTimeDays,
                isOverride: true,
              }
            : i.product?.supplier
            ? {
                id: i.product.supplier.id,
                name: i.product.supplier.name,
                mandatoryCarriers: i.product.supplier.mandatoryCarriers,
                requiresPdf: i.product.supplier.requiresPdf,
                leadTimeDays: i.product.supplier.leadTimeDays,
                isOverride: false,
              }
            : null,
          // "Daha ucuz tedarikçi" manuel işareti (varsa) — admin uyarısı, otomasyon yok.
          cheaperHint:
            canSeeCost && i.productId
              ? cheaperHintMap.get(i.productId) ?? null
              : null,
        })),
        trackingEvents: order.trackingEvents,
        customerId: order.customerId ?? null,
        supportMessages: order.supportMessages,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
        // Konsolide fatura durumu (birfatura.md §11). invoicedAt doluysa yeşil
        // "Faturalandı" rozeti + link; batch'e donduysa ama callback gelmediyse
        // "Faturaya alındı (bekliyor)" gösterilir. Hiçbiri yoksa kırmızı.
        invoicedAt: order.invoicedAt,
        invoiceBatchId: order.invoiceBatchId ?? null,
        invoiceBatch: order.invoiceBatch
          ? {
              id: order.invoiceBatch.id,
              status: order.invoiceBatch.status,
              periodStart: order.invoiceBatch.periodStart,
              periodEnd: order.invoiceBatch.periodEnd,
              orderCode: order.invoiceBatch.orderCode,
              birfaturaOrderId: order.invoiceBatch.birfaturaOrderId.toString(),
              invoiceUrl: order.invoiceBatch.invoiceUrl,
              invoiceNumber: order.invoiceBatch.invoiceNumber,
              invoiceDate: order.invoiceBatch.invoiceDate,
              invoicedAt: order.invoiceBatch.invoicedAt,
            }
          : null,
      },
    };
  }

  /**
   * Aynı kargo barkodu/teslimat numarasıyla başka sipariş var mı?
   * Geçmişte aynı barkod iki siparişe yapıştırıldı ve kargo karıştı —
   * admin UI kaydetmeden önce buradan kontrol edip onay penceresi açar.
   */
  async findCargoBarcodeDuplicates(
    tenantId: string,
    barcode: string,
    excludeOrderId?: string | null,
  ): Promise<
    Array<{
      id: string;
      humanOrderNo: string;
      status: string;
      customerName: string | null;
      customerEmail: string | null;
      endCustomerName: string | null;
      cargoCompany: string | null;
      cargoBarcode: string | null;
      trackingNumber: string | null;
      createdAt: Date;
    }>
  > {
    const trimmed = barcode.trim();
    if (trimmed.length === 0) return [];

    const matches = await this.prisma.order.findMany({
      where: {
        tenantId,
        // Ödemesi alınmamış kart denemeleri (awaiting_payment) barkodu
        // rezerve etmez — mükerrer uyarısında sayılmaz.
        status: { not: 'awaiting_payment' },
        ...(excludeOrderId ? { NOT: { id: excludeOrderId } } : {}),
        OR: [
          { cargoBarcode: { equals: trimmed, mode: 'insensitive' } },
          { trackingNumber: { equals: trimmed, mode: 'insensitive' } },
        ],
      },
      select: {
        id: true,
        humanOrderNo: true,
        status: true,
        customerName: true,
        customerEmail: true,
        endCustomerName: true,
        cargoCompany: true,
        cargoBarcode: true,
        trackingNumber: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    return matches;
  }

  /**
   * Tenant ownership doğrulama (`findFirst {id, tenantId}`) ve `update` ayrı
   * statement'lar olduğunda araya başka bir update/delete giren paralel istek
   * "doğrulanmış ama farklı bir versiyon yazılmış" satır üretebiliyordu —
   * `updateMany` count==0 dönerse 404 doğru tepki gibi görünür ama yarış
   * koşulunda yanlış sonuca da yol açabilir. Tek `$transaction` içinde
   * doğrulama + update yapınca DB seviyesinde atomik garantiye geçiyoruz.
   */
  async updateOrder(
    tenantId: string,
    id: string,
    dto: UpdateOrderDto,
    actor: { id: string; tenantId: string },
    options?: {
      notify?: boolean;
      supplierCancelConfirmed?: boolean;
      requireCurrentStatus?: OrderStatus;
      /**
       * İADE (return) finalize akışı için: 'refunded'a geçişte müşteri cari
       * bakiyesini de iade et (iptaldeki netPaid mantığının aynısı). Varsayılan
       * false → 'refunded' davranışı DEĞİŞMEZ (yalnız tedarikçi cüzdanı geri
       * alınır). Idempotent: netPaid önceki REFUND'ları düşer → çift iade olmaz.
       */
      refundCustomerCari?: boolean;
    },
  ) {
    const notify = options?.notify !== false;
    const refundCustomerCari = options?.refundCustomerCari === true;
    // Tedarikçi cüzdan iadesi YALNIZCA tedarikçinin iptali doğrulandığında
    // (örn. Tedarikçi A status=6 → status-poll) yapılır. Bizim elle iptalimizde,
    // sipariş tedarikçide ZATEN açılmışsa (supplierOrderNo dolu) tedarikçi
    // büyük olasılıkla iade ETMEZ → cüzdanı iade etmeyiz (aksi halde bakiyemiz
    // gerçekte iade edilmeyen tutar kadar yüksek görünür — Tedarikçi A drift'inin
    // kök nedeni buydu).
    const supplierCancelConfirmed = options?.supplierCancelConfirmed === true;
    const data: Prisma.OrderUpdateInput = {};
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.trackingNumber !== undefined) data.trackingNumber = dto.trackingNumber;
    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.marketplace !== undefined) {
      data.marketplace = dto.marketplace ?? null;
    }
    if (dto.cargoCompany !== undefined) {
      data.cargoCompany = dto.cargoCompany ?? null;
    }
    if (dto.cargoBarcode !== undefined) {
      data.cargoBarcode = dto.cargoBarcode ?? null;
    }
    if (dto.endCustomerName !== undefined) {
      data.endCustomerName = dto.endCustomerName ?? null;
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.order.findFirst({
        where: { id, tenantId },
        select: {
          id: true,
          status: true,
          total: true,
          customerId: true,
          humanOrderNo: true,
          supplierOrderNo: true,
          paymentType: true,
          cardCommissionAmount: true,
          cariApprovalStatus: true,
          paidAt: true,
          shippedAt: true,
          invoiceHoldUntil: true,
          invoicedAt: true,
          customerEmail: true,
          customerName: true,
          marketplace: true,
          cargoCompany: true,
          cargoBarcode: true,
          items: {
            select: {
              productId: true,
              qty: true,
              houseStockDispatchedAt: true,
            },
          },
        },
      });
      if (!existing) throw new NotFoundException('order not found');

      // Atomik statü guard: çağıran (örn. oto-iptal onayı) "yalnız bu statüdeyken
      // işle" diyebilir. Sipariş, dışarıdaki ön-kontrol ile bu transaction
      // arasında statü değiştirdiyse (ör. bir bot paid→preparing yaptıysa) işlemi
      // reddederiz. Böylece "yalnız 'paid' siparişi otomatik iptal et" garantisi
      // okuma+yazma arası yarışta bile korunur. Diğer çağıranlar bu option'ı
      // geçmez → davranış DEĞİŞMEZ.
      if (
        options?.requireCurrentStatus !== undefined &&
        existing.status !== options.requireCurrentStatus
      ) {
        throw new ConflictException({
          code: 'ORDER_STATUS_GUARD_FAILED',
          message: `Sipariş statü guard: beklenen '${options.requireCurrentStatus}', mevcut '${existing.status}'.`,
        });
      }

      const nextStatus = dto.status;

      // §2.2 REAKTİVASYON — iptal edilmiş sipariş tekrar aktife (paid/preparing/
      // shipped) çekiliyor mu? Öyleyse iptalin TÜM etkisi tam simetrik geri
      // sarılır (stok yeniden düş + cari yeniden ücretlendir + tedarikçi cüzdanı
      // yeniden düş). 'refunded'dan diriltme bu otomatiğe DAHİL DEĞİL
      // (iade yaşam döngüsüne ait — elle kontrol).
      const reactivatingFromCancel =
        existing.status === 'cancelled' &&
        nextStatus !== undefined &&
        nextStatus !== 'cancelled' &&
        nextStatus !== 'refunded';

      // ── Statü geçiş onay kapısı (limbo/şişme önleme — SERT engel DEĞİL) ──
      // İptal/iade'den geri alma ("diriltme") veya depodan gönderilmiş siparişi
      // 'paid'e geri çekme limbo/stok şişmesi/çift iade üretebilir. Admin'in
      // yanlışlıkla yaptığı işlemi geri alabilmesi için bunları ENGELLEMİYORUZ;
      // ama stok/cari/depo OTOMATİK düzeltilmediğinden açık onay (FE popup'ından
      // gelen confirmReactivation) şart. Onaysız riskli geçiş → 409 + açıklama;
      // FE popup gösterip "Evet" denince confirmReactivation:true ile yeniden
      // gönderir ve geçiş uygulanır. Normal ileri geçişler (paid→preparing→
      // shipped→refunded) onaysız serbest. nextStatus undefined ise dokunma.
      if (nextStatus !== undefined && nextStatus !== existing.status) {
        const normalTransition = isAllowedStatusTransition(
          existing.status,
          nextStatus,
        );
        const depotDispatchedToPaid =
          nextStatus === 'paid' &&
          existing.items.some((it) => it.houseStockDispatchedAt !== null);
        const riskyTransition = !normalTransition || depotDispatchedToPaid;
        // A1: Tedarikçi KARGOLANMIŞ siparişi iptale çekerse (düşük olasılık ama
        // olur) shipped→cancelled normal matriste yok → "riskli" sayılır. Ancak
        // bu, tedarikçinin iptalinin bot tarafından DOĞRULANDIĞI (status=6,
        // supplierCancelConfirmed) en güçlü onaydır; para iadesi MUTLAKA
        // yapılmalı. Bu tek durumda onay kapısını atla — aşağıdaki
        // enteringCancelled bloğu stok+cari+tedarikçi iadesini eksiksiz yapar.
        const supplierConfirmedCancel =
          supplierCancelConfirmed && nextStatus === 'cancelled';
        if (riskyTransition && !dto.confirmReactivation && !supplierConfirmedCancel) {
          throw new ConflictException({
            code: 'STATUS_TRANSITION_NEEDS_CONFIRM',
            message:
              `Riskli statü değişikliği: "${statusLabel(existing.status)}" → ` +
              `"${statusLabel(nextStatus)}". ` +
              (reactivatingFromCancel
                ? 'İptal edilmiş sipariş yeniden aktifleştirilecek: stok yeniden ' +
                  'düşülecek, müşteri carisi yeniden ücretlendirilecek ve tedarikçi ' +
                  'cüzdanı yeniden düşülecek. (Müşterinin cari bakiyesi yetmezse ' +
                  'işlem durur ve sipariş iptalde kalır.) '
                : depotDispatchedToPaid
                  ? 'Bu sipariş depodan gönderilmiş; "paid"e geri çekmek onu ' +
                    'depo akışından düşürür. Stok, cari ve depo hareketleri OTOMATİK ' +
                    'düzeltilmez — gerekirse elle kontrol edin. '
                  : 'İade durumundan geri alma yapıyorsunuz. Stok, cari ve depo ' +
                    'hareketleri OTOMATİK düzeltilmez — gerekirse elle kontrol edin. ') +
              'Onaylıyor musunuz?',
          });
        }
        if (riskyTransition) {
          this.logger.warn(
            `Riskli statü geçişi ONAYLANDI: order=${id} ${existing.status}→${nextStatus} (confirmReactivation) — stok/cari elle kontrol gerekebilir`,
          );
        }
      }
      // Status fiilen değişiyorsa statusChangedAt güncellenir — Tedarikçi A
      // status-poll cron'u ve zaman-bazlı akışlar bu alana dayanır.
      if (nextStatus !== undefined && nextStatus !== existing.status) {
        data.statusChangedAt = new Date();
      }
      const isPaidTransition =
        nextStatus === 'paid' && existing.status !== 'paid' && !existing.paidAt;
      const enteringPreparing =
        nextStatus === 'preparing' && existing.status !== 'preparing';
      // shippedAt = konsolide fatura kesim uygunluğunun tek kaynağı (birfatura.md
      // §3.2). Admin manuel olarak 'shipped'e çekerse de doldur — yalnızca henüz
      // boşsa, mevcut kargo tarihini ezmeden (sipariş yanlış döneme kaymasın).
      const enteringShipped =
        nextStatus === 'shipped' && existing.status !== 'shipped';
      if (enteringShipped && existing.shippedAt === null) {
        data.shippedAt = new Date();
      }
      // İptal: stok geri eklenir + ödeme yapılmışsa cari iadesi.
      // - Kart + 144h hold içinde → POS komisyonu kesilip kalan cari'ye iade
      // - Kart + hold sonrası → fatura zaten kesildi; elle iade akışı
      // - Cari (approved) → tutarın tamamı cari'ye geri (komisyon yok)
      // İade: stok geri EKLENMEZ ve cari otomatik iade EDİLMEZ — bu, destek
      // üzerinden yürüyen iade akışında (refundCustomerCari:true) yapılır.
      const enteringCancelled =
        nextStatus === 'cancelled' && !TERMINAL_STATES.has(existing.status);
      const enteringRefunded =
        nextStatus === 'refunded' && !TERMINAL_STATES.has(existing.status);
      // Müşteri cari iadesi: iptalde HER ZAMAN, iadede (refunded) YALNIZCA çağıran
      // refundCustomerCari:true geçtiğinde (destek-tabanlı iade finalize akışı).
      const refundCustomerForOrder =
        enteringCancelled || (enteringRefunded && refundCustomerCari);

      let refundLedgerId: string | null = null;
      let posCommissionAmount: Prisma.Decimal | null = null;
      let posCommissionRate: number | null = null;
      let refundMeta: {
        amount: number;
        previousBalance: number;
        newBalance: number;
        customerId: string;
        customerName: string | null;
      } | null = null;
      const restoredItems: Array<{ productId: string; qty: number }> = [];
      const supplierRefunds: Array<{
        supplierId: string;
        ledgerId: string | null;
        balanceAfter: number | null;
      }> = [];

      if (enteringCancelled) {
        for (const item of existing.items) {
          if (!item.productId) continue;
          await tx.product.update({
            where: { id: item.productId },
            data: { stock: { increment: item.qty } },
          });
          restoredItems.push({ productId: item.productId, qty: item.qty });
        }

        // Tedarikçi bakiye iadesi (kâr/maliyet'e DOKUNMAZ — ayrı modül/tablo).
        // KRİTİK YÖN AYRIMI: cüzdan iadesi YALNIZCA tedarikçi iptali
        // doğrulandığında yapılır (supplierCancelConfirmed = Tedarikçi A status=6
        // status-poll). Bizim ELLE iptalimizde tedarikçi siparişi zaten açtıysa
        // (ORDER_PURCHASE var) tedarikçi iade etmez → cüzdanı iade ETMEYİZ;
        // yoksa bakiyemiz gerçekte iade edilmeyen tutar kadar yüksek kalır.
        const purchaseSuppliers = await tx.supplierAccountLedger.findMany({
          where: {
            orderId: existing.id,
            tenantId,
            type: SupplierLedgerType.ORDER_PURCHASE,
          },
          select: { supplierId: true },
          distinct: ['supplierId'],
        });
        // KULLANICI KURALI (2026-06-20): Sipariş İPTAL edildiyse — elle ya da
        // tedarikçi-onaylı, supplierOrderNo dolu olsa bile — düşülen tedarikçi
        // tutarı DAİMA geri eklenir. İptal = tedarikçi iadesi; "tedarikçide açık"
        // diye iadeyi atlamak bakiye drift'ine ve sonsuz elle düzeltmeye yol
        // açıyordu. refundForOrderTx idempotent: ORDER_PURCHASE yoksa / zaten
        // iade edilmişse no-op (çift iade imkânsız).
        for (const { supplierId } of purchaseSuppliers) {
          const refund = await this.supplierAccount.refundForOrderTx(tx, {
            supplierId,
            tenantId,
            orderId: existing.id,
            humanOrderNo: existing.humanOrderNo,
          });
          if (!refund.skipped) {
            supplierRefunds.push({
              supplierId,
              ledgerId: refund.ledgerId,
              balanceAfter: refund.balanceAfter,
            });
          }
        }
        if (!supplierCancelConfirmed && purchaseSuppliers.length > 0) {
          // İz bırak: tedarikçi onayı gelmeden elle iptal edildi ama iade YİNE DE
          // yapıldı (kullanıcı kuralı). Tedarikçi gerçekte iade etmediyse admin
          // "Tedarikçiler" ekranından ters düzeltme yapabilir.
          await this.audit
            .log({
              tenantId,
              actorId: actor.id,
              actorType: 'ADMIN',
              action: 'supplier.refund.on_manual_cancel',
              target: existing.id,
              metadata: {
                humanOrderNo: existing.humanOrderNo,
                supplierOrderNo: existing.supplierOrderNo,
                supplierIds: purchaseSuppliers.map((p) => p.supplierId),
              },
            })
            .catch(() => undefined);
        }
      }

      // B1 (Safe refund): siparişe ait gerçek ORDER_PAYMENT ledger kayıtlarını
      // topla; önceden REFUND yapıldıysa onu da düş → müşterinin gerçekten
      // ödediği net tutar kadar iade. İPTAL'de HER ZAMAN; İADE (refunded)'da
      // yalnız çağıran refundCustomerCari:true geçtiğinde (destek-tabanlı iade
      // finalize). netPaid mantığı önceki REFUND'ları düştüğü için 'refunded'
      // yolunda çift iade İMKÂNSIZ.
      if (refundCustomerForOrder && existing.customerId) {
          const ledgerEntries = await tx.cariLedger.findMany({
            where: {
              orderId: existing.id,
              customerId: existing.customerId,
              type: { in: ['ORDER_PAYMENT', 'REFUND'] },
            },
            select: { type: true, amount: true },
          });

          let netPaid = new Prisma.Decimal(0);
          for (const entry of ledgerEntries) {
            if (entry.type === 'ORDER_PAYMENT') {
              netPaid = netPaid.sub(new Prisma.Decimal(entry.amount));
            } else if (entry.type === 'REFUND') {
              netPaid = netPaid.sub(new Prisma.Decimal(entry.amount));
            }
          }

          // Kart ödemesi 144h hold içinde mi? Fatura kesilmedi, POS komisyonu
          // kesilebilir. Hold geçmişse ya da paidAt yoksa komisyon kesme.
          const isCardPaid = existing.paymentType === 'card';
          const now = new Date();
          const isCardWithinHold =
            isCardPaid &&
            existing.invoiceHoldUntil !== null &&
            existing.invoiceHoldUntil > now &&
            existing.invoicedAt === null;

          // KART (POS) tahsilatı: cari ledger'da ORDER_PAYMENT satırı olmaz —
          // tahsil edilen tutar PaymentTransaction(success).totalAmount'tadır.
          // İŞLETME KURALI: karta iade YAPILMAZ (PayTR İade API'si bilinçli
          // olarak yok); iptal/iade tutarı HER ZAMAN cari bakiyeye eklenir.
          // KART KOMİSYONU İADE EDİLMEZ — POS işlem başına kestiği için
          // çekilen tutardan komisyon snapshot'ı düşülür (örn. 1.236 çekildi,
          // komisyon 36 → cariye 1.200 iade). Önceki kısmi REFUND'lar da
          // düşülür ki mükerrer iade oluşmasın.
          const hasCommissionSnapshot = existing.cardCommissionAmount !== null;
          // Kart dalına giriş: cari ORDER_PAYMENT satırı YOK (kart siparişinde
          // hiç yazılmaz). netPaid.isZero() KULLANILMAZ — önceki kısmi
          // REFUND'lar ilk döngüde netPaid'i NEGATİFE çekip iadeyi tamamen
          // kilitliyordu (örn. 1.236 çekildi, 500 kısmi iade → kalan 700
          // yerine 0 iade). REFUND düşümü bu dalın kendi döngüsünde yapılır;
          // netPaid burada baştan hesaplanıp ÜZERİNE yazılır.
          const hasOrderPayment = ledgerEntries.some(
            (e) => e.type === 'ORDER_PAYMENT',
          );
          if (!hasOrderPayment && isCardPaid && existing.paidAt) {
            const captured = await tx.paymentTransaction.aggregate({
              where: { orderId: existing.id, status: 'success' },
              _sum: { totalAmount: true },
            });
            let cardPaid = new Prisma.Decimal(captured._sum.totalAmount ?? 0);
            if (existing.cardCommissionAmount) {
              const commission = new Prisma.Decimal(
                existing.cardCommissionAmount,
              );
              posCommissionAmount = commission;
              posCommissionRate = null;
              cardPaid = cardPaid.sub(commission);
            }
            for (const entry of ledgerEntries) {
              if (entry.type === 'REFUND') {
                cardPaid = cardPaid.sub(new Prisma.Decimal(entry.amount));
              }
            }
            netPaid = cardPaid.greaterThan(0) ? cardPaid : new Prisma.Decimal(0);
          }

          if (netPaid.greaterThan(0)) {
            let refundAmount = netPaid;

            // Eski (snapshot'sız) kart siparişleri için legacy hold-içi
            // tahmini POS kesintisi. Yeni siparişlerde komisyon yukarıda
            // birebir snapshot'tan düşüldü — tekrar kesinti yapılmaz.
            if (isCardWithinHold && !hasCommissionSnapshot) {
              const rate = await this.settings.getDecimal(
                'payment.posCommissionRate',
                new Prisma.Decimal('2.5'),
              );
              posCommissionRate = Number(rate);
              posCommissionAmount = refundAmount.mul(rate).div(100);
              refundAmount = refundAmount.sub(posCommissionAmount);
            }

            const refund = await this.cariBalance.refundForOrderTx(tx, {
              customerId: existing.customerId,
              orderId: existing.id,
              amount: refundAmount,
              humanOrderNo: existing.humanOrderNo,
            });
            refundLedgerId = refund.ledgerId;
            refundMeta = {
              amount: Number(refundAmount),
              previousBalance: Number(refund.previousBalance),
              newBalance: Number(refund.newBalance),
              customerId: existing.customerId,
              customerName: existing.customerName,
            };
          }
        }

      // §2.2 — İADE (refunded) yolunda da tedarikçi cüzdanı geri eklenir.
      // İptal (enteringCancelled) bunu zaten yapıyordu; refunded'da HİÇ
      // yapılmıyordu → tedarikçiden alınıp (ORDER_PURCHASE düşülmüş) sonra
      // iade edilen siparişte cüzdan kalıcı aşağı drift ediyordu. Bu blok
      // YALNIZCA tedarikçi cüzdanını iade eder. Müşteri cari iadesi refunded'da
      // destek-tabanlı iade finalize'ında yukarıdaki refundCustomerForOrder
      // bloğunda (refundCustomerCari:true) yapılır. ÇİFT İADE engellenir:
      // finalize'ın netPaid'i önceki REFUND'ları düşer. Bu blok tedarikçi
      // cüzdanı için: refundForOrderTx idempotent (ORDER_PURCHASE yoksa/zaten
      // iade edilmişse no-op).
      if (enteringRefunded) {
        const refundSuppliers = await tx.supplierAccountLedger.findMany({
          where: {
            orderId: existing.id,
            tenantId,
            type: SupplierLedgerType.ORDER_PURCHASE,
          },
          select: { supplierId: true },
          distinct: ['supplierId'],
        });
        for (const { supplierId } of refundSuppliers) {
          const refund = await this.supplierAccount.refundForOrderTx(tx, {
            supplierId,
            tenantId,
            orderId: existing.id,
            humanOrderNo: existing.humanOrderNo,
          });
          if (!refund.skipped) {
            supplierRefunds.push({
              supplierId,
              ledgerId: refund.ledgerId,
              balanceAfter: refund.balanceAfter,
            });
          }
        }
      }

      // §orta — İptal/iade edilen siparişin KREDİ KARTI TAHSİLAT MAKBUZU silinir
      // (kullanıcı kararı 2026-06-24: iptal olanın makbuzu geçerli görünmesin).
      // Makbuz no dizisinde boşluk olabilir — kabul edilen davranış. Cari topup
      // makbuzları (topupId'li) ETKİLENMEZ; yalnız bu siparişe bağlı olan silinir.
      if (enteringCancelled || enteringRefunded) {
        await tx.paymentReceipt.deleteMany({ where: { orderId: existing.id } });
      }

      // §2.2 REAKTİVASYON GERİ-SARMA — iptal edilmiş sipariş tekrar aktife
      // çekiliyorsa iptalin üç etkisini de tam simetrik geri al. Sıra: önce
      // geri-sarma, sonra (gerekiyorsa) normal düşüm. Yetersiz cari bakiyede
      // reverseCancelRefundTx throw eder → tüm transaction rollback (sipariş
      // iptalde kalır).
      if (reactivatingFromCancel) {
        // (1) Stok yeniden düş — iptal her kalem için increment etmişti.
        for (const item of existing.items) {
          if (!item.productId) continue;
          await tx.product.update({
            where: { id: item.productId },
            data: { stock: { decrement: item.qty } },
          });
        }
        // (2) Cari yeniden ücretlendir — iptalin REFUND'larını silip bakiyeden
        // düşer (yetersizse throw). Kart siparişinde de doğru çalışır.
        if (existing.customerId) {
          await this.cariBalance.reverseCancelRefundTx(tx, {
            customerId: existing.customerId,
            orderId: existing.id,
          });
        }
        // (3) Tedarikçi cüzdanını yeniden düş — iptalin ORDER_REFUND'larını
        // silip bakiyeden düşer (ORDER_PURCHASE durumu geri gelir). Sipariş
        // iptalden önce hiç düşülmemişse (ORDER_REFUND yok) no-op; bu durumda
        // aşağıdaki düşüm bloğu fiilen alımı yapar.
        const refundedSuppliers = await tx.supplierAccountLedger.findMany({
          where: {
            orderId: existing.id,
            tenantId,
            type: SupplierLedgerType.ORDER_REFUND,
          },
          select: { supplierId: true },
          distinct: ['supplierId'],
        });
        for (const { supplierId } of refundedSuppliers) {
          await this.supplierAccount.reverseRefundForReactivationTx(tx, {
            supplierId,
            tenantId,
            orderId: existing.id,
          });
        }
      }

      // Sipariş paid'den fiilen tedarik akışına geçiyorsa (preparing VEYA
      // doğrudan shipped — admin preparing'i atlayabiliyor): tedarikçi
      // bakiyesini gerçek alış maliyeti kadar düş (Karlılık → Tedarikçi
      // Ayarları). Idempotent (orderId+supplierId), aynı transaction.
      // Depo'dan gönderilen kalemler deductForOrderByCostTx içinde
      // filtrelenir → tam-depo siparişte düşüm doğal olarak sıfır kalem bulur,
      // karma siparişte yalnız tedarikçi kalemleri düşer. Reaktivasyonda
      // doğrudan preparing/shipped'e çekilirse de (existing.status='cancelled')
      // burada fiilen alım yapılır; idempotent olduğundan (3) ile çakışmaz.
      if (
        (nextStatus === 'preparing' || nextStatus === 'shipped') &&
        (existing.status === 'paid' || reactivatingFromCancel)
      ) {
        await this.supplierAccount.deductForOrderByCostTx(tx, {
          orderId: existing.id,
        });
      }

      // Status 'paid'a geçiyorsa: paidAt + invoiceHoldUntil + billing snapshot.
      // Bu admin manuel tik akışı; ödeme webhook'ları ileride aynı helper'ı
      // kendi flow'larından çağıracak.
      if (isPaidTransition && existing.customerId) {
        const customer = await tx.customer.findUnique({
          where: { id: existing.customerId },
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
        });
        if (customer) {
          await markOrderPaid({
            tx,
            settings: this.settings,
            orderId: existing.id,
            customer: {
              id: customer.id,
              name: customer.name,
              email: customer.email,
              phone: customer.phone,
              companyTitle: customer.companyTitle,
              vergiNo: customer.vergiNo,
              vergiDairesi: customer.vergiDairesi,
              tcKimlik: customer.tcKimlik,
              contactPhone: customer.contactPhone,
              companyAddress: customer.companyAddress,
            },
            customerAddress: customer.addresses[0] ?? null,
          });
        }
      }

      const updated = await tx.order.update({
        where: { id },
        data,
        select: {
          id: true,
          status: true,
          trackingNumber: true,
          marketplace: true,
          cargoCompany: true,
          cargoBarcode: true,
          endCustomerName: true,
          notes: true,
          updatedAt: true,
        },
      });

      return {
        updated,
        sideEffects: {
          enteredCancelled: enteringCancelled,
          enteredRefunded: enteringRefunded,
          enteredPaid: isPaidTransition,
          enteredPreparing: enteringPreparing,
          previousStatus: existing.status,
          nextStatus: nextStatus ?? existing.status,
          restoredItems,
          supplierRefunds,
          refundLedgerId,
          refundMeta,
          posCommissionAmount:
            posCommissionAmount !== null
              ? Number(posCommissionAmount)
              : null,
          posCommissionRate,
          preparingMailInfo: enteringPreparing
            ? {
                customerId: existing.customerId,
                customerEmail: existing.customerEmail,
                customerName: existing.customerName,
                humanOrderNo: existing.humanOrderNo,
                marketplace: dto.marketplace ?? existing.marketplace,
                cargoCompany: dto.cargoCompany ?? existing.cargoCompany,
                cargoBarcode: dto.cargoBarcode ?? existing.cargoBarcode,
              }
            : null,
        },
      };
    });

    if (result.sideEffects.enteredCancelled || result.sideEffects.enteredRefunded) {
      const action = result.sideEffects.enteredRefunded
        ? 'ORDER_REFUNDED'
        : 'ORDER_CANCELLED';
      void this.audit.log({
        actorType: 'admin',
        actorId: actor.id,
        tenantId: actor.tenantId,
        action,
        target: id,
        metadata: {
          previousStatus: result.sideEffects.previousStatus,
          nextStatus: result.sideEffects.nextStatus,
          restoredItems: result.sideEffects.restoredItems,
          supplierRefunds: result.sideEffects.supplierRefunds,
          refundLedgerId: result.sideEffects.refundLedgerId,
          posCommissionAmount: result.sideEffects.posCommissionAmount,
          posCommissionRate: result.sideEffects.posCommissionRate,
        },
      });
    }

    if (result.sideEffects.enteredPaid) {
      void this.audit.log({
        actorType: 'admin',
        actorId: actor.id,
        tenantId: actor.tenantId,
        action: 'ORDER_PAID',
        target: id,
        metadata: { previousStatus: result.sideEffects.previousStatus },
      });
    }

    const pm = result.sideEffects.preparingMailInfo;
    if (notify && pm?.customerEmail) {
      // OPSİYONEL "hazırlanıyor" maili: müşteri durum bildirimlerini kapattıysa atla.
      // (Hazırlanıyor bir iptal/iade değildir; zorunlu muafiyet gerekmez.)
      const { status: statusPrefOk } = await getOrderEmailPrefs(
        this.prisma,
        pm.customerId,
      );
      if (statusPrefOk) {
        void this.mail
          .sendOrderPreparing({
            to: pm.customerEmail,
            customerName: pm.customerName ?? pm.customerEmail,
            humanOrderNo: pm.humanOrderNo,
            marketplace: pm.marketplace ?? undefined,
            cargoCompany: pm.cargoCompany ?? undefined,
            cargoBarcode: pm.cargoBarcode ?? undefined,
          })
          .catch((e) =>
            this.logger.warn(`order preparing mail failed order=${id} err=${(e as Error).message}`),
          );
      }
    }

    // Generic status değişim mail'i: preparing'in kendi dedicated mail'i var,
    // diğer tüm transition'lar için (paid, shipped, cancelled, refunded)
    // tek tip statü-değişti maili gönder.
    const se = result.sideEffects;
    const statusChanged =
      se.nextStatus !== se.previousStatus && !se.enteredPreparing;

    // B1: Sipariş iptal edilip bedel cari hesaba iade edildiyse (refundMeta dolu)
    // müşteriye "cari bakiyenize ekleme yapılmıştır" mailini önceki/yeni bakiye
    // ile gönder. Tedarikçi kaynaklı bot iptalinde (supplierCancelConfirmed)
    // notify:false olsa dahi bu mail gönderilir. Bu durumda generic statü-değişti
    // maili GÖNDERİLMEZ (çift mail olmasın) — karşılıklı dışlama.
    const cancelRefundMailEligible =
      se.enteredCancelled &&
      se.refundMeta != null &&
      (notify || supplierCancelConfirmed);

    if (cancelRefundMailEligible || (notify && statusChanged)) {
      const orderForMail = await this.prisma.order.findUnique({
        where: { id },
        select: {
          customerId: true,
          customerEmail: true,
          customerName: true,
          humanOrderNo: true,
          marketplace: true,
          cargoCompany: true,
          cargoBarcode: true,
        },
      });
      if (orderForMail?.customerEmail) {
        if (cancelRefundMailEligible && se.refundMeta) {
          const rm = se.refundMeta;
          void this.mail
            .sendOrderCancelledRefund({
              to: orderForMail.customerEmail,
              customerName:
                orderForMail.customerName ??
                rm.customerName ??
                orderForMail.customerEmail,
              humanOrderNo: orderForMail.humanOrderNo,
              refundAmount: rm.amount,
              previousBalance: rm.previousBalance,
              newBalance: rm.newBalance,
            })
            .catch((e) =>
              this.logger.warn(
                `order cancelled refund mail failed order=${id} err=${(e as Error).message}`,
              ),
            );
        } else if (notify && statusChanged) {
          // İPTAL GARANTİSİ: iptal/iade geçişlerinde (cari iade olmasa bile bu
          // generic dala düşer) müşteri durum bildirimlerini KAPATMIŞ olsa dahi
          // mail ZORUNLU olarak gönderilir. Diğer durum değişimleri (kargoda,
          // teslim edildi vb.) OPSİYONEL — tercih kapalıysa atlanır.
          const isCancelLike = se.enteredCancelled || se.enteredRefunded;
          // KURAL: "kargoya verildi" (shipped) geçişinde müşteriye ASLA mail
          // atılmaz — gerçekte daha erken/daha geç kargoya veriyoruz; bir
          // "kargoya verildi" bildirimi/tarihi müşteriyi yanıltır. Müşteriye
          // yalnız sipariş alındı + hazırlanıyor bilgilendirmesi gider.
          const isShipped = se.nextStatus === 'shipped';
          const statusPrefOk = isCancelLike
            ? true
            : (await getOrderEmailPrefs(this.prisma, orderForMail.customerId))
                .status;
          if (statusPrefOk && !isShipped) {
            void this.mail
              .sendOrderStatusChanged({
                to: orderForMail.customerEmail,
                customerName:
                  orderForMail.customerName ?? orderForMail.customerEmail,
                humanOrderNo: orderForMail.humanOrderNo,
                fromLabel: statusLabel(se.previousStatus),
                toLabel: statusLabel(se.nextStatus),
                cargoCompany: orderForMail.cargoCompany,
                cargoBarcode: orderForMail.cargoBarcode,
                marketplace: orderForMail.marketplace,
              })
              .catch((e) =>
                this.logger.warn(
                  `order status changed mail failed order=${id} err=${(e as Error).message}`,
                ),
              );
          }
        }
      }
    }

    return {
      success: true,
      data: result.updated,
      meta: {
        previousStatus: result.sideEffects.previousStatus,
        nextStatus: result.sideEffects.nextStatus,
        statusChanged:
          result.sideEffects.previousStatus !== result.sideEffects.nextStatus,
        refund: result.sideEffects.refundMeta,
      },
    };
  }

  /**
   * Toplu sipariş statü güncelleme.
   *
   * Üç mod:
   *  - selected:   `orderIds` listesindeki siparişleri günceller.
   *  - filtered:   Admin filtreleriyle eşleşen ilk 200 siparişi günceller.
   *  - transition: `fromStatus`'taki siparişleri (filtrelerle birlikte) `toStatus`'a alır.
   *
   * Her sipariş için `updateOrder` çağrılır — refund/cari/preparing-mail
   * side-effect'leri tek tek tetiklenir. Hata olursa o sipariş `failed` listesine
   * eklenir, diğerleri devam eder.
   */
  async bulkUpdate(
    tenantId: string,
    dto: BulkUpdateOrdersDto,
    actor: { id: string; tenantId: string },
  ) {
    const notify = dto.notify !== false;

    if (dto.mode === 'transition' && !dto.fromStatus) {
      throw new BadRequestException(
        'transition mode için fromStatus zorunlu',
      );
    }
    if (dto.mode === 'selected' && (!dto.orderIds || dto.orderIds.length === 0)) {
      throw new BadRequestException(
        'selected mode için orderIds zorunlu',
      );
    }

    const ids = await this.resolveBulkOrderIds(tenantId, dto);

    if (ids.length === 0) {
      return {
        success: true as const,
        data: {
          requested: 0,
          succeeded: 0,
          failed: [] as Array<{ id: string; error: string }>,
          toStatus: dto.toStatus,
          mode: dto.mode,
        },
      };
    }

    const succeeded: string[] = [];
    const failed: Array<{ id: string; error: string }> = [];

    for (const id of ids) {
      try {
        await this.updateOrder(
          tenantId,
          id,
          { status: dto.toStatus },
          actor,
          { notify },
        );
        succeeded.push(id);
      } catch (err) {
        failed.push({
          id,
          error: (err as Error)?.message ?? 'unknown error',
        });
        this.logger.warn(
          `bulk update failed order=${id} err=${(err as Error)?.message}`,
        );
      }
    }

    void this.audit.log({
      actorType: 'admin',
      actorId: actor.id,
      tenantId: actor.tenantId,
      action: 'ORDER_BULK_UPDATE',
      target: dto.toStatus,
      metadata: {
        mode: dto.mode,
        fromStatus: dto.fromStatus ?? null,
        toStatus: dto.toStatus,
        notify,
        notes: dto.notes ?? null,
        requested: ids.length,
        succeeded: succeeded.length,
        failed: failed.length,
      },
    });

    return {
      success: true as const,
      data: {
        requested: ids.length,
        succeeded: succeeded.length,
        failed,
        toStatus: dto.toStatus,
        mode: dto.mode,
      },
    };
  }

  /**
   * Bulk update için sipariş ID'lerini moda göre çözer.
   * Selected mode'da liste max BULK_UPDATE_MAX'a kısılır; filtered/transition
   * için filtre koşullarına uyan ilk BULK_UPDATE_MAX kaydı alır.
   */
  private async resolveBulkOrderIds(
    tenantId: string,
    dto: BulkUpdateOrdersDto,
  ): Promise<string[]> {
    if (dto.mode === 'selected') {
      const ids = (dto.orderIds ?? []).slice(0, BULK_UPDATE_MAX);
      // Tenant ownership doğrulaması — başka tenant'a ait id'yi sessizce eler.
      const owned = await this.prisma.order.findMany({
        where: { id: { in: ids }, tenantId },
        select: { id: true },
      });
      return owned.map((o) => o.id);
    }

    const where: Prisma.OrderWhereInput = { tenantId };

    if (dto.mode === 'transition' && dto.fromStatus) {
      where.status = dto.fromStatus as OrderStatus;
    } else if (dto.status) {
      where.status = dto.status as OrderStatus;
    }
    if (dto.customerId) where.customerId = dto.customerId;
    // Çoklu tedarikçi (multi-select) önceliklidir; verildiğinde tekil supplierId
    // yok sayılır. Atıf TEK KAYNAK (override→snapshot→product) ile liste/EXPORT
    // ile birebir aynı kapsam kullanır.
    if (dto.supplierIds !== undefined) {
      if (dto.supplierIds.length === 0) {
        // Hiçbiri seçili değil → hiçbir sipariş.
        return [];
      }
      where.items = {
        some: { OR: dto.supplierIds.flatMap((id) => supplierMatchOr(id)) },
      };
    } else if (dto.supplierId) {
      where.items = { some: { OR: supplierMatchOr(dto.supplierId) } };
    }
    {
      const range = trDateRange(dto.dateFrom, dto.dateTo);
      if (range) where.createdAt = range;
    }
    if (dto.q) {
      where.OR = [
        { humanOrderNo: { contains: dto.q, mode: 'insensitive' } },
        { supplierOrderNo: { contains: dto.q, mode: 'insensitive' } },
        { cargoBarcode: { contains: dto.q, mode: 'insensitive' } },
        { customerName: { contains: dto.q, mode: 'insensitive' } },
        { customerEmail: { contains: dto.q, mode: 'insensitive' } },
        { endCustomerName: { contains: dto.q, mode: 'insensitive' } },
      ];
    }

    const rows = await this.prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: BULK_UPDATE_MAX,
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  /**
   * Aynı isimli (productName) ürünler için tedarikçiler arasında en ucuz
   * alternatif tedarikçi varsa onu döndürür. Sipariş detayında "daha ucuza
   * aynı ürünü şu tedarikçiden alabilirsiniz" ipucu için kullanılır.
   *
   * Yalnızca admin'e görünür; müşteri tarafına sızmaz.
   */
  /**
   * Bir order item'ın ürünü için "aynı fiziksel ürünü stoklayan tedarikçiler"
   * adaylarını belirleyen Prisma kapsamı — auto-route (cheapest-supplier) ile
   * BİREBİR aynı mantık. Ürün AKTİF bir match-group'a bağlıysa grup üyeleri
   * (Vitrin/Satın-Alma eşleştirmesi: İphone↔iPhone, "Marka" öneki, ARB06↔EAN
   * barkod köprüsü dahil); aksi halde nameKey. Eski "name birebir eşit" filtresi
   * farklı yazımlı Tedarikçi A'i dışarıda bırakıyordu (paid siparişte kalem altında
   * yalnız Toptan Budur çıkıyordu). Kapsam çıkarılamazsa null döner.
   */
  private async resolveItemSupplierScope(
    product:
      | {
          nameKey?: string | null;
          matchGroupId?: string | null;
          matchGroup?: { status: string } | null;
        }
      | null
      | undefined,
    productNameFallback: string | null,
  ): Promise<Prisma.ProductWhereInput | null> {
    const matchEnabled = await this.settings.getBoolean(
      PRODUCT_MATCH_SETTING_KEYS.ENABLED,
      PRODUCT_MATCH_DEFAULTS.ENABLED,
    );
    const activeGroupId =
      matchEnabled &&
      product?.matchGroupId &&
      product?.matchGroup?.status === 'active'
        ? product.matchGroupId
        : null;
    if (activeGroupId) return { matchGroupId: activeGroupId };
    const nameKey =
      product?.nameKey?.trim() ||
      (productNameFallback ? computeNameKey(productNameFallback) : '');
    if (!nameKey) return null;
    return { nameKey };
  }

  /**
   * SİPARİŞ-SEVİYESİ tedarikçi KARARI (kullanıcı kararı 2026-06-29). Eski per-item
   * "💡 daha ucuz" YANLIŞTI: alternatifin MALİYETİNİ ürünün SATIŞ fiyatıyla
   * kıyaslıyordu (maliyet<satış hep doğru → her zaman yanlış "daha ucuz" derdi).
   * Artık MALİYET-vs-MALİYET, sipariş-seviyesi + eşik-bilinçli:
   *   - kind='deliberate' (YEŞİL): alternatif (Tedarikçi A) 0 < fark < eşik daha ucuz →
   *     tedarikçi ilişkisi için BİLİNÇLİ olarak display'de (TB) kalındı.
   *   - kind='cheaper' (SARI): alternatif eşik kadar+ ucuz (rota dışı kalmışsa uyarı).
   *   - kind='none': mevcut zaten en ucuz / alternatif yok / paid değil.
   * getOrderEligibleSuppliers'ı yeniden kullanır (maliyet toplamları + currentSupplierId).
   */
  async getSupplierAlternatives(tenantId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId },
      select: { id: true, status: true },
    });
    if (!order) throw new NotFoundException('order not found');

    const none = { success: true as const, data: { kind: 'none' as const } };
    // Yalnız 'paid' (alım öncesi); 'preparing'+ kilitli → karar gösterme.
    if (order.status !== 'paid') return none;

    const elig = await this.getOrderEligibleSuppliers(tenantId, orderId);
    const currentSupplierId = elig.data.currentSupplierId;
    const suppliers = elig.data.suppliers; // toplam maliyete göre ARTAN sıralı
    if (!currentSupplierId || suppliers.length < 2) return none;

    const currentSup = suppliers.find((s) => s.id === currentSupplierId);
    // En ucuz alternatif = sıralı listede mevcut olmayan ilk (en düşük toplam) tedarikçi.
    const cheapestAlt = suppliers.find((s) => s.id !== currentSupplierId);
    if (!currentSup || !cheapestAlt) return none;

    const diff =
      Math.round((currentSup.totalCost - cheapestAlt.totalCost) * 100) / 100;
    if (diff <= 0) return none; // mevcut zaten en ucuz (veya eşit)

    const threshold = await this.settings.getNumber(
      'dispatch.minCostSavingToSwitch',
      3,
    );
    const kind = diff >= threshold ? 'cheaper' : 'deliberate';
    return {
      success: true as const,
      data: {
        kind,
        currentSupplierName: currentSup.name,
        cheaperSupplierName: cheapestAlt.name,
        diff,
        threshold,
      },
    };
  }

  /**
   * Belirli bir OrderItem için bayinin gerçekte alım yaptığı tedarikçiyi
   * günceller. Bayi "daha ucuz" önerisini kabul edip farklı tedarikçiden
   * alıyorsa, ciro/cari hesaplamaları artık o tedarikçiye yansır.
   *
   * Kurallar:
   * - Yeni supplier aynı tenantId'de olmalı.
   * - Yeni supplier'da bu productName ile aktif bir ürün bulunmalı (yalnızca
   *   ürünü stoklayan tedarikçiler seçilebilir).
   * - Override null ile sıfırlanabilir (ürünün orijinal tedarikçisine dön).
   */
  async setItemSupplierOverride(
    tenantId: string,
    orderId: string,
    itemId: string,
    supplierId: string | null,
  ) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId },
      select: { id: true },
    });
    if (!order) throw new NotFoundException('order not found');

    const item = await this.prisma.orderItem.findFirst({
      where: { id: itemId, orderId },
      // Override sıfırlandığında orijinal tedarikçinin SKU/barkod/maliyetine geri
      // dönmek için ürünün externalCode/barcode/costPrice'ını; yeni tedarikçinin
      // aday kapsamı için de nameKey/matchGroup'ı çekiyoruz.
      select: {
        id: true,
        productName: true,
        product: {
          select: {
            externalCode: true,
            barcode: true,
            costPrice: true,
            nameKey: true,
            matchGroupId: true,
            matchGroup: { select: { status: true } },
          },
        },
      },
    });
    if (!item) throw new NotFoundException('order item not found');

    // KRİTİK (2026-06-28 bug #61002900): Bot orchestrator'ları (bot'lu
    // tedarikçi API'leri) sipariş gönderirken tedarikçi
    // SKU'sunu `resolveItemSupplierSku` ile çözer: ÖNCE `supplierSkuOverride`,
    // yoksa `supplierSku` snapshot'ı. Auto-route (en-ucuz yönlendirme) yeni
    // tedarikçinin değerlerini OVERRIDE alanlarına (supplierIdOverride /
    // supplierSkuOverride / supplierBarcodeOverride + costPriceSnapshot) yazar.
    //
    // Bu manuel değiştirici ESKİDEN SKU/barkodu SNAPSHOT alanlarına yazıyordu;
    // supplierIdOverride'ı yeni tedarikçiye çevirse de auto-route'tan kalan
    // `supplierSkuOverride`'ı TEMİZLEMEDİĞİ için bot hâlâ o bayat SKU'yu okuyordu
    // (ör. Tedarikçi B "Sem.7676038" → Tedarikçi C urunID INTEGER beklediğinden
    // validation_error). DÜZELTME: bu değiştirici de auto-route ile BİREBİR aynı
    // OVERRIDE katmanını atomik yazar — üç alan DAİMA birlikte set/clear edilir ki
    // supplierIdOverride ile supplierSkuOverride asla farklı tedarikçilere işaret
    // etmesin. Her tedarikçinin externalCode uzayı kendine özgüdür.
    let nextSupplierSku: string | null;
    let nextSupplierBarcode: string | null;

    if (supplierId) {
      const supplier = await this.prisma.supplier.findFirst({
        where: { id: supplierId, tenantId },
        select: { id: true },
      });
      if (!supplier) {
        throw new BadRequestException('supplier not found in this tenant');
      }
      // Seçilen tedarikçinin bu ürün için satırını matchGroup/nameKey kapsamıyla
      // bul (eski "name birebir eşit" değil — eligible listesiyle TUTARLI olmalı,
      // yoksa listede görünen Tedarikçi A "selected supplier does not stock this
      // product" ile reddedilirdi). Stoktakini ve en ucuzu tercih et; SKU/barkod/
      // maliyet o satırdan alınır.
      const scope = await this.resolveItemSupplierScope(
        item.product ?? null,
        item.productName,
      );
      const newProduct = scope
        ? await this.prisma.product.findFirst({
            where: { tenantId, supplierId, ...scope, active: true },
            orderBy: [{ stock: 'desc' }, { costPrice: 'asc' }],
            select: { externalCode: true, barcode: true, costPrice: true },
          })
        : null;
      if (!newProduct) {
        throw new BadRequestException(
          'selected supplier does not stock this product',
        );
      }
      nextSupplierSku = newProduct.externalCode ?? null;
      nextSupplierBarcode = newProduct.barcode ?? null;

      // OVERRIDE katmanını atomik yaz — auto-route ile aynı semantik. Üç override
      // alanı (id/sku/barcode) DAİMA birlikte yazılır; costPriceSnapshot yeni
      // tedarikçinin maliyetine güncellenir ki cari/karlılık doğru atfetsin.
      await this.prisma.orderItem.update({
        where: { id: itemId },
        data: {
          supplierIdOverride: supplierId,
          supplierSkuOverride: nextSupplierSku,
          supplierBarcodeOverride: nextSupplierBarcode,
          costPriceSnapshot: newProduct.costPrice ?? null,
        },
      });
    } else {
      // Override sıfırlanıyor — TÜM override alanlarını TEMİZLE ki bot orijinal
      // tedarikçinin snapshot SKU/barkoduna düşsün. Snapshot'ları da ürünün
      // güncel değerlerine geri yazarız (eski sürümün snapshot'a yazdığı bayat
      // değeri iyileştirir); costPriceSnapshot orijinal ürün maliyetine döner.
      nextSupplierSku = item.product?.externalCode ?? null;
      nextSupplierBarcode = item.product?.barcode ?? null;

      await this.prisma.orderItem.update({
        where: { id: itemId },
        data: {
          supplierIdOverride: null,
          supplierSkuOverride: null,
          supplierBarcodeOverride: null,
          supplierSku: nextSupplierSku,
          supplierBarcode: nextSupplierBarcode,
          costPriceSnapshot: item.product?.costPrice ?? null,
        },
      });
    }

    this.logger.log(
      `order item ${itemId} supplier override=${supplierId ?? 'null'} ` +
        `sku=${nextSupplierSku ?? 'null'} barcode=${nextSupplierBarcode ?? 'null'} ` +
        `(tenantId=${tenantId})`,
    );

    return this.findOne(tenantId, orderId);
  }

  /**
   * Sipariş bazında tedarikçi sipariş numarasını kaydeder.
   * Boş string null'a çevrilir. İlk kez set edildiğinde sipariş hâlâ
   * "paid" ise statü otomatik "preparing"e geçer.
   */
  async setOrderSupplierOrderNo(
    tenantId: string,
    orderId: string,
    supplierOrderNo: string | null,
  ) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId },
      select: { id: true, status: true, supplierOrderNo: true },
    });
    if (!order) throw new NotFoundException('order not found');

    const value =
      supplierOrderNo && supplierOrderNo.trim() !== ''
        ? supplierOrderNo.trim()
        : null;

    const wasEmpty = !order.supplierOrderNo;
    const shouldTransition = !!(value && wasEmpty && order.status === 'paid');

    await this.prisma.$transaction(async (tx) => {
      if (shouldTransition) {
        // Atomik paid→preparing: yalnızca hâlâ 'paid' ise geçir. count===1 →
        // geçişi GERÇEKTEN bu çağrı yaptı → tedarikçiden alım = bakiyeyi düş
        // (Karlılık ayarları, idempotent orderId+supplierId).
        const transition = await tx.order.updateMany({
          where: { id: orderId, status: 'paid' },
          data: {
            supplierOrderNo: value,
            status: 'preparing',
            statusChangedAt: new Date(),
          },
        });
        if (transition.count === 1) {
          await this.supplierAccount.deductForOrderByCostTx(tx, { orderId });
          return;
        }
      }
      // Geçiş yok ya da yarışta başka işlem geçirdi: yalnızca sip. no'yu yaz.
      await tx.order.update({
        where: { id: orderId },
        data: { supplierOrderNo: value },
      });
      // Sipariş zaten preparing ise (örn. karma depo siparişi depo
      // dispatch'iyle geçmiş) tedarikçi sip. no girilmesi = alım yapıldı →
      // idempotent düşüm. Depo kalemleri içeride filtrelenir.
      if (value) {
        const fresh = await tx.order.findUnique({
          where: { id: orderId },
          select: { status: true },
        });
        if (fresh?.status === 'preparing') {
          await this.supplierAccount.deductForOrderByCostTx(tx, { orderId });
        }
      }
    });

    this.logger.log(
      `order ${orderId} supplierOrderNo set (tenantId=${tenantId}, autoTransition=${
        shouldTransition ? 'yes' : 'no'
      })`,
    );

    return this.findOne(tenantId, orderId);
  }

  /**
   * OrderItem üzerine tedarikçinin verdiği sipariş numarasını kaydeder.
   * Boş string null'a çevrilir. İlk kez set edildiğinde sipariş hâlâ
   * "paid" ise statü otomatik "preparing"e geçer.
   */
  async setItemSupplierOrderNo(
    tenantId: string,
    orderId: string,
    itemId: string,
    supplierOrderNo: string | null,
  ) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId },
      select: { id: true, status: true },
    });
    if (!order) throw new NotFoundException('order not found');

    const item = await this.prisma.orderItem.findFirst({
      where: { id: itemId, orderId },
      select: { id: true },
    });
    if (!item) throw new NotFoundException('order item not found');

    const value = supplierOrderNo && supplierOrderNo.trim() !== ''
      ? supplierOrderNo.trim()
      : null;

    await this.prisma.$transaction(async (tx) => {
      await tx.orderItem.update({
        where: { id: itemId },
        data: { supplierOrderNo: value },
      });

      if (value && order.status === 'paid') {
        // Atomik paid→preparing guard: yalnızca hâlâ 'paid' ise geçir.
        const transition = await tx.order.updateMany({
          where: { id: orderId, status: 'paid' },
          data: { status: 'preparing', statusChangedAt: new Date() },
        });
        if (transition.count === 1) {
          // Tedarikçiden alım = bakiyeyi düş (Karlılık ayarları, idempotent).
          await this.supplierAccount.deductForOrderByCostTx(tx, { orderId });
          return;
        }
      }
      // Sipariş zaten preparing ise (örn. karma depo siparişi) kalem sip. no
      // girilmesi = alım yapıldı → idempotent düşüm (depo kalemleri filtreli).
      if (value) {
        const fresh = await tx.order.findUnique({
          where: { id: orderId },
          select: { status: true },
        });
        if (fresh?.status === 'preparing') {
          await this.supplierAccount.deductForOrderByCostTx(tx, { orderId });
        }
      }
    });

    this.logger.log(
      `order item ${itemId} supplierOrderNo set (tenantId=${tenantId}, autoTransition=${
        value && order.status === 'paid' ? 'yes' : 'no'
      })`,
    );

    return this.findOne(tenantId, orderId);
  }

  /**
   * Belirli bir OrderItem için seçilebilecek tedarikçileri döndürür —
   * yalnızca aynı productName'i aktif olarak stoklayan tedarikçiler.
   * Admin UI'da supplier seçici dropdown'unda kullanılır.
   */
  async getItemEligibleSuppliers(
    tenantId: string,
    orderId: string,
    itemId: string,
  ) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId },
      select: { id: true },
    });
    if (!order) throw new NotFoundException('order not found');

    const item = await this.prisma.orderItem.findFirst({
      where: { id: itemId, orderId },
      select: {
        id: true,
        productName: true,
        productId: true,
        supplierIdOverride: true,
        product: {
          select: {
            supplierId: true,
            nameKey: true,
            matchGroupId: true,
            matchGroup: { select: { status: true } },
          },
        },
      },
    });
    if (!item) throw new NotFoundException('order item not found');

    // Adayları matchGroup/nameKey kapsamıyla bul (eski "name birebir eşit" değil)
    // — böylece aynı fiziksel ürünü farklı yazımla (İphone↔iPhone, ARB06 barkod)
    // stoklayan Tedarikçi A de seçilebilir tedarikçiler listesinde görünür.
    const scope = await this.resolveItemSupplierScope(
      item.product ?? null,
      item.productName,
    );
    const rows = scope
      ? await this.prisma.product.findMany({
          where: { tenantId, ...scope, active: true },
          select: {
            price: true,
            costPrice: true,
            supplier: { select: { id: true, name: true } },
          },
        })
      : [];

    const bySupplier = new Map<
      string,
      { id: string; name: string; unitPrice: number; costPrice: number | null }
    >();
    for (const r of rows) {
      const sid = r.supplier?.id;
      if (!sid) continue;
      const existing = bySupplier.get(sid);
      const unitPrice = Number(r.price);
      const cost = r.costPrice !== null ? Number(r.costPrice) : null;
      if (!existing) {
        bySupplier.set(sid, {
          id: sid,
          name: r.supplier!.name,
          unitPrice,
          costPrice: cost,
        });
      } else if (cost !== null && (existing.costPrice ?? Infinity) > cost) {
        existing.costPrice = cost;
        existing.unitPrice = unitPrice;
      }
    }

    const eligible = Array.from(bySupplier.values()).sort((a, b) => {
      const ac = a.costPrice ?? a.unitPrice;
      const bc = b.costPrice ?? b.unitPrice;
      return ac - bc;
    });

    return {
      success: true,
      data: {
        currentSupplierId: item.product?.supplierId ?? null,
        overrideSupplierId: item.supplierIdOverride,
        suppliers: eligible,
      },
    };
  }

  /**
   * SİPARİŞ-SEVİYESİ tedarikçi seçimi (kullanıcı kararı 2026-06-29: ürün-ürün
   * DEĞİL, tüm siparişi tek tedarikçiye kaydırma). Bir sipariş = TEK tedarikçi.
   * Yalnızca TÜM kalemleri (matchGroup/nameKey kapsamında, aktif+stoklu) karşılayan
   * tedarikçiler döner — toplam maliyetle, en ucuz önce. Bir kalemi stoklayamayan
   * tedarikçi listede ASLA çıkmaz (sipariş bölünemez).
   */
  async getOrderEligibleSuppliers(tenantId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId },
      select: {
        id: true,
        items: {
          select: {
            id: true,
            qty: true,
            productName: true,
            supplierIdOverride: true,
            houseStockReservedQty: true,
            houseStockDispatchedAt: true,
            product: {
              select: {
                supplierId: true,
                costPrice: true,
                nameKey: true,
                matchGroupId: true,
                matchGroup: { select: { status: true } },
              },
            },
          },
        },
      },
    });
    if (!order) throw new NotFoundException('order not found');

    const items = order.items.filter(
      (it) =>
        it.qty > 0 &&
        (it.houseStockReservedQty ?? 0) === 0 &&
        !it.houseStockDispatchedAt &&
        it.product,
    );
    if (items.length === 0) {
      return { success: true, data: { currentSupplierId: null, suppliers: [] } };
    }

    // Kalem başına aday tedarikçi → en düşük maliyet (display dahil).
    const perItem: Array<{
      productName: string;
      qty: number;
      cand: Map<string, number>;
    }> = [];
    for (const it of items) {
      const cand = new Map<string, number>();
      const dsup = it.product!.supplierId;
      cand.set(
        dsup,
        it.product!.costPrice != null ? Number(it.product!.costPrice) : Infinity,
      );
      const scope = await this.resolveItemSupplierScope(
        it.product ?? null,
        it.productName,
      );
      if (scope) {
        const rows = await this.prisma.product.findMany({
          where: { tenantId, ...scope, active: true, stock: { gt: 0 } },
          select: { supplierId: true, costPrice: true },
        });
        for (const r of rows) {
          const cost = r.costPrice != null ? Number(r.costPrice) : Infinity;
          const ex = cand.get(r.supplierId);
          if (ex === undefined || cost < ex) cand.set(r.supplierId, cost);
        }
      }
      perItem.push({ productName: it.productName ?? '—', qty: it.qty, cand });
    }

    // TÜM kalemlerde adayı olan tedarikçiler (kesişim) + toplam maliyet.
    let fulfilling: Set<string> | null = null;
    for (const p of perItem) {
      const keys = new Set(p.cand.keys());
      if (fulfilling === null) fulfilling = keys;
      else {
        const next = new Set<string>();
        for (const s of fulfilling) if (keys.has(s)) next.add(s);
        fulfilling = next;
      }
    }
    const fulfillSet = fulfilling ?? new Set<string>();
    const totals: Array<{
      supplierId: string;
      totalCost: number;
      items: Array<{ productName: string; qty: number; cost: number }>;
    }> = [];
    for (const s of fulfillSet) {
      let t = 0;
      let ok = true;
      const itemsBreak: Array<{
        productName: string;
        qty: number;
        cost: number;
      }> = [];
      for (const p of perItem) {
        const cost = p.cand.get(s);
        if (cost === undefined || !Number.isFinite(cost)) {
          ok = false;
          break;
        }
        t += cost * p.qty;
        itemsBreak.push({
          productName: p.productName,
          qty: p.qty,
          cost: Math.round(cost * 100) / 100,
        });
      }
      if (ok) {
        totals.push({
          supplierId: s,
          totalCost: Math.round(t * 100) / 100,
          items: itemsBreak,
        });
      }
    }
    totals.sort((a, b) => a.totalCost - b.totalCost);

    const supRows = await this.prisma.supplier.findMany({
      where: { id: { in: totals.map((t) => t.supplierId) } },
      select: { id: true, name: true },
    });
    const nameById = new Map(supRows.map((s) => [s.id, s.name]));

    // Mevcut etkin tedarikçi (tüm kalemler aynıysa).
    const effSet = new Set(
      items.map((it) => it.supplierIdOverride || it.product!.supplierId),
    );
    const currentSupplierId = effSet.size === 1 ? [...effSet][0] : null;

    return {
      success: true,
      data: {
        currentSupplierId,
        suppliers: totals.map((t) => ({
          id: t.supplierId,
          name: nameById.get(t.supplierId) ?? '?',
          totalCost: t.totalCost,
          items: t.items,
        })),
      },
    };
  }

  /**
   * Tüm siparişi TEK tedarikçiye kaydırır (her kalem o tedarikçiden alınır).
   * supplierId=null → tüm override'ları temizler (her kalem kendi canonical'ına).
   * Seçilen tedarikçi TÜM kalemleri stoklayamıyorsa REDDEDER (sipariş bölünemez).
   * NOT: setItemSupplierOverride ile aynı override katmanını (4 alan) yazar; cari
   * bakiye LEDGER'ına DOKUNMAZ (paid→preparing düşümüyle aynı semantik — manuel).
   */
  async setOrderSupplier(
    tenantId: string,
    orderId: string,
    supplierId: string | null,
  ) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId },
      select: {
        id: true,
        items: {
          select: {
            id: true,
            qty: true,
            productName: true,
            supplierIdOverride: true,
            houseStockReservedQty: true,
            houseStockDispatchedAt: true,
            product: {
              select: {
                supplierId: true,
                externalCode: true,
                barcode: true,
                costPrice: true,
                nameKey: true,
                matchGroupId: true,
                matchGroup: { select: { status: true } },
              },
            },
          },
        },
      },
    });
    if (!order) throw new NotFoundException('order not found');

    const items = order.items.filter(
      (it) =>
        it.qty > 0 &&
        (it.houseStockReservedQty ?? 0) === 0 &&
        !it.houseStockDispatchedAt &&
        it.product,
    );

    const updateArgs: Prisma.OrderItemUpdateArgs[] = [];

    if (supplierId === null) {
      // Tüm override'ları temizle → her kalem kendi canonical'ına (tek display).
      for (const it of items) {
        if (it.supplierIdOverride) {
          updateArgs.push({
            where: { id: it.id },
            data: {
              supplierIdOverride: null,
              supplierSkuOverride: null,
              supplierBarcodeOverride: null,
              supplierSku: it.product!.externalCode ?? null,
              supplierBarcode: it.product!.barcode ?? null,
              costPriceSnapshot: it.product!.costPrice ?? null,
            },
          });
        }
      }
    } else {
      const supplier = await this.prisma.supplier.findFirst({
        where: { id: supplierId, tenantId },
        select: { id: true },
      });
      if (!supplier) {
        throw new BadRequestException('supplier not found in this tenant');
      }
      for (const it of items) {
        const dsup = it.product!.supplierId;
        if (supplierId === dsup) {
          // Display tedarikçisi → override varsa temizle.
          if (it.supplierIdOverride) {
            updateArgs.push({
              where: { id: it.id },
              data: {
                supplierIdOverride: null,
                supplierSkuOverride: null,
                supplierBarcodeOverride: null,
                supplierSku: it.product!.externalCode ?? null,
                supplierBarcode: it.product!.barcode ?? null,
                costPriceSnapshot: it.product!.costPrice ?? null,
              },
            });
          }
          continue;
        }
        const scope = await this.resolveItemSupplierScope(
          it.product ?? null,
          it.productName,
        );
        const sp = scope
          ? await this.prisma.product.findFirst({
              where: { tenantId, supplierId, ...scope, active: true },
              orderBy: [{ stock: 'desc' }, { costPrice: 'asc' }],
              select: { externalCode: true, barcode: true, costPrice: true },
            })
          : null;
        if (!sp) {
          throw new BadRequestException(
            'selected supplier cannot fulfill all items in this order',
          );
        }
        if (it.supplierIdOverride !== supplierId) {
          updateArgs.push({
            where: { id: it.id },
            data: {
              supplierIdOverride: supplierId,
              supplierSkuOverride: sp.externalCode ?? null,
              supplierBarcodeOverride: sp.barcode ?? null,
              costPriceSnapshot: sp.costPrice ?? null,
            },
          });
        }
      }
    }

    if (updateArgs.length > 0) {
      await this.prisma.$transaction(
        updateArgs.map((a) => this.prisma.orderItem.update(a)),
      );
    }
    this.logger.log(
      `order ${orderId} whole-order supplier=${supplierId ?? 'null(clear)'} ` +
        `(${updateArgs.length} item update(s)) tenantId=${tenantId}`,
    );
    return this.findOne(tenantId, orderId);
  }

  async deleteOrder(tenantId: string, id: string): Promise<{ success: true }> {
    const order = await this.prisma.order.findFirst({ where: { id, tenantId } });
    if (!order) throw new NotFoundException(`Order ${id} not found`);

    // Siparişin cari hareketlerinin bakiyeye net etkisi. Siparişi "sanki hiç
    // olmamış" gibi temizliyoruz: net etkiyi geri al (paid sipariş → cari iade;
    // iptal edilmiş sipariş → ödeme + iade zaten birbirini götürür, net=0; kart
    // ödemeli siparişte cari hareketi yok → net=0), sonra ledger satırlarını sil
    // ki cari ekstrede "Sipariş #X" izi kalmasın (CariLedger.order FK'sı SetNull
    // olduğundan aksi halde orphan kayıt kalırdı). Para hesabı debitForOrderTx/
    // refundForOrderTx ile aynı desen: Decimal aritmetiği + müşteri satır kilidi.
    // §2.3 + §3.1 — Cari geri-alma kuralı:
    //  • TERMINAL (cancelled/refunded) sipariş: para zaten iptal/iade anında
    //    settle edildi → bakiyeye DOKUNMA, yalnız kayıtları sil. (Önceki kod
    //    kart-iptalinde iadeyi geri alıp müşteriyi mağdur ediyordu.)
    //  • NON-TERMINAL sipariş: "sanki hiç olmamış" gibi geri al. HER MÜŞTERİ
    //    KENDİ hareketinden geri alınır (farklı customerId olan hareketler
    //    buyer bakiyesine ASLA karışmaz). Kart
    //    siparişinde buyer'ın iadesi ayrı kart-dalında (çekilen − komisyon −
    //    önceki iadeler) ele alınır.
    const isTerminalDelete = TERMINAL_STATES.has(order.status);
    const isCardBuyer = order.paymentType === 'card';
    const ledgerRows = await this.prisma.cariLedger.findMany({
      where: { orderId: id },
      select: { customerId: true, type: true, amount: true },
    });
    const netByCustomer = new Map<string, Prisma.Decimal>();
    if (!isTerminalDelete) {
      for (const e of ledgerRows) {
        // Kart buyer'ın hareketleri (önceki kısmi REFUND vb.) kart-dalında
        // işlenir → burada dışla. Diğer müşterilerin hareketleri dahil.
        if (isCardBuyer && e.customerId === order.customerId) continue;
        const cur = netByCustomer.get(e.customerId) ?? new Prisma.Decimal(0);
        netByCustomer.set(e.customerId, cur.add(new Prisma.Decimal(e.amount)));
      }
    }

    await this.prisma.$transaction(async (tx) => {
      // Her etkilenen müşterinin KENDİ net hareketini geri al (her müşteri
      // ayrı ayrı, doğru bakiyeden).
      for (const [custId, net] of netByCustomer) {
        if (net.isZero()) continue;
        await tx.$queryRaw`SELECT id FROM "Customer" WHERE id = ${custId} FOR UPDATE`;
        const c = await tx.customer.findUnique({
          where: { id: custId },
          select: { cariBalance: true },
        });
        if (!c) continue;
        const newBalance = new Prisma.Decimal(
          new Prisma.Decimal(c.cariBalance).sub(net).toFixed(2),
        );
        await tx.customer.update({
          where: { id: custId },
          data: { cariBalance: newBalance },
        });
      }

      // §2.3 — KART siparişi non-terminal silinince iptal gibi davran: çekilen
      // tutar − komisyon − önceki iadeler buyer cari'sine iade edilir (kartın
      // cari ORDER_PAYMENT izi yoktur; tahsilat PaymentTransaction'dadır).
      if (!isTerminalDelete && order.customerId && isCardBuyer && order.paidAt) {
        const buyerHasOrderPayment = ledgerRows.some(
          (e) => e.customerId === order.customerId && e.type === 'ORDER_PAYMENT',
        );
        if (!buyerHasOrderPayment) {
          const captured = await tx.paymentTransaction.aggregate({
            where: { orderId: id, status: 'success' },
            _sum: { totalAmount: true },
          });
          let cardPaid = new Prisma.Decimal(captured._sum.totalAmount ?? 0);
          if (order.cardCommissionAmount) {
            cardPaid = cardPaid.sub(
              new Prisma.Decimal(order.cardCommissionAmount),
            );
          }
          for (const e of ledgerRows) {
            if (e.customerId === order.customerId && e.type === 'REFUND') {
              cardPaid = cardPaid.sub(new Prisma.Decimal(e.amount));
            }
          }
          if (cardPaid.greaterThan(0)) {
            await this.cariBalance.refundForOrderTx(tx, {
              customerId: order.customerId,
              orderId: id,
              amount: cardPaid,
              humanOrderNo: order.humanOrderNo,
            });
          }
        }
      }

      // Tedarikçi bakiye iadesi: silinen siparişin ORDER_PURCHASE düşümleri
      // SİLMEDEN ÖNCE iade edilmeli — SupplierAccountLedger.order FK'sı
      // SetNull olduğundan, silindikten sonra refundForOrderTx orderId ile
      // kaydı bir daha bulamaz (kalıcı bakiye kaçağı). refundForOrderTx
      // idempotent: iptal edilip iade edilmiş siparişte no-op.
      const purchaseSuppliers = await tx.supplierAccountLedger.findMany({
        where: {
          orderId: id,
          tenantId,
          type: SupplierLedgerType.ORDER_PURCHASE,
        },
        select: { supplierId: true },
        distinct: ['supplierId'],
      });
      for (const { supplierId } of purchaseSuppliers) {
        await this.supplierAccount.refundForOrderTx(tx, {
          supplierId,
          tenantId,
          orderId: id,
          humanOrderNo: order.humanOrderNo,
        });
      }

      // Kalemleri (stok iadesi + house-stock release için) tx içinde, taze oku.
      const items = await tx.orderItem.findMany({
        where: { orderId: id },
        select: {
          productId: true,
          qty: true,
          houseStockReservedQty: true,
          houseStockItemId: true,
          houseStockDispatchedAt: true,
        },
      });

      // (a) ÜRÜN STOK İADESİ: yalnız sipariş cancelled/refunded DEĞİLSE her
      // kalem için Product.stock'a qty geri eklenir. cancelled'da stok zaten
      // cancelOrder/updateOrder iptal dalında geri eklendi → tekrar eklemek
      // stok şişmesi olur (YASAK). refunded'da stok bilinçli geri eklenmez
      // (iade akışı elle yönetir). cancelOrder'daki increment deseninin
      // birebir aynısı.
      if (!TERMINAL_STATES.has(order.status)) {
        for (const item of items) {
          if (!item.productId) continue;
          await tx.product.update({
            where: { id: item.productId },
            data: { stock: { increment: item.qty } },
          });
        }
      }

      // (b) HOUSE-STOCK REZERVASYON SERBEST: rezerve adedi > 0 olan ve HENÜZ
      // depodan gönderilmemiş (houseStockDispatchedAt == null) kalemler için
      // HouseStockItem.reservedQty geri salınır. Dispatch edilmiş kalemde
      // reservedQty zaten confirmDispatchInTx'te düşmüştür — tekrar düşürmek
      // negatife götürür (YASAK). Rezervasyonlar SÜRESİZdir (zaman bazlı cron
      // yok); sipariş silindiğinde reservedQty burada serbest bırakılır. İptal
      // akışı zaten salmış olabilir; bu yüzden mevcut reservedQty ile sınırlı,
      // negatife düşürmeyen güvenli decrement uygulanır.
      for (const item of items) {
        if (item.houseStockReservedQty <= 0) continue;
        if (item.houseStockDispatchedAt !== null) continue;
        if (!item.houseStockItemId) continue;
        const hsItem = await tx.houseStockItem.findUnique({
          where: { id: item.houseStockItemId },
          select: { reservedQty: true },
        });
        if (!hsItem || hsItem.reservedQty <= 0) continue;
        const releaseQty = Math.min(
          item.houseStockReservedQty,
          hsItem.reservedQty,
        );
        if (releaseQty <= 0) continue;
        await tx.houseStockItem.update({
          where: { id: item.houseStockItemId },
          data: { reservedQty: { decrement: releaseQty } },
        });
      }

      await tx.cariLedger.deleteMany({ where: { orderId: id } });
      await tx.orderItem.deleteMany({ where: { orderId: id } });
      await tx.order.delete({ where: { id } });
    });

    this.logger.log(
      `order deleted id=${id} tenantId=${tenantId} status=${order.status} terminal=${isTerminalDelete} cariLedgerRemoved=${ledgerRows.length} customersReversed=${netByCustomer.size}`,
    );
    return { success: true };
  }
}

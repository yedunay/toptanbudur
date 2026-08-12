import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, OrderStatus, ConversationType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CariBalanceService } from '../../cari-balance/cari-balance.service';
import { ReceiptsService } from '../../receipts/receipts.service';
import {
  type ListOrdersQueryDto,
  type OrderSortValue,
  resolveOrderDateRange,
} from './dto/list-orders.query.dto';
import { istanbulMonthLabel } from '../../birfatura/birfatura.utils';
import {
  trDateRange,
  trStartOfMonth,
  trStartOfDay,
  trAddDays,
} from '../../common/utils/tr-time';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const DEFAULT_SORT: OrderSortValue = 'createdAt:desc';
const DASHBOARD_RECENT_LIMIT = 3;
const DASHBOARD_TOP_PRODUCTS_LIMIT = 3;
const DASHBOARD_SPARKLINE_DAYS = 7;

const PRISMA_ORDER_STATUS_VALUES = new Set<OrderStatus>([
  OrderStatus.paid,
  OrderStatus.preparing,
  OrderStatus.shipped,
  OrderStatus.cancelled,
  OrderStatus.refunded,
]);

function toPrismaOrderStatus(value: string | undefined): OrderStatus | null {
  if (!value) return null;
  return PRISMA_ORDER_STATUS_VALUES.has(value as OrderStatus)
    ? (value as OrderStatus)
    : null;
}

interface OrderListRow {
  id: string;
  humanOrderNo: string | null;
  status: string;
  total: Prisma.Decimal;
  subtotal: Prisma.Decimal | null;
  kdvAmount: Prisma.Decimal | null;
  packagingCost: Prisma.Decimal | null;
  packagingUnitFee: Prisma.Decimal | null;
  currency: string;
  marketplace: string | null;
  cargoCompany: string | null;
  cargoBarcode: string | null;
  endCustomerName: string | null;
  trackingNumber: string | null;
  createdAt: Date;
  updatedAt: Date;
  items: {
    id: string;
    productSlug: string;
    productName: string;
    qty: number;
    unitPrice: Prisma.Decimal;
    product: { images: { url: string }[] } | null;
  }[];
}

@Injectable()
export class CustomerOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cariBalance: CariBalanceService,
    private readonly receipts: ReceiptsService,
  ) {}

  async list(customerId: string, query: ListOrdersQueryDto) {
    const page = query.page ?? DEFAULT_PAGE;
    const limit = query.limit ?? DEFAULT_LIMIT;
    const sort = query.sort ?? DEFAULT_SORT;
    const skip = (page - 1) * limit;

    // Bayiler-arası iade (dealer_return) kalemli siparişler "Siparişlerim"
    // listesine dahil edilmez. Sipariş detayı (findOne/detail) erişilebilir kalır.
    const where: Prisma.OrderWhereInput = {
      customerId,
      items: { none: { fulfillmentSource: 'dealer_return' } },
    };
    const mappedStatus = toPrismaOrderStatus(query.status);
    if (mappedStatus) {
      where.status = mappedStatus;
    } else {
      // awaiting_payment iç ara durumdur (kart ödemesi alınmadı) — müşteri
      // sipariş listesinde gösterilmez; ödeme gelince 'paid' olarak görünür.
      where.status = { not: 'awaiting_payment' };
    }
    // Tamamlanmamış kart denemeleri (cancelled & hiç ödenmemiş, paidAt=null)
    // müşteri sipariş listesinde/dökümünde GÖRÜNMEZ. Ödenip iptal edilenler kalır.
    where.AND = [
      ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
      { NOT: { status: 'cancelled', paidAt: null } },
    ];

    const search = query.search?.trim();
    if (search) {
      where.OR = [
        { humanOrderNo: { contains: search, mode: 'insensitive' } },
        { trackingNumber: { contains: search, mode: 'insensitive' } },
        { cargoBarcode: { contains: search, mode: 'insensitive' } },
        { endCustomerName: { contains: search, mode: 'insensitive' } },
        {
          items: {
            some: {
              productName: { contains: search, mode: 'insensitive' },
            },
          },
        },
      ];
    }

    if (query.marketplace) {
      where.marketplace = { contains: query.marketplace, mode: 'insensitive' };
    }
    if (query.cargoCompany) {
      where.cargoCompany = {
        contains: query.cargoCompany,
        mode: 'insensitive',
      };
    }
    const { dateFrom, dateTo } = resolveOrderDateRange(query);
    {
      // TR takvim günü: başlangıç dahil, bitiş günü de DAHİL (yarı-açık üst sınır).
      const range = trDateRange(dateFrom, dateTo);
      if (range) where.createdAt = range;
    }

    const orderBy = buildOrderBy(sort);

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        select: {
          id: true,
          humanOrderNo: true,
          status: true,
          total: true,
          subtotal: true,
          kdvAmount: true,
          packagingCost: true,
          packagingUnitFee: true,
          currency: true,
          marketplace: true,
          cargoCompany: true,
          cargoBarcode: true,
          endCustomerName: true,
          trackingNumber: true,
          createdAt: true,
          updatedAt: true,
          items: {
            take: 4,
            select: {
              id: true,
              productSlug: true,
              productName: true,
              qty: true,
              unitPrice: true,
              product: {
                select: {
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
      this.prisma.order.count({ where }),
    ]);

    // Makbuzu olan siparişlere küçük ikon için — tek sorguda toplu çözülür
    // (N+1 yok). Makbuz yalnızca kart ödemelerinde var olduğundan bu küme
    // doğal olarak kart-dışı siparişleri içermez.
    const receiptOrderIds = await this.receipts.orderIdsWithReceipt(
      rows.map((r) => r.id),
    );

    return {
      success: true,
      data: rows.map((row) =>
        serializeOrderRow(row, receiptOrderIds.has(row.id)),
      ),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  async summary(customerId: string) {
    // Gross sorgular yalnızca customerId ile kapsanır (tenant filtresi yok;
    // Customer modelinde tenantId alanı yok). İade toplamı da aynı eksende —
    // customerIds ile — çekilir ki kapsam birebir eşleşsin.
    const [groups, refundMap] = await Promise.all([
      this.prisma.order.groupBy({
        by: ['status'],
        where: {
          customerId,
          // awaiting_payment: ödemesi alınmamış kart siparişi — hiçbir
          // müşteri metriğine/kırılımına girmez.
          status: { not: 'awaiting_payment' },
          items: { none: { fulfillmentSource: 'dealer_return' } },
        },
        orderBy: { status: 'asc' },
        _count: true,
        _sum: { total: true },
      }),
      this.cariBalance.refundTotalsByCustomer({
        customerIds: [customerId],
      }),
    ]);

    const counts = groups.reduce<Record<string, number>>((acc, g) => {
      acc[g.status] = countOf(g._count);
      return acc;
    }, {});

    // "Toplam Tutar" net harcamayı gösterir: iptal (cancelled) ve iade
    // (refunded) edilen siparişler para geri gittiği için toplama eklenmez.
    // Statü kırılımı (cancelledOrders/refundedOrders) ayrıca gösterilir.
    const grossAmount = groups.reduce<Prisma.Decimal | null>((acc, g) => {
      if (g.status === 'cancelled' || g.status === 'refunded') return acc;
      const sumTotal = g._sum?.total;
      if (!sumTotal) return acc;
      return acc ? acc.plus(sumTotal) : sumTotal;
    }, null);

    // Kısmi iadeler (REFUND ledger) brüt tutardan düşülür — sipariş hâlâ
    // paid/shipped statüsünde kaldığı için yukarıdaki filtre bunu yakalamaz.
    // NET = max(0, brüt − iade).
    const refunded = refundMap.get(customerId) ?? 0;
    const totalAmount = Math.max(
      0,
      (grossAmount ? Number(grossAmount) : 0) - refunded,
    );

    const totalOrders = groups.reduce((acc, g) => acc + countOf(g._count), 0);

    return {
      success: true,
      data: {
        totalOrders,
        // `shipped` artık terminal teslimat statüsü — biz tedarikçiyiz, kargoya
        // teslim sonrası akışla ilgilenmiyoruz. `delivered` enum'dan kaldırıldı.
        shippedOrders: counts['shipped'] ?? 0,
        pendingOrders: (counts['paid'] ?? 0) + (counts['preparing'] ?? 0),
        cancelledOrders: counts['cancelled'] ?? 0,
        refundedOrders: counts['refunded'] ?? 0,
        totalAmount,
      },
    };
  }

  async dashboard(customerId: string) {
    const now = new Date();
    const startOfMonth = trStartOfMonth(now);

    const dayWindows = buildDailyWindows(now, DASHBOARD_SPARKLINE_DAYS);

    const dailyOrderCountQueries = dayWindows.map((w) =>
      this.prisma.order.count({
        where: {
          customerId,
          // awaiting_payment (ödemesi alınmamış kart) hiçbir metriğe girmez.
          status: { not: 'awaiting_payment' },
          createdAt: { gte: w.start, lt: w.end },
          items: { none: { fulfillmentSource: 'dealer_return' } },
        },
      }),
    );

    // Günlük satış grafiği net tutarı gösterir — iptal/iade ve ödemesi
    // alınmamış kart siparişleri (awaiting_payment) hariç.
    const dailySalesQueries = dayWindows.map((w) =>
      this.prisma.order.aggregate({
        where: {
          customerId,
          createdAt: { gte: w.start, lt: w.end },
          status: { notIn: ['cancelled', 'refunded', 'awaiting_payment'] },
          items: { none: { fulfillmentSource: 'dealer_return' } },
        },
        _sum: { total: true },
      }),
    );

    // Kısmi iadeler (REFUND ledger) brüt tutarlardan düşülür — sipariş
    // paid/shipped kaldığı için yukarıdaki status filtresi bunu yakalamaz.
    // İade toplamı siparişin createdAt eksenine göre çekilir; her pencerenin
    // üst sınırı gross aggregate'teki `lt: w.end` ile hizalansın diye 1ms
    // eksiltilir (helper `<=` kullanır, çifte sayımı önler).
    const monthlyRefundPromise = this.cariBalance.refundTotalsByCustomer({
      customerIds: [customerId],
      orderCreatedFrom: startOfMonth,
    });
    const dailyRefundPromises = dayWindows.map((w) =>
      this.cariBalance.refundTotalsByCustomer({
        customerIds: [customerId],
        orderCreatedFrom: w.start,
        orderCreatedTo: new Date(w.end.getTime() - 1),
      }),
    );

    const [
      [
        marketplaceGroups,
        topProductGroups,
        recentUpdateRows,
        monthlySales,
        ...dailyResults
      ],
      monthlyRefundMap,
      dailyRefundMaps,
    ] = await Promise.all([
      this.prisma.$transaction([
      this.prisma.order.groupBy({
        by: ['marketplace'],
        where: {
          customerId,
          status: { not: 'awaiting_payment' },
          marketplace: { not: null },
          items: { none: { fulfillmentSource: 'dealer_return' } },
        },
        orderBy: { marketplace: 'asc' },
        _count: true,
      }),
      this.prisma.orderItem.groupBy({
        by: ['productSlug', 'productName'],
        where: {
          order: {
            customerId,
            status: { not: 'awaiting_payment' },
            items: { none: { fulfillmentSource: 'dealer_return' } },
          },
          fulfillmentSource: { not: 'dealer_return' },
        },
        _sum: { qty: true },
        orderBy: { _sum: { qty: 'desc' } },
        take: DASHBOARD_TOP_PRODUCTS_LIMIT,
      }),
      this.prisma.order.findMany({
        where: {
          customerId,
          status: { not: 'awaiting_payment' },
          items: { none: { fulfillmentSource: 'dealer_return' } },
        },
        orderBy: { updatedAt: 'desc' },
        take: DASHBOARD_RECENT_LIMIT,
        select: {
          id: true,
          humanOrderNo: true,
          status: true,
          updatedAt: true,
        },
      }),
      this.prisma.order.aggregate({
        where: {
          customerId,
          createdAt: { gte: startOfMonth },
          status: { notIn: ['cancelled', 'refunded', 'awaiting_payment'] },
          items: { none: { fulfillmentSource: 'dealer_return' } },
        },
        _sum: { total: true },
      }),
      ...dailyOrderCountQueries,
      ...dailySalesQueries,
      ]),
      monthlyRefundPromise,
      Promise.all(dailyRefundPromises),
    ]);

    const dailyOrderCounts = (dailyResults.slice(
      0,
      DASHBOARD_SPARKLINE_DAYS,
    ) as number[]).map((n) => n ?? 0);

    const dailySalesRaw = dailyResults.slice(DASHBOARD_SPARKLINE_DAYS) as {
      _sum: { total: Prisma.Decimal | null };
    }[];
    const dailySalesAmounts = dailySalesRaw.map((row, idx) => {
      const gross = row._sum.total ? Number(row._sum.total) : 0;
      const refunded = dailyRefundMaps[idx]?.get(customerId) ?? 0;
      return Math.max(0, gross - refunded);
    });

    const totalMarketplaceOrders = marketplaceGroups.reduce(
      (acc, g) => acc + countOf(g._count),
      0,
    );
    const marketplaceDistribution = marketplaceGroups
      .filter((g): g is typeof g & { marketplace: string } =>
        Boolean(g.marketplace),
      )
      .map((g) => {
        const count = countOf(g._count);
        return {
          marketplace: g.marketplace,
          count,
          percentage:
            totalMarketplaceOrders > 0
              ? (count / totalMarketplaceOrders) * 100
              : 0,
        };
      })
      .sort((a, b) => b.count - a.count);

    const topProducts = topProductGroups.map((g, idx) => ({
      rank: idx + 1,
      productSlug: g.productSlug,
      productName: g.productName,
      qty: g._sum?.qty ?? 0,
    }));

    const recentUpdates = recentUpdateRows.map((r) => ({
      id: r.id,
      humanOrderNo: r.humanOrderNo,
      status: r.status,
      updatedAt: r.updatedAt,
    }));

    return {
      success: true,
      data: {
        marketplaceDistribution,
        topProducts,
        recentUpdates,
        monthlySalesAmount: Math.max(
          0,
          (monthlySales._sum.total ? Number(monthlySales._sum.total) : 0) -
            (monthlyRefundMap.get(customerId) ?? 0),
        ),
        dailyOrderCounts,
        dailySalesAmounts,
      },
    };
  }

  /**
   * Müşterinin kendi sipariş geçmişinde aynı kargo barkodunun daha önce
   * kullanılıp kullanılmadığını kontrol eder. UI "Ödemeye Geç" anında
   * sessizce çağırır; eşleşme varsa uyarı popup'ı açar (akış değişmez).
   *
   * Sadece müşterinin KENDİ siparişleri taranır — başka müşterinin verisi
   * sızdırılmaz. cargoBarcode ve trackingNumber birlikte kontrol edilir.
   */
  async checkCargoBarcode(customerId: string, barcode: string) {
    const value = barcode.trim();
    if (value.length < 3) return { matches: [] };

    const rows = await this.prisma.order.findMany({
      where: {
        customerId,
        // awaiting_payment: ödemesi alınmamış kart denemesi (ağ hatası /
        // yarım kalan ödeme) barkodu REZERVE ETMEZ — müşteri aynı barkodla
        // yeniden sipariş geçebilmeli ("bu barkod kullanılmış" hatası
        // çıkmamalı). İptal edilen siparişler de blok değildir.
        status: { notIn: ['awaiting_payment', 'cancelled'] },
        OR: [
          { cargoBarcode: { equals: value, mode: 'insensitive' } },
          { trackingNumber: { equals: value, mode: 'insensitive' } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true,
        humanOrderNo: true,
        status: true,
        marketplace: true,
        cargoCompany: true,
        cargoBarcode: true,
        trackingNumber: true,
        endCustomerName: true,
        createdAt: true,
      },
    });

    return {
      matches: rows.map((r) => ({
        id: r.id,
        humanOrderNo: r.humanOrderNo,
        status: r.status,
        marketplace: r.marketplace,
        cargoCompany: r.cargoCompany,
        cargoBarcode: r.cargoBarcode,
        trackingNumber: r.trackingNumber,
        endCustomerName: r.endCustomerName,
        createdAt: r.createdAt,
      })),
    };
  }

  async detail(customerId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, customerId },
      select: {
        id: true,
        humanOrderNo: true,
        status: true,
        total: true,
        subtotal: true,
        kdvAmount: true,
        kdvRate: true,
        packagingCost: true,
        packagingUnitFee: true,
        currency: true,
        marketplace: true,
        cargoCompany: true,
        cargoBarcode: true,
        endCustomerName: true,
        trackingNumber: true,
        paymentType: true,
        cardCommissionRate: true,
        cardCommissionAmount: true,
        cariApprovalStatus: true,
        customerName: true,
        customerPhone: true,
        addressLine1: true,
        shippingDistrict: true,
        addressCity: true,
        addressPostal: true,
        addressCountry: true,
        billingName: true,
        billingPhone: true,
        billingMobilePhone: true,
        billingAddressLine: true,
        billingDistrict: true,
        billingCity: true,
        billingPostal: true,
        cargoCost: true,
        invoicedAt: true,
        invoiceBatch: {
          select: {
            id: true,
            status: true,
            periodStart: true,
            periodEnd: true,
            invoiceUrl: true,
            invoiceNumber: true,
            invoiceDate: true,
            invoicedAt: true,
          },
        },
        createdAt: true,
        updatedAt: true,
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
            product: {
              select: {
                images: {
                  orderBy: { position: 'asc' },
                  take: 1,
                  select: { url: true },
                },
              },
            },
          },
        },
        // KESKİN KURAL: ham event.description/location TEDARİKÇİ/OTOMASYON metni
        // taşır ("Tedarikçi siparişi açıldı (TY-...)", "Otomatik kargoya verildi
        // (zamanlı)", "barkod: ..."). Bunlar müşteriye ASLA gönderilmez —
        // select'ten çıkarıldı; müşteri çizelgesi status+createdAt'ten türetilir.
        trackingEvents: {
          orderBy: { occurredAt: 'asc' },
          select: {
            id: true,
            status: true,
            occurredAt: true,
          },
        },
      },
    });
    if (!order) throw new NotFoundException('order not found');

    // Tahsilat makbuzu yalnızca kart ödemelerinde üretilir; sahiplik yukarıda
    // (where: { id, customerId }) doğrulandı, tek sorguyla varlık kontrolü.
    const receiptOrderIds = await this.receipts.orderIdsWithReceipt([order.id]);
    const hasReceipt = receiptOrderIds.has(order.id);

    // Cari ödemede sipariş onay/detay ekranında "önceki bakiye − sipariş = yeni
    // bakiye" gösterimi için ledger snapshot'ı. ORDER_PAYMENT kaydı negatif
    // amount (borç) + balanceAfter (yeni bakiye) taşır; önceki = balanceAfter −
    // amount. Kart ödemelerinde kayıt yoktur → alanlar null kalır.
    const cariLedger =
      order.paymentType === 'cari_balance'
        ? await this.prisma.cariLedger.findFirst({
            where: { orderId: order.id, type: 'ORDER_PAYMENT' },
            orderBy: { createdAt: 'asc' },
            select: { amount: true, balanceAfter: true },
          })
        : null;
    const cariNewBalance = cariLedger ? Number(cariLedger.balanceAfter) : null;
    const cariAmount = cariLedger ? Number(cariLedger.amount) : null;
    const cariPreviousBalance =
      cariNewBalance !== null && cariAmount !== null
        ? Math.round((cariNewBalance - cariAmount) * 100) / 100
        : null;
    const cariDeducted = cariAmount !== null ? Math.abs(cariAmount) : null;

    const shippingAddress = {
      fullName: order.customerName,
      phone: order.customerPhone,
      line1: order.addressLine1,
      district: order.shippingDistrict ?? '',
      city: order.addressCity,
      postalCode: order.addressPostal,
      country: order.addressCountry,
    };

    const hasBilling =
      order.billingName || order.billingAddressLine || order.billingCity;
    const billingAddress = hasBilling
      ? {
          fullName: order.billingName ?? order.customerName,
          phone:
            order.billingPhone ??
            order.billingMobilePhone ??
            order.customerPhone,
          line1: order.billingAddressLine ?? order.addressLine1,
          district:
            order.billingDistrict ?? order.shippingDistrict ?? '',
          city: order.billingCity ?? order.addressCity,
          postalCode: order.billingPostal ?? order.addressPostal,
          country: order.addressCountry,
        }
      : null;

    return {
      success: true,
      data: {
        id: order.id,
        number: order.humanOrderNo,
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
        shippingCost:
          order.cargoCost !== null && order.cargoCost !== undefined
            ? Number(order.cargoCost)
            : null,
        currency: order.currency,
        marketplace: order.marketplace,
        cargoCompany: order.cargoCompany,
        cargoBarcode: order.cargoBarcode,
        // #30: FE sipariş detayı `carrier` (firma etiketi) ve `carrierTrackingUrl`
        // (deep-link) bekliyor. carrier = cargoCompany; takip URL'i firma + barkod
        // (cargoBarcode) ya da takip no'dan üretilir. Üretilemezse null (buton
        // gizli kalır), uydurma URL yok.
        carrier: order.cargoCompany,
        carrierTrackingUrl: getCarrierTrackingUrl(
          order.cargoCompany,
          // Buton yalnız trackingNumber varken render olur; takip için kargo
          // firmasının kendi takip no'su esastır, yoksa teslimat barkoduna düş.
          order.trackingNumber ?? order.cargoBarcode,
        ),
        // Müşteri ismi — Bayi'nin kendi son müşterisi (teslimat adıyla karışmaz).
        endCustomerName: order.endCustomerName,
        trackingNumber: order.trackingNumber,
        paymentMethod: order.paymentType,
        paymentStatus: order.cariApprovalStatus,
        // Cari ödeme bakiye snapshot'ı (yalnızca cari_balance ödemelerde dolu).
        cariPreviousBalance,
        cariNewBalance,
        cariDeducted,
        // Kartla ödenmiş siparişlerde tahsilat makbuzu erişilebilir (buton FE'de
        // paymentMethod==='card' && hasReceipt ile gösterilir).
        hasReceipt,
        // Kart komisyonu snapshot'ı — yalnızca kartlı ödemede dolu, cari'de
        // null. Ödenen toplam = total + cardCommissionAmount.
        cardCommissionRate:
          order.cardCommissionRate !== null
            ? Number(order.cardCommissionRate)
            : null,
        cardCommissionAmount:
          order.cardCommissionAmount !== null
            ? Number(order.cardCommissionAmount)
            : null,
        shippingAddress,
        billingAddress,
        items: order.items.map((i) => ({
          id: i.id,
          productId: i.productId,
          productSlug: i.productSlug,
          productName: i.productName,
          imageUrl: i.product?.images?.[0]?.url ?? null,
          unitPrice: Number(i.unitPrice),
          unitPriceOriginal:
            i.unitPriceOriginal !== null
              ? Number(i.unitPriceOriginal)
              : null,
          discountPercent: i.discountPercent,
          qty: i.qty,
        })),
        trackingEvents: order.trackingEvents,
        // Faturalandırma — konsolide aylık toplu fatura batch'i (birfatura.md §10).
        // Bu sipariş bir batch'e bağlıysa, hangi ayın toplu faturasına dahil
        // olduğu + (callback geldiyse) indirilebilir fatura linki döner.
        invoicedAt: order.invoicedAt ? order.invoicedAt.toISOString() : null,
        invoiceBatch: order.invoiceBatch
          ? {
              id: order.invoiceBatch.id,
              status: order.invoiceBatch.status,
              periodStart: order.invoiceBatch.periodStart.toISOString(),
              periodEnd: order.invoiceBatch.periodEnd.toISOString(),
              monthLabel: istanbulMonthLabel(order.invoiceBatch.periodEnd),
              invoiceUrl: order.invoiceBatch.invoiceUrl,
              invoiceNumber: order.invoiceBatch.invoiceNumber,
              invoiceDate: order.invoiceBatch.invoiceDate
                ? order.invoiceBatch.invoiceDate.toISOString()
                : null,
              invoicedAt: order.invoiceBatch.invoicedAt
                ? order.invoiceBatch.invoicedAt.toISOString()
                : null,
            }
          : null,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
      },
    };
  }

  /**
   * Bir siparişin kredi kartı tahsilat makbuzunu müşteriye döner. Sahiplik
   * doğrulanır; makbuz yoksa (kart-dışı ödeme ya da henüz üretilmemiş) 404.
   * PDF lazy üretilir/cache'lenir ve indirilebilir signed URL ile serileşir.
   */
  async getReceiptForCustomer(customerId: string, orderId: string) {
    const receipt = await this.receipts.getForOrderCustomer(orderId, customerId);
    if (!receipt) throw new NotFoundException('receipt not found');
    const { url } = await this.receipts.ensurePdf(receipt.id);
    return { success: true, data: this.receipts.serializeForCustomer(receipt, url) };
  }
}

function countOf(value: unknown): number {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object' && '_all' in value) {
    const inner = (value as { _all?: number })._all;
    return typeof inner === 'number' ? inner : 0;
  }
  return 0;
}

function buildDailyWindows(now: Date, days: number) {
  // Günlük pencereler TR takvim günlerine göre (sunucu UTC olsa bile):
  // her pencere [TR gün başı, ertesi TR gün başı).
  const windows: { start: Date; end: Date }[] = [];
  const todayStart = trStartOfDay(now);
  for (let i = days - 1; i >= 0; i -= 1) {
    const start = trAddDays(todayStart, -i);
    const end = trAddDays(start, 1);
    windows.push({ start, end });
  }
  return windows;
}

function buildOrderBy(sort: OrderSortValue): Prisma.OrderOrderByWithRelationInput {
  const [field, direction] = sort.split(':') as [
    'createdAt' | 'total',
    'asc' | 'desc',
  ];
  return { [field]: direction };
}

// -----------------------------------------------------------------------------
// #30 — Kargo takip URL üretimi (backend karşılığı).
//
// Frontend `apps/frontend/lib/cargo-tracking.ts` mantığının birebir backend
// aynası. Sipariş detayında `carrierTrackingUrl` döndürülmediği için "Kargo
// Takip" butonu hiç render olmuyordu (FE gate: trackingNumber && isSafeUrl(
// carrierTrackingUrl)). Order.cargoCompany (firma) + Order.cargoBarcode (kod)
// normalize edilip ilgili firmanın takip sayfasına deep-link üretilir. Firma
// tanınmıyor / "Diğer" ise ya da kod boşsa null döner — UYDURMA URL üretilmez.
// -----------------------------------------------------------------------------
const CARGO_TRACKING_CARRIERS = [
  'Yurtiçi Kargo',
  'Aras Kargo',
  'Sürat Kargo',
  'MNG Kargo',
  'PTT Kargo',
  'UPS',
  'Hepsijet',
  'Trendyol Express',
  'Diğer',
] as const;

const CARGO_TRACKING_CARRIER_KEYS: Record<string, string> = {
  yurtici: 'Yurtiçi Kargo',
  yurtiçi: 'Yurtiçi Kargo',
  yurticikargo: 'Yurtiçi Kargo',
  yurtiçikargo: 'Yurtiçi Kargo',
  aras: 'Aras Kargo',
  araskargo: 'Aras Kargo',
  surat: 'Sürat Kargo',
  sürat: 'Sürat Kargo',
  suratkargo: 'Sürat Kargo',
  süratkargo: 'Sürat Kargo',
  mng: 'MNG Kargo',
  mngkargo: 'MNG Kargo',
  ptt: 'PTT Kargo',
  pttkargo: 'PTT Kargo',
  ups: 'UPS',
  hepsijet: 'Hepsijet',
  trendyolexpress: 'Trendyol Express',
  'trendyol express': 'Trendyol Express',
};

function normaliseCarrier(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  const exact = (CARGO_TRACKING_CARRIERS as readonly string[]).find(
    (c) => c.toLowerCase() === trimmed.toLowerCase(),
  );
  if (exact) return exact;
  const key = trimmed.toLowerCase().replace(/\s+/g, '');
  return CARGO_TRACKING_CARRIER_KEYS[key] ?? null;
}

function getCarrierTrackingUrl(
  carrier: string | null | undefined,
  code: string | null | undefined,
): string | null {
  if (!code) return null;
  const trimmedCode = code.trim();
  if (!trimmedCode) return null;
  const normalised = normaliseCarrier(carrier);
  if (!normalised || normalised === 'Diğer') return null;
  const encoded = encodeURIComponent(trimmedCode);
  switch (normalised) {
    case 'Yurtiçi Kargo':
      return `https://www.yurticikargo.com/tr/online-servisler/gonderi-sorgula?code=${encoded}`;
    case 'Aras Kargo':
      return `https://kargotakip.araskargo.com.tr/?code=${encoded}`;
    case 'Sürat Kargo':
      return `https://www.suratkargo.com.tr/KargoTakip/?kargotakipno=${encoded}`;
    case 'MNG Kargo':
      return `https://service.mngkargo.com.tr/iShipmentWeb/?ShipmentNumber=${encoded}`;
    case 'PTT Kargo':
      return `https://gonderitakip.ptt.gov.tr/Track/${encoded}`;
    case 'UPS':
      return `https://www.ups.com/track?tracknum=${encoded}`;
    case 'Hepsijet':
      return `https://www.hepsijet.com/gonderi-takibi?code=${encoded}`;
    case 'Trendyol Express':
      return `https://trendyolexpress.com/gonderi-takibi?code=${encoded}`;
    default:
      return null;
  }
}

function serializeOrderRow(row: OrderListRow, hasReceipt: boolean) {
  return {
    id: row.id,
    humanOrderNo: row.humanOrderNo,
    status: row.status,
    hasReceipt,
    total: Number(row.total),
    subtotal: row.subtotal !== null ? Number(row.subtotal) : null,
    kdvAmount: row.kdvAmount !== null ? Number(row.kdvAmount) : null,
    packagingCost:
      row.packagingCost !== null ? Number(row.packagingCost) : null,
    packagingUnitFee:
      row.packagingUnitFee !== null ? Number(row.packagingUnitFee) : null,
    currency: row.currency,
    marketplace: row.marketplace,
    cargoCompany: row.cargoCompany,
    cargoBarcode: row.cargoBarcode,
    endCustomerName: row.endCustomerName,
    trackingNumber: row.trackingNumber,
    items: row.items.map((i) => ({
      id: i.id,
      slug: i.productSlug,
      name: i.productName,
      qty: i.qty,
      unitPrice: Number(i.unitPrice),
      imageUrl: i.product?.images?.[0]?.url ?? null,
    })),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

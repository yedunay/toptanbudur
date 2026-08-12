import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AppSettingsService } from '../app-settings/app-settings.service';
import { ExchangeRateService } from '../common/services/exchange-rate.service';
import {
  ORDER_STATUS_DICTIONARY,
  PAYMENT_METHOD_DICTIONARY,
  mapBirfaturaIdToInternalStatuses,
  mapBirfaturaIdToFirstInternalStatus,
  mapPaymentTypeToBirfaturaId,
  mapPaymentTypeToBirfaturaLabel,
} from './birfatura.constants';
import {
  countryToTurkish,
  decimalToNumber,
  formatTrDate,
  hashStringToInt,
  humanOrderNoToLong,
  parseTrDate,
  sanitizePhone,
  vatAdd,
  vatRemove,
} from './birfatura.utils';
import {
  mapBatchToBirfaturaOrder,
  resolveLineProductCode,
  resolveLineBarcode,
  CONSOLIDATED_SALES_CHANNEL,
  DEFAULT_TC_FALLBACK,
  BIRFATURA_SALES_CHANNEL_ENV,
  BIRFATURA_DEFAULT_TC_ENV,
  type BatchMemberOrder,
} from './consolidation/batch-mapper';
import type { OrdersRequestDto } from './dto/orders-request.dto';
import type { CargoUpdateDto } from './dto/cargo-update.dto';
import type { InvoiceLinkDto } from './dto/invoice-link.dto';

const DEFAULT_VAT = 20;
/** Legacy bireysel `/api/orders/` satış kanalı (konsolide ≠ bu; batch-mapper'a bak). */
const DEFAULT_SALES_CHANNEL = 'toptanbudur.com';
// DEFAULT_TC ve CONSOLIDATED_SALES_CHANNEL artık batch-mapper'dan paylaşılır
// (DEFAULT_TC_FALLBACK / CONSOLIDATED_SALES_CHANNEL) → önizleme ile drift olmaz.

/**
 * Faz 0 — KILL-SWITCH. `birfatura.ordersEnabled` AppSetting `true` olana dek
 * `/api/orders/` daima boş döner. Varsayılan KAPALI (fallback `false`) — satır
 * DB'de yoksa bile güvenli taraf seçilir.
 */
const ORDERS_ENABLED_KEY = 'birfatura.ordersEnabled';

/**
 * Faz 4 — konsolide (toplu) mod anahtarı. `true` (varsayılan) → batch'ler tek
 * tek sipariş yerine konsolide olarak çekilir; `false` → legacy per-order yol.
 * Freeze servisiyle AYNI anahtar (`birfatura.consolidationEnabled`).
 */
const CONSOLIDATION_ENABLED_KEY = 'birfatura.consolidationEnabled';

@Injectable()
export class BirfaturaService {
  private readonly logger = new Logger(BirfaturaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: AppSettingsService,
    private readonly config: ConfigService,
    private readonly exchangeRate: ExchangeRateService,
  ) {}

  // ============================================================
  // Endpoint #1 — orderStatus
  // ============================================================
  statusDictionary(): Array<{ Id: number; Value: string }> {
    return ORDER_STATUS_DICTIONARY.map((s) => ({ Id: s.Id, Value: s.Value }));
  }

  // ============================================================
  // Endpoint #2 — paymentMethods
  // ============================================================
  paymentDictionary(): Array<{ Id: number; Value: string }> {
    return PAYMENT_METHOD_DICTIONARY.map((p) => ({ Id: p.Id, Value: p.Value }));
  }

  // ============================================================
  // Endpoint #3 — orders (KRİTİK)
  // ============================================================
  async fetchOrders(
    dto: OrdersRequestDto,
  ): Promise<{ Orders: Record<string, unknown>[] }> {
    const startedAt = Date.now();

    // ── Faz 0 — KILL-SWITCH ──────────────────────────────────────────────
    // Kapalıyken (varsayılan) BirFatura bağlı olsa, "TEST ET"e bassa, otomatik
    // poll yapsa bile DERHAL boş döner; kazara fatura kesilmez.
    const ordersEnabled = await this.settings.getBoolean(
      ORDERS_ENABLED_KEY,
      false,
    );
    if (!ordersEnabled) {
      void this.audit.log({
        actorType: 'system',
        actorId: 'birfatura',
        action: 'BIRFATURA_ORDERS_FETCH_DISABLED',
        target: null,
        metadata: {
          reason: 'kill-switch off (birfatura.ordersEnabled=false)',
          orderStatusId: dto.orderStatusId,
          startDateTime: dto.startDateTime,
          endDateTime: dto.endDateTime,
        },
      });
      return { Orders: [] };
    }

    // ── Faz 4 — mod seçimi ───────────────────────────────────────────────
    // Konsolide (varsayılan): donmuş InvoiceBatch'ler tek sipariş gibi döner.
    // Legacy: "1 sipariş = 1 fatura" (eski yol, geriye dönük uyumluluk).
    const consolidationEnabled = await this.settings.getBoolean(
      CONSOLIDATION_ENABLED_KEY,
      true,
    );
    return consolidationEnabled
      ? this.fetchConsolidatedOrders(dto, startedAt)
      : this.fetchLegacyOrders(dto, startedAt);
  }

  // ============================================================
  // Endpoint #3 — KONSOLİDE (toplu) yol — Faz 4 (§6 #3)
  // ============================================================
  /**
   * Donmuş (`frozen`, henüz faturalanmamış) `InvoiceBatch`'leri BirFatura'nın
   * beklediği sentetik konsolide sipariş JSON'una çevirir. Granüler statü
   * filtresi UYGULANMAZ (§6 #3.1) — batch'in kendisi zaten "kesilmeye hazır"
   * durumdur; yalnızca `periodEnd` istenen tarih aralığına düşmelidir.
   */
  private async fetchConsolidatedOrders(
    dto: OrdersRequestDto,
    startedAt: number,
  ): Promise<{ Orders: Record<string, unknown>[] }> {
    const start = parseTrDate(dto.startDateTime);
    const end = parseTrDate(dto.endDateTime);

    const batches = await this.prisma.invoiceBatch.findMany({
      where: {
        status: 'frozen',
        invoicedAt: null,
        periodEnd: { gte: start, lte: end },
      },
      include: {
        orders: {
          orderBy: { humanOrderNo: 'asc' },
          select: {
            humanOrderNo: true,
            packagingCost: true,
            cardCommissionAmount: true,
            items: {
              orderBy: { id: 'asc' },
              select: {
                productId: true,
                productSlug: true,
                productName: true,
                unitPrice: true,
                qty: true,
                internalCodeSnapshot: true,
                publicBarcodeSnapshot: true,
                product: {
                  select: { id: true, internalCode: true, publicBarcode: true },
                },
              },
            },
          },
        },
      },
      orderBy: { periodEnd: 'asc' },
    });

    const salesChannel =
      this.config.get<string>(BIRFATURA_SALES_CHANNEL_ENV) ??
      CONSOLIDATED_SALES_CHANNEL;
    const defaultTc =
      this.config.get<string>(BIRFATURA_DEFAULT_TC_ENV) ?? DEFAULT_TC_FALLBACK;

    const mapped = batches.map((batch) =>
      mapBatchToBirfaturaOrder(batch, batch.orders as BatchMemberOrder[], {
        salesChannel,
        defaultTc,
      }),
    );

    void this.audit.log({
      actorType: 'system',
      actorId: 'birfatura',
      action: 'BIRFATURA_ORDERS_FETCH',
      target: null,
      metadata: {
        mode: 'consolidated',
        startDateTime: dto.startDateTime,
        endDateTime: dto.endDateTime,
        returnedCount: mapped.length,
        durationMs: Date.now() - startedAt,
      },
    });

    return { Orders: mapped };
  }

  // ============================================================
  // Endpoint #3 — LEGACY (per-order) yol — geriye dönük uyumluluk
  // ============================================================
  private async fetchLegacyOrders(
    dto: OrdersRequestDto,
    startedAt: number,
  ): Promise<{ Orders: Record<string, unknown>[] }> {
    const internalStatuses = mapBirfaturaIdToInternalStatuses(dto.orderStatusId);
    if (internalStatuses.length === 0) {
      return { Orders: [] };
    }

    const start = parseTrDate(dto.startDateTime);
    const end = parseTrDate(dto.endDateTime);
    const now = new Date();

    const orders = await this.prisma.order.findMany({
      where: {
        status: { in: internalStatuses },
        paidAt: { gte: start, lte: end, not: null },
        invoiceHoldUntil: { lte: now },
        billingHold: false,
        invoicedAt: null,
        cariApprovalStatus: { not: 'pending' },
      },
      include: {
        items: {
          include: {
            product: {
              include: {
                images: { take: 1, orderBy: { position: 'asc' } },
              },
            },
          },
        },
        customer: true,
      },
      orderBy: { paidAt: 'asc' },
    });

    const salesChannel =
      this.config.get<string>(BIRFATURA_SALES_CHANNEL_ENV) ??
      DEFAULT_SALES_CHANNEL;
    const defaultTc =
      this.config.get<string>(BIRFATURA_DEFAULT_TC_ENV) ?? DEFAULT_TC_FALLBACK;

    const exchangeRateForTry =
      orders.some((o) => o.currency !== 'TRY')
        ? await this.exchangeRate.getUsdToTry().catch(() => null)
        : null;

    const mapped = orders.map((o) =>
      this.mapOrderToBirfatura(o, {
        salesChannel,
        defaultTc,
        usdToTryRate: exchangeRateForTry?.rate ?? null,
      }),
    );

    void this.audit.log({
      actorType: 'system',
      actorId: 'birfatura',
      action: 'BIRFATURA_ORDERS_FETCH',
      target: null,
      metadata: {
        mode: 'legacy',
        orderStatusId: dto.orderStatusId,
        startDateTime: dto.startDateTime,
        endDateTime: dto.endDateTime,
        returnedCount: mapped.length,
        durationMs: Date.now() - startedAt,
      },
    });

    return { Orders: mapped };
  }

  private mapOrderToBirfatura(
    order: Prisma.OrderGetPayload<{
      include: {
        items: { include: { product: { include: { images: true } } } };
        customer: true;
      };
    }>,
    ctx: {
      salesChannel: string;
      defaultTc: string;
      usdToTryRate: number | null;
    },
  ): Record<string, unknown> {
    const paid = order.paidAt ?? order.updatedAt;
    const total = new Prisma.Decimal(order.total);
    const subtotal = new Prisma.Decimal(order.subtotal ?? order.total);
    const orderVatRate = order.kdvRate ?? DEFAULT_VAT;

    // Müşteri tipi: kurumsal (vergiNo dolu) ya da bireysel
    const isCorporate = !!(order.billingVergiNo && order.billingVergiNo.trim());
    const billingName = isCorporate
      ? (order.billingCompanyTitle?.trim() ||
          order.billingName?.trim() ||
          order.customer?.name ||
          '')
      : (order.billingName?.trim() ||
          order.customer?.name ||
          order.customerName);

    const ssnTcNo = order.billingTcNo?.trim() || ctx.defaultTc;

    const currencyRate =
      order.currency === 'TRY' ? 1 : (ctx.usdToTryRate ?? 1);

    // Kart komisyonu (varsa): KDV'siz hali ürün matrahlarına ORANSAL gömülür
    // — ayrı kalem YOK; fatura toplamı karttan çekilen tutarla birebir tutar.
    // Legacy yolda satır KDV'si ürünün KENDİ taxRate'i olduğundan (konsolide
    // motorun sabit %20'sinden farklı olabilir) dağıtım da satır oranlarıyla
    // yapılır: brüt komisyon, satırların KDV-DAHİL paylarına bölünür; her
    // payın KDV'siz hali o satırın kendi oranıyla geri eklendiğinde brüt
    // toplam artışı TAM cardCommissionAmount eder (oran karışık olsa bile).
    const itemVats = order.items.map((item) =>
      item.product?.taxRate !== null && item.product?.taxRate !== undefined
        ? Number(item.product.taxRate)
        : orderVatRate,
    );
    const commissionGross = order.cardCommissionAmount
      ? new Prisma.Decimal(order.cardCommissionAmount)
      : new Prisma.Decimal(0);
    const lineGross = order.items.map((item, i) =>
      vatAdd(new Prisma.Decimal(item.unitPrice), itemVats[i]).mul(item.qty),
    );
    const totalGross = lineGross.reduce(
      (a, b) => a.add(b),
      new Prisma.Decimal(0),
    );
    let commissionNetTotal = new Prisma.Decimal(0);
    let assignedGross = new Prisma.Decimal(0);
    const commissionUnits = order.items.map((item, i) => {
      if (
        commissionGross.lessThanOrEqualTo(0) ||
        totalGross.lessThanOrEqualTo(0) ||
        item.qty <= 0
      ) {
        return new Prisma.Decimal(0);
      }
      // Son kaleme kalan — paylar toplamı brüt komisyonu birebir tutsun.
      const shareGross =
        i === order.items.length - 1
          ? commissionGross.sub(assignedGross)
          : commissionGross.mul(lineGross[i]).div(totalGross);
      if (i !== order.items.length - 1) {
        assignedGross = assignedGross.add(shareGross);
      }
      const shareNet = vatRemove(shareGross, itemVats[i]);
      commissionNetTotal = commissionNetTotal.add(shareNet);
      return shareNet.div(item.qty);
    });

    const orderDetails = order.items.map((item, itemIdx) => {
      const itemVat = itemVats[itemIdx];

      const unitPriceExcl = new Prisma.Decimal(item.unitPrice).add(
        commissionUnits[itemIdx],
      );
      const unitPriceIncl = vatAdd(unitPriceExcl, itemVat);

      return {
        ProductId: item.product?.id
          ? hashStringToInt(item.product.id)
          : hashStringToInt(item.id),
        // MÜŞTERİ-güvenli "Stok Kodu": internalCode snapshot/canlı → publicBarcode
        // snapshot/canlı → temiz fallback. Tedarikçi kodu (externalCode) ve ham
        // tedarikçi barkodu (Product.barcode) ile URL slug'ı ASLA basılmaz.
        ProductCode: resolveLineProductCode(item),
        // Barkod alanı da yalnız publicBarcode (snapshot → canlı); ham tedarikçi
        // barkodu müşteri faturasına gitmez.
        Barcode: resolveLineBarcode(item),
        ProductBrand: item.product?.brand ?? null,
        ProductName: item.productName,
        ProductImage: item.product?.images[0]?.url ?? null,
        Variants: [],
        ProductQuantityType: 'Adet',
        ProductQuantity: item.qty,
        VatRate: itemVat,
        ProductUnitPriceTaxExcluding: decimalToNumber(unitPriceExcl),
        ProductUnitPriceTaxIncluding: decimalToNumber(unitPriceIncl),
        DiscountUnitTaxExcluding: 0,
        DiscountUnitTaxIncluding: 0,
      };
    });

    const productsTotalExcluding = order.items.reduce(
      (acc, item, itemIdx) =>
        acc.add(
          new Prisma.Decimal(item.unitPrice)
            .add(commissionUnits[itemIdx])
            .mul(item.qty),
        ),
      new Prisma.Decimal(0),
    );
    const productsTotalIncluding = order.items.reduce((acc, item, itemIdx) => {
      return acc.add(
        vatAdd(
          new Prisma.Decimal(item.unitPrice).add(commissionUnits[itemIdx]),
          itemVats[itemIdx],
        ).mul(item.qty),
      );
    }, new Prisma.Decimal(0));

    const out: Record<string, unknown> = {
      OrderId: humanOrderNoToLong(order.humanOrderNo),
      OrderCode: `AB-${order.humanOrderNo}`,
      OrderDate: formatTrDate(paid),
      CustomerId: order.customerId
        ? hashStringToInt(order.customerId)
        : humanOrderNoToLong(order.humanOrderNo),

      // Billing — KURUMSAL: TaxOffice + TaxNo dolu, BillingName=companyTitle
      //          BİREYSEL: SSNTCNo (TC) dolu, BillingName=isim
      BillingName: billingName,
      BillingAddress: order.billingAddressLine ?? order.addressLine1,
      BillingTown: order.billingDistrict ?? null,
      BillingCity: order.billingCity ?? order.addressCity,
      BillingMobilePhone: sanitizePhone(
        order.billingMobilePhone ?? order.billingPhone ?? order.customerPhone,
      ),
      BillingPhone: sanitizePhone(order.billingPhone ?? order.customerPhone),
      SSNTCNo: ssnTcNo,
      Email: order.billingEmail ?? order.customerEmail,

      // Shipping — sipariş üstü denormalize alanlar
      ShippingName: order.customerName,
      ShippingAddress: order.addressLine1,
      ShippingTown: order.shippingDistrict ?? null,
      ShippingCity: order.addressCity,
      ShippingCountry: countryToTurkish(order.addressCountry),
      ShippingZipCode: order.addressPostal,
      ShippingPhone: sanitizePhone(order.customerPhone),
      ShipCompany: order.cargoCompany ?? null,

      SalesChannelWebSite: ctx.salesChannel,
      PaymentTypeId: mapPaymentTypeToBirfaturaId(order.paymentType),
      PaymentType: mapPaymentTypeToBirfaturaLabel(order.paymentType),
      Currency: order.currency,
      CurrencyRate: currencyRate,

      // Tutarlar — YUVARLAMA YOK, Number() doğrudan.
      // Kart komisyonu satır matrahlarına gömülü olduğundan TotalPaid de
      // komisyonu İÇERMELİ (ödenen = total + komisyon); aksi halde
      // Σ(satırlar) + ShippingCharge ≠ TotalPaid tutarsızlığı doğar.
      TotalPaidTaxIncluding: decimalToNumber(total.add(commissionGross)),
      TotalPaidTaxExcluding: decimalToNumber(subtotal.add(commissionNetTotal)),
      ProductsTotalTaxIncluding: decimalToNumber(productsTotalIncluding),
      ProductsTotalTaxExcluding: decimalToNumber(productsTotalExcluding),
      // Kargo + Paketleme tek kalem olarak ShippingCharge'da bildirilir.
      // Paketleme ücreti KDV-hariç (oran 0); kargo (varsa) order.kdvRate ile
      // KDV'lendirilir. Bu yüzden TaxExcluding ve TaxIncluding'i ayrı ayrı
      // toplayıp gönderiyoruz.
      ShippingChargeTotalTaxExcluding: decimalToNumber(
        (order.cargoCost
          ? new Prisma.Decimal(order.cargoCost)
          : new Prisma.Decimal(0)
        ).add(
          order.packagingCost
            ? new Prisma.Decimal(order.packagingCost)
            : new Prisma.Decimal(0),
        ),
      ),
      ShippingChargeTotalTaxIncluding: decimalToNumber(
        (order.cargoCost
          ? vatAdd(new Prisma.Decimal(order.cargoCost), orderVatRate)
          : new Prisma.Decimal(0)
        ).add(
          order.packagingCost
            ? new Prisma.Decimal(order.packagingCost)
            : new Prisma.Decimal(0),
        ),
      ),
      DiscountTotalTaxExcluding: 0,
      DiscountTotalTaxIncluding: 0,

      OrderDetails: orderDetails,
    };

    // Kurumsal müşteri için TaxOffice/TaxNo doldur
    if (isCorporate) {
      out.TaxOffice = order.billingVergiDairesi ?? null;
      out.TaxNo = order.billingVergiNo ?? null;
    }

    return out;
  }

  // ============================================================
  // Endpoint #4 — orderCargoUpdate
  // ============================================================
  async applyCargoUpdate(dto: CargoUpdateDto): Promise<{ success: boolean }> {
    // Önce konsolide batch çöz: birfaturaOrderId ~9e9 ile humanOrderNo ~6.1e7
    // aralıkları çakışmaz → yanlış eşleşme imkânsız (§6 #4/#5).
    const batch = await this.prisma.invoiceBatch.findUnique({
      where: { birfaturaOrderId: BigInt(dto.orderId) },
      select: { id: true },
    });
    if (batch) {
      // §6 #4 — toplu fatura kargoyla ilerlemez; kargo sipariş seviyesinde
      // yönetilir. BirFatura batch'e kargo yazmaya
      // çalışırsa no-op + audit (üye Order'lara dokunmayız).
      void this.audit.log({
        actorType: 'system',
        actorId: 'birfatura',
        action: 'BIRFATURA_CARGO_UPDATE_NOOP',
        target: batch.id,
        metadata: {
          orderId: dto.orderId,
          reason: 'consolidated batch — cargo managed at order level',
          orderStatusId: dto.orderStatusId,
          cargoTrackingCode: dto.cargoTrackingCode,
          cargoCompany: dto.cargoCompany ?? null,
        },
      });
      return { success: true };
    }

    // Batch yok → legacy per-order yol (humanOrderNo). §6 #4: legacy eşleşmesi korunur.
    return this.applyCargoUpdateLegacy(dto);
  }

  /** Legacy per-order kargo güncelleme (humanOrderNo) — geriye dönük uyumluluk. */
  private async applyCargoUpdateLegacy(
    dto: CargoUpdateDto,
  ): Promise<{ success: boolean }> {
    const order = await this.prisma.order.findFirst({
      where: { humanOrderNo: String(dto.orderId) },
      select: { id: true, humanOrderNo: true, shippedAt: true },
    });
    if (!order) throw new NotFoundException('order not found');

    const newStatus = mapBirfaturaIdToFirstInternalStatus(dto.orderStatusId);

    // shippedAt = konsolide fatura kesim uygunluğunun tek kaynağı (birfatura.md §3.2).
    // Legacy yol da shipped'e geçirebilir (orderStatusId=5); mevcut shippedAt'i
    // ezmeden (yalnızca null ise) doldururuz ki sipariş yanlış döneme kaymasın.
    const shouldSetShippedAt = newStatus === 'shipped' && order.shippedAt === null;

    await this.prisma.order.update({
      where: { id: order.id },
      data: {
        ...(newStatus ? { status: newStatus } : {}),
        ...(shouldSetShippedAt ? { shippedAt: new Date() } : {}),
        cargoBarcode: dto.cargoTrackingCode,
        trackingNumber: dto.cargoTrackingCode,
        ...(dto.cargoCompany ? { cargoCompany: dto.cargoCompany } : {}),
      },
    });

    void this.audit.log({
      actorType: 'system',
      actorId: 'birfatura',
      action: 'BIRFATURA_CARGO_UPDATE',
      target: order.id,
      metadata: {
        mode: 'legacy',
        orderId: dto.orderId,
        humanOrderNo: order.humanOrderNo,
        orderStatusId: dto.orderStatusId,
        cargoTrackingCode: dto.cargoTrackingCode,
        cargoCompany: dto.cargoCompany ?? null,
      },
    });

    return { success: true };
  }

  // ============================================================
  // Endpoint #5 — invoiceLinkUpdate
  // ============================================================
  async applyInvoiceLink(dto: InvoiceLinkDto): Promise<{ success: boolean }> {
    let invoiceDate: Date;
    try {
      invoiceDate = dto.faturaTarihi ? parseTrDate(dto.faturaTarihi) : new Date();
    } catch {
      invoiceDate = new Date();
    }

    // Önce konsolide batch çöz: birfaturaOrderId ~9e9 ile humanOrderNo ~6.1e7
    // aralıkları çakışmaz → yanlış eşleşme imkânsız (§6 #5).
    const batch = await this.prisma.invoiceBatch.findUnique({
      where: { birfaturaOrderId: BigInt(dto.orderId) },
      select: { id: true, invoicedAt: true, status: true },
    });
    if (batch) {
      return this.applyInvoiceLinkToBatch(batch, dto, invoiceDate);
    }

    // Batch yok → legacy per-order yol (humanOrderNo).
    return this.applyInvoiceLinkLegacy(dto, invoiceDate);
  }

  /**
   * §6 #5 — konsolide batch faturalama. Idempotent (webhook tekrarına karşı):
   * batch zaten faturalandıysa no-op + ayrı audit. İlk sefer tek transaction'da
   * batch `invoiced` yapılır ve TÜM üye Order'lara invoice* alanları propagate
   * edilir. E-postayı BirFatura gönderir (§7) — biz göndermeyiz.
   */
  private async applyInvoiceLinkToBatch(
    batch: { id: string; invoicedAt: Date | null; status: string },
    dto: InvoiceLinkDto,
    invoiceDate: Date,
  ): Promise<{ success: boolean }> {
    // İptal-batch guard'ı (birfatura.md §12.9): iptal edilmiş bir batch ASLA
    // faturalanmaz. Üyeleri iptal anında serbest bırakıldığı (`invoiceBatchId=null`)
    // için bir sonraki kesimde yeni batch'e süpürülür; bu sentetik no'ya gelen
    // gecikmiş webhook'u sessizce yutarsak gerçek bir tutarsızlık gizlenir →
    // no-op + ayrı (DUPLICATE değil) audit ile yüksek sesle kaydet.
    if (batch.status === 'cancelled') {
      void this.audit.log({
        actorType: 'system',
        actorId: 'birfatura',
        action: 'BIRFATURA_INVOICE_LINK_ON_CANCELLED',
        target: batch.id,
        metadata: {
          orderId: dto.orderId,
          reason: 'batch cancelled — invoice link ignored',
          faturaUrl: dto.faturaUrl,
          faturaNo: dto.faturaNo ?? null,
        },
      });
      return { success: true };
    }

    if (batch.invoicedAt) {
      void this.audit.log({
        actorType: 'system',
        actorId: 'birfatura',
        action: 'BIRFATURA_INVOICE_LINK_DUPLICATE',
        target: batch.id,
        metadata: {
          orderId: dto.orderId,
          reason: 'batch already invoiced',
          faturaUrl: dto.faturaUrl,
          faturaNo: dto.faturaNo ?? null,
        },
      });
      return { success: true };
    }

    const invoicedAt = new Date();

    // Tek transaction: batch'i faturala (yarış guard'ı: invoicedAt null iken
    // updateMany) + üye Order'lara propagate.
    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.invoiceBatch.updateMany({
        // Yarış guard'ı: yalnız hâlâ faturalanmamış VE iptal edilmemiş batch'i
        // talep et. `status: { not: 'cancelled' }` okuma↔yazma arasında araya giren
        // iptale karşı savunma (read-time guard yukarıda, bu DB-seviyesi yedeği).
        where: { id: batch.id, invoicedAt: null, status: { not: 'cancelled' } },
        data: {
          invoiceUrl: dto.faturaUrl,
          invoiceNumber: dto.faturaNo ?? null,
          invoiceDate,
          invoicedAt,
          status: 'invoiced',
        },
      });
      if (updated.count === 0) {
        // Başka bir istek bizden önce faturaladı ya da batch iptal edildi (yarış) → no-op.
        return { applied: false, memberCount: 0 };
      }
      const members = await tx.order.updateMany({
        where: { invoiceBatchId: batch.id },
        data: {
          invoiceUrl: dto.faturaUrl,
          invoiceNumber: dto.faturaNo ?? null,
          invoiceDate,
          invoicedAt,
        },
      });
      return { applied: true, memberCount: members.count };
    });

    if (!result.applied) {
      void this.audit.log({
        actorType: 'system',
        actorId: 'birfatura',
        action: 'BIRFATURA_INVOICE_LINK_DUPLICATE',
        target: batch.id,
        metadata: {
          orderId: dto.orderId,
          reason: 'batch invoiced concurrently',
          faturaUrl: dto.faturaUrl,
          faturaNo: dto.faturaNo ?? null,
        },
      });
      return { success: true };
    }

    void this.audit.log({
      actorType: 'system',
      actorId: 'birfatura',
      action: 'BIRFATURA_INVOICE_LINK',
      target: batch.id,
      metadata: {
        mode: 'consolidated',
        orderId: dto.orderId,
        memberCount: result.memberCount,
        faturaUrl: dto.faturaUrl,
        faturaNo: dto.faturaNo ?? null,
      },
    });

    return { success: true };
  }

  /** Legacy per-order faturalama (humanOrderNo) — geriye dönük uyumluluk. */
  private async applyInvoiceLinkLegacy(
    dto: InvoiceLinkDto,
    invoiceDate: Date,
  ): Promise<{ success: boolean }> {
    const order = await this.prisma.order.findFirst({
      where: { humanOrderNo: String(dto.orderId) },
      select: { id: true, humanOrderNo: true },
    });
    if (!order) throw new NotFoundException('order not found');

    await this.prisma.order.update({
      where: { id: order.id },
      data: {
        invoiceUrl: dto.faturaUrl,
        invoiceNumber: dto.faturaNo ?? null,
        invoiceDate,
        invoicedAt: new Date(),
      },
    });

    void this.audit.log({
      actorType: 'system',
      actorId: 'birfatura',
      action: 'BIRFATURA_INVOICE_LINK',
      target: order.id,
      metadata: {
        mode: 'legacy',
        orderId: dto.orderId,
        humanOrderNo: order.humanOrderNo,
        faturaUrl: dto.faturaUrl,
        faturaNo: dto.faturaNo ?? null,
      },
    });

    return { success: true };
  }
}

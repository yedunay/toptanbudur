import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { resolveDiscountMode, applyDealerDiscount } from './dealer-price.util';
import { Prisma } from '@prisma/client';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOrderDto } from './dto';
import { OrderNumberService } from './order-number.service';
import { MailService } from '../mail/mail.service';
import { AdminNotifierService } from '../mail/admin-notifier.service';
import { CariBalanceService } from '../cari-balance/cari-balance.service';
import { AppSettingsService } from '../app-settings/app-settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { STORAGE_SERVICE } from '../storage/storage.constants';
import type { IFileStorage } from '../storage/storage.interface';
import { HouseStockService } from '../house-stock/house-stock.service';
import { ConversationsService } from '../conversations/conversations.service';
import { markOrderPaid } from '../admin/orders/mark-order-paid.helper';
import { ReceiptsService } from '../receipts/receipts.service';
import { getOrderEmailPrefs } from '../common/utils/notification-prefs';
import { BasitKargoService } from '../basitkargo/basitkargo.service';

const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * KDV oranı sabit (%20 — TR genel oranı).
 * Subtotal: bayi indirimli birim fiyat * adet.
 * Toplam:   subtotal + kdvAmount.
 */
const DEFAULT_KDV_RATE = 20;

/**
 * 2 ondalık basamaklı yuvarlama (Decimal kalıyor — JS Number hassasiyet kaybı yok).
 */
function decimalRound2(value: Prisma.Decimal): Prisma.Decimal {
  return new Prisma.Decimal(value.toFixed(2));
}

/** "Toptan Budur'dan al" fiyat teklifi — tek satır (müşteri-yüzlü tam fiyat). */
export interface StoreQuoteLine {
  slug: string;
  qty: number;
  /** Ham liste fiyatı (Product.price). */
  unitListPrice: number;
  /** İndirimli birim (KDV + paketleme HARİÇ) — create() `unitPrice` ile aynı. */
  unitDiscounted: number;
  /** MÜŞTERİ TAM birim fiyatı: indirimli × (1+KDV) + paketleme-birim. */
  unitPrice: number;
  /** round2(unitPrice × qty). */
  lineTotal: number;
}

/** "Toptan Budur'dan al" fiyat teklifi — create() ile birebir tutan toplam. */
export interface StoreQuote {
  lines: StoreQuoteLine[];
  subtotal: number;
  kdvRate: number;
  kdvAmount: number;
  packagingUnitFee: number;
  packagingCost: number;
  /** Cariden düşecek GERÇEK toplam (create() ile birebir; dropship, cargoCost=0). */
  total: number;
  currency: string;
  /**
   * İstenen TÜM ürünler sorunsuz fiyatlandı mı? false ise en az bir ürünü create()
   * REDDEDER (bulunamadı / fiyat≤0 / admin-indirim maliyet-yok) → `total` GÜVENİLMEZ,
   * kesin toplam olarak gösterilmemeli (buy() zaten net hata verir).
   */
  complete: boolean;
}

/**
 * HMAC kid-based key rotation for order receipt tokens.
 *
 * Configuration (env, in priority order):
 *   1. ORDER_TOKEN_KEYS — comma-separated `kid:secret` pairs
 *      (e.g. `v1:abcd...,v0:9876...`)
 *      ORDER_TOKEN_ACTIVE_KID selects which kid is used for *signing*
 *      new tokens. All listed kids remain valid for *verification* until
 *      retired. Each secret must be >= 32 chars.
 *   2. ORDER_TOKEN_SECRET (legacy) — single secret. Treated internally
 *      as `[{ kid: 'v1', secret, active: true }]` for zero-downtime
 *      migration. Tokens minted by the legacy code path (no kid prefix)
 *      are still accepted by trying the lone secret.
 *
 * Token format (new):  `<kid>.<orderId-hex-sig>`
 * Token format (legacy, accepted on read-only path):  `<orderId-hex-sig>`
 */
interface OrderTokenKey {
  readonly kid: string;
  readonly secret: string;
  readonly active: boolean;
}

const KID_RE = /^[A-Za-z0-9_-]{1,16}$/;

interface OrderTokenKeyset {
  readonly keys: ReadonlyMap<string, OrderTokenKey>;
  readonly activeKid: string;
  /** Legacy single-secret bag used for unprefixed tokens (back-compat). */
  readonly legacySecret: string | null;
}

let cachedKeyset: OrderTokenKeyset | null = null;
let cachedKeysetSource: string | null = null;

function parseOrderTokenKeyset(): OrderTokenKeyset {
  const sourceFingerprint = JSON.stringify({
    keys: process.env.ORDER_TOKEN_KEYS ?? '',
    active: process.env.ORDER_TOKEN_ACTIVE_KID ?? '',
    legacy: process.env.ORDER_TOKEN_SECRET ?? '',
  });
  if (cachedKeyset && cachedKeysetSource === sourceFingerprint) {
    return cachedKeyset;
  }

  const rawKeys = (process.env.ORDER_TOKEN_KEYS ?? '').trim();
  const legacy = process.env.ORDER_TOKEN_SECRET ?? '';

  const map = new Map<string, OrderTokenKey>();
  let activeKid: string | null = null;
  let legacySecret: string | null = null;

  if (rawKeys.length > 0) {
    const declaredActive = (process.env.ORDER_TOKEN_ACTIVE_KID ?? '').trim();
    const entries = rawKeys
      .split(',')
      .map((e) => e.trim())
      .filter((e) => e.length > 0);
    for (const entry of entries) {
      const idx = entry.indexOf(':');
      if (idx <= 0) {
        throw new InternalServerErrorException(
          'ORDER_TOKEN_KEYS malformed (expected `kid:secret`)',
        );
      }
      const kid = entry.slice(0, idx).trim();
      const secret = entry.slice(idx + 1).trim();
      if (!KID_RE.test(kid)) {
        throw new InternalServerErrorException(
          `ORDER_TOKEN_KEYS invalid kid: ${kid}`,
        );
      }
      if (secret.length < 32) {
        throw new InternalServerErrorException(
          `ORDER_TOKEN_KEYS secret for kid=${kid} too short (>=32 required)`,
        );
      }
      if (map.has(kid)) {
        throw new InternalServerErrorException(
          `ORDER_TOKEN_KEYS duplicate kid: ${kid}`,
        );
      }
      const isActive = declaredActive
        ? kid === declaredActive
        : activeKid === null;
      map.set(kid, { kid, secret, active: isActive });
      if (isActive && activeKid === null) {
        activeKid = kid;
      }
    }
    if (declaredActive && !map.has(declaredActive)) {
      throw new InternalServerErrorException(
        `ORDER_TOKEN_ACTIVE_KID=${declaredActive} not found in ORDER_TOKEN_KEYS`,
      );
    }
    if (!activeKid) {
      throw new InternalServerErrorException(
        'ORDER_TOKEN_KEYS has no active kid',
      );
    }
    // If the legacy secret is *also* set and is not already in the keyset,
    // accept it as a back-compat verifier so unprefixed legacy tokens still work.
    if (legacy.length >= 32) {
      const knownSecrets = new Set(
        Array.from(map.values()).map((k) => k.secret),
      );
      if (!knownSecrets.has(legacy)) {
        legacySecret = legacy;
      } else {
        legacySecret = legacy;
      }
    }
  } else if (legacy.length > 0) {
    if (legacy.length < 32) {
      throw new InternalServerErrorException(
        'ORDER_TOKEN_SECRET too short (>=32 required)',
      );
    }
    map.set('v1', { kid: 'v1', secret: legacy, active: true });
    activeKid = 'v1';
    legacySecret = legacy;
  } else {
    throw new InternalServerErrorException(
      'ORDER_TOKEN_KEYS or ORDER_TOKEN_SECRET must be configured',
    );
  }

  cachedKeyset = {
    keys: map,
    activeKid: activeKid!,
    legacySecret,
  };
  cachedKeysetSource = sourceFingerprint;
  return cachedKeyset;
}

function hmacHex(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

function safeHexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

function signOrderId(orderId: string): string {
  const ks = parseOrderTokenKeyset();
  const active = ks.keys.get(ks.activeKid);
  if (!active) {
    // unreachable — parseOrderTokenKeyset enforces this invariant
    throw new InternalServerErrorException('order token active kid missing');
  }
  const sig = hmacHex(active.secret, orderId);
  return `${active.kid}.${sig}`;
}

function verifyOrderToken(orderId: string, token: string): boolean {
  if (!token) return false;
  let ks: OrderTokenKeyset;
  try {
    ks = parseOrderTokenKeyset();
  } catch {
    return false;
  }

  const dot = token.indexOf('.');
  if (dot > 0) {
    const kid = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    if (!KID_RE.test(kid)) return false;
    const key = ks.keys.get(kid);
    if (!key) return false;
    const expected = hmacHex(key.secret, orderId);
    return safeHexEqual(sig, expected);
  }

  // Legacy unprefixed token — only accept if a back-compat secret exists.
  if (!ks.legacySecret) return false;
  const expected = hmacHex(ks.legacySecret, orderId);
  return safeHexEqual(token, expected);
}

/**
 * Eagerly validate keyset configuration. Called on module bootstrap so
 * misconfiguration surfaces at startup, not on the first signing request.
 */
export function validateOrderTokenKeysetOrThrow(): void {
  parseOrderTokenKeyset();
}

@Injectable()
export class OrdersService implements OnModuleInit {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orderNumber: OrderNumberService,
    private readonly mail: MailService,
    private readonly cariBalance: CariBalanceService,
    private readonly adminNotifier: AdminNotifierService,
    private readonly appSettings: AppSettingsService,
    private readonly notifications: NotificationsService,
    private readonly conversations: ConversationsService,
    private readonly houseStock: HouseStockService,
    private readonly receipts: ReceiptsService,
    private readonly basitKargo: BasitKargoService,
    @Inject(STORAGE_SERVICE) private readonly storage: IFileStorage,
  ) {}

  onModuleInit(): void {
    // Fail fast if order-token keyset is misconfigured.
    validateOrderTokenKeysetOrThrow();
    const ks = parseOrderTokenKeyset();
    this.logger.log(
      `Order token keyset loaded: activeKid=${ks.activeKid}, kids=[${Array.from(ks.keys.keys()).join(',')}], legacyAccept=${ks.legacySecret ? 'yes' : 'no'}`,
    );
  }

  /**
   * Checkout PDF ön-kontrolü (salt-okunur). Sepet slug+adetleri verilir; sipariş
   * OLUŞTURULMADAN, `create()`'teki PDF kapısıyla AYNI kararı döner:
   *  - vitrin tedarikçilerinden biri requiresPdf ise → true (mevcut davranış), VEYA
   *  - sipariş daha ucuz bir override tedarikçisine (requiresPdf) konsolide
   *    olacaksa → true (bkz. predictEffectiveRequiresPdf / #61003950).
   *
   * Amaç: sepet, PDF yükleme kutusunu VİTRİN değil GERÇEK alım tedarikçisine göre
   * gösterebilsin (aksi halde müşteri kutuyu hiç görmez, checkout'ta 400'e çarpar).
   * Yalnız boolean döner — tedarikçi adı/maliyeti sızmaz (cross-app gizlilik).
   * Hata → { requiresPdf: false } (fail-open: eski/vitrin-bazlı davranışa düşer).
   */
  async getCheckoutPdfPolicy(input: {
    tenantSlug: string;
    marketplace?: string;
    items: Array<{ slug: string; qty: number }>;
  }): Promise<{ requiresPdf: boolean }> {
    try {
      // self siparişte tedarikçi PDF'i hiç istenmez (create() ile aynı).
      if (input.marketplace?.trim() === 'self') return { requiresPdf: false };

      const tenant = await this.prisma.tenant.findUnique({
        where: { slug: input.tenantSlug },
        select: { id: true },
      });
      if (!tenant) return { requiresPdf: false };

      const qtyBySlug = new Map<string, number>();
      for (const it of input.items) {
        if (!it.slug) continue;
        const q = Number.isFinite(it.qty) ? it.qty : 0;
        qtyBySlug.set(it.slug, (qtyBySlug.get(it.slug) ?? 0) + q);
      }
      const slugs = Array.from(qtyBySlug.keys());
      if (slugs.length === 0) return { requiresPdf: false };

      const products = await this.prisma.product.findMany({
        where: { tenantId: tenant.id, slug: { in: slugs }, active: true },
        select: {
          slug: true,
          name: true,
          costPrice: true,
          nameKey: true,
          matchGroupId: true,
          matchGroup: { select: { status: true } },
          supplier: { select: { id: true, requiresPdf: true } },
        },
      });

      // Vitrin tedarikçisi PDF istiyorsa erken dön (create() ile aynı).
      if (products.some((p) => p.supplier?.requiresPdf)) {
        return { requiresPdf: true };
      }

      return { requiresPdf: false };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'unknown error';
      this.logger.warn(`getCheckoutPdfPolicy failed (fail-open): ${message}`);
      return { requiresPdf: false };
    }
  }

  async create(dto: CreateOrderDto, customerId?: string) {
    // TODO: rate-limit per IP/tenant when @nestjs/throttler is added
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug: dto.tenantSlug },
      select: { id: true },
    });
    if (!tenant) {
      throw new NotFoundException('tenant not found');
    }

    const paymentMethod = dto.paymentMethod ?? 'card';
    if (paymentMethod === 'cari_balance' && !customerId) {
      throw new BadRequestException(
        'cari_balance payment requires authenticated customer',
      );
    }

    // "Kendim İçin" (marketplace='self') siparişi: bayi kendisi için alır.
    //  - Son-müşteri ismi / kargo barkodu / kargo şirketi / tedarikçi PDF'i
    //    SORULMAZ (tek serbest-metin adres yeterli).
    //  - Tedarikçi botları bu siparişi OTOMATİK ALMAZ (scheduler hariç tutar);
    //    admin elle alabilir.
    //  - Sipariş toplamına SABİT +cargoCost (varsayılan 200 TL) eklenir; bu
    //    tutar hem bayinin ödediği toplama hem de maliyete (Excel dökümü) yansır.
    // self-DIŞI siparişlerde bu dalların HİÇBİRİ çalışmaz → mevcut akış birebir
    // korunur.
    const isSelfOrder = dto.marketplace?.trim() === 'self';

    // self-DIŞI siparişlerde adres şehir/posta kodu DTO'da koşullu-opsiyonel
    // hale geldiği için (nested DTO marketplace'i göremez) katı zorunluluğu
    // burada yeniden uygula — self-DIŞI davranışı birebir korunur.
    if (!isSelfOrder) {
      const addr = dto.customer.address;
      if (!addr.city?.trim() || !addr.postalCode?.trim()) {
        throw new BadRequestException(
          'Teslimat adresi için şehir ve posta kodu zorunludur',
        );
      }
    } else {
      // "Kendim İçin": yapılandırılmış adres (Basit Kargo etiketine birebir).
      // il (city) + ilçe (district) + açık adres (line1) zorunlu; alıcı ad/tel
      // customer.name/phone ile gelir (DTO'da zaten zorunlu).
      const addr = dto.customer.address;
      if (!addr.city?.trim() || !addr.district?.trim() || !addr.line1?.trim()) {
        throw new BadRequestException(
          'Kendim İçin siparişlerde il, ilçe ve açık adres zorunludur',
        );
      }
    }

    // Bayi indirimi — yalnızca login'li (customerId) müşterilere uygulanır.
    // Misafir / xml dealer akışlarında discount = 0.
    // globalDiscount: fallback; supplierDiscountMap: tedarikçi bazlı override.
    //
    // Admin İndirimi (customerStatus = ADMIN_DISCOUNT):
    //   Tüm tedarikçi/global iskontoları override eder. Sipariş satır kalemleri
    //   `costPrice` üzerinden hesaplanır (maliyet fiyatı). Paketleme ücreti
    //   normal şekilde uygulanır. costPrice null/0 olan ürünlerde mevcut akışa
    //   düşülmez — invalid product price hatası tetiklenir (audit izi temiz).
    //
    // Tedarikçi-bazlı Admin İndirimi (CustomerSupplierDiscount.adminDiscount):
    //   Yukarıdaki davranışın TEK TEDARİKÇİYE kapsanmış hali. supplierAdminDiscountSet
    //   içindeki tedarikçinin ürünleri maliyet fiyatından satılır; bu tedarikçide
    //   yüzde override'ı yok sayılır (admin kazanır). Diğer tedarikçiler normal akış.
    // Kâr İndirimi (kardan indirim) + legacy off-list iskonto + Admin İndirimi.
    // Öncelik (tedarikçi satırı varsa): Admin/100 → Kâr İndirimi % → legacy
    // off-list % → yok. Satır yoksa global: Admin → Kâr İndirimi → legacy → yok.
    let globalDiscountPercent = 0; // legacy off-list (liste fiyatından)
    let globalProfitDiscountPercent = 0; // Kâr İndirimi (kardan)
    let isAdminDiscount = false;
    const supplierDiscountMap = new Map<string, number>(); // legacy off-list / tedarikçi
    const supplierProfitMap = new Map<string, number>(); // Kâr İndirimi / tedarikçi
    const supplierRowSet = new Set<string>(); // override satırı OLAN tedarikçiler
    const supplierAdminDiscountSet = new Set<string>();
    if (customerId) {
      const customer = await this.prisma.customer.findUnique({
        where: { id: customerId },
        select: {
          discountPercent: true,
          profitDiscountPercent: true,
          customerStatus: true,
          supplierDiscounts: {
            select: {
              supplierId: true,
              discountPercent: true,
              profitDiscountPercent: true,
              adminDiscount: true,
            },
          },
        },
      });
      isAdminDiscount = customer?.customerStatus === 'ADMIN_DISCOUNT';
      globalDiscountPercent = Math.max(0, Math.min(100, customer?.discountPercent ?? 0));
      globalProfitDiscountPercent = Math.max(
        0,
        Math.min(100, customer?.profitDiscountPercent ?? 0),
      );
      for (const sd of customer?.supplierDiscounts ?? []) {
        supplierRowSet.add(sd.supplierId);
        if (sd.adminDiscount) {
          // adminDiscount açık: maliyet dalına gir, yüzde override'larını yok say.
          supplierAdminDiscountSet.add(sd.supplierId);
        }
        supplierDiscountMap.set(sd.supplierId, Math.max(0, Math.min(100, sd.discountPercent)));
        supplierProfitMap.set(
          sd.supplierId,
          Math.max(0, Math.min(100, sd.profitDiscountPercent)),
        );
      }
    }

    // Aggregate qty per slug to prevent duplicate-slug abuse
    const aggregated = new Map<string, number>();
    for (const item of dto.items) {
      const cur = aggregated.get(item.productSlug) ?? 0;
      aggregated.set(item.productSlug, cur + item.qty);
    }
    const slugs = Array.from(aggregated.keys());

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const products = await tx.product.findMany({
          where: {
            tenantId: tenant.id,
            slug: { in: slugs },
            active: true,
          },
          select: {
            id: true,
            slug: true,
            name: true,
            price: true,
            costPrice: true,
            currency: true,
            stock: true,
            // Tedarikçi stok kodu + barkod — sipariş kalemine snapshot'lanır.
            // YALNIZCA admin panelinde gösterilir, müşteriye asla sızdırılmaz.
            externalCode: true,
            barcode: true,
            // MÜŞTERİ-yüzlü stok kodu + public barkod — sipariş kalemine
            // snapshot'lanır. Ürün sonradan hard-delete edilse bile e-faturada
            // gösterilen "Stok Kodu" donar; slug ASLA sızmaz.
            internalCode: true,
            publicBarcode: true,
            // Efektif tedarikçi (daha ucuz override) PDF tahmini için: aynı
            // isim/eşleştirme kapsamında en ucuzu bulmakta kullanılır
            // (predictEffectiveRequiresPdf). Maliyet karşılaştırması costPrice
            // üzerinden yapılır (yukarıda zaten seçili).
            nameKey: true,
            matchGroupId: true,
            matchGroup: { select: { status: true } },
            // Supplier-driven sipariş kuralları (mandatoryCarriers / requiresPdf).
            // supplier ilişkisi opsiyonel — eski tenant'lar için null gelebilir.
            supplier: {
              select: {
                id: true,
                name: true,
                mandatoryCarriers: true,
                requiresPdf: true,
              },
            },
          },
        });

        const bySlug = new Map(products.map((p) => [p.slug, p]));

        const missing = slugs.filter((s) => !bySlug.has(s));
        if (missing.length > 0) {
          throw new HttpException(
            { message: 'product not found', missing },
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        }

        const insufficient: { slug: string; available: number }[] = [];
        for (const [slug, qty] of aggregated.entries()) {
          const p = bySlug.get(slug)!;
          if (p.stock < qty) {
            insufficient.push({ slug, available: p.stock });
          }
        }
        if (insufficient.length > 0) {
          throw new HttpException(
            { message: 'insufficient stock', insufficient },
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        }

        // Currency consistency (use first product's currency as canonical)
        const currency = products[0].currency;
        for (const p of products) {
          if (p.currency !== currency) {
            throw new HttpException(
              { message: 'mixed currencies in cart' },
              HttpStatus.UNPROCESSABLE_ENTITY,
            );
          }
        }

        // Çoklu tedarikçi/paket engeli (defense-in-depth):
        //   Müşteri tek bir kargo barkodu + tek bir PDF + tek bir pazaryeri
        //   girer; siparişler tedarikçi başına ayrı paketlenip kargolanır.
        //   Frontend bu durumu "Sepeti Paketlere Ayır" modalı ile yönetir;
        //   yine de direkt POST denemelerine karşı backend hard-block uygular.
        //   Tedarikçi adı/UUID asla cevaba sızdırılmaz — sadece grup sayısı.
        const distinctSupplierIds = new Set<string>();
        for (const p of products) {
          if (p.supplier?.id) distinctSupplierIds.add(p.supplier.id);
        }
        if (distinctSupplierIds.size > 1) {
          throw new HttpException(
            {
              message:
                'Sepet içeriğinizde birden fazla depomuza ait ürün bulunmaktadır. Lütfen kargo paketinizi parçalayınız ve her siparişinizi ürün ürün kendi kargo barkodlarıyla giriniz.',
              code: 'MULTI_SUPPLIER_CART',
              packageCount: distinctSupplierIds.size,
            },
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        }

        // Supplier-driven sipariş kuralları:
        //  1) Herhangi bir ürünün tedarikçisi `requiresPdf=true` ise → dto.pdfUrl
        //     boş olamaz (400 — istemci eksik veri).
        //  2) Sepetteki tedarikçilerin `mandatoryCarriers` array'leri intersect
        //     edilir; ortak küme boş ise → 422 (CARRIER_CONFLICT).
        //  3) Ortak küme boş değilse dto.cargoCompany bu küme içinde olmalı (422).
        //     Tedarikçilerden hiçbiri kargo zorunluluğu belirtmemişse (her array
        //     boş) bu kontrol atlanır — kargo serbest seçilir.

        // Vitrin (display) tedarikçisi PDF istiyor mu? (mevcut davranış.)
        const displayRequiresPdf = products.some((p) => p.supplier?.requiresPdf);
        const pdfMissing = !dto.pdfUrl || dto.pdfUrl.trim().length === 0;

        const effectiveRequiresPdf = displayRequiresPdf;

        if (!isSelfOrder && effectiveRequiresPdf && pdfMissing) {
          // Müşteri tarafına supplier isimleri sızdırılmaz (cross-app gizlilik
          // kuralı). Sadece kaç tedarikçinin PDF zorunlu kıldığı bildirilir.
          // Efektif (override) kaynaklı zorunlulukta vitrin sayısı 0 olabilir →
          // en az 1 raporla.
          const requiresPdfCount = Math.max(
            products.filter((p) => p.supplier?.requiresPdf).length,
            1,
          );
          throw new BadRequestException({
            message: 'pdf required for this supplier',
            code: 'PDF_REQUIRED',
            requiresPdfCount,
          });
        }

        // Tedarikçi başına benzersiz kargo zorunluluk listeleri (sadece set olanlar).
        const supplierCarrierLists: string[][] = [];
        const seenSupplierIds = new Set<string>();
        for (const p of products) {
          const sup = p.supplier;
          if (!sup || seenSupplierIds.has(sup.id)) continue;
          seenSupplierIds.add(sup.id);
          const list = (sup.mandatoryCarriers ?? [])
            .map((c) => c.trim().toLowerCase())
            .filter((c) => c.length > 0);
          if (list.length > 0) {
            supplierCarrierLists.push(list);
          }
        }

        // Intersection: tüm zorunlu listelerde ortak olan kargolar.
        let allowedCarriers: string[] | null = null;
        if (supplierCarrierLists.length > 0) {
          allowedCarriers = supplierCarrierLists.reduce<string[]>(
            (acc, list, idx) =>
              idx === 0 ? [...list] : acc.filter((c) => list.includes(c)),
            [],
          );
          if (allowedCarriers.length === 0) {
            throw new HttpException(
              {
                message: 'conflicting mandatory carriers in cart',
                code: 'CARRIER_CONFLICT',
                supplierCarriers: supplierCarrierLists,
              },
              HttpStatus.UNPROCESSABLE_ENTITY,
            );
          }
          // self siparişte kargo şirketi yok (tedarikçiye gönderim yok) →
          // zorunlu-kargo eşleşmesi uygulanmaz.
          if (!isSelfOrder) {
            const provided = (dto.cargoCompany ?? '').trim().toLowerCase();
            if (!allowedCarriers.includes(provided)) {
              throw new HttpException(
                {
                  message: 'mandatory carrier mismatch',
                  code: 'CARRIER_MISMATCH',
                  allowed: allowedCarriers,
                  provided,
                },
                HttpStatus.UNPROCESSABLE_ENTITY,
              );
            }
          }
        }

        // Backend computes totals with bayi-discount + KDV breakdown + paketleme.
        //   unitPriceOriginal = liste fiyatı (DB)
        //   unitPriceDiscounted = price * (1 - effectiveDiscountPercent/100)
        //   effectiveDiscountPercent = tedarikçi bazlı override > global fallback
        //   subtotal       = sum(unitPriceDiscounted * qty)
        //   kdvAmount      = subtotal * (kdvRate / 100)
        //   packagingCost  = totalQty * packagingUnitFee  (KDV-hariç)
        //   total          = subtotal + kdvAmount + packagingCost
        //
        // Admin İndirimi (isAdminDiscount === true):
        //   unitPriceDiscounted = costPrice
        //   discountPercent kaydında "100 * (1 - cost/price)" snapshot'lanır
        //   (raporlarda doğru iskonto yüzdesi okunsun diye). costPrice null/<=0
        //   olan ürün ADMIN_DISCOUNT müşterisinde sipariş edilemez — siparişin
        //   maliyetini izleyemeyiz.
        let subtotal = new Prisma.Decimal(0);
        let totalQty = 0;
        const itemsToCreate: Prisma.OrderItemCreateManyOrderInput[] = [];
        for (const [slug, qty] of aggregated.entries()) {
          const p = bySlug.get(slug)!;
          if (new Prisma.Decimal(p.price).lte(0)) {
            throw new HttpException(
              { message: 'invalid product price', slug: p.slug },
              HttpStatus.UNPROCESSABLE_ENTITY,
            );
          }
          const supplierId = p.supplier?.id;
          const original = new Prisma.Decimal(p.price);
          const costDec = p.costPrice ? new Prisma.Decimal(p.costPrice) : null;

          // ── İndirim modu çözümü ────────────────────────────────────────────
          // 'cost'   = maliyet fiyatı (Admin İndirimi / Kâr İndirimi %100)
          // 'profit' = Kâr İndirimi: liste − kâr×(pct/100), maliyetin altına inmez
          // 'offlist'= legacy liste fiyatından indirim (geriye dönük)
          // 'none'   = indirim yok (tam liste fiyatı)
          const supplierAdminDiscount =
            supplierId !== undefined && supplierAdminDiscountSet.has(supplierId);
          const hasRow = supplierId !== undefined && supplierRowSet.has(supplierId);

          // İndirim modu + formül TEK KAYNAKTA (dealer-price.util). Davranış aynen:
          // 'cost' modu + maliyet yoksa applyDealerDiscount null → ADMIN_DISCOUNT_NO_COST.
          const { mode, modePct } = resolveDiscountMode({
            isAdminDiscount,
            supplierAdminDiscount,
            hasRow,
            rowProfit: hasRow ? supplierProfitMap.get(supplierId!) ?? 0 : 0,
            rowOfflist: hasRow ? supplierDiscountMap.get(supplierId!) ?? 0 : 0,
            globalProfitDiscountPercent,
            globalDiscountPercent,
          });
          const applied = applyDealerDiscount(original, costDec, mode, modePct);
          if (applied === null) {
            throw new HttpException(
              { message: 'admin discount requires costPrice', code: 'ADMIN_DISCOUNT_NO_COST', slug: p.slug },
              HttpStatus.UNPROCESSABLE_ENTITY,
            );
          }
          const discounted: Prisma.Decimal = applied;

          // Snapshot iskonto yüzdesi = etkin "liste fiyatından" indirim yüzdesi
          // (100 − satış/liste × 100), 0-100 clamp. Tüm modlarda tutarlı; raporlar
          // (karlılık/cari) bu alanı "uygulanan indirim %" olarak okur.
          const effectiveDiscount = original.gt(0)
            ? Math.max(
                0,
                Math.min(
                  100,
                  Math.round(100 - discounted.mul(100).div(original).toNumber()),
                ),
              )
            : 0;

          const lineTotal = discounted.mul(qty);
          subtotal = subtotal.add(lineTotal);
          totalQty += qty;
          itemsToCreate.push({
            productId: p.id,
            productSlug: p.slug,
            productName: p.name,
            unitPrice: discounted,
            unitPriceOriginal: original,
            discountPercent: effectiveDiscount,
            qty,
            costPriceSnapshot: p.costPrice ?? null,
            // Tedarikçi kod/barkod snapshot'ı — sadece admin panelinde gösterilir.
            supplierSku: p.externalCode ?? null,
            supplierBarcode: p.barcode ?? null,
            // Tedarikçi snapshot'ı — ürün sonradan hard-delete edilse bile
            // karlılık/cari raporu doğru tedarikçiye atfeder (costPriceSnapshot
            // ile aynı koruma). Denormalize; FK kurulmaz.
            supplierIdSnapshot: p.supplier?.id ?? null,
            supplierNameSnapshot: p.supplier?.name ?? null,
            // MÜŞTERİ-yüzlü stok kodu snapshot'ı — ürün hard-delete edilse bile
            // e-faturadaki "Stok Kodu" donmuş TBDR kodunu gösterir, slug sızmaz.
            internalCodeSnapshot: p.internalCode ?? null,
            publicBarcodeSnapshot: p.publicBarcode ?? null,
          });
        }
        subtotal = decimalRound2(subtotal);
        const kdvRate = DEFAULT_KDV_RATE;

        // "Kendim İçin" KARGO BEDELİ — SABİT (pricing.selfCargoFee, default 200),
        // sipariş başına bir kez. self'te NORMAL PAKETLEME ALINMAZ; bunun yerine
        // bu kargo bedeli geçer. Kargo bedeli KDV'YE TABİDİR → KDV matrahına
        // (subtotal + cargoCost) dahil edilir. Bayinin ödediği toplama yansır
        // (örn. ürün subtotal 100 → 100 + KDV(100+200=300×%20=60) + kargo 200 =
        // 360) ve maliyet/kâr dökümünde KDV-hariç 200 olarak görünür
        // (admin-profitability order.cargoCost'u okur). self-DIŞI'nda cargoCost=0.
        const cargoCost = isSelfOrder
          ? decimalRound2(
              await this.appSettings.getDecimal('pricing.selfCargoFee', 200),
            )
          : new Prisma.Decimal(0);

        // KDV matrahı: ürünler + (self ise) kargo bedeli. self-DIŞI'nda
        // cargoCost=0 → KDV yalnız subtotal üzerinden (mevcut davranış birebir).
        const kdvAmount = decimalRound2(
          subtotal.add(cargoCost).mul(new Prisma.Decimal(kdvRate)).div(100),
        );

        // Paketleme ücreti — settings snapshot'ı. self'te ALINMAZ (0); kargo
        // bedeli paketlemenin yerini alır. self-DIŞI: birim×adet, KDV'siz
        // (BirFatura ShippingCharge kalemine yansır). self'te packagingUnitFee
        // de 0 snapshot'lanır: aksi halde kâr/profitability gelire 4,80×adet
        // hayali paketleme geliri ekler (karşılığı maliyet yok → kâr şişer).
        const packagingUnitFee = isSelfOrder
          ? new Prisma.Decimal(0)
          : decimalRound2(
              await this.appSettings.getDecimal('pricing.packagingUnitFee', 4.8),
            );
        const packagingCost = isSelfOrder
          ? new Prisma.Decimal(0)
          : decimalRound2(packagingUnitFee.mul(new Prisma.Decimal(totalQty)));

        const total = decimalRound2(
          subtotal.add(kdvAmount).add(packagingCost).add(cargoCost),
        );

        // Kart komisyonu — SADECE kartlı ödemede, HER ŞEY DAHİL (KDV +
        // paketleme) toplamın üzerine aktif POS'un SİTE oranı (%X) ile
        // eklenir. Cari ödemede komisyon YOKTUR. Oran + tutar siparişe
        // snapshot'lanır; karttan çekilen = total + cardCommissionAmount.
        // İade edilmez; faturada KDV'siz hali ürün matrahına oransal gömülür.
        let cardCommissionRate: Prisma.Decimal | null = null;
        let cardCommissionAmount: Prisma.Decimal | null = null;
        if (paymentMethod === 'card') {
          const activePos = await tx.posProvider.findFirst({
            where: { active: true },
            select: { customerCommissionRate: true },
          });
          // Aktif POS yoksa kart KAPALI: sipariş hiç oluşmaz (awaiting_payment
          // hayaleti, stok kilidi, barkod karmaşası doğmasın). UI zaten kart
          // seçeneğini gri/tıklanamaz gösterir — bu ikinci savunma hattıdır.
          if (!activePos) {
            throw new BadRequestException({
              message:
                'Kart ile ödeme şu anda kullanılamıyor — lütfen cari bakiyenizle ödeyin.',
              code: 'CARD_PAYMENT_UNAVAILABLE',
            });
          }
          if (activePos.customerCommissionRate?.greaterThan(0)) {
            cardCommissionRate = activePos.customerCommissionRate;
            cardCommissionAmount = decimalRound2(
              total.mul(cardCommissionRate).div(100),
            );
          }
        }

        // Decrement stock atomically with guard against race
        for (const [slug, qty] of aggregated.entries()) {
          const p = bySlug.get(slug)!;
          const result = await tx.product.updateMany({
            where: {
              id: p.id,
              tenantId: tenant.id,
              stock: { gte: qty },
            },
            data: { stock: { decrement: qty } },
          });
          if (result.count !== 1) {
            throw new HttpException(
              {
                message: 'insufficient stock',
                insufficient: [{ slug, available: 0 }],
              },
              HttpStatus.UNPROCESSABLE_ENTITY,
            );
          }
        }

        const humanOrderNo = await this.orderNumber.generateHumanOrderNo(tx);
        // Kartlı ödeme: sipariş 'awaiting_payment' doğar; PayTR Bildirim URL
        // callback'i (paytr.service) ödemeyi onaylayınca confirmCardPayment
        // ile 'paid'e geçer. Cari ödeme aynı transaction'da tahsil edildiği
        // için doğrudan 'paid' doğar.
        const isCardPayment = paymentMethod === 'card';
        const order = await tx.order.create({
          data: {
            tenantId: tenant.id,
            customerId: customerId ?? null,
            status: isCardPayment ? 'awaiting_payment' : 'paid',
            paidAt: isCardPayment ? null : new Date(),
            total,
            subtotal,
            kdvAmount,
            kdvRate,
            packagingCost,
            packagingUnitFee,
            // self'te +200; self-DIŞI'nda null (mevcut davranış — alan boş kalır).
            cargoCost: isSelfOrder ? cargoCost : null,
            currency,
            humanOrderNo,
            paymentType:
              paymentMethod === 'cari_balance' ? 'cari_balance' : 'card',
            cardCommissionRate,
            cardCommissionAmount,
            cariApprovalStatus:
              paymentMethod === 'cari_balance' ? 'approved' : null,
            customerName: dto.customer.name,
            customerEmail: dto.customer.email,
            customerPhone: dto.customer.phone,
            // self: yapılandırılmış adres — line1=mahalle+açık adres, city=il,
            // district=ilçe (Basit Kargo client.city/town). addressPostal Basit
            // Kargo'da gerekmez → NOT NULL için '-' placeholder. self-DIŞI: mevcut
            // katı alanlar aynen yazılır.
            addressLine1: dto.customer.address.line1,
            addressCity: dto.customer.address.city?.trim() || (isSelfOrder ? '-' : ''),
            addressPostal:
              dto.customer.address.postalCode?.trim() || (isSelfOrder ? '-' : ''),
            addressCountry: dto.customer.address.country ?? 'TR',
            // self: ilçe → Basit Kargo client.town + adres snapshot. self-DIŞI'nda
            // district gelmez (null); mevcut davranış değişmez.
            shippingDistrict: dto.customer.address.district?.trim() || null,
            // self'te kargo/barkod/son-müşteri ismi sorulmaz. cargoCompany/
            // cargoBarcode paid-hook'ta Basit Kargo'dan doldurulur → şimdilik null.
            cargoCompany: isSelfOrder ? null : (dto.cargoCompany ?? '').trim(),
            cargoBarcode: isSelfOrder ? null : (dto.cargoBarcode ?? '').trim(),
            // self: Basit Kargo etiketi paid-hook'ta üretilecek → PENDING (retry
            // cron bunu toplar). self-DIŞI'nda null.
            basitKargoStatus: isSelfOrder ? 'PENDING' : null,
            endCustomerName: isSelfOrder ? null : (dto.endCustomerName ?? '').trim(),
            marketplace: dto.marketplace.trim(),
            pdfUrl: dto.pdfUrl?.trim() || null,
            pdfKey: dto.pdfKey?.trim() || null,
            notes: dto.orderNote?.trim() || null,
            items: { createMany: { data: itemsToCreate } },
          },
          select: {
            id: true,
            total: true,
            subtotal: true,
            kdvAmount: true,
            kdvRate: true,
            packagingCost: true,
            packagingUnitFee: true,
            currency: true,
            status: true,
            humanOrderNo: true,
          },
        });

        // Cari bakiyeden ödeme: aynı transaction içinde bakiye düşümü
        // (FOR UPDATE müşteri kilidi + ledger satırı). Yetersiz bakiye
        // burada BadRequestException atar ve TX rollback olur — stok geri alınır.
        let cariBalanceBefore: number | null = null;
        let cariBalanceAfter: number | null = null;
        if (paymentMethod === 'cari_balance' && customerId) {
          const beforeRow = await tx.customer.findUnique({
            where: { id: customerId },
            select: { cariBalance: true },
          });
          cariBalanceBefore = beforeRow ? Number(beforeRow.cariBalance) : null;
          await this.cariBalance.debitForOrderTx(tx, {
            customerId,
            orderId: order.id,
            amount: total,
            humanOrderNo: order.humanOrderNo,
          });
          const afterRow = await tx.customer.findUnique({
            where: { id: customerId },
            select: { cariBalance: true },
          });
          cariBalanceAfter = afterRow ? Number(afterRow.cariBalance) : null;
        }

        return {
          orderId: order.id,
          humanOrderNo: order.humanOrderNo,
          token: signOrderId(order.id),
          total: Number(order.total),
          subtotal: Number(order.subtotal ?? subtotal),
          kdvAmount: Number(order.kdvAmount ?? kdvAmount),
          kdvRate: order.kdvRate ?? kdvRate,
          packagingCost: Number(order.packagingCost ?? packagingCost),
          packagingUnitFee: Number(order.packagingUnitFee ?? packagingUnitFee),
          // Sipariş başlığı için etkin global indirim: Kâr İndirimi varsa onu,
          // yoksa legacy off-list oranını göster (kalem-bazı snapshot ayrı tutulur).
          discountPercent:
            globalProfitDiscountPercent > 0
              ? globalProfitDiscountPercent
              : globalDiscountPercent,
          currency: order.currency,
          status: order.status,
          cardCommissionAmount: cardCommissionAmount
            ? Number(cardCommissionAmount)
            : null,
          chargedTotal: Number(
            cardCommissionAmount ? total.add(cardCommissionAmount) : total,
          ),
          cariBalanceBefore,
          cariBalanceAfter,
          _emailItems: itemsToCreate.map((i) => ({
            name: i.productName,
            qty: i.qty,
            unitPrice: Number(i.unitPrice),
          })),
        };
      });

      // Kartlı ödemede yan etkiler (depo rezervi, auto-route, onay maili)
      // ÖDEME ONAYINA kadar ertelenir — confirmCardPayment tetikler. Aksi
      // halde ödenmemiş sipariş tedarikçiye yönlenir / müşteriye onay gider.
      if (paymentMethod === 'card') {
        const { _emailItems, ...response } = result;
        return response;
      }

      // "Kendim İçin" siparişi (TAM OTOMASYON): Basit Kargo etiketi (firma+barkod)
      // paid-hook'ta üretilir; BAŞARILIYSA depo rezervi + tedarikçi oto-alım aynı
      // makineyle tetiklenir. Barkod üretilemezse route EDİLMEZ (barkodsuz dispatch
      // olmaz) — retry cron toplar. Fire-and-forget: ödeme akışını asla bozmaz.
      // self-DIŞI'nda mevcut akış birebir korunur.
      if (isSelfOrder) {
        void this.basitKargo.fulfillSelfOrder(result.orderId, tenant.id);
      } else {
        // Depo (Faz 1.7) — Owner stoğu varsa OrderItem'ları rezerve
        // eder. Reservation hatası asla siparişi bozmaz.
        void this.houseStock
          .reserveForOrder(result.orderId, tenant.id)
          .catch((e) =>
            this.logger.warn(
              `house-stock reserveForOrder failed for order=${result.orderId}: ${(e as Error).message}`,
            ),
          );
      }

      // Send confirmation email (fire-and-forget; mail failures must not break order flow)
      // OPSİYONEL mail: müşteri "Sipariş onayı" tercihini kapattıysa gönderme.
      // customerId yoksa (misafir/elle sipariş) tercih kaydı yok → daima gönder.
      const confirmPref = await getOrderEmailPrefs(this.prisma, customerId);
      if (dto.customer.email && confirmPref.confirm) {
        void this.mail
          .sendOrderConfirmation({
            to: dto.customer.email,
            customerName: dto.customer.name,
            humanOrderNo: result.humanOrderNo,
            total: result.total,
            subtotal: result.subtotal,
            kdvAmount: result.kdvAmount,
            packagingCost: result.packagingCost,
            currency: result.currency,
            items: result._emailItems,
            paymentType: paymentMethod === 'cari_balance' ? 'cari_balance' : 'card',
            marketplace: dto.marketplace?.trim() || null,
            cargoCompany: dto.cargoCompany?.trim() || null,
            cargoBarcode: dto.cargoBarcode?.trim() || null,
            cariBalanceBefore: result.cariBalanceBefore,
            cariBalanceAfter: result.cariBalanceAfter,
          })
          .catch((e) => this.logger.error('order confirmation mail failed', e as Error));
      }

      // Admin "yeni sipariş alındı" maili — KASITLI olarak gönderilmiyor.
      // Spam'i azaltmak için kullanıcı isteğiyle kaldırıldı: admin sipariş
      // listesinden zaten görüyor; kritik durumlar (iade, destek, cari
      // yükleme talebi vb.) kendi mail/bildirim yollarıyla devam ediyor.
      // sendAdminNewOrder() helper'ı silinmedi — başka tetikleyici (örn.
      // pazaryeri entegrasyonu) için ileride kullanılabilir.

      const { _emailItems, ...response } = result;
      return response;
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.logger.error('order create failed', err as Error);
      throw new InternalServerErrorException('Internal error');
    }
  }

  /**
   * SALT-OKUNUR fiyat teklifi — "Toptan Budur'dan al" kartı/önizlemesi için
   * müşterinin GERÇEK ödeyeceği tutarı hesaplar. create()'in fiyatlandırma
   * mantığının (indirim modu → KDV → paketleme) BİREBİR AYNISIDIR ama HİÇBİR ŞEY
   * YAZMAZ (stok/bakiye/DB'ye dokunmaz, transaction yok).
   *
   * !! SENKRON UYARISI: create() ile AYNI sonucu vermek ZORUNDADIR. create()'in
   * fiyatlandırması değişirse burası da AYNEN güncellenmelidir. Normal alış akışı
   * (create) kullanıcı şartıyla ASLA değiştirilmediğinden mantık bilinçli kopyadır.
   * Yalnız DROPSHIP (self-DIŞI) senaryosu: cargoCost=0, paketleme=birim×adet,
   * KDV=subtotal×%20 — "Toptan Budur'dan al" daima dropship'tir.
   */
  async quoteStoreItems(
    customerId: string | undefined,
    items: Array<{ slug: string; qty: number }>,
  ): Promise<StoreQuote> {
    const empty: StoreQuote = {
      lines: [],
      subtotal: 0,
      kdvRate: DEFAULT_KDV_RATE,
      kdvAmount: 0,
      packagingUnitFee: 0,
      packagingCost: 0,
      total: 0,
      currency: 'TRY',
      complete: false,
    };
    // Toptan Budur'dan al daima DEFAULT tenant (dropship) — id'yi burada çöz.
    const tenantSlug = process.env.DEFAULT_TENANT_SLUG ?? 'acme';
    const tenant =
      (await this.prisma.tenant.findFirst({ where: { slug: tenantSlug }, select: { id: true } })) ??
      (await this.prisma.tenant.findFirst({ select: { id: true } }));
    if (!tenant) return empty;
    const tenantId = tenant.id;

    // ── İndirim verisi (create() 351-393 ile birebir) ──────────────────────
    let globalDiscountPercent = 0;
    let globalProfitDiscountPercent = 0;
    let isAdminDiscount = false;
    const supplierDiscountMap = new Map<string, number>();
    const supplierProfitMap = new Map<string, number>();
    const supplierRowSet = new Set<string>();
    const supplierAdminDiscountSet = new Set<string>();
    if (customerId) {
      const customer = await this.prisma.customer.findUnique({
        where: { id: customerId },
        select: {
          discountPercent: true,
          profitDiscountPercent: true,
          customerStatus: true,
          supplierDiscounts: {
            select: {
              supplierId: true,
              discountPercent: true,
              profitDiscountPercent: true,
              adminDiscount: true,
            },
          },
        },
      });
      isAdminDiscount = customer?.customerStatus === 'ADMIN_DISCOUNT';
      globalDiscountPercent = Math.max(0, Math.min(100, customer?.discountPercent ?? 0));
      globalProfitDiscountPercent = Math.max(0, Math.min(100, customer?.profitDiscountPercent ?? 0));
      for (const sd of customer?.supplierDiscounts ?? []) {
        supplierRowSet.add(sd.supplierId);
        if (sd.adminDiscount) supplierAdminDiscountSet.add(sd.supplierId);
        supplierDiscountMap.set(sd.supplierId, Math.max(0, Math.min(100, sd.discountPercent)));
        supplierProfitMap.set(sd.supplierId, Math.max(0, Math.min(100, sd.profitDiscountPercent)));
      }
    }

    // ── Ürünleri yükle (slug başına adet birleştir) ────────────────────────
    const aggregated = new Map<string, number>();
    for (const it of items) {
      if (!it?.slug || !(it.qty > 0)) continue;
      aggregated.set(it.slug, (aggregated.get(it.slug) ?? 0) + Math.floor(it.qty));
    }
    const slugs = [...aggregated.keys()];
    const products = slugs.length
      ? await this.prisma.product.findMany({
          where: { tenantId, slug: { in: slugs }, active: true },
          select: {
            slug: true,
            price: true,
            costPrice: true,
            currency: true,
            supplier: { select: { id: true } },
          },
        })
      : [];
    const bySlug = new Map(products.map((p) => [p.slug, p]));

    const kdvRate = DEFAULT_KDV_RATE;
    const packagingUnitFee = decimalRound2(
      await this.appSettings.getDecimal('pricing.packagingUnitFee', 4.8),
    );

    // ── Per-line indirimli fiyat (create() 636-703 mode mantığı birebir; quote'ta
    //    throw YOK → maliyet yoksa tam listeye düşülür, gösterim yanıltmaz) ────
    let subtotal = new Prisma.Decimal(0);
    let totalQty = 0;
    let currency = 'TRY';
    let complete = aggregated.size > 0; // hiç ürün yoksa "eksik" say (empty gibi)
    const lines: StoreQuoteLine[] = [];

    for (const [slug, qty] of aggregated.entries()) {
      const p = bySlug.get(slug);
      // create() bulunamayan/fiyatsız ürünü REDDEDER → complete=false (kesin toplam güvenilmez).
      if (!p) {
        complete = false;
        continue;
      }
      currency = p.currency ?? currency;
      const original = new Prisma.Decimal(p.price);
      if (original.lte(0)) {
        complete = false;
        continue;
      }
      const costDec = p.costPrice ? new Prisma.Decimal(p.costPrice) : null;
      const supplierId = p.supplier?.id;
      const supplierAdminDiscount =
        supplierId !== undefined && supplierAdminDiscountSet.has(supplierId);
      const hasRow = supplierId !== undefined && supplierRowSet.has(supplierId);

      // TEK KAYNAK (dealer-price.util) — sipariş-create ile birebir aynı fiyat.
      const { mode, modePct } = resolveDiscountMode({
        isAdminDiscount,
        supplierAdminDiscount,
        hasRow,
        rowProfit: hasRow ? supplierProfitMap.get(supplierId!) ?? 0 : 0,
        rowOfflist: hasRow ? supplierDiscountMap.get(supplierId!) ?? 0 : 0,
        globalProfitDiscountPercent,
        globalDiscountPercent,
      });
      const applied = applyDealerDiscount(original, costDec, mode, modePct);
      // Önizleme: 'cost' modu + maliyet yoksa create() reddeder → complete=false,
      // gösterimde en azından tam liste (yanıltıcı değil).
      let discounted: Prisma.Decimal;
      if (applied === null) {
        complete = false;
        discounted = decimalRound2(original);
      } else {
        discounted = applied;
      }

      subtotal = subtotal.add(discounted.mul(qty));
      totalQty += qty;
      // Müşteri TAM birim fiyatı = indirimli × (1 + KDV/100) + paketleme-birim.
      const unitGross = decimalRound2(
        discounted.mul(new Prisma.Decimal(100 + kdvRate).div(100)).add(packagingUnitFee),
      );
      lines.push({
        slug,
        qty,
        unitListPrice: decimalRound2(original).toNumber(),
        unitDiscounted: discounted.toNumber(),
        unitPrice: unitGross.toNumber(),
        lineTotal: decimalRound2(unitGross.mul(qty)).toNumber(),
      });
    }

    // ── Toplamlar (create() 744-782 ile birebir sıra) ──────────────────────
    subtotal = decimalRound2(subtotal);
    const kdvAmount = decimalRound2(subtotal.mul(new Prisma.Decimal(kdvRate)).div(100));
    const packagingCost = decimalRound2(packagingUnitFee.mul(new Prisma.Decimal(totalQty)));
    const total = decimalRound2(subtotal.add(kdvAmount).add(packagingCost));

    return {
      lines,
      subtotal: subtotal.toNumber(),
      kdvRate,
      kdvAmount: kdvAmount.toNumber(),
      packagingUnitFee: packagingUnitFee.toNumber(),
      packagingCost: packagingCost.toNumber(),
      total: total.toNumber(),
      currency,
      complete,
    };
  }

  async listForCustomer(customerId?: string) {
    if (!customerId) return [];
    // Bayiler-arası iade (dealer_return) kalemli siparişler "Siparişlerim"
    // listesinden hariç tutulur. Sipariş detayı (getById) erişilebilir kalmalı.
    // awaiting_payment da hariç: kart ödemesi tamamlanmadan sipariş "girilmiş"
    // sayılmaz; bu iç ara durum müşteriye hiçbir listede gösterilmez.
    const orders = await this.prisma.order.findMany({
      where: {
        customerId,
        status: { not: 'awaiting_payment' },
        items: { none: { fulfillmentSource: 'dealer_return' } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
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
        createdAt: true,
        trackingNumber: true,
        endCustomerName: true,
        items: {
          select: {
            id: true,
            productSlug: true,
            productName: true,
            unitPrice: true,
            unitPriceOriginal: true,
            discountPercent: true,
            qty: true,
          },
        },
      },
    });
    return orders.map((o) => ({
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
      createdAt: o.createdAt,
      trackingNumber: o.trackingNumber,
      endCustomerName: o.endCustomerName,
      items: o.items.map((i) => ({
        id: i.id,
        slug: i.productSlug,
        name: i.productName,
        price: Number(i.unitPrice),
        priceOriginal:
          i.unitPriceOriginal !== null ? Number(i.unitPriceOriginal) : null,
        discountPercent: i.discountPercent,
        qty: i.qty,
      })),
    }));
  }

  async getById(orderId: string, token?: string) {
    if (!UUID_V4_RE.test(orderId)) {
      throw new NotFoundException('order not found');
    }
    if (!token || !verifyOrderToken(orderId, token)) {
      throw new ForbiddenException('invalid token');
    }
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
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
        paymentType: true,
        cardCommissionRate: true,
        cardCommissionAmount: true,
        currency: true,
        marketplace: true,
        cargoCompany: true,
        cargoBarcode: true,
        trackingNumber: true,
        customerName: true,
        customerEmail: true,
        customerPhone: true,
        endCustomerName: true,
        addressLine1: true,
        addressCity: true,
        addressPostal: true,
        addressCountry: true,
        createdAt: true,
        items: {
          select: {
            id: true,
            productSlug: true,
            productName: true,
            unitPrice: true,
            unitPriceOriginal: true,
            discountPercent: true,
            qty: true,
          },
        },
      },
    });
    if (!order) {
      throw new NotFoundException('order not found');
    }

    // Cari ödemede sipariş onay ekranında "önceki bakiye − sipariş = yeni bakiye"
    // gösterimi için ledger snapshot'ı çözülür. ORDER_PAYMENT kaydı negatif
    // amount + balanceAfter taşır (debitForOrderTx); önceki = balanceAfter −
    // amount. Kart/misafir siparişlerinde kayıt yoktur → alanlar null kalır.
    const cari = await this.resolveCariSnapshotForOrder(
      order.id,
      order.paymentType,
    );

    return {
      order: {
        id: order.id,
        humanOrderNo: order.humanOrderNo,
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
        // Ödeme türü + kart komisyonu snapshot'ı — komisyon yalnızca kartlı
        // ödemede dolu, cari ödemede null. Ödenen = total + cardCommissionAmount.
        paymentType: order.paymentType,
        cardCommissionRate:
          order.cardCommissionRate !== null
            ? Number(order.cardCommissionRate)
            : null,
        cardCommissionAmount:
          order.cardCommissionAmount !== null
            ? Number(order.cardCommissionAmount)
            : null,
        // Cari ödeme bakiye snapshot'ı (yalnızca cari_balance ödemelerde dolu).
        cariPreviousBalance: cari?.previousBalance ?? null,
        cariNewBalance: cari?.newBalance ?? null,
        cariDeducted: cari?.deducted ?? null,
        currency: order.currency,
        // Sipariş onay ekranında bayinin "doğru girdim mi?" kontrolü için:
        // pazaryeri + kargo firması + kargo barkodu/takip no.
        marketplace: order.marketplace,
        cargoCompany: order.cargoCompany,
        cargoBarcode: order.cargoBarcode,
        trackingNumber: order.trackingNumber,
        endCustomerName: order.endCustomerName,
        customer: {
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
        createdAt: order.createdAt,
      },
      items: order.items.map((i) => ({
        id: i.id,
        slug: i.productSlug,
        name: i.productName,
        price: Number(i.unitPrice),
        priceOriginal:
          i.unitPriceOriginal !== null ? Number(i.unitPriceOriginal) : null,
        discountPercent: i.discountPercent,
        qty: i.qty,
      })),
    };
  }

  /**
   * Bir siparişin cari ödeme bakiye snapshot'ını çözer. Yalnızca paymentType
   * === 'cari_balance' olduğunda CariLedger ORDER_PAYMENT kaydına bakar; kayıt
   * negatif `amount` (borç) + `balanceAfter` (yeni bakiye) taşır. Önceki bakiye
   * = balanceAfter − amount (amount negatif). Kayıt yoksa / kart-misafir
   * siparişlerinde null döner (ekstra sorgu yapılmaz).
   */
  private async resolveCariSnapshotForOrder(
    orderId: string,
    paymentType: string | null,
  ): Promise<{
    previousBalance: number;
    newBalance: number;
    deducted: number;
  } | null> {
    if (paymentType !== 'cari_balance') return null;
    const ledger = await this.prisma.cariLedger.findFirst({
      where: { orderId, type: 'ORDER_PAYMENT' },
      orderBy: { createdAt: 'asc' },
      select: { amount: true, balanceAfter: true },
    });
    if (!ledger) return null;
    const newBalance = Number(ledger.balanceAfter);
    const amount = Number(ledger.amount); // negatif = borç
    return {
      newBalance,
      previousBalance: Math.round((newBalance - amount) * 100) / 100,
      deducted: Math.abs(amount),
    };
  }

  /**
   * Tedarikçi imzalı PDF'i depoya yükler ve imzalı URL döner.
   * - JSON gövde: `{ filename, contentBase64 }`.
   * - Maks 10 MB ham boyut (base64 öncesi).
   * - PDF magic bytes (`%PDF-`) zorunlu — sahte uzantılı dosyaları reddeder.
   * - Anahtar yolu: `order-pdfs/temp-<uuid>/<güvenli-dosya-adı>.pdf`.
   *
   * Storage IFileStorage abstraction üzerinden gider; STORAGE_DRIVER=local
   * (varsayılan) diskte tutar ve `/api/storage/...` imzalı URL üretir,
   * STORAGE_DRIVER=r2 R2 presigned URL döner. Eski "doğrudan MinIO PUT"
   * akışı kaldırıldı (bucket önceden oluşturulmuş olmalıydı, init script
   * yoktu — sürekli 'NoSuchBucket' hatası oluşturuyordu).
   *
   * URL ömrü 7 gün (AWS SigV4 / R2 presigned URL maksimum sınırı). 7 günden
   * uzun istemek `SignatureDoesNotMatch` hatası verir. Admin panelinde
   * süresi dolmuş URL'lerin sorun olmaması için ayrıca kalıcı `key` döner;
   * admin `findOne` çağrısı bu key üzerinden taze 1 saatlik URL imzalar.
   */
  async uploadPdf(input: {
    filename?: string;
    contentBase64?: string;
  }): Promise<{ pdfUrl: string; key: string }> {
    const filename = (input.filename ?? '').trim();
    const contentBase64 = (input.contentBase64 ?? '').trim();
    if (filename.length === 0 || contentBase64.length === 0) {
      throw new BadRequestException({
        message: 'filename ve contentBase64 zorunludur',
        code: 'PDF_UPLOAD_INVALID',
      });
    }

    let buffer: Buffer;
    try {
      buffer = Buffer.from(contentBase64, 'base64');
    } catch {
      throw new BadRequestException({
        message: 'geçersiz base64 içerik',
        code: 'PDF_UPLOAD_INVALID_BASE64',
      });
    }

    const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
    if (buffer.length === 0 || buffer.length > MAX_BYTES) {
      throw new BadRequestException({
        message: `pdf boyutu 1 byte ile ${MAX_BYTES} byte arasında olmalıdır`,
        code: 'PDF_UPLOAD_SIZE',
      });
    }

    // PDF magic bytes — RFC 8118 §8 / ISO 32000-1 §7.5.2: file MUST start
    // with `%PDF-` followed by a version number.
    const head = buffer.subarray(0, 5).toString('ascii');
    if (head !== '%PDF-') {
      throw new BadRequestException({
        message: 'dosya pdf değil (geçersiz imza)',
        code: 'PDF_UPLOAD_NOT_PDF',
      });
    }

    // Sanitize filename: keep only [A-Za-z0-9._-], collapse the rest, force .pdf.
    const baseName =
      filename
        .replace(/[\\/]/g, '_')
        .replace(/[^A-Za-z0-9._-]/g, '_')
        .replace(/_+/g, '_')
        .slice(0, 100) || 'order';
    const safeName = baseName.toLowerCase().endsWith('.pdf')
      ? baseName
      : `${baseName}.pdf`;

    const key = `order-pdfs/temp-${randomUUID()}/${safeName}`;
    try {
      const result = await this.storage.upload(key, buffer, 'application/pdf');
      // 7 gün: AWS SigV4 presigned URL'ler için katı üst sınır (R2 da uyguluyor).
      // Daha uzun istemek S3 SDK'nın imza üretiminde hata vermesine sebep
      // oluyordu (`Signature version 4 presigned URLs must have an expiration
      // date less than one week in the future`). Müşteri sipariş oluştururken
      // bu URL'yi DB'ye yazmaya devam eder; admin "Görüntüle" akışı süresi
      // dolmuş olsa bile `pdfKey` üzerinden taze URL üretir.
      const signedUrl = await this.storage.getSignedUrl(
        result.key,
        7 * 24 * 3600,
      );
      return { pdfUrl: signedUrl, key: result.key };
    } catch (err) {
      this.logger.error(
        `pdf upload failed key=${key}: ${(err as Error).message}`,
        err as Error,
      );
      throw new InternalServerErrorException({
        message: 'pdf yüklenemedi (depolama hatası)',
        code: 'PDF_UPLOAD_STORAGE',
      });
    }
  }

  // ─── Sanal POS (PayTR) entegrasyon yardımcıları ──────────────────────────

  /** Makbuz token'ı üretir — create() yanıtındaki `token` ile aynı imza. */
  signReceiptToken(orderId: string): string {
    return signOrderId(orderId);
  }

  /** Makbuz token'ını doğrular (misafir kart ödemesi yetkilendirmesi). */
  verifyReceiptToken(orderId: string, token: string): boolean {
    return verifyOrderToken(orderId, token);
  }

  /**
   * Kartlı ödeme onayı — YALNIZCA PayTR Bildirim URL callback'i 'success'
   * döndüğünde çağrılır (paytr.service.handleCallback).
   *
   * Atomik geçiş: awaiting_payment → paid (+ paidAt, statusChangedAt,
   * posProviderKey, invoiceHoldUntil + billing snapshot via markOrderPaid).
   * Ardından sipariş-doğumunda ertelenen yan etkiler çalışır: depo
   * rezervi → auto-route → müşteri onay maili.
   *
   * İdempotent: sipariş zaten paid ise no-op döner (PayTR aynı bildirimi
   * birden çok kez gönderebilir; transaction katmanı da ayrıca filtreler).
   */
  async confirmCardPayment(params: {
    orderId: string;
    providerKey: string;
  }): Promise<{ confirmed: boolean; reason?: string }> {
    const outcome = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: params.orderId },
        select: {
          id: true,
          tenantId: true,
          status: true,
          customerId: true,
          humanOrderNo: true,
          marketplace: true,
          total: true,
        },
      });
      if (!order) return { confirmed: false, reason: 'order-not-found' };
      if (order.status === 'paid') return { confirmed: false, reason: 'already-paid' };
      if (order.status !== 'awaiting_payment') {
        // İptal edilmiş siparişe ödeme geldi — para tahsil edildi! Statüye
        // dokunma; loglanır ve iade kuralı gereği tutar admin tarafından
        // cari bakiyeye eklenir (karta iade yapılmaz).
        return { confirmed: false, reason: `unexpected-status:${order.status}` };
      }

      const now = new Date();

      // Muhasebe — gerçek POS komisyonu snapshot'ı. Tahsilatı yapan POS'un
      // BİZDEN kestiği gerçek oranı (commissionRate, ~%2,79) sipariş anında
      // dondur. Müşteriden alınan %3 zaten cardCommissionAmount'ta. Komisyon
      // kârı = cardCommissionAmount − cardCommissionAmountActual. Base = total
      // (komisyon hariç matrah; merkezî kâr formülüyle birebir aynı taban).
      // POS bulunamaz/oran 0 ise NULL bırak → merkezî kâr aktif POS'a düşer.
      const pos = await tx.posProvider.findUnique({
        where: { key: params.providerKey },
        select: { commissionRate: true },
      });
      const realRate = pos?.commissionRate ?? null;
      const hasRealRate = realRate != null && realRate.greaterThan(0);
      const cardCommissionAmountActual = hasRealRate
        ? decimalRound2(order.total.mul(realRate).div(100))
        : null;

      await tx.order.update({
        where: { id: order.id },
        data: {
          status: 'paid',
          statusChangedAt: now,
          posProviderKey: params.providerKey,
          cardCommissionRateActual: hasRealRate ? realRate : null,
          cardCommissionAmountActual,
        },
      });

      if (order.customerId) {
        const customer = await tx.customer.findUnique({
          where: { id: order.customerId },
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
              select: { line1: true, city: true, district: true, postalCode: true },
            },
          },
        });
        if (customer) {
          await markOrderPaid({
            tx,
            settings: this.appSettings,
            orderId: order.id,
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
            now,
          });
        }
      } else {
        // Misafir siparişi: billing snapshot sipariş üstündeki müşteri
        // alanlarından; hold süresi markOrderPaid ile aynı ayardan.
        const holdHours = await this.appSettings.getNumber(
          'birfatura.invoiceHoldHours',
          144,
        );
        await tx.order.update({
          where: { id: order.id },
          data: {
            paidAt: now,
            invoiceHoldUntil: new Date(now.getTime() + holdHours * 3_600_000),
            billingHold: false,
          },
        });
      }

      return { confirmed: true as const, order };
    });

    if (!outcome.confirmed || !('order' in outcome) || !outcome.order) {
      if (outcome.reason && outcome.reason !== 'already-paid') {
        this.logger.error(
          `confirmCardPayment: sipariş onaylanamadı (${params.orderId}): ${outcome.reason}`,
        );
      }
      return { confirmed: false, reason: outcome.reason };
    }

    const order = outcome.order;

    // Tahsilat makbuzu — ödeme COMMIT olduktan SONRA üretilir. Makbuz satırı
    // kendi idempotent transaction'ında açılır (createForOrder); buradaki bir
    // hata ASLA onaylanmış ödemeyi geri almaz. Eksik kalırsa backfill + lazy
    // ensurePdf güvenlik ağı yakalar. Sadece kart siparişinde üretir (guard
    // createForOrderTx içinde: paymentType==='card').
    try {
      await this.receipts.createForOrder(order.id);
    } catch (e) {
      this.logger.error(
        `makbuz üretilemedi (order=${order.id}): ${(e as Error).message}`,
      );
    }

    // Ertelenen yan etkiler — create() içindeki paid-akışıyla birebir aynı
    // sıra: depo rezervi. Hatalar ödeme onayını bozmaz.
    // "Kendim İçin" (self, TAM OTOMASYON): Basit Kargo etiketi üret, başarılıysa
    // depo rezervi (create() paid-akışıyla tutarlı).
    // self-DIŞI'nda birebir korunur.
    if (order.marketplace?.trim() === 'self') {
      void this.basitKargo.fulfillSelfOrder(order.id, order.tenantId);
    } else {
      void this.houseStock
        .reserveForOrder(order.id, order.tenantId)
        .catch((e) =>
          this.logger.warn(
            `house-stock reserveForOrder failed for order=${order.id}: ${(e as Error).message}`,
          ),
        );
    }

    // Onay maili — ödeme kesinleştiği için ancak şimdi gönderilir.
    void this.sendCardPaymentConfirmationMail(order.id).catch((e) =>
      this.logger.error('card order confirmation mail failed', e as Error),
    );

    this.logger.log(
      `Kart ödemesi onaylandı: #${order.humanOrderNo} (POS: ${params.providerKey})`,
    );
    return { confirmed: true };
  }

  private async sendCardPaymentConfirmationMail(orderId: string): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        customerId: true,
        humanOrderNo: true,
        total: true,
        subtotal: true,
        kdvAmount: true,
        packagingCost: true,
        cardCommissionAmount: true,
        currency: true,
        customerName: true,
        customerEmail: true,
        marketplace: true,
        cargoCompany: true,
        cargoBarcode: true,
        items: { select: { productName: true, qty: true, unitPrice: true } },
      },
    });
    if (!order?.customerEmail) return;
    // OPSİYONEL mail: müşteri "Sipariş onayı" tercihini kapattıysa gönderme.
    const { confirm } = await getOrderEmailPrefs(this.prisma, order.customerId);
    if (!confirm) return;
    await this.mail.sendOrderConfirmation({
      to: order.customerEmail,
      customerName: order.customerName ?? '',
      humanOrderNo: order.humanOrderNo,
      total: Number(order.total),
      subtotal: Number(order.subtotal ?? 0),
      kdvAmount: Number(order.kdvAmount ?? 0),
      packagingCost: Number(order.packagingCost ?? 0),
      cardCommissionAmount: order.cardCommissionAmount
        ? Number(order.cardCommissionAmount)
        : null,
      currency: order.currency,
      items: order.items.map((i) => ({
        name: i.productName,
        qty: i.qty,
        unitPrice: Number(i.unitPrice),
      })),
      paymentType: 'card',
      marketplace: order.marketplace ?? null,
      cargoCompany: order.cargoCompany ?? null,
      cargoBarcode: order.cargoBarcode ?? null,
      cariBalanceBefore: null,
      cariBalanceAfter: null,
    });
  }
}

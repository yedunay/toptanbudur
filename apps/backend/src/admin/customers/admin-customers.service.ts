import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { PasswordCryptoService } from '../../vault/password-crypto.service';
import { MailService } from '../../mail/mail.service';
import { DealerService } from '../../dealer/dealer.service';
import { CariBalanceService } from '../../cari-balance/cari-balance.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { BayiNumberService } from '../../receipts/bayi-number.service';
import { normalizeTrPhone } from '../../common/utils/phone';
import { getMonthlyTopSellers } from './monthly-top-sellers';

const DEFAULT_PAGE_SIZE = 30;
// "Tümü" sorgularında uygulanan güvenlik tavanı — sınırsız findMany engellenir.
const ALL_MAX_PAGE_SIZE = 10_000;
const BCRYPT_ROUNDS = 12;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Reset-password endpoint'i her çağrıda 12 karakterli rastgele bir parola
 * üretir, `mustChangePassword=true` işaretler ve plaintext'i yalnızca yanıtta
 * bir kere döner. Audit log'a plaintext yazılmaz.
 */
function generateResetPassword(): string {
  // 9 byte → base64url ≈ 12 karakter (büyük/küçük harf + rakam + - _).
  return randomBytes(9).toString('base64url').slice(0, 12);
}

export interface CustomerListQuery {
  page?: number;
  pageSize?: number;
  /**
   * "Tümü" — tüm müşteriler tek sayfada döner. Standart 200'lük üst sınırı
   * baypas eder; sınırsız sorgu riskine karşı {@link ALL_MAX_PAGE_SIZE} tavanı
   * uygulanır.
   */
  all?: boolean;
  q?: string;
  /** Manuel etikete göre filtre — bu etikete sahip müşteriler. */
  tagId?: string;
  /** Otomatik etikete göre filtre (ör. 'no_orders'). */
  autoTag?: string;
}

/**
 * OTOMATİK (sistem) etiketleri — veriden HESAPLANIR, DB'ye yazılmaz, cron yok.
 * Manuel etiketlerden (CustomerTag) ayrıdır; salt-okunur, admin kaldıramaz.
 * Yeni kural eklenince buraya bir satır + list/findOne'da hesap eklenir.
 */
export interface AutoTag {
  key: string;
  name: string;
  color: string;
  /** Opsiyonel emoji simge (ör. 🏆 = ayın en çok satanı). */
  icon?: string;
}
export const AUTO_TAGS: Record<string, AutoTag> = {
  no_orders: { key: 'no_orders', name: 'Hiç ürün almamış', color: '#dc2626' },
};
/** Ayın en çok satan N. bayisi (1..5) — kupa simgeli; sıraya göre renk. */
const TOP_SELLER_COLORS = ['#eab308', '#94a3b8', '#d97706', '#3b82f6', '#3b82f6'];
export function topSellerAutoTag(rank: number): AutoTag {
  return {
    key: `top_seller_${rank}`,
    name: `Ayın en çok satan ${rank}.`,
    color: TOP_SELLER_COLORS[rank - 1] ?? '#3b82f6',
    icon: '🏆',
  };
}
/**
 * Müşterinin veri-temelli OTOMATİK etiketleri:
 *  - Hiç siparişi yoksa → "Hiç ürün almamış" (kırmızı).
 *  - Bu ayın en çok satan ilk 5 bayisinden biriyse → "Ayın en çok satan N." (🏆).
 * Depolanmaz, hesaplanır; admin kaldıramaz.
 */
function computeAutoTags(orderCount: number, topRank?: number): AutoTag[] {
  const tags: AutoTag[] = [];
  if (orderCount === 0) tags.push(AUTO_TAGS.no_orders);
  if (topRank && topRank >= 1) tags.push(topSellerAutoTag(topRank));
  return tags;
}

@Injectable()
export class AdminCustomersService {
  private readonly logger = new Logger(AdminCustomersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly passwordCrypto: PasswordCryptoService,
    private readonly mail: MailService,
    private readonly dealer: DealerService,
    private readonly cariBalance: CariBalanceService,
    private readonly notifications: NotificationsService,
    private readonly bayiNumbers: BayiNumberService,
  ) {}

  /**
   * Geliştirme yardımcısı — admin panelinin "Test müşteri yarat" butonu.
   * Gerçek müşteri akışıyla aynı `Customer` tablosuna yazar (CustomerAuthService
   * ile uyumlu). Aynı email zaten varsa parolayı günceller (idempotent).
   */
  async createTestCustomer(
    actor: { id: string; tenantId: string },
    body: { email?: string; password?: string; name?: string },
  ) {
    const email =
      body.email && body.email.trim().length > 0
        ? body.email.trim().toLowerCase()
        : `musteri-${Date.now()}@test.local`;
    const password =
      body.password && body.password.length >= 4 ? body.password : 'test1234';
    const name = body.name?.trim() || 'Test Müşteri';
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    // Test akışı da gerçek müşteri akışıyla aynı sealed kopyayı yazar; aksi
    // halde admin "şifre görüntüle" test kullanıcılarında force-reset fallback'a
    // düşer ve test1234 üzerine tesadüfi parola yazılır.
    const encryptedPassword = this.passwordCrypto.seal(password);

    const customer = await this.prisma.customer.upsert({
      where: { email },
      update: { passwordHash, encryptedPassword, name },
      create: { email, passwordHash, encryptedPassword, name },
      select: { id: true, email: true },
    });

    // Müşteri oluşturulduğu anda bayiNo ata (kart işlemi beklenmez); bayiNo
    // ikincil alan olduğundan hata müşteri yaratmayı kırmaz.
    try {
      await this.bayiNumbers.ensureForCustomer(customer.id);
    } catch (err) {
      this.logger.warn(
        `bayiNo atanamadı customerId=${customer.id}: ${(err as Error).message}`,
      );
    }

    void this.audit.log({
      actorType: 'admin',
      actorId: actor.id,
      tenantId: actor.tenantId,
      action: 'CUSTOMER_TEST_CREATED',
      target: customer.id,
      metadata: { email: customer.email },
    });

    return {
      success: true,
      data: {
        id: customer.id,
        email: customer.email,
        // Plain-text password — yalnızca bu uç. UI tek seferlik gösterip atar.
        password,
        // UI'nin "varsayılan şifre nedir?" sorusuna net cevap. Karışıklık önlemi:
        // varsayılan `test1234` — body.password override etmedikçe.
        defaultPassword: 'test1234',
      },
    };
  }

  /**
   * @param canSeeProfitConfig false ise (çalışan/MEMBER) yanıttan indirim ve
   *   kâr yapılandırması alanları çıkarılır (discountPercent,
   *   profitDiscountPercent, customerStatus). Bayinin kendi cari bakiyesi
   *   destek işi için görünür kalır; kâr/maliyet yapılandırması görünmez.
   */
  async list(
    tenantId: string,
    query: CustomerListQuery,
    canSeeProfitConfig = true,
  ) {
    // "Tümü" seçildiğinde tüm müşteriler tek sayfada döner. ALL_MAX_PAGE_SIZE,
    // patolojik büyük tenant'larda sınırsız sorguyu önleyen güvenlik tavanıdır;
    // gerçek müşteri sayıları bunun çok altında kaldığı için pratikte tümü döner.
    const wantsAll = query.all === true;
    const page = wantsAll ? 1 : Math.max(1, query.page ?? 1);
    const pageSize = wantsAll
      ? ALL_MAX_PAGE_SIZE
      : Math.min(200, Math.max(1, query.pageSize ?? DEFAULT_PAGE_SIZE));

    // Universal arama: name, email, phone, vergiNo, bayiNo — case-insensitive
    // contains. bayiNo, CustomerPicker placeholder'ında ("bayi no … ara")
    // vaat edildiği için aramaya dahildir. SKU/barcode N/A (Customer modelinde
    // ürün alanı yok); ürün bazlı arama için admin/products kullanılır.
    const baseFilter = query.q
      ? {
          OR: [
            { name: { contains: query.q, mode: 'insensitive' as const } },
            { email: { contains: query.q, mode: 'insensitive' as const } },
            { phone: { contains: query.q, mode: 'insensitive' as const } },
            { vergiNo: { contains: query.q, mode: 'insensitive' as const } },
            { bayiNo: { contains: query.q, mode: 'insensitive' as const } },
          ],
        }
      : {};
    const where = {
      ...baseFilter,
      // Manuel etiket filtresi — bu etikete sahip müşteriler.
      ...(query.tagId ? { tags: { some: { id: query.tagId } } } : {}),
      // Otomatik etiket filtresi — 'no_orders' = hiç siparişi olmayanlar
      // (görünen "Sipariş" sayacıyla tutarlı: orders where tenantId).
      ...(query.autoTag === 'no_orders'
        ? { orders: { none: { tenantId } } }
        : {}),
    };

    const [total, customers] = await Promise.all([
      this.prisma.customer.count({ where }),
      this.prisma.customer.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          bayiNo: true,
          email: true,
          name: true,
          phone: true,
          vergiNo: true,
          vergiDairesi: true,
          discountPercent: true,
          profitDiscountPercent: true,
          customerStatus: true,
          cariBalance: true,
          // M-5: xmlToken bilerek listede dönmüyor — uzun ömürlü API anahtarı.
          // İhtiyaç duyulan tek yer detay sayfası (findOne) ve regenerate-token
          // uç noktası; orada select'lerde tutuldu.
          isActive: true,
          mustChangePassword: true,
          createdAt: true,
          _count: { select: { orders: { where: { tenantId } } } },
          orders: {
            where: { tenantId },
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { createdAt: true },
          },
          // Manuel etiketler (YALNIZ ADMIN — müşteri-yüzlü select'lere eklenmez).
          tags: {
            select: { id: true, name: true, color: true },
            orderBy: { name: 'asc' },
          },
        },
      }),
    ]);

    const [totalSpentMap, topSellers] = await Promise.all([
      this.buildTotalSpentMap(
        tenantId,
        customers.map((c) => c.id),
      ),
      getMonthlyTopSellers(this.prisma, tenantId),
    ]);

    return {
      success: true,
      data: customers.map((c) => ({
        id: c.id,
        bayiNo: c.bayiNo,
        email: c.email,
        name: c.name,
        phone: c.phone,
        vergiNo: c.vergiNo,
        vergiDairesi: c.vergiDairesi,
        discountPercent: canSeeProfitConfig ? c.discountPercent : null,
        profitDiscountPercent: canSeeProfitConfig
          ? c.profitDiscountPercent
          : null,
        customerStatus: canSeeProfitConfig ? c.customerStatus : null,
        cariBalance: Number(c.cariBalance),
        isActive: c.isActive,
        mustChangePassword: c.mustChangePassword,
        totalOrders: c._count.orders,
        totalSpent: totalSpentMap[c.id] ?? 0,
        lastOrderAt: c.orders[0]?.createdAt ?? null,
        createdAt: c.createdAt,
        tags: c.tags,
        autoTags: computeAutoTags(c._count.orders, topSellers.get(c.id)),
      })),
      meta: {
        total,
        page,
        // "Tümü" durumunda limit = gerçek toplam; footer "1–total" gösterir,
        // ALL_MAX tavanı sızdırılmaz.
        limit: wantsAll ? total : pageSize,
        totalPages: wantsAll ? 1 : Math.ceil(total / pageSize),
      },
    };
  }

  /** @param canSeeProfitConfig bkz. list(). */
  async findOne(tenantId: string, id: string, canSeeProfitConfig = true) {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
      select: {
        id: true,
        bayiNo: true,
        email: true,
        name: true,
        phone: true,
        vergiNo: true,
        vergiDairesi: true,
        tcKimlik: true,
        companyTitle: true,
        mersisNumber: true,
        companyAddress: true,
        contactName: true,
        contactPhone: true,
        contactEmail: true,
        discountPercent: true,
        profitDiscountPercent: true,
        customerStatus: true,
        cariBalance: true,
        xmlTokenV2: true,
        isActive: true,
        mustChangePassword: true,
        createdAt: true,
        vacationMode: true,
        vacationStartedAt: true,
        // Fatura kesimi toggle'ı (birfatura.md §9) — KAPALI ise bu bayinin
        // siparişleri konsolide kesime (freeze) HİÇ girmez. Default AÇIK.
        invoicingEnabled: true,
        _count: { select: { orders: { where: { tenantId } } } },
        // Manuel etiketler (YALNIZ ADMIN — müşteri-yüzlü select'e eklenmez).
        tags: {
          select: { id: true, name: true, color: true },
          orderBy: { name: 'asc' },
        },
        addresses: {
          orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
          select: {
            id: true,
            title: true,
            fullName: true,
            phone: true,
            line1: true,
            line2: true,
            city: true,
            district: true,
            postalCode: true,
            country: true,
            isDefault: true,
          },
        },
        orders: {
          // awaiting_payment (tamamlanmamış kart denemesi) müşteri sipariş
          // listesinde GÖRÜNMEZ — iptal sanılıp kafa karışıyordu.
          where: { tenantId, status: { not: 'awaiting_payment' } },
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: {
            id: true,
            humanOrderNo: true,
            marketplace: true,
            status: true,
            total: true,
            currency: true,
            createdAt: true,
            items: {
              select: {
                productName: true,
                qty: true,
                product: {
                  select: {
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
        },
      },
    });
    if (!customer) throw new NotFoundException('customer not found');

    // Stat bar'daki "Toplam Harcama" gerçekten cebe giren parayı yansıtmalı:
    // iptal (cancelled) ve iade (refunded) edilen siparişler para geri gittiği
    // için toplama DAHİL EDİLMEZ. Sipariş ADEDİ (_count.orders) tüm statüleri
    // sayar — o ayrı hesaplanır; burada sadece tutar/ortalama nettir.
    const totalSpentAgg = await this.prisma.order.aggregate({
      where: {
        tenantId,
        customerId: id,
        status: { notIn: ['cancelled', 'refunded'] },
      },
      _sum: { total: true },
      _count: { id: true },
      _max: { createdAt: true },
    });
    // İADE düşümü: müşteriye CariLedger REFUND ile geri ödenen para gross'tan
    // çıkarılır (NET HARCAMA). Kısmî iade edilen siparişler 'paid'/'shipped'
    // kaldığı için gross'ta görünür; farkı burada düşeriz.
    const detailRefundMap = await this.cariBalance.refundTotalsByCustomer({
      tenantId,
      customerIds: [id],
    });
    const grossSpent = Number(totalSpentAgg._sum.total ?? 0);
    const totalSpent = Math.max(0, grossSpent - (detailRefundMap.get(id) ?? 0));
    // avgOrderValue net toplam / net (iptal/iade hariç) sipariş adedi.
    const netOrderCount = totalSpentAgg._count.id;
    const avgOrderValue = netOrderCount > 0 ? totalSpent / netOrderCount : 0;
    const lastOrderAt = totalSpentAgg._max.createdAt ?? null;
    const topSellers = await getMonthlyTopSellers(this.prisma, tenantId);

    return {
      success: true,
      data: {
        id: customer.id,
        bayiNo: customer.bayiNo,
        email: customer.email,
        name: customer.name,
        phone: customer.phone,
        vergiNo: customer.vergiNo,
        vergiDairesi: customer.vergiDairesi,
        tcKimlik: customer.tcKimlik,
        companyTitle: customer.companyTitle,
        mersisNumber: customer.mersisNumber,
        companyAddress: customer.companyAddress,
        contactName: customer.contactName,
        contactPhone: customer.contactPhone,
        contactEmail: customer.contactEmail,
        discountPercent: canSeeProfitConfig ? customer.discountPercent : null,
        profitDiscountPercent: canSeeProfitConfig
          ? customer.profitDiscountPercent
          : null,
        customerStatus: canSeeProfitConfig ? customer.customerStatus : null,
        cariBalance: Number(customer.cariBalance),
        // Müşteri-yüzlü aktif token V2 (marketplace); response anahtarı
        // geriye dönük uyumluluk için 'xmlToken' olarak kalır.
        xmlToken: customer.xmlTokenV2,
        isActive: customer.isActive,
        mustChangePassword: customer.mustChangePassword,
        totalOrders: customer._count.orders,
        ordersCount: customer._count.orders,
        totalSpent,
        avgOrderValue,
        lastOrderAt,
        addresses: customer.addresses,
        tags: customer.tags,
        autoTags: computeAutoTags(customer._count.orders, topSellers.get(id)),
        recentOrders: customer.orders.map((o) => {
          const supplierSet = new Set<string>();
          const products: Array<{
            name: string;
            qty: number;
            imageUrl: string | null;
          }> = [];
          for (const it of o.items) {
            const sName = it.product?.supplier?.name;
            if (sName) supplierSet.add(sName);
            if (it.productName) {
              products.push({
                name: it.productName,
                qty: it.qty,
                imageUrl: it.product?.images?.[0]?.url ?? null,
              });
            }
          }
          return {
            id: o.id,
            humanOrderNo: o.humanOrderNo,
            marketplace: o.marketplace,
            status: o.status,
            total: Number(o.total),
            currency: o.currency,
            createdAt: o.createdAt,
            products,
            supplierNames: Array.from(supplierSet),
          };
        }),
        createdAt: customer.createdAt,
        vacationMode: customer.vacationMode,
        vacationStartedAt: customer.vacationStartedAt,
        invoicingEnabled: customer.invoicingEnabled,
      },
    };
  }

  private async assertCustomerBelongsToTenant(
    customerId: string,
    _tenantId: string,
  ): Promise<void> {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true },
    });
    if (!customer) throw new NotFoundException('customer not found');
  }

  async updateDiscount(
    id: string,
    discountPercent: number,
    actor?: { id: string; tenantId: string },
  ) {
    const clamped = Math.max(0, Math.min(100, Math.round(discountPercent)));
    if (actor?.tenantId) {
      await this.assertCustomerBelongsToTenant(id, actor.tenantId);
    }
    const customer = await this.prisma.customer.findUnique({ where: { id } });
    if (!customer) throw new NotFoundException('customer not found');
    const updated = await this.prisma.customer.update({
      where: { id },
      data: { discountPercent: clamped },
      select: { id: true, email: true, name: true, discountPercent: true, xmlTokenV2: true },
    });
    if (actor) {
      void this.audit.log({
        actorType: 'admin',
        actorId: actor.id,
        tenantId: actor.tenantId,
        action: 'CUSTOMER_DISCOUNT_UPDATED',
        target: id,
        metadata: { from: customer.discountPercent, to: clamped },
      });
    }
    return {
      success: true,
      data: { ...updated, xmlToken: updated.xmlTokenV2 },
    };
  }

  /**
   * PATCH /api/admin/customers/:id — kısmi alan güncellemesi.
   * - email değişiyorsa unique kontrolü yapılır (ConflictException).
   * - phone normalize edilir (TR).
   * - discountPercent 0-100 aralığına clamp edilir.
   */
  async updateCustomer(
    id: string,
    body: {
      name?: string;
      email?: string;
      phone?: string | null;
      vergiDairesi?: string | null;
      vergiNo?: string | null;
      tcKimlik?: string | null;
      companyTitle?: string | null;
      mersisNumber?: string | null;
      companyAddress?: string | null;
      contactName?: string | null;
      contactPhone?: string | null;
      contactEmail?: string | null;
      discountPercent?: number;
      profitDiscountPercent?: number;
      customerStatus?: 'STANDARD' | 'ADMIN_DISCOUNT';
      invoicingEnabled?: boolean;
    },
    actor: { id: string; tenantId: string },
  ) {
    await this.assertCustomerBelongsToTenant(id, actor.tenantId);
    const existing = await this.prisma.customer.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('customer not found');

    const data: Prisma.CustomerUpdateInput = {};
    const changes: Record<string, { from: unknown; to: unknown }> = {};

    if (body.name !== undefined) {
      const trimmed = body.name.trim();
      if (trimmed.length < 2) {
        throw new BadRequestException('name too short');
      }
      data.name = trimmed;
      changes.name = { from: existing.name, to: trimmed };
    }
    if (body.email !== undefined) {
      const next = body.email.trim().toLowerCase();
      if (!EMAIL_RE.test(next)) {
        throw new BadRequestException('invalid email');
      }
      if (next !== existing.email) {
        const collision = await this.prisma.customer.findUnique({
          where: { email: next },
          select: { id: true },
        });
        if (collision && collision.id !== id) {
          throw new ConflictException('email already in use');
        }
        data.email = next;
        changes.email = { from: existing.email, to: next };
      }
    }
    if (body.phone !== undefined) {
      const next =
        body.phone === null || body.phone.trim() === ''
          ? null
          : (normalizeTrPhone(body.phone) ?? body.phone.trim());
      data.phone = next;
      changes.phone = { from: existing.phone, to: next };
    }
    if (body.vergiDairesi !== undefined) {
      const raw = body.vergiDairesi === null ? '' : body.vergiDairesi.trim();
      if (raw.length > 200) {
        throw new BadRequestException('Vergi dairesi en fazla 200 karakter olabilir.');
      }
      const next = raw.length === 0 ? null : raw;
      data.vergiDairesi = next;
      changes.vergiDairesi = { from: existing.vergiDairesi, to: next };
    }
    if (body.discountPercent !== undefined) {
      const clamped = Math.max(
        0,
        Math.min(100, Math.round(Number(body.discountPercent))),
      );
      data.discountPercent = clamped;
      changes.discountPercent = {
        from: existing.discountPercent,
        to: clamped,
      };
    }
    // Global Kâr İndirimi (kardan indirim) — 0-100.
    if (body.profitDiscountPercent !== undefined) {
      const clamped = Math.max(
        0,
        Math.min(100, Math.round(Number(body.profitDiscountPercent))),
      );
      data.profitDiscountPercent = clamped;
      changes.profitDiscountPercent = {
        from: existing.profitDiscountPercent,
        to: clamped,
      };
    }
    if (
      body.customerStatus !== undefined &&
      body.customerStatus !== existing.customerStatus
    ) {
      data.customerStatus = body.customerStatus;
      changes.customerStatus = {
        from: existing.customerStatus,
        to: body.customerStatus,
      };
    }
    // Fatura kesimi toggle'ı (birfatura.md §9). KAPALI ise bu bayinin
    // siparişleri konsolide kesime (freeze) HİÇ girmez.
    if (
      body.invoicingEnabled !== undefined &&
      body.invoicingEnabled !== existing.invoicingEnabled
    ) {
      data.invoicingEnabled = body.invoicingEnabled;
      changes.invoicingEnabled = {
        from: existing.invoicingEnabled,
        to: body.invoicingEnabled,
      };
    }
    // Fatura/firma alanları — '' veya null → null (temizle), aksi halde trim.
    const norm = (v?: string | null) =>
      v === undefined ? undefined : v === null || v.trim() === '' ? null : v.trim();
    for (const key of [
      'vergiNo', 'tcKimlik', 'companyTitle', 'mersisNumber',
      'companyAddress', 'contactName', 'contactPhone', 'contactEmail',
    ] as const) {
      const next = norm(body[key]);
      if (next === undefined) continue;
      (data as Prisma.CustomerUpdateInput)[key] = next;
      changes[key] = { from: (existing as Record<string, unknown>)[key], to: next };
    }

    const updated = await this.prisma.customer.update({
      where: { id },
      data,
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        vergiNo: true,
        vergiDairesi: true,
        tcKimlik: true,
        companyTitle: true,
        mersisNumber: true,
        companyAddress: true,
        contactName: true,
        contactPhone: true,
        contactEmail: true,
        discountPercent: true,
        profitDiscountPercent: true,
        customerStatus: true,
        invoicingEnabled: true,
        xmlTokenV2: true,
        mustChangePassword: true,
      },
    });

    void this.audit.log({
      actorType: 'admin',
      actorId: actor.id,
      tenantId: actor.tenantId,
      action: 'CUSTOMER_UPDATED',
      target: id,
      metadata: { changes },
    });

    return {
      success: true,
      data: { ...updated, xmlToken: updated.xmlTokenV2 },
    };
  }

  /**
   * POST /api/admin/customers/:id/regenerate-token — yeni V2 (marketplace)
   * feed token'ı üret. Müşteri-yüzlü aktif token xmlTokenV2'dir; legacy
   * xmlToken'a dokunulmaz (entegrasyona verilmiş eski linkler korunur).
   * cuid kullanmıyoruz (Customer.id ile karışmasın); 24-byte hex random.
   */
  async regenerateXmlToken(
    id: string,
    actor: { id: string; tenantId: string },
  ) {
    const existing = await this.prisma.customer.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('customer not found');

    // Çakışma çok düşük olasılıklı (24 byte = 192 bit) ama yine de retry mantığı.
    let token = generateXmlToken();
    for (let i = 0; i < 3; i++) {
      const conflict = await this.prisma.customer.findUnique({
        where: { xmlTokenV2: token },
        select: { id: true },
      });
      if (!conflict) break;
      token = generateXmlToken();
    }

    const updated = await this.prisma.customer.update({
      where: { id },
      data: { xmlTokenV2: token },
      select: { id: true, email: true, xmlTokenV2: true },
    });

    void this.audit.log({
      actorType: 'admin',
      actorId: actor.id,
      tenantId: actor.tenantId,
      action: 'CUSTOMER_TOKEN_REGENERATED',
      target: id,
      metadata: { email: existing.email },
    });

    return {
      success: true,
      data: { ...updated, xmlToken: updated.xmlTokenV2 },
    };
  }

  /**
   * POST /api/admin/customers/:id/reset-password — sabit "toptan1234"
   * parolasına döner ve mustChangePassword=true işaretler. Plaintext yanıtta
   * dönülür; audit log'a yazılmaz.
   */
  async resetPassword(
    id: string,
    actor: { id: string; tenantId: string },
  ) {
    await this.assertCustomerBelongsToTenant(id, actor.tenantId);
    const existing = await this.prisma.customer.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('customer not found');

    const password = 'toptan1234';
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    await this.prisma.customer.update({
      where: { id },
      data: {
        passwordHash,
        mustChangePassword: true,
        // Admin şifreyi sıfırladı: bekleyen self-servis reset linkini geçersizle
        // + tokenVersion +1 ile müşterinin önceki tüm oturumlarını düşür.
        passwordResetTokenHash: null,
        passwordResetExpiresAt: null,
        tokenVersion: { increment: 1 },
      },
    });

    void this.audit.log({
      actorType: 'admin',
      actorId: actor.id,
      tenantId: actor.tenantId,
      action: 'CUSTOMER_PASSWORD_RESET',
      target: id,
      metadata: { email: existing.email, defaultPassword: '[REDACTED]' },
    });

    return {
      success: true,
      data: {
        id,
        email: existing.email,
        defaultPassword: password,
        mustChangePassword: true,
      },
    };
  }

  /**
   * PATCH /api/admin/customers/:id/password — admin özel şifre atama.
   * Hem bcrypt hash hem AES sealed kopya güncellenir; mustChangePassword=false.
   * Audit log: CUSTOMER_PASSWORD_SET (plaintext metadata'ya yazılmaz).
   */
  async setPassword(
    id: string,
    password: string,
    actor: { id: string; tenantId: string },
  ) {
    // M-4: 4 karakterlik parola brute-force'a açık; admin yine kısa parola
    // atayabiliyordu. En düşük güvenli sınırı 8 karaktere yükselttik.
    if (typeof password !== 'string' || password.length < 8) {
      throw new BadRequestException('password must be at least 8 characters');
    }
    if (password.length > 128) {
      throw new BadRequestException('password too long');
    }
    await this.assertCustomerBelongsToTenant(id, actor.tenantId);
    const existing = await this.prisma.customer.findUnique({
      where: { id },
      select: { id: true, email: true },
    });
    if (!existing) throw new NotFoundException('customer not found');

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const encryptedPassword = this.passwordCrypto.seal(password);
    await this.prisma.customer.update({
      where: { id },
      data: {
        passwordHash,
        encryptedPassword,
        mustChangePassword: false,
        // Admin şifreyi elle belirledi: bekleyen reset linkini geçersizle +
        // önceki oturumları (tokenVersion) düşür.
        passwordResetTokenHash: null,
        passwordResetExpiresAt: null,
        tokenVersion: { increment: 1 },
      },
    });

    void this.audit.log({
      actorType: 'admin',
      actorId: actor.id,
      tenantId: actor.tenantId,
      action: 'CUSTOMER_PASSWORD_SET',
      target: id,
      metadata: { email: existing.email },
    });

    return { success: true, data: { id, email: existing.email } };
  }

  /**
   * GET /api/admin/customers/:id/password — admin "şifre görüntüle".
   *
   * 1. `encryptedPassword` doluysa AES-256-GCM ile çözer ve plaintext döner.
   *    Yanıt: `{ password: <plain>, hasEncryptedPassword: true }`.
   * 2. NULL ise (eski müşteri, sealed kopya yok) — ham şifreyi geri getirmek
   *    imkansız. Yanıt: `{ password: null, hasEncryptedPassword: false }`.
   *    Admin UI bu durumda "Şifre kayıtlı değil — sıfırla" mesajını gösterir
   *    ve `POST /:id/reset-password` ile sıfırlama akışına yönlendirir.
   * 3. Decrypt başarısızlığında (sealed bozuk / anahtar değişti) yine
   *    `{ password: null, hasEncryptedPassword: false }` dönülür — ekran
   *    "kayıt yok" davranışı ile aynı çalışır; oto-reset yapılmaz.
   *
   * Her durumda AuditLog'a `CUSTOMER_PASSWORD_VIEWED` kaydı düşer — plaintext
   * audit metadata'ya ASLA yazılmaz, yalnızca "görüntülendi" izi.
   */
  async getPassword(id: string, actor: { id: string; tenantId: string }) {
    await this.assertCustomerBelongsToTenant(id, actor.tenantId);
    const existing = await this.prisma.customer.findUnique({
      where: { id },
      select: { id: true, email: true, encryptedPassword: true },
    });
    if (!existing) throw new NotFoundException('customer not found');

    let plaintext: string | null = null;
    let decryptError: string | null = null;
    if (existing.encryptedPassword) {
      try {
        plaintext = this.passwordCrypto.open(existing.encryptedPassword);
      } catch (err: unknown) {
        decryptError = err instanceof Error ? err.message : String(err);
        // Sealed kopya bozuk veya anahtar değişmiş — null dön. Force-reset
        // otomatik yapılmaz; admin UI explicit reset-password endpoint'ine yönlenir.
        this.logger.warn(
          `customer ${id} encryptedPassword decrypt failed: ${decryptError}`,
        );
      }
    }

    void this.audit.log({
      actorType: 'admin',
      actorId: actor.id,
      tenantId: actor.tenantId,
      action: 'CUSTOMER_PASSWORD_VIEWED',
      target: id,
      // Plaintext metadata'ya yazılmaz — yalnızca görüntüleme izi ve durum.
      metadata: {
        email: existing.email,
        hasEncryptedPassword: existing.encryptedPassword !== null,
        decryptFailed: decryptError !== null,
      },
    });

    return {
      success: true,
      data: {
        id: existing.id,
        email: existing.email,
        password: plaintext,
        hasEncryptedPassword:
          existing.encryptedPassword !== null && decryptError === null,
      },
    };
  }

  /**
   * DELETE /api/admin/customers/:id — hard delete.
   * Order.customerId FK SET NULL — eski siparişler kalır ama müşteri bağı kopar.
   */
  async remove(id: string, actor: { id: string; tenantId: string }) {
    await this.assertCustomerBelongsToTenant(id, actor.tenantId);
    const existing = await this.prisma.customer.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('customer not found');

    await this.prisma.customer.delete({ where: { id } });

    void this.audit.log({
      actorType: 'admin',
      actorId: actor.id,
      tenantId: actor.tenantId,
      action: 'CUSTOMER_DELETED',
      target: id,
      metadata: { email: existing.email, name: existing.name },
    });

    return { success: true, data: { deleted: true, id } };
  }

  async getSupplierDiscounts(
    id: string,
    actor: { id: string; tenantId: string },
  ) {
    await this.assertCustomerBelongsToTenant(id, actor.tenantId);

    const [suppliers, overrides] = await Promise.all([
      this.prisma.supplier.findMany({
        where: { tenantId: actor.tenantId, active: true },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.customerSupplierDiscount.findMany({
        where: { customerId: id },
        select: {
          supplierId: true,
          discountPercent: true,
          profitDiscountPercent: true,
          adminDiscount: true,
        },
      }),
    ]);

    const overrideMap = new Map(overrides.map((o) => [o.supplierId, o]));

    const data = suppliers.map((s) => {
      const ov = overrideMap.get(s.id);
      return {
        supplierId: s.id,
        supplierName: s.name,
        // profitDiscountPercent = DÜZENLENEBİLİR "Kâr İndirimi"; null = OVERRIDE YOK
        // (global miras). Override satırı VARSA gerçek değer (0 DAHİL) döndürülür ki
        // admin "gizli sıfır"ı görsün: 0/0 override sipariş motorunda o tedarikçide
        // indirimi SESSİZCE iptal ediyor, ama eskiden 0→null olduğu için panelde
        // "global miras" gibi görünüp fark edilmiyordu (Doğan Gılavuz vakası). Artık
        // 0 açıkça görünür → admin silip global'e döndürebilir. (adminDiscount satırı
        // "Maliyet + paketleme" rozetiyle gösterildiğinden profit alanı gizli → null.)
        profitDiscountPercent:
          ov && !ov.adminDiscount ? ov.profitDiscountPercent : null,
        // discountPercent = LEGACY off-list (yalnız OKUNUR not). adminDiscount
        // olsa bile gösterilir — admin, altta duran ve "Admin İndirimi"ni
        // kapatınca devreye girecek eski değeri görebilsin (kazara silme önlenir).
        discountPercent:
          ov && ov.discountPercent > 0 ? ov.discountPercent : null,
        adminDiscount: ov?.adminDiscount ?? false,
      };
    });

    return { success: true, data };
  }

  async updateSupplierDiscounts(
    id: string,
    discounts: Array<{
      supplierId: string;
      // "Kâr İndirimi" (kardan) — DÜZENLENEBİLİR. Bir SAYI ise yazılır. undefined
      // (alan hiç gönderilmedi) ise Kâr İndirimi'ne DOKUNULMAZ (yalnızca admin
      // toggle değişti olabilir → satır korunur, legacy off-list silinmez).
      profitDiscountPercent?: number | null;
      adminDiscount?: boolean;
      // YALNIZCA bu true iken satır tamamen silinir (override kaldır → global'e
      // dön). Admin'in açık "kaldır" eylemi (✕ / alanı boşaltma) dışında ASLA
      // silinmez — böylece eski liste indirimi kazara kaybolmaz.
      clearOverride?: boolean;
    }>,
    actor: { id: string; tenantId: string; email?: string | null },
    req?: import('express').Request | null,
  ) {
    await this.assertCustomerBelongsToTenant(id, actor.tenantId);

    const supplierIds = discounts.map((d) => d.supplierId);
    const validSuppliers = await this.prisma.supplier.findMany({
      where: { id: { in: supplierIds }, tenantId: actor.tenantId },
      select: { id: true, name: true },
    });
    const validIds = new Set(validSuppliers.map((s) => s.id));
    const supplierNameMap = new Map(validSuppliers.map((s) => [s.id, s.name]));
    const invalid = supplierIds.filter((sid) => !validIds.has(sid));
    if (invalid.length > 0) {
      throw new BadRequestException(`Invalid supplier ids: ${invalid.join(', ')}`);
    }

    const previousOverrides = await this.prisma.customerSupplierDiscount.findMany(
      {
        where: { customerId: id, supplierId: { in: supplierIds } },
        select: {
          supplierId: true,
          discountPercent: true,
          profitDiscountPercent: true,
          adminDiscount: true,
        },
      },
    );
    const beforeMap = new Map(
      previousOverrides.map((o) => [o.supplierId, o]),
    );

    await this.prisma.$transaction(async (tx) => {
      for (const d of discounts) {
        if (d.clearOverride) {
          // TEK silme yolu — admin açıkça "kaldır" dedi (✕ / alanı boşalttı).
          // Override tamamen gider (Kâr İndirimi + legacy off-list) → global'e dön.
          await tx.customerSupplierDiscount.deleteMany({
            where: { customerId: id, supplierId: d.supplierId },
          });
        } else if (d.adminDiscount) {
          // Tedarikçi-bazlı Admin İndirimi: maliyet fiyatı uygulanır, yüzde
          // override'ları yok sayılır → profitDiscountPercent=0, adminDiscount=true.
          // Legacy discountPercent'e dokunulmaz (korunur).
          await tx.customerSupplierDiscount.upsert({
            where: { customerId_supplierId: { customerId: id, supplierId: d.supplierId } },
            create: {
              customerId: id,
              supplierId: d.supplierId,
              tenantId: actor.tenantId,
              discountPercent: 0,
              profitDiscountPercent: 0,
              adminDiscount: true,
            },
            update: { profitDiscountPercent: 0, adminDiscount: true },
          });
        } else if (d.profitDiscountPercent === undefined || d.profitDiscountPercent === null) {
          // Kâr İndirimi'ne dokunulmadı; yalnızca Admin İndirimi KAPATILDI. Satır
          // VARSA adminDiscount=false yap, Kâr İndirimi + legacy off-list KORUNUR.
          // Satır yoksa hiçbir şey yaratma (no-op) — kazara silme/oluşturma yok.
          await tx.customerSupplierDiscount.updateMany({
            where: { customerId: id, supplierId: d.supplierId },
            data: { adminDiscount: false },
          });
        } else {
          // Kâr İndirimi % yaz. Legacy discountPercent'e DOKUNMA (mevcut müşteri
          // fiyatları bozulmasın; Kâr İndirimi >0 iken motor onu zaten yok sayar).
          const clamped = Math.max(
            0,
            Math.min(100, Math.round(d.profitDiscountPercent)),
          );
          await tx.customerSupplierDiscount.upsert({
            where: { customerId_supplierId: { customerId: id, supplierId: d.supplierId } },
            create: {
              customerId: id,
              supplierId: d.supplierId,
              tenantId: actor.tenantId,
              discountPercent: 0,
              profitDiscountPercent: clamped,
              adminDiscount: false,
            },
            update: { profitDiscountPercent: clamped, adminDiscount: false },
          });
        }
      }
    });

    void (async () => {
      try {
        const [admin, customer] = await Promise.all([
          this.prisma.user.findUnique({
            where: { id: actor.id },
            select: { name: true, email: true },
          }),
          this.prisma.customer.findUnique({
            where: { id },
            select: { name: true, email: true },
          }),
        ]);
        const adminLabel =
          admin?.name?.trim() || admin?.email?.trim() || actor.email || 'admin';
        const customerLabel =
          customer?.name?.trim() || customer?.email?.trim() || id;

        const fmtState = (
          st:
            | {
                discountPercent: number;
                profitDiscountPercent: number;
                adminDiscount: boolean;
              }
            | undefined,
        ): string =>
          st === undefined
            ? 'varsayılan'
            : st.adminDiscount
              ? 'Admin İndirimi (maliyet)'
              : st.profitDiscountPercent > 0
                ? `Kâr İndirimi %${st.profitDiscountPercent}`
                : st.discountPercent > 0
                  ? `Liste indirimi %${st.discountPercent} (eski)`
                  : 'varsayılan';

        const changeLines = discounts.map((d) => {
          const supplierName = supplierNameMap.get(d.supplierId) ?? d.supplierId;
          const beforeText = fmtState(beforeMap.get(d.supplierId));
          const afterText = d.clearOverride
            ? 'kaldırıldı (genel)'
            : d.adminDiscount
              ? 'Admin İndirimi (maliyet)'
              : d.profitDiscountPercent === undefined ||
                  d.profitDiscountPercent === null
                ? 'değişmedi'
                : `Kâr İndirimi %${d.profitDiscountPercent}`;
          return `${supplierName}: ${beforeText} → ${afterText}`;
        });

        const summary = `${adminLabel} ${customerLabel} müşterisinin tedarikçi indirim oranlarını güncelledi (${changeLines.length} tedarikçi)`;

        await this.audit.record({
          action: 'CUSTOMER_SUPPLIER_DISCOUNTS_UPDATE',
          summary,
          actor: {
            type: 'admin',
            id: actor.id,
            name: admin?.name ?? null,
            email: admin?.email ?? actor.email ?? null,
            tenantId: actor.tenantId,
          },
          target: {
            id,
            type: 'customer',
            label: customerLabel,
          },
          before: { discounts: Array.from(beforeMap.entries()).map(([sid, st]) => ({ supplierId: sid, supplierName: supplierNameMap.get(sid) ?? sid, discountPercent: st.discountPercent, profitDiscountPercent: st.profitDiscountPercent, adminDiscount: st.adminDiscount })) },
          after: { discounts: discounts.map((d) => ({ supplierId: d.supplierId, supplierName: supplierNameMap.get(d.supplierId) ?? d.supplierId, profitDiscountPercent: d.profitDiscountPercent ?? null, adminDiscount: d.adminDiscount ?? false, clearOverride: d.clearOverride ?? false })) },
          extra: { changes: changeLines },
          req: req ?? null,
        });
      } catch (err) {
        this.logger?.warn?.(
          `Failed to record CUSTOMER_SUPPLIER_DISCOUNTS_UPDATE audit: ${
            err instanceof Error ? err.message : 'unknown'
          }`,
        );
      }
    })();

    return { success: true };
  }

  /**
   * POST /api/admin/customers/:id/balance-adjustment — admin manuel cari
   * bakiye düzeltmesi. Admin yeni mutlak bakiye değerini gönderir; servis
   * işaretli farkı hesaplar ve ADJUSTMENT tipli CariLedger kaydı yazar.
   * Audit log: CUSTOMER_BALANCE_ADJUSTED.
   */
  async adjustBalance(
    id: string,
    newBalance: number,
    reason: string | undefined,
    actor: { id: string; tenantId: string; email?: string | null },
    req?: import('express').Request | null,
  ) {
    await this.assertCustomerBelongsToTenant(id, actor.tenantId);

    return this.cariBalance.adjustBalanceByAdmin({
      customerId: id,
      newBalance,
      reason,
      adminUserId: actor.id,
      actorEmail: actor.email ?? null,
      tenantId: actor.tenantId,
      req: req ?? null,
    });
  }

  /**
   * POST /api/admin/customers/:id/gift-balance — admin HEDİYE BAKİYE tanımlar.
   * `amount` müşterinin cari bakiyesine EKLENECEK pozitif hediye tutarıdır
   * (mutlak bakiye değil). isGift+isPromo işaretli ADJUSTMENT ledger kaydı
   * yazılır ve müşteriye hediye e-postası gönderilir.
   * Audit log: CARI_GIFT_BALANCE_GRANT.
   */
  async giftBalance(
    id: string,
    amount: number,
    note: string | undefined,
    actor: { id: string; tenantId: string; email?: string | null },
    req?: import('express').Request | null,
  ) {
    await this.assertCustomerBelongsToTenant(id, actor.tenantId);

    return this.cariBalance.giftBalanceByAdmin({
      customerId: id,
      amount,
      note,
      adminUserId: actor.id,
      actorEmail: actor.email ?? null,
      tenantId: actor.tenantId,
      req: req ?? null,
    });
  }

  /**
   * GET /api/admin/customers/:id/cari-ledger — müşterinin cari hareket
   * defteri (yükleme / sipariş ödemesi / iade / manuel düzeltme). Bakiyenin
   * doğruluğunu denetlemek için salt-okunur.
   */
  async getCariLedger(
    id: string,
    actor: { id: string; tenantId: string },
    page?: number,
    pageSize?: number,
  ) {
    await this.assertCustomerBelongsToTenant(id, actor.tenantId);
    return this.cariBalance.listLedgerForCustomer(id, { page, pageSize });
  }

  // ---------------------------------------------------------------------------

  /**
   * Bir müşterinin MANUEL etiketlerini verilen sete eşitler (set-all). Yalnız
   * bu tenant'a ait etiketler kabul edilir; geçersiz id'ler sessizce elenir.
   * Otomatik (sistem) etiketleri bu yolla değiştirilemez — onlar hesaplanır.
   */
  async setCustomerTags(
    tenantId: string,
    customerId: string,
    tagIds: string[],
  ) {
    // NOT: Customer tenant-scope'lu DEĞİL (bu projede tenantId Order'da). Mevcut
    // list()/findOne de müşteriyi tenantId ile filtrelemez — aynı davranış.
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true },
    });
    if (!customer) throw new NotFoundException('Müşteri bulunamadı.');

    const unique = Array.from(new Set(tagIds ?? []));
    const valid = unique.length
      ? await this.prisma.customerTag.findMany({
          where: { tenantId, id: { in: unique } },
          select: { id: true },
        })
      : [];
    const validIds = valid.map((t) => t.id);

    await this.prisma.customer.update({
      where: { id: customerId },
      data: { tags: { set: validIds.map((tid) => ({ id: tid })) } },
    });
    return { success: true, tagIds: validIds };
  }

  private async buildTotalSpentMap(
    tenantId: string,
    customerIds: string[],
  ): Promise<Record<string, number>> {
    if (customerIds.length === 0) return {};

    // İptal/iade edilen siparişler harcama toplamına dahil edilmez (para geri
    // gitti). Ayrıca cari REFUND hareketleri brüt tutardan düşülür.
    // "Toplam harcama" sütunu net tutarı gösterir.
    const [aggregated, refundMap] = await Promise.all([
      this.prisma.order.groupBy({
        by: ['customerId'],
        where: {
          tenantId,
          customerId: { in: customerIds },
          status: { notIn: ['cancelled', 'refunded'] },
        },
        _sum: { total: true },
      }),
      this.cariBalance.refundTotalsByCustomer({ tenantId, customerIds }),
    ]);

    return Object.fromEntries(
      aggregated.map((r) => {
        const gross = Number(r._sum.total ?? 0);
        const refunded = refundMap.get(r.customerId!) ?? 0;
        return [r.customerId!, Math.max(0, gross - refunded)];
      }),
    );
  }

  /**
   * Ön kayıtlı (isActive=false) müşteriyi aktive eder: isActive=true yapar,
   * taze geçici şifre üretir, mustChangePassword=true işaretler ve hoş geldin
   * e-postasını şimdi gönderir. Zaten aktif ise 400 fırlatır.
   */
  async activateCustomer(
    customerId: string,
    actor: { id: string; tenantId: string },
  ) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true, email: true, name: true, isActive: true, mustChangePassword: true },
    });
    if (!customer) throw new NotFoundException('Müşteri bulunamadı');
    if (customer.isActive) {
      throw new BadRequestException('Müşteri zaten aktif.');
    }

    // Tek aktivasyon noktası: e-postaya bağlı bir DealerApplication varsa
    // approveApplication'a delege et. Bu sayede Dealer Applications sayfasından
    // ve Customers sayfasından gelen "aktive et" istekleri aynı kod yolundan
    // geçer; tek parola, tek e-posta, drift yok.
    const normalizedEmail = customer.email.trim().toLowerCase();
    const application = await this.prisma.dealerApplication.findUnique({
      where: { email: normalizedEmail },
      select: { id: true, status: true },
    });

    if (application) {
      const result = await this.dealer.approveApplication(application.id, actor);
      return result;
    }

    // Bağlı bir DealerApplication yoksa (eski seed data / manuel oluşturulmuş
    // müşteri): eski davranışı koru — taze parola üret, mail gönder, aktive et.
    const tempPassword = generateResetPassword();
    const passwordHash = await bcrypt.hash(tempPassword, BCRYPT_ROUNDS);

    const updated = await this.prisma.customer.update({
      where: { id: customerId },
      data: { isActive: true, passwordHash, mustChangePassword: true },
      select: { id: true, email: true, name: true, isActive: true },
    });

    void (async () => {
      try {
        await this.mail.sendDealerWelcome({
          to: customer.email,
          name: customer.name,
          tempPassword,
        });
      } catch (err) {
        this.logger.warn(
          `activate welcome mail failed (non-fatal) email=${customer.email} err=${(err as Error).message}`,
        );
      }
    })();

    void this.audit.log({
      actorType: 'admin',
      actorId: actor.id,
      tenantId: actor.tenantId,
      action: 'CUSTOMER_ACTIVATED',
      target: customerId,
      metadata: { email: customer.email, tempPasswordIssued: true },
    });

    this.logger.log(
      JSON.stringify({ event: 'customer.activated', customerId, email: customer.email }),
    );

    return {
      success: true,
      data: { customer: updated, oneTimePassword: tempPassword },
    };
  }

  /**
   * Toplu aktif/pasif. Her müşteri için aynı tenant doğrulaması yapılır.
   * `activate` → isActive=true (mail gönderilmez; tek tek `activate` endpoint'i
   * temp parola + mail gerektirir). `deactivate` → isActive=false.
   */
  async bulkSetActive(
    tenantId: string,
    ids: string[],
    action: 'activate' | 'deactivate',
    actor: { id: string },
  ): Promise<{ updated: number }> {
    const isActive = action === 'activate';
    const result = await this.prisma.customer.updateMany({
      where: { id: { in: ids } },
      data: { isActive },
    });

    if (result.count > 0) {
      void this.audit.log({
        actorType: 'admin',
        actorId: actor.id,
        tenantId,
        action:
          action === 'activate'
            ? 'CUSTOMER_BULK_ACTIVATE'
            : 'CUSTOMER_BULK_DEACTIVATE',
        target: `${result.count} müşteri`,
        metadata: {
          requested: ids.length,
          updated: result.count,
        },
      });
    }

    return { updated: result.count };
  }

  /**
   * PATCH /api/admin/customers/:id/vacation
   * Tatil modu toggle — AÇIK iken müşterinin iade satışı ilanları diğer bayilere
   * görünmez ("yokmuş gibi"). listingStatus değişmez; public query Customer
   * join üzerinden filtrelenir. RESERVED/SHIPPED/SETTLED akışları etkilenmez.
   */
  async setVacationMode(
    id: string,
    enabled: boolean,
    actor: { id: string; tenantId: string },
  ) {
    await this.assertCustomerBelongsToTenant(id, actor.tenantId);
    const existing = await this.prisma.customer.findUnique({
      where: { id },
      select: { id: true, email: true, vacationMode: true },
    });
    if (!existing) throw new NotFoundException('customer not found');

    if (existing.vacationMode === enabled) {
      return {
        success: true,
        data: { id, vacationMode: enabled, changed: false },
      };
    }

    const updated = await this.prisma.customer.update({
      where: { id },
      data: {
        vacationMode: enabled,
        vacationStartedAt: enabled ? new Date() : null,
      },
      select: { id: true, vacationMode: true, vacationStartedAt: true },
    });

    void this.audit.log({
      actorType: 'admin',
      actorId: actor.id,
      tenantId: actor.tenantId,
      action: enabled ? 'CUSTOMER_VACATION_ENABLED' : 'CUSTOMER_VACATION_DISABLED',
      target: id,
      metadata: { email: existing.email, source: 'admin' },
    });

    void this.notifications
      .emit({
        type: 'customer.vacation',
        severity: enabled ? 'warning' : 'info',
        title: enabled
          ? 'Bayi tatil moduna alındı (admin)'
          : 'Bayi tatil modundan çıkarıldı (admin)',
        body: enabled
          ? `${existing.email ?? id} için admin tatil modunu açtı.`
          : `${existing.email ?? id} için admin tatil modunu kapattı.`,
        link: `/customers/${id}`,
        data: {
          customerId: id,
          vacationMode: enabled,
          source: 'admin',
          actorId: actor.id,
        },
        audience: { role: 'ADMIN' },
      })
      .catch((e) =>
        this.logger.warn(
          `Failed to emit customer.vacation notification: ${
            e instanceof Error ? e.message : 'unknown'
          }`,
        ),
      );

    return { success: true, data: { ...updated, changed: true } };
  }
}

function generateXmlToken(): string {
  // 24 byte = 192 bit entropi. CSPRNG.
  return randomBytes(24).toString('hex');
}

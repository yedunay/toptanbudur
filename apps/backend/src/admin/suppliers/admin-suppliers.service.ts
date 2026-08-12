import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import axios from 'axios';
import { Prisma, SupplierAuthType as PrismaAuthType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { assertSafeFeedUrl } from '../../common/utils/safe-feed-url';
import { VaultService } from '../../vault/vault.service';
import { MailService } from '../../mail/mail.service';
import { AdminNotifierService } from '../../mail/admin-notifier.service';
import { FEED_SYNC_QUEUE } from '../../queue/queue.module';
import { RECOMPUTE_TEXT_JOB } from '../../queue/feed-sync.processor';
import { XmlSlotService } from '../../product-core/xml-slot.service';
import { snapshotSupplierBeforeProductDelete } from '../../profitability/supplier-attribution.util';
import {
  resolveEffectivePricing,
  computeSalePrice,
  validateTiers,
  parseTiers,
  type SupplierPricingInput,
  type CategoryPricingInput,
} from '../../pricing/tiered-profit.util';
import type { CreateSupplierDto } from './dto/create-supplier.dto';
import { SupplierAuthType } from './dto/create-supplier.dto';
import type { CreateSupplierFeedDto } from './dto/create-supplier.dto';
import type { UpdateSupplierDto, UpdateSupplierFeedDto } from './dto/update-supplier.dto';
import type { SupplierQueryDto } from './dto/supplier-query.dto';
import type { BrandMappingsBulkDto } from './dto/brand-mapping.dto';
import type { TextRulesBulkDto } from './dto/text-rules.dto';

const DEFAULT_PAGE_SIZE = 20;
// FeedSyncScheduler ile birebir aynı tekrarlı job jobId formatı — feed
// silinince/pasifleşince Redis'teki repeatable'ı kaldırmak için kullanılır (#13).
const feedSyncRepeatJobId = (feedId: string): string => `feed-sync:${feedId}`;

function toAuthTypeEnum(type: SupplierAuthType): PrismaAuthType {
  const map: Record<SupplierAuthType, PrismaAuthType> = {
    [SupplierAuthType.NONE]: 'NONE',
    [SupplierAuthType.BASIC]: 'BASIC',
    [SupplierAuthType.BEARER]: 'BEARER',
  };
  return map[type];
}

function mapFeed(f: {
  id: string;
  name: string;
  feedUrl: string;
  authType: PrismaAuthType;
  refreshIntervalHours: number;
  feedCurrency: string | null;
  exchangeRate: Prisma.Decimal | null;
  exchangeRateMargin: Prisma.Decimal;
  active: boolean;
  lastSyncedAt: Date | null;
  lastSyncError: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: f.id,
    name: f.name,
    feedUrl: f.feedUrl,
    authType: f.authType,
    refreshIntervalHours: f.refreshIntervalHours,
    feedCurrency: f.feedCurrency,
    exchangeRate: f.exchangeRate !== null ? Number(f.exchangeRate) : null,
    exchangeRateMargin: Number(f.exchangeRateMargin),
    active: f.active,
    lastSyncedAt: f.lastSyncedAt,
    lastSyncError: f.lastSyncError,
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
  };
}

const FEED_SELECT = {
  id: true,
  name: true,
  feedUrl: true,
  authType: true,
  refreshIntervalHours: true,
  feedCurrency: true,
  exchangeRate: true,
  exchangeRateMargin: true,
  active: true,
  lastSyncedAt: true,
  lastSyncError: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class AdminSuppliersService {
  private readonly logger = new Logger(AdminSuppliersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly vault: VaultService,
    private readonly mail: MailService,
    private readonly adminNotifier: AdminNotifierService,
    private readonly xmlSlot: XmlSlotService,
    @InjectQueue(FEED_SYNC_QUEUE) private readonly queue: Queue,
  ) {}

  async list(tenantId: string, query: SupplierQueryDto) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? DEFAULT_PAGE_SIZE));

    const where: Prisma.SupplierWhereInput = { tenantId };
    // UI bazı yerlerde `isActive`, bazı yerlerde `active` gönderiyor — ikisini
    // birleştir (active öncelikli).
    const activeFilter = query.active ?? query.isActive;
    if (activeFilter !== undefined) where.active = activeFilter;

    // Serbest metin araması: Supplier modelinde yalnız `name` text alanı var
    // (code/email/marka kolonları şemada yok), bu yüzden ad üzerinde
    // case-insensitive contains uygulanır. Boş/whitespace q yok sayılır (#12).
    const term = query.q?.trim();
    if (term && term.length > 0) {
      where.OR = [{ name: { contains: term, mode: 'insensitive' } }];
    }

    const [total, rows] = await Promise.all([
      this.prisma.supplier.count({ where }),
      this.prisma.supplier.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          name: true,
          active: true,
          profitMargin: true,
          stockThreshold: true,
          marketplaces: true,
          priceIncludesVat: true,
          extraCostTry: true,
          minPrice: true,
          purchaseVatRate: true,
          purchaseDiscountInclVatPct: true,
          purchaseDiscountTl: true,
          purchaseExtraCostTl: true,
          purchaseDiscountExclVatPct: true,
          includeInOwnFeed: true,
          categoriesSyncedAt: true,
          mandatoryCarriers: true,
          requiresPdf: true,
          pttavmEnabled: true,
          leadTimeDays: true,
          createdAt: true,
          _count: { select: { products: true, feeds: true } },
          feeds: {
            where: { active: true },
            orderBy: { lastSyncedAt: 'desc' },
            take: 1,
            select: { lastSyncedAt: true },
          },
        },
      }),
    ]);

    const data = rows.map((s) => ({
      id: s.id,
      name: s.name,
      active: s.active,
      productCount: s._count.products,
      feedCount: s._count.feeds,
      lastSyncAt: s.feeds[0]?.lastSyncedAt ?? null,
      profitMargin: Number(s.profitMargin),
      stockThreshold: s.stockThreshold,
      marketplaces: s.marketplaces,
      priceIncludesVat: s.priceIncludesVat,
      extraCostTry: Number(s.extraCostTry),
      minPrice: Number(s.minPrice),
      purchaseVatRate: Number(s.purchaseVatRate),
      purchaseDiscountInclVatPct: Number(s.purchaseDiscountInclVatPct),
      purchaseDiscountTl: Number(s.purchaseDiscountTl),
      purchaseExtraCostTl: Number(s.purchaseExtraCostTl),
      purchaseDiscountExclVatPct: Number(s.purchaseDiscountExclVatPct),
      includeInOwnFeed: s.includeInOwnFeed,
      categoriesSyncedAt: s.categoriesSyncedAt,
      mandatoryCarriers: s.mandatoryCarriers,
      requiresPdf: s.requiresPdf,
      pttavmEnabled: s.pttavmEnabled,
      leadTimeDays: s.leadTimeDays,
      createdAt: s.createdAt,
    }));

    return {
      success: true,
      data,
      meta: { total, page, limit: pageSize, totalPages: Math.ceil(total / pageSize) },
    };
  }

  async findOne(tenantId: string, id: string) {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id, tenantId },
      select: {
        id: true,
        name: true,
        active: true,
        profitMargin: true,
        profitType: true,
        profitTiers: true,
        stockThreshold: true,
        marketplaces: true,
        priceIncludesVat: true,
        extraCostTry: true,
        minPrice: true,
        purchaseVatRate: true,
        purchaseDiscountInclVatPct: true,
        purchaseDiscountTl: true,
        purchaseExtraCostTl: true,
        purchaseDiscountExclVatPct: true,
        includeInOwnFeed: true,
        categoriesSyncedAt: true,
        mandatoryCarriers: true,
        requiresPdf: true,
        pttavmEnabled: true,
        leadTimeDays: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { products: true } },
        feeds: {
          orderBy: { createdAt: 'asc' },
          select: FEED_SELECT,
        },
      },
    });
    if (!supplier) throw new NotFoundException('supplier not found');

    return {
      success: true,
      data: {
        id: supplier.id,
        name: supplier.name,
        active: supplier.active,
        productCount: supplier._count.products,
        profitMargin: Number(supplier.profitMargin),
        profitType: supplier.profitType === 'tiered' ? 'tiered' : 'fixed',
        profitTiers: parseTiers(supplier.profitTiers),
        stockThreshold: supplier.stockThreshold,
        marketplaces: supplier.marketplaces,
        priceIncludesVat: supplier.priceIncludesVat,
        extraCostTry: Number(supplier.extraCostTry),
        minPrice: Number(supplier.minPrice),
        purchaseVatRate: Number(supplier.purchaseVatRate),
        purchaseDiscountInclVatPct: Number(supplier.purchaseDiscountInclVatPct),
        purchaseDiscountTl: Number(supplier.purchaseDiscountTl),
        purchaseExtraCostTl: Number(supplier.purchaseExtraCostTl),
        purchaseDiscountExclVatPct: Number(supplier.purchaseDiscountExclVatPct),
        includeInOwnFeed: supplier.includeInOwnFeed,
        categoriesSyncedAt: supplier.categoriesSyncedAt,
        mandatoryCarriers: supplier.mandatoryCarriers,
        requiresPdf: supplier.requiresPdf,
        pttavmEnabled: supplier.pttavmEnabled,
        leadTimeDays: supplier.leadTimeDays,
        createdAt: supplier.createdAt,
        updatedAt: supplier.updatedAt,
        feeds: supplier.feeds.map(mapFeed),
      },
    };
  }

  async create(
    tenantId: string,
    dto: CreateSupplierDto,
    actor?: { id: string; name?: string | null; email?: string },
  ) {
    const extraCostTryValue = dto.extraCostTry != null ? Number(dto.extraCostTry) : 0;
    const minPriceValue = dto.minPrice != null ? Number(dto.minPrice) : 1.0;

    // Kademeli seçiliyse baremleri doğrula.
    if (dto.profitType === 'tiered') {
      const vr = validateTiers(dto.profitTiers);
      if (!vr.ok) throw new BadRequestException(vr.error ?? 'Geçersiz kâr baremleri.');
    }
    const profitTiersValue =
      dto.profitTiers != null
        ? (parseTiers(dto.profitTiers) as unknown as Prisma.InputJsonValue)
        : Prisma.JsonNull;

    const supplier = await this.prisma.$transaction(async (tx) => {
      const created = await tx.supplier.create({
        data: {
          tenantId,
          name: dto.name,
          profitMargin: dto.profitMargin ?? 20,
          profitType: dto.profitType === 'tiered' ? 'tiered' : 'fixed',
          profitTiers: profitTiersValue,
          stockThreshold: dto.stockThreshold ?? 0,
          marketplaces: dto.marketplaces ?? [],
          active: dto.active ?? true,
          includeInOwnFeed: dto.includeInOwnFeed ?? true,
          priceIncludesVat: dto.priceIncludesVat ?? false,
          extraCostTry: new Prisma.Decimal(
            (Number.isFinite(extraCostTryValue) ? extraCostTryValue : 0).toFixed(2),
          ),
          minPrice: new Prisma.Decimal(
            (Number.isFinite(minPriceValue) && minPriceValue >= 0 ? minPriceValue : 1.0).toFixed(2),
          ),
          // TEK KAYNAK alış ayarları — create/update asimetrisi kapatıldı:
          // (eskiden create bu alanları yazmıyordu, yeni tedarikçi indirim=0 başlıyordu).
          purchaseVatRate:
            dto.purchaseVatRate != null &&
            Number.isFinite(Number(dto.purchaseVatRate))
              ? Math.trunc(Number(dto.purchaseVatRate))
              : 20,
          purchaseDiscountInclVatPct: new Prisma.Decimal(
            Math.min(
              100,
              Math.max(0, Number(dto.purchaseDiscountInclVatPct ?? 0) || 0),
            ).toFixed(4),
          ),
          purchaseDiscountTl: new Prisma.Decimal(
            Math.max(0, Number(dto.purchaseDiscountTl ?? 0) || 0).toFixed(2),
          ),
          purchaseExtraCostTl: new Prisma.Decimal(
            Math.max(0, Number(dto.purchaseExtraCostTl ?? 0) || 0).toFixed(2),
          ),
          ...(dto.mandatoryCarriers !== undefined ? { mandatoryCarriers: dto.mandatoryCarriers } : {}),
          ...(dto.requiresPdf !== undefined ? { requiresPdf: dto.requiresPdf } : {}),
          ...(dto.pttavmEnabled !== undefined ? { pttavmEnabled: dto.pttavmEnabled } : {}),
          ...(dto.leadTimeDays !== undefined ? { leadTimeDays: dto.leadTimeDays } : {}),
        },
        select: { id: true, name: true, createdAt: true },
      });

      if (dto.initialFeed) {
        await this.createFeedRecord(tx, tenantId, created.id, dto.initialFeed);
      }

      return created;
    });

    void (async () => {
      try {
        const emails = await this.adminNotifier.resolveAdminEmails(tenantId);
        if (emails.length === 0) {
          this.logger.warn(
            `[admin.supplier.create] admin notification skipped — tenant=${tenantId} aktif OWNER/ADMIN yok supplierId=${supplier.id}`,
          );
          return;
        }
        await this.mail.sendAdminNewSupplier({
          to: emails,
          supplierName: supplier.name,
          addedByName: actor?.name ?? actor?.email ?? 'Admin',
        });
      } catch (e) {
        this.logger.warn(`new supplier notification mail failed: ${(e as Error).message}`);
      }
    })();

    void this.xmlSlot.recomputeSlots(tenantId).catch((e: Error) =>
      this.logger.warn(`xml slot recompute failed after supplier create: ${e.message}`),
    );

    return this.findOne(tenantId, supplier.id);
  }

  async update(tenantId: string, id: string, dto: UpdateSupplierDto) {
    // İndirimin GERÇEKTEN değişip değişmediğini anlamak için mevcut değerleri al.
    // Form her kayıtta indirim alanını gönderir; sadece "undefined değil mi"
    // bakarsak her marj değişiminde gereksiz re-sync tetiklenir VE fiyat
    // recompute'u atlanır (re-sync skip ettiği için fiyat güncellenmez).
    const before = await this.prisma.supplier.findFirst({
      where: { id, tenantId },
      select: {
        purchaseDiscountInclVatPct: true,
        purchaseDiscountTl: true,
        purchaseExtraCostTl: true,
        purchaseVatRate: true,
        priceIncludesVat: true,
      },
    });
    const data: Prisma.SupplierUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.profitMargin !== undefined) data.profitMargin = dto.profitMargin;
    // Kâr tipi (fixed/tiered) + kademeli baremler. tiered seçiliyse baremleri
    // doğrula (bitişik [0,∞), geçerli oranlar) ve TEMİZLENMİŞ halini sakla.
    if (dto.profitType !== undefined) {
      data.profitType = dto.profitType === 'tiered' ? 'tiered' : 'fixed';
    }
    if (dto.profitType === 'tiered') {
      const vr = validateTiers(dto.profitTiers);
      if (!vr.ok) throw new BadRequestException(vr.error ?? 'Geçersiz kâr baremleri.');
      data.profitTiers = vr.tiers as unknown as Prisma.InputJsonValue;
    } else if (dto.profitTiers !== undefined) {
      // fixed'e geçince baremleri koru/sakla (kullanıcı geri dönerse kaybolmasın).
      data.profitTiers =
        dto.profitTiers === null
          ? Prisma.JsonNull
          : (parseTiers(dto.profitTiers) as unknown as Prisma.InputJsonValue);
    }
    if (dto.stockThreshold !== undefined) data.stockThreshold = dto.stockThreshold;
    if (dto.marketplaces !== undefined) data.marketplaces = dto.marketplaces;
    if (dto.active !== undefined) data.active = dto.active;
    if (dto.includeInOwnFeed !== undefined) data.includeInOwnFeed = dto.includeInOwnFeed;
    if (dto.priceIncludesVat !== undefined) data.priceIncludesVat = dto.priceIncludesVat;
    if (dto.extraCostTry != null && Number.isFinite(Number(dto.extraCostTry))) {
      data.extraCostTry = new Prisma.Decimal(Number(dto.extraCostTry).toFixed(2));
    }
    if (dto.minPrice != null && Number.isFinite(Number(dto.minPrice))) {
      const v = Number(dto.minPrice);
      data.minPrice = new Prisma.Decimal((v >= 0 ? v : 0).toFixed(2));
    }
    // KDV oranı (10/20) — KDV strip + cüzdan gross-up için tek rate.
    if (
      dto.purchaseVatRate != null &&
      Number.isFinite(Number(dto.purchaseVatRate))
    ) {
      data.purchaseVatRate = Math.trunc(Number(dto.purchaseVatRate));
    }
    // Tek "alış indirimi %".
    if (
      dto.purchaseDiscountInclVatPct != null &&
      Number.isFinite(Number(dto.purchaseDiscountInclVatPct))
    ) {
      const v = Math.min(100, Math.max(0, Number(dto.purchaseDiscountInclVatPct)));
      data.purchaseDiscountInclVatPct = new Prisma.Decimal(v.toFixed(4));
    }
    // Alış indirimi (TL).
    if (
      dto.purchaseDiscountTl != null &&
      Number.isFinite(Number(dto.purchaseDiscountTl))
    ) {
      const v = Math.max(0, Number(dto.purchaseDiscountTl));
      data.purchaseDiscountTl = new Prisma.Decimal(v.toFixed(2));
    }
    // Alış ek maliyeti (TL).
    if (
      dto.purchaseExtraCostTl != null &&
      Number.isFinite(Number(dto.purchaseExtraCostTl))
    ) {
      const v = Math.max(0, Number(dto.purchaseExtraCostTl));
      data.purchaseExtraCostTl = new Prisma.Decimal(v.toFixed(2));
    }
    if (dto.mandatoryCarriers !== undefined) {
      data.mandatoryCarriers = { set: dto.mandatoryCarriers };
    }
    if (dto.requiresPdf !== undefined) data.requiresPdf = dto.requiresPdf;
    if (dto.pttavmEnabled !== undefined) data.pttavmEnabled = dto.pttavmEnabled;
    if (dto.leadTimeDays !== undefined) data.leadTimeDays = dto.leadTimeDays ?? null;

    const result = await this.prisma.supplier.updateMany({
      where: { id, tenantId },
      data,
    });
    if (result.count === 0) throw new NotFoundException('supplier not found');

    if (dto.active === false) {
      await this.prisma.product.updateMany({
        where: { tenantId, supplierId: id },
        data: { stock: 0, contentHash: '' },
      });
      this.logger.log(`supplier=${id} deactivated, zeroed product stocks + cleared contentHash`);
      // Tedarikçi pasifleşince tüm feed'lerinin tekrarlı sync job'larını kaldır
      // (#13). Scheduler zaten supplier.active=false feed'leri zamanlamaz.
      const feeds = await this.prisma.supplierFeed.findMany({
        where: { supplierId: id, tenantId },
        select: { id: true },
      });
      for (const f of feeds) {
        await this.removeFeedRepeatable(f.id);
      }
    }

    const pricingChanged =
      dto.profitMargin !== undefined ||
      dto.extraCostTry !== undefined ||
      dto.profitType !== undefined ||
      dto.profitTiers !== undefined;
    // Alış MALİYETİNİ (costPrice) etkileyen girdiler: indirim %/TL, KDV oranı,
    // KDV-dahil mi. Bunlar değişince SQL recompute YETMEZ (costPrice ingest'te
    // yeniden hesaplanmalı) → feed re-sync. Form alanları her kayıtta geldiği
    // için yalnız değer GERÇEKTEN değiştiyse tetikle (bkz. before fetch).
    const costInputsChanged =
      (dto.purchaseDiscountInclVatPct !== undefined &&
        Number(dto.purchaseDiscountInclVatPct) !==
          Number(before?.purchaseDiscountInclVatPct ?? 0)) ||
      (dto.purchaseDiscountTl !== undefined &&
        Number(dto.purchaseDiscountTl) !==
          Number(before?.purchaseDiscountTl ?? 0)) ||
      (dto.purchaseExtraCostTl !== undefined &&
        Number(dto.purchaseExtraCostTl) !==
          Number(before?.purchaseExtraCostTl ?? 0)) ||
      (dto.purchaseVatRate !== undefined &&
        Number(dto.purchaseVatRate) !== Number(before?.purchaseVatRate ?? 20)) ||
      (dto.priceIncludesVat !== undefined &&
        dto.priceIncludesVat !== Boolean(before?.priceIncludesVat));
    if (costInputsChanged) {
      // costPrice değişir → feed re-sync (costPrice + feedPrice + price yeniden;
      // marj değişikliği de aynı sync'te uygulanır).
      await this.enqueueSync(tenantId, id).catch((e) =>
        this.logger.warn(`cost re-sync enqueue failed supplier=${id}: ${e.message}`),
      );
    } else if (pricingChanged) {
      // Sadece marj/ek kâr değişti → costPrice aynı → anında SQL recompute.
      await this.recomputePricesForSupplier(tenantId, id);
    }

    return this.findOne(tenantId, id);
  }

  async recomputePricesForSupplier(
    tenantId: string,
    supplierId: string,
  ): Promise<{ updated: number }> {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id: supplierId, tenantId },
      select: {
        profitType: true,
        profitMargin: true,
        extraCostTry: true,
        profitTiers: true,
      },
    });
    if (!supplier) return { updated: 0 };
    // HIZLI YOL: tedarikçi "fixed" VE hiçbir kategori "tiered" değilse mevcut tek
    // UPDATE SQL'i kullan (kategori FIXED override'ları COALESCE ile desteklenir,
    // davranış AYNI). Kademeli (tiered) varsa SQL'de barem seçimi pratik değil →
    // TEK KAYNAK motoruyla (tiered-profit.util) app-code recompute.
    const tieredCats = await this.prisma.supplierCategory.count({
      where: { supplierId, profitTypeOverride: 'tiered' },
    });
    if (supplier.profitType !== 'tiered' && tieredCats === 0) {
      return this.recomputeFixedPricesSql(tenantId, supplierId);
    }
    return this.recomputeTieredPrices(tenantId, supplierId, supplier);
  }

  /** Sabit-kâr (ve kategori fixed override) hızlı SQL recompute'u. */
  private async recomputeFixedPricesSql(
    tenantId: string,
    supplierId: string,
  ): Promise<{ updated: number }> {
    // feedPrice = ham hesaplanan satış fiyatı; price = manualPrice ?? feedPrice
    // (ingest invariant'ı korunur — admin manuel override EZİLMEZ).
    //
    // KATEGORİ-FARKINDA: bir ürünün leaf kategorisi için SupplierCategory'de
    // marginPercentOverride / extraCostTryOverride tanımlıysa, global supplier
    // marjı yerine o override kullanılır (COALESCE). Böylece tedarikçi global
    // marjını kaydetmek, daha önce setCategoryPricing ile konan kategori
    // override'larını SESSİZCE EZMEZ. Eşleşme setCategoryPricing ile birebir
    // aynı: array_to_string(sc."path",' > ') = c."path" (exact leaf match) ve
    // sc."supplierId" = bu tedarikçi.
    //
    // NOT: Etkin marj/ek-kâr önce bir CTE'de (eff) ürün başına hesaplanır, sonra
    // UPDATE bu CTE'ye join'lenir. PostgreSQL, UPDATE hedef tablosu p'yi FROM
    // listesindeki bir alt sorgudan (LATERAL dahil) referanslamaya İZİN VERMEZ
    // (hata 42P10: "invalid reference to FROM-clause entry for table p"). CTE
    // ayrı bir kapsam olduğu için p."categoryId"'yi orada serbestçe kullanırız.
    const updated = await this.prisma.$executeRaw`
      WITH eff AS (
        SELECT
          p."id" AS pid,
          p."costPrice" AS cost,
          p."manualPrice" AS manual,
          COALESCE(sc."marginPercentOverride", s."profitMargin") AS margin,
          COALESCE(sc."extraCostTryOverride", s."extraCostTry") AS extra
        FROM "Product" p
        JOIN "Supplier" s
          ON s."id" = p."supplierId"
         AND s."tenantId" = ${tenantId}
        LEFT JOIN "Category" c ON c."id" = p."categoryId"
        LEFT JOIN "SupplierCategory" sc
          ON sc."supplierId" = ${supplierId}
         AND array_to_string(sc."path", ' > ') = c."path"
         AND (
           sc."marginPercentOverride" IS NOT NULL
           OR sc."extraCostTryOverride" IS NOT NULL
         )
        WHERE p."supplierId" = ${supplierId}
          AND p."tenantId" = ${tenantId}
      )
      UPDATE "Product" p
      SET "feedPrice" = ROUND(
            (eff.cost * (1 + (eff.margin / 100.0)))::numeric + eff.extra::numeric,
            2
          ),
          "price" = CASE
            WHEN eff.manual IS NOT NULL THEN eff.manual
            ELSE ROUND(
              (eff.cost * (1 + (eff.margin / 100.0)))::numeric + eff.extra::numeric,
              2
            )
          END,
          "updatedAt" = NOW()
      FROM eff
      WHERE eff.pid = p."id"
    `;
    this.logger.log(`recomputeFixedPricesSql supplier=${supplierId} rows=${updated}`);
    return { updated: Number(updated) };
  }

  /**
   * Kademeli (tiered) kâr için app-code recompute — TEK KAYNAK tiered-profit.util
   * motoruyla (ingest ile parite). Ürün başına: kategori override (tiered/fixed)
   * → tedarikçi (fixed/tiered) çözülür, costPrice'tan satış fiyatı hesaplanır.
   * manualPrice EZİLMEZ. Toplu UPDATE FROM VALUES ile chunk'lı yazılır.
   */
  private async recomputeTieredPrices(
    tenantId: string,
    supplierId: string,
    supplier: {
      profitType: string;
      profitMargin: Prisma.Decimal;
      extraCostTry: Prisma.Decimal;
      profitTiers: Prisma.JsonValue;
    },
  ): Promise<{ updated: number }> {
    const supplierPricing: SupplierPricingInput = {
      profitType: supplier.profitType,
      profitMargin: supplier.profitMargin,
      extraCostTry: supplier.extraCostTry,
      profitTiers: supplier.profitTiers,
    };
    const cats = await this.prisma.supplierCategory.findMany({
      where: {
        supplierId,
        OR: [
          { marginPercentOverride: { not: null } },
          { extraCostTryOverride: { not: null } },
          { profitTypeOverride: { not: null } },
        ],
      },
      select: {
        path: true,
        marginPercentOverride: true,
        extraCostTryOverride: true,
        profitTypeOverride: true,
        profitTiers: true,
      },
    });
    const overrideByPathKey = new Map<string, CategoryPricingInput>();
    for (const c of cats) {
      if (!Array.isArray(c.path) || c.path.length === 0) continue;
      overrideByPathKey.set(c.path.join(' > '), {
        profitTypeOverride: c.profitTypeOverride,
        marginPercentOverride: c.marginPercentOverride,
        extraCostTryOverride: c.extraCostTryOverride,
        profitTiers: c.profitTiers,
      });
    }

    const products = await this.prisma.product.findMany({
      where: { supplierId, tenantId },
      select: {
        id: true,
        costPrice: true,
        manualPrice: true,
        category: { select: { path: true } },
      },
    });
    const updates = products.map((p) => {
      const cost = Number(p.costPrice);
      const key = p.category?.path ?? '';
      const override = key ? overrideByPathKey.get(key) ?? null : null;
      const pricing = resolveEffectivePricing(supplierPricing, override);
      const feedPrice = computeSalePrice(cost, pricing);
      const price = p.manualPrice != null ? Number(p.manualPrice) : feedPrice;
      return { id: p.id, feedPrice, price };
    });
    const updated = await this.batchUpdatePrices(tenantId, updates);
    this.logger.log(`recomputeTieredPrices supplier=${supplierId} rows=${updated}`);
    return { updated };
  }

  /**
   * Ürün başına farklı feedPrice/price'ı tek UPDATE ... FROM (VALUES ...) ile
   * chunk'lı (1000) yazar. manualPrice mantığı çağırana aittir (price zaten
   * çözülmüş gelir). PG parametre limiti için chunk şart.
   */
  private async batchUpdatePrices(
    tenantId: string,
    updates: Array<{ id: string; feedPrice: number; price: number }>,
  ): Promise<number> {
    let total = 0;
    const CHUNK = 1000;
    for (let i = 0; i < updates.length; i += CHUNK) {
      const chunk = updates.slice(i, i + CHUNK);
      if (chunk.length === 0) continue;
      const values = Prisma.join(
        chunk.map(
          (u) =>
            Prisma.sql`(${u.id}, ${u.feedPrice}::numeric, ${u.price}::numeric)`,
        ),
      );
      const res = await this.prisma.$executeRaw`
        UPDATE "Product" p
        SET "feedPrice" = v.fp, "price" = v.pr, "updatedAt" = NOW()
        FROM (VALUES ${values}) AS v(id, fp, pr)
        WHERE p."id" = v.id AND p."tenantId" = ${tenantId}
      `;
      total += Number(res);
    }
    return total;
  }

  async remove(tenantId: string, id: string) {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id, tenantId },
      select: { id: true, name: true, _count: { select: { products: true } } },
    });
    if (!supplier) throw new NotFoundException('supplier not found');

    const productCount = supplier._count.products;
    // Feed id'lerini silmeden önce yakala — silindikten sonra Redis'teki
    // tekrarlı sync job'larını temizlemek için (#13).
    const feedsToCleanup = await this.prisma.supplierFeed.findMany({
      where: { supplierId: id, tenantId },
      select: { id: true },
    });
    await this.prisma.$transaction(async (tx) => {
      if (productCount > 0) {
        // SAVUNMA HATTI: ürünleri (ve hemen ardından tedarikçiyi) silmeden ÖNCE
        // bağlı sipariş kalemlerinin tedarikçi snapshot'ını doldur. Tedarikçi
        // de silineceği için snapshot'taki AD, karlılık/cari raporunda geçmiş
        // siparişlerin tedarikçisini göstermenin tek yolu olur.
        await snapshotSupplierBeforeProductDelete(tx, {
          tenantId,
          supplierId: id,
        });
        await tx.product.deleteMany({ where: { tenantId, supplierId: id } });
      }
      await tx.supplierCategory.deleteMany({ where: { supplierId: id } });
      await tx.supplierBrandMapping.deleteMany({ where: { supplierId: id } });
      await tx.supplier.deleteMany({ where: { id, tenantId } });
    });

    for (const f of feedsToCleanup) {
      await this.removeFeedRepeatable(f.id);
    }

    this.logger.log(
      `supplier=${id} hard-deleted name="${supplier.name}" products=${productCount}`,
    );
    return {
      success: true,
      data: { deleted: true, deactivated: false, productCount },
    };
  }

  // ── Feed CRUD ─────────────────────────────────────────────────────────────

  async listFeeds(tenantId: string, supplierId: string) {
    await this.assertSupplierExists(tenantId, supplierId);
    const feeds = await this.prisma.supplierFeed.findMany({
      where: { supplierId, tenantId },
      orderBy: { createdAt: 'asc' },
      select: FEED_SELECT,
    });
    return { success: true, data: feeds.map(mapFeed) };
  }

  async createFeed(tenantId: string, supplierId: string, dto: CreateSupplierFeedDto) {
    await this.assertSupplierExists(tenantId, supplierId);
    const feed = await this.createFeedRecord(this.prisma, tenantId, supplierId, dto);
    return { success: true, data: mapFeed(feed) };
  }

  /**
   * Feed XML'inde ürün-bazlı para birimi etiketi var mı? Varsa hangi para
   * birimleri ve kaç ürün? Admin Yapılandırma ekranı bunu gösterip yalnızca
   * yabancı para (USD) için kur sorar. Salt-okunur; XML'i indirip currency
   * etiketlerini sayar (TL→TRY normalize). Hata olursa hasPerProductCurrency
   * false döner — UI eski feed-seviyesi davranışına düşer.
   */
  async detectFeedCurrencies(
    tenantId: string,
    supplierId: string,
    feedId: string,
  ): Promise<{
    success: true;
    data: {
      hasPerProductCurrency: boolean;
      currencies: Record<string, number>;
      foreignCurrencies: string[];
      total: number;
      error?: string;
    };
  }> {
    await this.assertSupplierExists(tenantId, supplierId);
    const feed = await this.prisma.supplierFeed.findFirst({
      where: { id: feedId, supplierId, tenantId },
      select: { id: true, feedUrl: true },
    });
    if (!feed) throw new NotFoundException('feed not found');

    const empty = {
      success: true as const,
      data: {
        hasPerProductCurrency: false,
        currencies: {} as Record<string, number>,
        foreignCurrencies: [] as string[],
        total: 0,
      },
    };

    let xmlText: string;
    try {
      await assertSafeFeedUrl(feed.feedUrl);
      const abort = new AbortController();
      const t = setTimeout(() => abort.abort(), 55_000);
      try {
        const resp = await axios.get<string>(feed.feedUrl, {
          timeout: 55_000,
          signal: abort.signal as never,
          responseType: 'text',
          maxContentLength: 1024 * 1024 * 200,
          maxBodyLength: 1024 * 1024 * 200,
          headers: {
            'User-Agent': 'TB-B2B-FeedSync/1.0 (+https://toptanbudur.com)',
            Accept: 'application/xml, text/xml, text/plain, */*',
            'Accept-Encoding': 'gzip, deflate',
          },
          transformResponse: [(d: unknown) => (typeof d === 'string' ? d : String(d))],
        });
        xmlText = resp.data;
      } finally {
        clearTimeout(t);
      }
    } catch (e) {
      this.logger.warn(
        `detectFeedCurrencies feed=${feedId} fetch failed: ${
          e instanceof Error ? e.message : 'unknown'
        }`,
      );
      return {
        ...empty,
        data: {
          ...empty.data,
          error: e instanceof Error ? e.message : 'feed alınamadı',
        },
      };
    }

    // Parser CURRENCY_KEYS ile uyumlu para birimi etiketleri. Tag adı tam
    // eşleşmeli (currencyCode gibi türevler hariç). TL/₺/TRL → TRY.
    const re =
      /<(?:ParaBirimi|para_birimi|doviz|urun_doviz|currency|Currency|CurrencyType|currencyType|systemCurrency|system_currency)>\s*([^<]+?)\s*<\//gi;
    const counts: Record<string, number> = {};
    let total = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(xmlText)) !== null) {
      let v = (m[1] || '').trim().toUpperCase();
      if (!v) continue;
      if (v === 'TL' || v === '₺' || v === 'TRL') v = 'TRY';
      counts[v] = (counts[v] || 0) + 1;
      total += 1;
    }
    const foreignCurrencies = Object.keys(counts).filter((c) => c !== 'TRY');
    return {
      success: true,
      data: {
        hasPerProductCurrency: total > 0,
        currencies: counts,
        foreignCurrencies,
        total,
      },
    };
  }

  async updateFeed(
    tenantId: string,
    supplierId: string,
    feedId: string,
    dto: UpdateSupplierFeedDto,
  ) {
    await this.assertSupplierExists(tenantId, supplierId);
    const existing = await this.prisma.supplierFeed.findFirst({
      where: { id: feedId, supplierId, tenantId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('feed not found');

    const data: Prisma.SupplierFeedUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.feedUrl !== undefined) data.feedUrl = dto.feedUrl;
    if (dto.refreshIntervalHours !== undefined) data.refreshIntervalHours = dto.refreshIntervalHours;
    if (dto.feedCurrency !== undefined) data.feedCurrency = dto.feedCurrency;
    if (dto.active !== undefined) data.active = dto.active;
    if (dto.exchangeRate !== undefined) {
      data.exchangeRate =
        dto.exchangeRate === null
          ? null
          : Number.isFinite(Number(dto.exchangeRate))
          ? new Prisma.Decimal(Number(dto.exchangeRate).toFixed(4))
          : undefined;
    }
    if (dto.exchangeRateMargin != null && Number.isFinite(Number(dto.exchangeRateMargin))) {
      data.exchangeRateMargin = new Prisma.Decimal(Number(dto.exchangeRateMargin).toFixed(4));
    }
    if (dto.auth !== undefined) {
      data.authType = toAuthTypeEnum(dto.auth.type);
      data.authCredentialsEncrypted =
        typeof dto.auth.credentials === 'string' && dto.auth.credentials.length > 0
          ? this.vault.seal(dto.auth.credentials)
          : null;
    }

    const updated = await this.prisma.supplierFeed.update({
      where: { id: feedId },
      data,
      select: FEED_SELECT,
    });
    // Feed pasifleştirildiyse tekrarlı sync job'ını kaldır — aktif edilirse
    // scheduler bir sonraki onModuleInit'te/stale-cron'da yeniden ekler (#13).
    if (dto.active === false) {
      await this.removeFeedRepeatable(feedId);
    }
    return { success: true, data: mapFeed(updated) };
  }

  async deleteFeed(tenantId: string, supplierId: string, feedId: string) {
    await this.assertSupplierExists(tenantId, supplierId);
    const feed = await this.prisma.supplierFeed.findFirst({
      where: { id: feedId, supplierId, tenantId },
      select: { id: true },
    });
    if (!feed) throw new NotFoundException('feed not found');

    const feedCount = await this.prisma.supplierFeed.count({ where: { supplierId, tenantId } });
    if (feedCount <= 1) {
      throw new BadRequestException('Cannot delete the last feed; a supplier must have at least one feed');
    }

    await this.prisma.supplierFeed.delete({ where: { id: feedId } });
    // Silinen feed'in Redis'teki tekrarlı sync job'ını da kaldır (#13).
    await this.removeFeedRepeatable(feedId);
    return { success: true, data: { deleted: true } };
  }

  async enqueueFeedSync(tenantId: string, supplierId: string, feedId: string) {
    await this.assertSupplierExists(tenantId, supplierId);
    const feed = await this.prisma.supplierFeed.findFirst({
      where: { id: feedId, supplierId, tenantId },
      select: { id: true, active: true },
    });
    if (!feed) throw new NotFoundException('feed not found');
    if (!feed.active) {
      return { success: true, data: { jobId: null, skipped: 'inactive' } };
    }

    const job = await this.queue.add(
      'sync',
      { feedId: feed.id, tenantId },
      { removeOnComplete: 50, removeOnFail: 100 },
    );
    this.logger.log(`Enqueued feed-sync job=${job.id} for feedId=${feedId}`);
    return { success: true, data: { jobId: String(job.id) } };
  }

  async enqueueSync(tenantId: string, supplierId: string) {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id: supplierId, tenantId },
      select: { id: true, active: true },
    });
    if (!supplier) throw new NotFoundException('supplier not found');
    if (!supplier.active) {
      return { success: true, data: { jobIds: [], skipped: 'supplier_inactive' } };
    }

    const feeds = await this.prisma.supplierFeed.findMany({
      where: { supplierId, tenantId, active: true },
      select: { id: true },
    });

    const jobIds: string[] = [];
    for (const feed of feeds) {
      const job = await this.queue.add(
        'sync',
        { feedId: feed.id, tenantId },
        { removeOnComplete: 50, removeOnFail: 100 },
      );
      jobIds.push(String(job.id));
    }
    this.logger.log(`Enqueued ${jobIds.length} feed-sync jobs for supplier=${supplierId}`);
    return { success: true, data: { jobIds } };
  }

  // ── Category Management ───────────────────────────────────────────────────

  async triggerCategorySync(tenantId: string, id: string) {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id, tenantId },
      select: { id: true, name: true },
    });
    if (!supplier) throw new NotFoundException('supplier not found');

    const feeds = await this.prisma.supplierFeed.findMany({
      where: { supplierId: id, tenantId, active: true },
      select: { id: true },
    });
    if (feeds.length === 0) throw new BadRequestException('supplier has no active feed');

    // Kategori keşfi artık arka planda feed-sync job'ı üzerinden çalışır.
    // Senkron axios.get kaldırıldı — büyük feed'lerde nginx 90s timeout'u
    // doldurup 502 vermesini engeller. Feed sync işlemcisi zaten kategori
    // upsert'i kendi içinde yapıyor (ensureCategory).
    const jobIds: string[] = [];
    for (const feed of feeds) {
      const job = await this.queue.add(
        'sync',
        { feedId: feed.id, tenantId },
        { removeOnComplete: 50, removeOnFail: 100 },
      );
      jobIds.push(String(job.id));
    }

    this.logger.log(
      `category-sync: enqueued ${jobIds.length} feed-sync jobs supplier=${id} name=${supplier.name}`,
    );

    return {
      success: true,
      data: { jobIds, enqueued: jobIds.length },
    };
  }

  /**
   * V3 (doğru-kategori): tedarikçinin ürünlerini DOĞRU (canonical/Trendyol)
   * kategorilere göre gruplar — admin tedarikçi ayarlarında "doğru kategoriler"
   * görünümü için. Salt-okunur; mevcut SupplierCategory yönetimini etkilemez.
   */
  async listCanonicalCategories(tenantId: string, supplierId: string) {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id: supplierId, tenantId },
      select: { id: true },
    });
    if (!supplier) throw new NotFoundException('supplier not found');

    const rows = await this.prisma.product.groupBy({
      by: ['canonicalCategoryPath'],
      where: {
        tenantId,
        supplierId,
        active: true,
        canonicalCategoryPath: { not: null },
      },
      _count: { _all: true },
    });
    const categories = rows
      .map((r) => ({
        path: r.canonicalCategoryPath as string,
        productCount: r._count._all,
      }))
      .sort((a, b) => b.productCount - a.productCount);
    const unmapped = await this.prisma.product.count({
      where: { tenantId, supplierId, active: true, canonicalCategoryPath: null },
    });
    return { categories, unmapped };
  }

  /// V3: belirli bir DOĞRU kategorideki tedarikçi ürünleri (salt-okunur).
  async listCanonicalCategoryProducts(
    tenantId: string,
    supplierId: string,
    path: string,
  ) {
    return this.prisma.product.findMany({
      where: { tenantId, supplierId, active: true, canonicalCategoryPath: path },
      select: {
        id: true,
        name: true,
        brand: true,
        price: true,
        stock: true,
        internalCode: true,
      },
      orderBy: { stock: 'desc' },
      take: 300,
    });
  }

  async listCategories(tenantId: string, supplierId: string) {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id: supplierId, tenantId },
      select: { id: true },
    });
    if (!supplier) throw new NotFoundException('supplier not found');

    const categories = await this.prisma.supplierCategory.findMany({
      where: { supplierId },
      select: {
        id: true,
        code: true,
        name: true,
        parentCode: true,
        path: true,
        isActive: true,
        marginPercentOverride: true,
        extraCostTryOverride: true,
        profitTypeOverride: true,
        profitTiers: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [{ parentCode: 'asc' }, { name: 'asc' }],
    });

    const counts = await this.prisma.$queryRaw<Array<{ catPath: string; cnt: bigint }>>`
      SELECT c."path" AS "catPath", COUNT(*)::bigint AS "cnt"
      FROM "Product" p
      JOIN "Category" c ON c."id" = p."categoryId"
      WHERE p."tenantId" = ${tenantId}
        AND p."supplierId" = ${supplierId}
      GROUP BY c."path"
    `;
    const countByPath = new Map<string, number>();
    for (const r of counts) {
      countByPath.set(r.catPath, Number(r.cnt));
    }

    const data = categories.map((c) => ({
      id: c.id,
      code: c.code,
      name: c.name,
      parentCode: c.parentCode,
      path: c.path,
      isActive: c.isActive,
      productCount: countByPath.get(c.path.join(' > ')) ?? 0,
      marginPercentOverride:
        c.marginPercentOverride != null ? Number(c.marginPercentOverride) : null,
      extraCostTryOverride:
        c.extraCostTryOverride != null ? Number(c.extraCostTryOverride) : null,
      profitTypeOverride: c.profitTypeOverride ?? null,
      profitTiers: parseTiers(c.profitTiers),
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    }));

    return { success: true, data };
  }

  async setCategoryActive(
    tenantId: string,
    supplierId: string,
    categoryCode: string,
    isActive: boolean,
  ) {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id: supplierId, tenantId },
      select: { id: true },
    });
    if (!supplier) throw new NotFoundException('supplier not found');

    const updated = await this.prisma.supplierCategory.updateMany({
      where: { supplierId, code: categoryCode },
      data: { isActive },
    });
    if (updated.count === 0) {
      throw new NotFoundException('category not found');
    }

    let deactivated = 0;
    if (!isActive) {
      const cat = await this.prisma.supplierCategory.findFirst({
        where: { supplierId, code: categoryCode },
        select: { path: true },
      });
      if (cat && cat.path.length > 0) {
        const escapeLike = (s: string): string =>
          s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
        const pathString = cat.path.join(' > ');
        const pathPrefixPattern = `${escapeLike(pathString)} > %`;
        const result = await this.prisma.$executeRaw`
          UPDATE "Product" p
          SET "active" = false,
              "marketplaceListed" = false,
              "contentHash" = '',
              "updatedAt" = NOW()
          FROM "Category" c
          WHERE p."categoryId" = c."id"
            AND p."tenantId" = ${tenantId}
            AND p."supplierId" = ${supplierId}
            AND p."active" = true
            AND (
              c."path" = ${pathString}
              OR c."path" LIKE ${pathPrefixPattern} ESCAPE '\'
            )
        `;
        deactivated = Number(result);
      }
    }

    return {
      success: true,
      data: { code: categoryCode, isActive, deactivated },
    };
  }

  /**
   * Kategori bazlı fiyatlandırma override'ı ayarlar ve etkilenen ürünleri ANINDA
   * yeniden fiyatlandırır. `setCategoryActive` ile birebir aynı doğrulama deseni:
   *  - tedarikçi + kategori tenant-scoped doğrulanır,
   *  - override alanları BAĞIMSIZ uygulanır: `undefined` = değiştirme,
   *    `null` = globale dön (override kaldır), sayı = override et,
   *  - yalnız bu kategoriye TAM eşleşen (Category.path === kategori yolu) ürünler,
   *    etkin marj/ek-kâr (override ?? tedarikçi global) ile yeniden fiyatlanır.
   *    `recomputePricesForSupplier` ile aynı formül; `manualPrice` EZİLMEZ.
   */
  async setCategoryPricing(
    tenantId: string,
    supplierId: string,
    categoryCode: string,
    overrides: {
      marginPercentOverride?: number | null;
      extraCostTryOverride?: number | null;
      profitTypeOverride?: string | null;
      profitTiers?: unknown;
    },
  ) {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id: supplierId, tenantId },
      select: {
        id: true,
        profitType: true,
        profitMargin: true,
        extraCostTry: true,
        profitTiers: true,
      },
    });
    if (!supplier) throw new NotFoundException('supplier not found');

    const category = await this.prisma.supplierCategory.findFirst({
      where: { supplierId, code: categoryCode },
      select: { id: true, path: true },
    });
    if (!category) throw new NotFoundException('category not found');

    const data: Prisma.SupplierCategoryUpdateInput = {};
    if (overrides.marginPercentOverride !== undefined) {
      data.marginPercentOverride =
        overrides.marginPercentOverride === null
          ? null
          : new Prisma.Decimal(
              Number(overrides.marginPercentOverride).toFixed(4),
            );
    }
    if (overrides.extraCostTryOverride !== undefined) {
      data.extraCostTryOverride =
        overrides.extraCostTryOverride === null
          ? null
          : new Prisma.Decimal(
              Number(overrides.extraCostTryOverride).toFixed(2),
            );
    }
    // Kategori KÂR TİPİ override'ı: 'tiered' → baremleri doğrula+sakla; 'fixed' →
    // sabit override; null → tedarikçiden miras.
    if (overrides.profitTypeOverride !== undefined) {
      data.profitTypeOverride =
        overrides.profitTypeOverride === 'tiered'
          ? 'tiered'
          : overrides.profitTypeOverride === 'fixed'
            ? 'fixed'
            : null;
    }
    if (overrides.profitTypeOverride === 'tiered') {
      const vr = validateTiers(overrides.profitTiers);
      if (!vr.ok) throw new BadRequestException(vr.error ?? 'Geçersiz kâr baremleri.');
      data.profitTiers = vr.tiers as unknown as Prisma.InputJsonValue;
    } else if (overrides.profitTiers !== undefined) {
      data.profitTiers =
        overrides.profitTiers === null
          ? Prisma.JsonNull
          : (parseTiers(overrides.profitTiers) as unknown as Prisma.InputJsonValue);
    }
    if (Object.keys(data).length > 0) {
      await this.prisma.supplierCategory.update({
        where: { id: category.id },
        data,
      });
    }

    // Kalıcı override'ları yeniden oku → TEK KAYNAK motoruyla etkin fiyatlandırma.
    const current = await this.prisma.supplierCategory.findUnique({
      where: { id: category.id },
      select: {
        marginPercentOverride: true,
        extraCostTryOverride: true,
        profitTypeOverride: true,
        profitTiers: true,
      },
    });
    const supplierPricing: SupplierPricingInput = {
      profitType: supplier.profitType,
      profitMargin: supplier.profitMargin,
      extraCostTry: supplier.extraCostTry,
      profitTiers: supplier.profitTiers,
    };
    const categoryInput: CategoryPricingInput = {
      profitTypeOverride: current?.profitTypeOverride ?? null,
      marginPercentOverride: current?.marginPercentOverride ?? null,
      extraCostTryOverride: current?.extraCostTryOverride ?? null,
      profitTiers: current?.profitTiers ?? null,
    };
    const pricing = resolveEffectivePricing(supplierPricing, categoryInput);

    // Yalnız bu kategoriye TAM eşleşen ürünleri yeniden fiyatla (alt kategoriler
    // hariç). manualPrice korunur. fixed → hızlı SQL; tiered → app-code motoru.
    let repriced = 0;
    if (category.path.length > 0) {
      const pathString = category.path.join(' > ');
      if (pricing.type === 'fixed') {
        const result = await this.prisma.$executeRaw`
          UPDATE "Product" p
          SET "feedPrice" = ROUND(
                (p."costPrice" * (1 + (${pricing.margin} / 100.0)))::numeric + ${pricing.extra}::numeric,
                2
              ),
              "price" = CASE
                WHEN p."manualPrice" IS NOT NULL THEN p."manualPrice"
                ELSE ROUND(
                  (p."costPrice" * (1 + (${pricing.margin} / 100.0)))::numeric + ${pricing.extra}::numeric,
                  2
                )
              END,
              "updatedAt" = NOW()
          FROM "Category" c
          WHERE p."categoryId" = c."id"
            AND p."tenantId" = ${tenantId}
            AND p."supplierId" = ${supplierId}
            AND c."path" = ${pathString}
        `;
        repriced = Number(result);
      } else {
        const products = await this.prisma.product.findMany({
          where: { tenantId, supplierId, category: { path: pathString } },
          select: { id: true, costPrice: true, manualPrice: true },
        });
        const updates = products.map((p) => {
          const cost = Number(p.costPrice);
          const feedPrice = computeSalePrice(cost, pricing);
          const price = p.manualPrice != null ? Number(p.manualPrice) : feedPrice;
          return { id: p.id, feedPrice, price };
        });
        repriced = await this.batchUpdatePrices(tenantId, updates);
      }
    }

    this.logger.log(
      `setCategoryPricing supplier=${supplierId} category=${categoryCode} ` +
        `type=${pricing.type} repriced=${repriced}`,
    );

    return {
      success: true,
      data: {
        code: categoryCode,
        marginPercentOverride:
          current?.marginPercentOverride != null
            ? Number(current.marginPercentOverride)
            : null,
        extraCostTryOverride:
          current?.extraCostTryOverride != null
            ? Number(current.extraCostTryOverride)
            : null,
        profitTypeOverride: current?.profitTypeOverride ?? null,
        profitTiers: (current?.profitTiers ?? null) as unknown,
        repriced,
      },
    };
  }

  // ── Product Listing ───────────────────────────────────────────────────────

  async listProducts(
    tenantId: string,
    id: string,
    page = 1,
    pageSize = 50,
    q?: string,
    categoryPath?: string,
    sourceBrand?: string,
  ) {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });
    if (!supplier) throw new NotFoundException('supplier not found');

    const safePage = Math.max(1, page);
    const safeSize = Math.min(200, Math.max(1, pageSize));

    // Tam kategori yolu filtresi (Category.path === categoryPath) — yalnız bu
    // kategoriye TAM eşleşen ürünler; alt kategoriler hariçtir.
    const path = categoryPath?.trim();
    const categoryWhere =
      path && path.length > 0 ? { category: { path } } : {};

    // Marka drill-down: SupplierBrandMapping.sourceBrandName yalnızca
    // Product.sourceBrand (ham XML markası) ile eşleşir — Product.brand değil
    // (ingest her zaman normalize edilmiş markayı yazar). Bu yüzden filtre
    // kaynak markaya göre yapılır.
    const brand = sourceBrand?.trim();
    const brandWhere = brand && brand.length > 0 ? { sourceBrand: brand } : {};

    const term = q?.trim();
    const searchWhere =
      term && term.length > 0
        ? {
            OR: [
              { name: { contains: term, mode: 'insensitive' as const } },
              { externalCode: { contains: term, mode: 'insensitive' as const } },
              { barcode: { contains: term, mode: 'insensitive' as const } },
              { internalCode: { contains: term, mode: 'insensitive' as const } },
              { publicBarcode: { contains: term, mode: 'insensitive' as const } },
            ],
          }
        : {};

    const productSelect = {
      id: true,
      slug: true,
      externalCode: true,
      name: true,
      brand: true,
      costPrice: true,
      price: true,
      currency: true,
      stock: true,
      active: true,
      updatedAt: true,
      images: {
        take: 1,
        select: { url: true },
        orderBy: { position: 'asc' as const },
      },
    };

    const inStockWhere = {
      tenantId,
      supplierId: id,
      stock: { gt: 0 },
      ...categoryWhere,
      ...brandWhere,
      ...searchWhere,
    };
    const outOfStockWhere = {
      tenantId,
      supplierId: id,
      stock: 0,
      ...categoryWhere,
      ...brandWhere,
      ...searchWhere,
    };

    const [inCount, outCount] = await Promise.all([
      this.prisma.product.count({ where: inStockWhere }),
      this.prisma.product.count({ where: outOfStockWhere }),
    ]);
    const total = inCount + outCount;

    const offset = (safePage - 1) * safeSize;
    const inSliceStart = Math.min(offset, inCount);
    const inSliceTake = Math.max(0, Math.min(safeSize, inCount - offset));
    const outSliceStart = Math.max(0, offset - inCount);
    const outSliceTake = safeSize - inSliceTake;

    const [inRows, outRows] = await Promise.all([
      inSliceTake > 0
        ? this.prisma.product.findMany({
            where: inStockWhere,
            orderBy: { updatedAt: 'desc' },
            skip: inSliceStart,
            take: inSliceTake,
            select: productSelect,
          })
        : Promise.resolve([]),
      outSliceTake > 0
        ? this.prisma.product.findMany({
            where: outOfStockWhere,
            orderBy: { updatedAt: 'desc' },
            skip: outSliceStart,
            take: outSliceTake,
            select: productSelect,
          })
        : Promise.resolve([]),
    ]);
    const products = [...inRows, ...outRows];

    return {
      success: true,
      data: products.map((p) => ({
        id: p.id,
        slug: p.slug,
        sku: p.externalCode,
        name: p.name,
        brand: p.brand,
        costPrice: Number(p.costPrice),
        price: Number(p.price),
        currency: p.currency,
        stock: p.stock,
        active: p.active,
        updatedAt: p.updatedAt,
        imageUrl: p.images[0]?.url ?? null,
      })),
      meta: { total, page: safePage, limit: safeSize, totalPages: Math.ceil(total / safeSize) },
    };
  }

  // ── Brand Mappings ────────────────────────────────────────────────────────

  async listBrands(tenantId: string, supplierId: string) {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id: supplierId, tenantId },
      select: { id: true },
    });
    if (!supplier) throw new NotFoundException('supplier not found');

    const [brandRows, mappings] = await Promise.all([
      this.prisma.product.findMany({
        where: { tenantId, supplierId, sourceBrand: { not: null } },
        distinct: ['sourceBrand'],
        select: { sourceBrand: true },
        orderBy: { sourceBrand: 'asc' },
      }),
      this.prisma.supplierBrandMapping.findMany({
        where: { supplierId },
        select: {
          id: true,
          sourceBrandName: true,
          targetBrandName: true,
          hidden: true,
          updatedAt: true,
        },
      }),
    ]);

    const mappingByName = new Map(mappings.map((m) => [m.sourceBrandName, m]));
    const productCountByBrand = await this.countProductsPerBrand(tenantId, supplierId);

    const result: Array<{
      sourceBrandName: string;
      targetBrandName: string | null;
      hidden: boolean;
      productCount: number;
      mappingId: string | null;
      updatedAt: Date | null;
    }> = [];

    const seen = new Set<string>();
    for (const row of brandRows) {
      const name = row.sourceBrand;
      if (!name) continue;
      seen.add(name);
      const m = mappingByName.get(name);
      result.push({
        sourceBrandName: name,
        targetBrandName: m?.targetBrandName ?? null,
        hidden: m?.hidden ?? false,
        productCount: productCountByBrand.get(name) ?? 0,
        mappingId: m?.id ?? null,
        updatedAt: m?.updatedAt ?? null,
      });
    }
    for (const m of mappings) {
      if (seen.has(m.sourceBrandName)) continue;
      result.push({
        sourceBrandName: m.sourceBrandName,
        targetBrandName: m.targetBrandName,
        hidden: m.hidden,
        productCount: 0,
        mappingId: m.id,
        updatedAt: m.updatedAt,
      });
    }

    result.sort((a, b) => a.sourceBrandName.localeCompare(b.sourceBrandName, 'tr'));
    return { success: true, data: result };
  }

  async upsertBrandMappings(tenantId: string, supplierId: string, dto: BrandMappingsBulkDto) {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id: supplierId, tenantId },
      select: { id: true },
    });
    if (!supplier) throw new NotFoundException('supplier not found');

    const ops = dto.mappings.map((m) =>
      this.prisma.supplierBrandMapping.upsert({
        where: {
          supplierId_sourceBrandName: { supplierId, sourceBrandName: m.sourceBrandName },
        },
        update: {
          targetBrandName: m.targetBrandName === undefined ? undefined : m.targetBrandName,
          hidden: m.hidden ?? undefined,
        },
        create: {
          supplierId,
          sourceBrandName: m.sourceBrandName,
          targetBrandName: m.targetBrandName ?? null,
          hidden: m.hidden ?? false,
        },
        select: {
          id: true,
          sourceBrandName: true,
          targetBrandName: true,
          hidden: true,
          updatedAt: true,
        },
      }),
    );

    const updated = await this.prisma.$transaction(ops);
    const recompute = await this.recomputeBrandsForSupplier(tenantId, supplierId);
    return {
      success: true,
      data: updated,
      meta: { updated: updated.length, hidden: recompute.hidden },
    };
  }

  async deleteBrandMapping(tenantId: string, supplierId: string, sourceBrandName: string) {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id: supplierId, tenantId },
      select: { id: true },
    });
    if (!supplier) throw new NotFoundException('supplier not found');

    const result = await this.prisma.supplierBrandMapping.deleteMany({
      where: { supplierId, sourceBrandName },
    });
    if (result.count === 0) {
      throw new NotFoundException('brand mapping not found');
    }

    await this.recomputeBrandsForSupplier(tenantId, supplierId);
    return { success: true, data: { deleted: true } };
  }

  // ── Text Rules (Metin Kuralları) ──────────────────────────────────────────

  /**
   * Bir tedarikçinin metin kurallarını (sil/değiştir) sortOrder sırasıyla
   * döner. Kurallar hem mağaza gösteriminde hem giden XML feed'inde uygulanan
   * ürün adı/açıklaması temizleme tanımlarıdır.
   */
  async listTextRules(tenantId: string, supplierId: string) {
    await this.assertSupplierExists(tenantId, supplierId);

    const rules = await this.prisma.supplierTextRule.findMany({
      where: { supplierId, tenantId },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        search: true,
        replacement: true,
        applyToName: true,
        applyToDescription: true,
        caseInsensitive: true,
        wholeWord: true,
        enabled: true,
        sortOrder: true,
        updatedAt: true,
      },
    });

    return { success: true, data: rules };
  }

  /**
   * Tedarikçinin metin kurallarını bulk olarak değiştirir (eskiyi sil + yeniyi
   * yaz, sortOrder = dizi index'i). Kayıttan sonra TÜM mevcut ürünlere yeniden
   * uygulanması için BullMQ `recompute-text` job'ı kuyruğa atılır — UI bloklanmaz.
   */
  async upsertTextRules(tenantId: string, supplierId: string, dto: TextRulesBulkDto) {
    await this.assertSupplierExists(tenantId, supplierId);

    await this.prisma.$transaction([
      this.prisma.supplierTextRule.deleteMany({ where: { supplierId, tenantId } }),
      this.prisma.supplierTextRule.createMany({
        data: dto.rules.map((r, index) => ({
          supplierId,
          tenantId,
          search: r.search,
          replacement: r.replacement ?? '',
          applyToName: r.applyToName ?? true,
          applyToDescription: r.applyToDescription ?? true,
          caseInsensitive: r.caseInsensitive ?? true,
          wholeWord: r.wholeWord ?? false,
          enabled: r.enabled ?? true,
          sortOrder: index,
        })),
      }),
    ]);

    await this.queue.add(
      RECOMPUTE_TEXT_JOB,
      { supplierId, tenantId },
      { removeOnComplete: 50, removeOnFail: 100 },
    );

    return this.listTextRules(tenantId, supplierId);
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /**
   * Feed'in Redis'teki tekrarlı (repeatable) sync job'ını kaldırır. Feed
   * silindiğinde/pasifleştiğinde zombi repeatable kalmasın diye çağrılır (#13).
   * getRepeatableJobs + removeRepeatableByKey deseni (z-report.scheduler ile
   * aynı) — versiyon-bağımsız ve güvenli eşleştirme. Hata yutulur, admin
   * işlemini bloklamaz.
   */
  private async removeFeedRepeatable(feedId: string): Promise<void> {
    const targetJobId = feedSyncRepeatJobId(feedId);
    try {
      const repeatables = await this.queue.getRepeatableJobs();
      for (const job of repeatables) {
        if (job.name !== 'sync') continue;
        if (job.id !== targetJobId) continue;
        await this.queue.removeRepeatableByKey(job.key);
        this.logger.log(`Removed repeatable feed-sync for feedId=${feedId}`);
      }
    } catch (e) {
      this.logger.warn(
        `removeFeedRepeatable failed feedId=${feedId}: ${(e as Error).message}`,
      );
    }
  }

  private async assertSupplierExists(tenantId: string, supplierId: string): Promise<void> {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id: supplierId, tenantId },
      select: { id: true },
    });
    if (!supplier) throw new NotFoundException('supplier not found');
  }

  private async createFeedRecord(
    tx: { supplierFeed: PrismaService['supplierFeed'] },
    tenantId: string,
    supplierId: string,
    dto: CreateSupplierFeedDto,
  ) {
    const authType = dto.auth?.type ?? SupplierAuthType.NONE;
    const authCredentialsEncrypted =
      typeof dto.auth?.credentials === 'string' && dto.auth.credentials.length > 0
        ? this.vault.seal(dto.auth.credentials)
        : null;

    const exchangeRateValue = dto.exchangeRate != null ? Number(dto.exchangeRate) : null;
    const exchangeRateMarginValue = dto.exchangeRateMargin != null ? Number(dto.exchangeRateMargin) : 0;

    return tx.supplierFeed.create({
      data: {
        supplierId,
        tenantId,
        name: dto.name ?? 'Ana Feed',
        feedUrl: dto.feedUrl,
        authType: toAuthTypeEnum(authType),
        authCredentialsEncrypted,
        refreshIntervalHours: dto.refreshIntervalHours ?? 6,
        ...(dto.feedCurrency !== undefined ? { feedCurrency: dto.feedCurrency } : {}),
        ...(exchangeRateValue !== null && Number.isFinite(exchangeRateValue)
          ? { exchangeRate: new Prisma.Decimal(exchangeRateValue.toFixed(4)) }
          : {}),
        exchangeRateMargin: new Prisma.Decimal(
          (Number.isFinite(exchangeRateMarginValue) ? exchangeRateMarginValue : 0).toFixed(4),
        ),
        active: dto.active ?? true,
      },
      select: FEED_SELECT,
    });
  }

  private async countProductsPerBrand(
    tenantId: string,
    supplierId: string,
  ): Promise<Map<string, number>> {
    const rows = await this.prisma.product.groupBy({
      by: ['sourceBrand'],
      where: { tenantId, supplierId, sourceBrand: { not: null } },
      _count: { _all: true },
    });
    const m = new Map<string, number>();
    for (const r of rows) {
      if (r.sourceBrand) m.set(r.sourceBrand, r._count._all);
    }
    return m;
  }

  private async recomputeBrandsForSupplier(
    tenantId: string,
    supplierId: string,
  ): Promise<{ updated: number; hidden: number }> {
    // 1) Marka adı normalizasyonu — targetBrandName doluysa onu, yoksa ham
    //    sourceBrand'ı `brand` alanına yaz.
    const updated = await this.prisma.$executeRaw`
      UPDATE "Product" p
      SET "brand" = COALESCE(
        (
          SELECT m."targetBrandName"
          FROM "SupplierBrandMapping" m
          WHERE m."supplierId" = p."supplierId"
            AND m."sourceBrandName" = p."sourceBrand"
            AND COALESCE(m."targetBrandName", '') <> ''
        ),
        p."sourceBrand"
      ),
      "updatedAt" = NOW()
      WHERE p."tenantId" = ${tenantId}
        AND p."supplierId" = ${supplierId}
        AND p."sourceBrand" IS NOT NULL
    `;

    // 2) Marka bazlı gizleme (aktif/pasif) — hidden=true markaların TÜM aktif
    //    ürünlerini ANINDA pasifleştir. Bu, kategori bazlı pasifleştirme
    //    (`setCategoryActive`) ile birebir aynı desendir: contentHash='' ile
    //    işaretlenir, böylece marka tekrar görünür yapıldığında bir sonraki feed
    //    sync ürünleri yeniden değerlendirip (finalActive = !hiddenByBrand)
    //    reaktive eder. Reaktivasyon — kategori toggle'ında olduğu gibi — sync'e
    //    bırakılır: active=false'un kaynağı kategori veya minPrice de olabilir,
    //    bu yüzden kör reaktivasyon güvensizdir; tek doğru kaynak sync'tir.
    const hidden = await this.prisma.$executeRaw`
      UPDATE "Product" p
      SET "active" = false,
          "marketplaceListed" = false,
          "contentHash" = '',
          "updatedAt" = NOW()
      FROM "SupplierBrandMapping" m
      WHERE p."supplierId" = m."supplierId"
        AND p."sourceBrand" = m."sourceBrandName"
        AND m."hidden" = true
        AND p."tenantId" = ${tenantId}
        AND p."supplierId" = ${supplierId}
        AND p."active" = true
    `;

    this.logger.log(
      `recomputeBrandsForSupplier supplier=${supplierId} brand=${updated} hidden=${hidden}`,
    );
    return { updated: Number(updated), hidden: Number(hidden) };
  }
}

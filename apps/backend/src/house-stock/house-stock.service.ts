import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Prisma, SupplierLedgerType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { trStartOfMonth } from '../common/utils/tr-time';
import { SupplierAccountService } from '../supplier-account/supplier-account.service';
import type { UpsertHouseStockItemDto } from './dto/upsert-item.dto';
import type { UpdateHouseStockSettingsDto } from './dto/update-settings.dto';
import type { HouseStockOrdersTab } from './dto/orders-query.dto';

const MAX_ROWS_PER_TAB = 500;

type OrderStatusUnion = 'paid' | 'preparing' | 'shipped' | 'cancelled' | 'refunded';

/**
 * Depo — OWNER kendi (ve diğer OWNER'ların) "ev stoku" envanterini
 * yönetir. Müşteri tarafına ASLA sızmaz: tedarikçi/maliyet bilgisi yok,
 * sipariş satırı normal akış gibi görünür ("Hazırlanıyor").
 *
 * Plan v7 garantileri:
 *  - Tatil modu FORWARD-ONLY (yeni paid Order'lar bypass eder, mevcut
 *    reserved kalemler salınmaz)
 *  - Stok güvenliği: stockQty ASLA reservedQty altına düşemez
 *  - Dispatch edilmiş kalem listede KALICI olarak görünür
 *  - Tüm sorgular tenant-bound (RLS dışı kontrol bu katmanda)
 *
 * Product ↔ HouseStockItem ilişkisi FK ile değil, string eşleşmesiyle kuruludur:
 *   HouseStockItem.tbdrCode === Product.internalCode (her ikisi de TBDR-XXXXXX).
 */
@Injectable()
export class HouseStockService {
  private readonly logger = new Logger(HouseStockService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    private readonly notifications?: NotificationsService,
    @Optional()
    private readonly supplierAccount?: SupplierAccountService,
  ) {}

  /**
   * Bir sipariş depodan karşılanmaya/tedarikçiye geri devredilmeye geçtiğinde,
   * o sipariş için daha önce düşülmüş tedarikçi cüzdan tutarını (ORDER_PURCHASE)
   * idempotent biçimde geri ekler. Kural: tedarikçi bakiyesi YALNIZCA tedarikçiden
   * fiilen alınan üründe düşer; depodan giden / geri alınan üründe düşmemeli.
   * ORDER_PURCHASE yoksa / zaten iade edilmişse no-op.
   */
  private async refundSupplierForOrderTx(
    tx: Prisma.TransactionClient,
    orderId: string,
  ): Promise<void> {
    if (!this.supplierAccount) return;
    const purchases = await tx.supplierAccountLedger.findMany({
      where: { orderId, type: SupplierLedgerType.ORDER_PURCHASE },
      select: { supplierId: true, tenantId: true, humanOrderNo: true },
      distinct: ['supplierId'],
    });
    for (const pu of purchases) {
      await this.supplierAccount.refundForOrderTx(tx, {
        supplierId: pu.supplierId,
        tenantId: pu.tenantId,
        orderId,
        humanOrderNo: pu.humanOrderNo,
      });
    }
  }

  // ─────────────────────────── Helpers ────────────────────────────

  private async assertOwnerInTenant(
    ownerId: string,
    tenantId: string,
  ): Promise<void> {
    const target = await this.prisma.user.findUnique({
      where: { id: ownerId },
      select: { id: true, tenantId: true, role: true },
    });
    if (!target || target.tenantId !== tenantId) {
      throw new ForbiddenException('OWNER bulunamadı');
    }
    if (target.role !== 'OWNER') {
      throw new ForbiddenException('Hedef kullanıcı OWNER değil');
    }
  }

  /**
   * FIX #6 — Sahiplik kontrolü: bir siparişin gönderilmiş Depo kalemlerinin
   * TÜMÜ aktöre ait olmalı. Whole-order kuralı gereği tek OWNER'a aittirler;
   * sahip aktör değilse (veya sahip bilgisi eksikse) işlem reddedilir.
   */
  private assertActorOwnsDepotItems(
    items: Array<{ houseStockReservedOwnerId: string | null }>,
    actorId: string,
  ): void {
    for (const it of items) {
      if (it.houseStockReservedOwnerId !== actorId) {
        throw new ForbiddenException(
          'Bu sipariş başka bir deposuna ait — yalnızca depo sahibi işlem yapabilir',
        );
      }
    }
  }

  // ─────────────────────────── Owners ─────────────────────────────

  async listOwners(tenantId: string) {
    return this.prisma.user.findMany({
      where: { tenantId, role: 'OWNER' },
      select: {
        id: true,
        name: true,
        email: true,
        profilePhotoUrl: true,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  // ─────────────────────────── Items ──────────────────────────────

  async listItems(ownerId: string, tenantId: string) {
    await this.assertOwnerInTenant(ownerId, tenantId);

    const items = await this.prisma.houseStockItem.findMany({
      where: { ownerId },
      orderBy: { updatedAt: 'desc' },
    });

    return items.map((it) => ({
      id: it.id,
      tbdrCode: it.tbdrCode,
      productName: it.productName,
      productImage: it.productImage,
      stockQty: it.stockQty,
      reservedQty: it.reservedQty,
      freeQty: Math.max(0, it.stockQty - it.reservedQty),
      note: it.note,
      createdAt: it.createdAt,
      updatedAt: it.updatedAt,
    }));
  }

  /**
   * TBDR bazlı upsert. Yeni satır: Product.internalCode + ilk ProductImage'dan
   * ad/görsel snapshot alınır. Mevcut satır: yalnızca stockQty/note güncellenir
   * (tbdrCode değiştirilmez). Stok güvenliği: stockQty < reservedQty yapılamaz.
   */
  async upsertItem(
    ownerId: string,
    tenantId: string,
    dto: UpsertHouseStockItemDto,
  ) {
    await this.assertOwnerInTenant(ownerId, tenantId);

    const tbdr = dto.tbdrCode.trim().toUpperCase();

    const product = await this.prisma.product.findFirst({
      where: { tenantId, internalCode: tbdr },
      select: {
        name: true,
        images: {
          orderBy: { position: 'asc' },
          take: 1,
          select: { url: true },
        },
      },
    });
    const productImage = product?.images?.[0]?.url ?? null;

    const existing = await this.prisma.houseStockItem.findUnique({
      where: { ownerId_tbdrCode: { ownerId, tbdrCode: tbdr } },
    });

    const isAdd = dto.mode === 'add';

    if (!isAdd && existing && dto.stockQty < existing.reservedQty) {
      throw new ConflictException(
        `Stok ${existing.reservedQty} altına çekilemez — bu kadar rezerve var`,
      );
    }

    return this.prisma.houseStockItem.upsert({
      where: { ownerId_tbdrCode: { ownerId, tbdrCode: tbdr } },
      create: {
        ownerId,
        tbdrCode: tbdr,
        stockQty: dto.stockQty,
        note: dto.note ?? null,
        productName: product?.name ?? null,
        productImage,
      },
      update: {
        stockQty: isAdd ? { increment: dto.stockQty } : dto.stockQty,
        ...(dto.note !== undefined ? { note: dto.note ?? null } : {}),
        productName: existing?.productName ?? product?.name ?? null,
        productImage: existing?.productImage ?? productImage,
      },
    });
  }

  async deleteItem(itemId: string, ownerId: string, tenantId: string) {
    await this.assertOwnerInTenant(ownerId, tenantId);

    const item = await this.prisma.houseStockItem.findUnique({
      where: { id: itemId },
    });
    if (!item || item.ownerId !== ownerId) {
      throw new NotFoundException('Depo kalemi bulunamadı');
    }
    if (item.reservedQty > 0) {
      throw new ConflictException(
        'Rezerve siparişi olan kalem silinemez — önce dispatch / release',
      );
    }

    await this.prisma.houseStockItem.delete({ where: { id: itemId } });
    return { ok: true };
  }

  // ─────────────────────────── Settings ───────────────────────────

  async getSettings(ownerId: string, tenantId: string) {
    await this.assertOwnerInTenant(ownerId, tenantId);

    const existing = await this.prisma.houseStockSettings.findUnique({
      where: { ownerId },
    });
    if (existing) return existing;

    return this.prisma.houseStockSettings.create({
      data: { ownerId, vacationMode: false },
    });
  }

  /**
   * Tatil modu FORWARD-ONLY: aç/kapat. Açıldığında mevcut reserved kalemler
   * SALINMAZ — bunlar OWNER tarafından gönderilmeye devam eder. Yalnızca
   * SONRAKİ paid Order'lar bu OWNER'a rezerve edilmez.
   */
  async updateSettings(
    ownerId: string,
    tenantId: string,
    dto: UpdateHouseStockSettingsDto,
  ) {
    await this.assertOwnerInTenant(ownerId, tenantId);

    const current = await this.getSettings(ownerId, tenantId);
    const goingOn = dto.vacationMode && !current.vacationMode;

    return this.prisma.houseStockSettings.update({
      where: { ownerId },
      data: {
        vacationMode: dto.vacationMode,
        vacationOnAt: goingOn ? new Date() : current.vacationOnAt,
      },
    });
  }

  // ─────────────────────────── Orders (sub-tabs) ──────────────────

  /**
   * 3 sub-tab sorgusu — ORDER-GROUPED. Whole-order kuralı gereği bir siparişin
   * tüm Depo kalemleri tek bir OWNER'a aittir; bu yüzden satırlar artık kalem
   * değil SİPARİŞ bazında döner (kalemler `items[]` içinde gömülü).
   *
   * Sekmeler:
   *  - `bekleyen`     → reservedQty>0 AND dispatchedAt=null AND status ∉ (cancelled,refunded)
   *  - `kargoVerilecek` → dispatchedAt≠null AND status='preparing'
   *  - `kargoVerildi` → dispatchedAt≠null AND status='shipped' (NİHAİ aşama)
   *
   * Müşteri/şehir alanları DÖNMEZ (UI'dan kaldırıldı). Kargo firması/barkodu ve
   * tedarikçi-no ("Depo {ad}") sipariş seviyesinde döner.
   */
  async listOrdersByTab(
    ownerId: string,
    tenantId: string,
    tab: HouseStockOrdersTab,
  ) {
    await this.assertOwnerInTenant(ownerId, tenantId);

    // Per-OWNER deterministic attribution: houseStockReservedOwnerId dispatch
    // sonrası da set kaldığından her sekmede bu OWNER'ın kalemlerini ayıklar.
    let itemStateWhere: Prisma.OrderItemWhereInput;
    let orderStatusWhere: Prisma.OrderWhereInput;

    switch (tab) {
      case 'bekleyen':
        itemStateWhere = {
          houseStockReservedOwnerId: ownerId,
          houseStockReservedQty: { gt: 0 },
          houseStockDispatchedAt: null,
        };
        orderStatusWhere = {
          status: { notIn: ['cancelled', 'refunded'] as OrderStatusUnion[] },
        };
        break;
      case 'kargoVerilecek':
        itemStateWhere = {
          houseStockReservedOwnerId: ownerId,
          houseStockDispatchedAt: { not: null },
        };
        orderStatusWhere = { status: 'preparing' };
        break;
      case 'kargoVerildi':
        itemStateWhere = {
          houseStockReservedOwnerId: ownerId,
          houseStockDispatchedAt: { not: null },
        };
        orderStatusWhere = { status: 'shipped' };
        break;
      default:
        throw new BadRequestException('Geçersiz tab');
    }

    // Aktif sekmedeki sıralama: bekleyen/kargoVerilecek için en eski önce
    // (FIFO worklist), kargoVerildi geçmişi için en yeni önce.
    const orderBy: Prisma.OrderOrderByWithRelationInput =
      tab === 'kargoVerildi' ? { createdAt: 'desc' } : { createdAt: 'asc' };

    const owner = await this.prisma.user.findUnique({
      where: { id: ownerId },
      select: { name: true },
    });
    const ownerName = owner?.name ?? null;
    const depotLabel = `Depo ${this.depotOwnerName(owner?.name)}`;

    const orders = await this.prisma.order.findMany({
      where: {
        tenantId,
        ...orderStatusWhere,
        items: { some: itemStateWhere },
      },
      orderBy,
      take: MAX_ROWS_PER_TAB,
      select: {
        id: true,
        humanOrderNo: true,
        status: true,
        total: true,
        createdAt: true,
        cargoCompany: true,
        cargoBarcode: true,
        supplierOrderNo: true,
        houseStockDispatchedAt: true,
        items: {
          where: itemStateWhere,
          select: {
            id: true,
            productName: true,
            qty: true,
            unitPrice: true,
            houseStockReservedQty: true,
            houseStockReservedUntil: true,
            houseStockDispatchedAt: true,
            houseStockDispatchKind: true,
            product: {
              select: {
                id: true,
                internalCode: true,
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
    });

    const now = new Date();
    return orders.map((o) => {
      const items = o.items.map((it) => ({
        id: it.id,
        productName: it.productName,
        productImage: it.product?.images?.[0]?.url ?? null,
        tbdrCode: it.product?.internalCode ?? null,
        qty: it.qty,
        reservedQty: it.houseStockReservedQty,
        unitPrice: it.unitPrice,
      }));

      const reservedQty = o.items.reduce(
        (s, it) => s + it.houseStockReservedQty,
        0,
      );

      // En erken reservedUntil = en aciliyetli (badge için).
      const reservedUntil = o.items.reduce<Date | null>((min, it) => {
        const d = it.houseStockReservedUntil;
        if (d === null) return min;
        return min === null || d < min ? d : min;
      }, null);

      // İlk dispatch anı (sipariş seviyesi fallback ile).
      const dispatchedAt = o.items.reduce<Date | null>((min, it) => {
        const d = it.houseStockDispatchedAt;
        if (d === null) return min;
        return min === null || d < min ? d : min;
      }, o.houseStockDispatchedAt);

      const dispatchKind =
        o.items.find((it) => it.houseStockDispatchKind)?.houseStockDispatchKind ??
        null;

      return {
        orderId: o.id,
        humanOrderNo: o.humanOrderNo,
        status: o.status,
        total: o.total,
        createdAt: o.createdAt,
        cargoCompany: o.cargoCompany ?? null,
        cargoBarcode: o.cargoBarcode ?? null,
        supplierOrderNo: o.supplierOrderNo ?? null,
        ownerId,
        ownerName,
        depotLabel,
        reservedQty,
        reservedUntil,
        expiringSoon: reservedUntil !== null && reservedUntil <= now,
        dispatchedAt,
        dispatchKind,
        items,
      };
    });
  }

  /**
   * Hesabım menüsündeki kırmızı badge için Bekleyen sayısı. OWNER kendi +
   * diğer OWNER'ların toplamı için iki kez çağrılır.
   */
  async countPendingForOwner(ownerId: string, tenantId: string): Promise<number> {
    await this.assertOwnerInTenant(ownerId, tenantId);

    return this.prisma.orderItem.count({
      where: {
        order: {
          tenantId,
          status: { notIn: ['cancelled', 'refunded'] as OrderStatusUnion[] },
        },
        houseStockReservedOwnerId: ownerId,
        houseStockReservedQty: { gt: 0 },
        houseStockDispatchedAt: null,
      },
    });
  }

  // ─────────────────────────── Sales summary ──────────────────────

  /**
   * Bu ay ve toplam satış tutarı (Order.total payları). Cari mekanizması YOK —
   * sadece görüntü amaçlı log özeti.
   */
  async getSalesSummary(ownerId: string, tenantId: string) {
    await this.assertOwnerInTenant(ownerId, tenantId);

    // Ay başı TR takvimine göre (sunucu UTC olsa bile).
    const monthStart = trStartOfMonth(new Date());

    const [monthAgg, totalAgg] = await Promise.all([
      this.prisma.houseStockSalesLog.aggregate({
        where: { ownerId, dispatchedAt: { gte: monthStart } },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.prisma.houseStockSalesLog.aggregate({
        where: { ownerId },
        _sum: { amount: true },
        _count: { _all: true },
      }),
    ]);

    return {
      monthAmount: monthAgg._sum.amount?.toString() ?? '0',
      monthCount: monthAgg._count._all,
      totalAmount: totalAgg._sum.amount?.toString() ?? '0',
      totalCount: totalAgg._count._all,
    };
  }

  // ─────────────────────────── Public helpers (Phase 4/5/6/7) ─────

  /**
   * OWNER tam adından depo etiketi için ilk adı çıkarır ("Ad Orta Soyad" →
   * "Ad"). Boşsa "Depo" döner. Tedarikçi-no alanına "Depo {ad}"
   * yazmak için kullanılır.
   */
  private depotOwnerName(fullName?: string | null): string {
    const first = (fullName ?? '').trim().split(/\s+/)[0];
    return first || 'Depo';
  }

  /**
   * Phase 4 reservation hook'unun kullandığı yardımcı: bir TBDR için tenant
   * içinde tatil modunda OLMAYAN OWNER'ların depo kalemlerini (free stok
   * azalan sırada) döner. Settings yoksa default vacationMode=false sayılır.
   */
  async findAvailableForReservation(
    tenantId: string,
    tbdrCode: string,
  ): Promise<
    Array<{
      id: string;
      ownerId: string;
      stockQty: number;
      reservedQty: number;
      freeQty: number;
    }>
  > {
    const items = await this.prisma.houseStockItem.findMany({
      where: {
        tbdrCode,
        owner: {
          tenantId,
          role: 'OWNER',
          OR: [
            { houseStockSettings: { is: null } },
            { houseStockSettings: { is: { vacationMode: false } } },
          ],
        },
      },
      select: {
        id: true,
        ownerId: true,
        stockQty: true,
        reservedQty: true,
        updatedAt: true,
      },
    });

    return items
      .map((it) => ({
        id: it.id,
        ownerId: it.ownerId,
        stockQty: it.stockQty,
        reservedQty: it.reservedQty,
        freeQty: Math.max(0, it.stockQty - it.reservedQty),
        updatedAt: it.updatedAt,
      }))
      .filter((it) => it.freeQty > 0)
      .sort((a, b) => {
        if (b.freeQty !== a.freeQty) return b.freeQty - a.freeQty;
        return a.updatedAt.getTime() - b.updatedAt.getTime();
      })
      .map(({ updatedAt: _u, ...rest }) => rest);
  }

  reserveItemInTx(
    tx: Prisma.TransactionClient,
    houseStockItemId: string,
    qty: number,
  ) {
    return tx.houseStockItem.update({
      where: { id: houseStockItemId },
      data: { reservedQty: { increment: qty } },
    });
  }

  /**
   * Depo rezervini KOŞULLU düşürür (race-safe). READ COMMITTED altında iki aktör
   * (örn. OWNER "Tedarikçiye Devret" + 03:00 cron) aynı kalemi aynı anda serbest
   * bırakmaya çalışırsa, kör `decrement` çift düşüm yapardı. `gte: qty` koşulu
   * PostgreSQL'in lock alımında satırı yeniden değerlendirmesini (EvalPlanQual)
   * sağlar: ikinci aktör count=0 alır ve atlar.
   *
   * @returns 1 → düşüldü, 0 → başka aktör zaten serbest bırakmış (atla).
   */
  async releaseItemInTx(
    tx: Prisma.TransactionClient,
    houseStockItemId: string,
    qty: number,
  ): Promise<number> {
    if (qty <= 0) return 0;
    const res = await tx.houseStockItem.updateMany({
      where: { id: houseStockItemId, reservedQty: { gte: qty } },
      data: { reservedQty: { decrement: qty } },
    });
    return res.count;
  }

  async confirmDispatchInTx(
    tx: Prisma.TransactionClient,
    args: {
      houseStockItemId: string;
      qty: number;
      ownerId: string;
      orderId: string;
      amount: Prisma.Decimal;
    },
  ) {
    // Koşullu düşüm: hem raf stoğu hem rezerv yeterliyse düş. Eşzamanlı
    // dispatch/devret durumunda count=0 → ConflictException tüm tx'i geri alır,
    // çift düşüm olmaz.
    const res = await tx.houseStockItem.updateMany({
      where: {
        id: args.houseStockItemId,
        reservedQty: { gte: args.qty },
        stockQty: { gte: args.qty },
      },
      data: {
        stockQty: { decrement: args.qty },
        reservedQty: { decrement: args.qty },
      },
    });
    if (res.count === 0) {
      throw new ConflictException(
        'Depo stoğu/rezervi yetersiz veya eşzamanlı işlem — tekrar dene',
      );
    }
    await tx.houseStockSalesLog.create({
      data: {
        ownerId: args.ownerId,
        orderId: args.orderId,
        quantity: args.qty,
        amount: args.amount,
      },
    });
  }

  // ─────────────────────────── Order-level actions (Plan v8) ──────

  /**
   * Bir siparişin TÜM açık Depo kalemlerini (reservedQty>0, dispatchedAt=null)
   * aktör için yükler ve doğrular. Whole-order kuralı gereği bu kalemlerin
   * hepsi TEK bir OWNER deposuna aittir.
   *
   * Garantiler:
   *  - Sipariş aynı tenant'ta olmalı.
   *  - En az bir açık Depo kalemi olmalı.
   *  - Her kalemin `houseStockReservedOwnerId` + `houseStockItemId` set olmalı.
   *  - Tüm kalemler aynı OWNER'a ait olmalı (whole-order garantisi).
   *  - Rezervasyon sahibi OWNER === işlemi yapan aktör olmalı. Bir OWNER başka
   *    bir OWNER'ın deposundaki siparişe işlem yapamaz (FIX #6 — sahiplik).
   */
  private async loadOrderDepotItemsOrFail(
    orderId: string,
    tenantId: string,
    actorId: string,
  ): Promise<{
    orderId: string;
    orderStatus: OrderStatusUnion;
    orderHouseStockDispatchedAt: Date | null;
    ownerId: string;
    items: Array<{
      id: string;
      reservedQty: number;
      unitPrice: Prisma.Decimal;
      houseStockItemId: string;
    }>;
  }> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId },
      select: {
        id: true,
        status: true,
        houseStockDispatchedAt: true,
        items: {
          where: {
            houseStockReservedQty: { gt: 0 },
            houseStockDispatchedAt: null,
          },
          select: {
            id: true,
            unitPrice: true,
            houseStockReservedQty: true,
            houseStockReservedOwnerId: true,
            houseStockItemId: true,
          },
        },
      },
    });

    if (!order) throw new NotFoundException('Sipariş bulunamadı');
    if (order.items.length === 0) {
      throw new ConflictException('Bu siparişte bekleyen Depo kalemi yok');
    }

    let ownerId: string | null = null;
    const items: Array<{
      id: string;
      reservedQty: number;
      unitPrice: Prisma.Decimal;
      houseStockItemId: string;
    }> = [];
    for (const it of order.items) {
      if (!it.houseStockReservedOwnerId || !it.houseStockItemId) {
        throw new ConflictException(
          'Rezervasyon kaydı eksik — manuel kontrol gerekir',
        );
      }
      if (ownerId === null) ownerId = it.houseStockReservedOwnerId;
      else if (ownerId !== it.houseStockReservedOwnerId) {
        // Whole-order kuralı bozulmuş — iki farklı depoya ait kalemler.
        throw new ConflictException(
          'Sipariş birden fazla depoya ait — manuel kontrol gerekir',
        );
      }
      items.push({
        id: it.id,
        reservedQty: it.houseStockReservedQty,
        unitPrice: it.unitPrice,
        houseStockItemId: it.houseStockItemId,
      });
    }
    if (!ownerId) throw new ConflictException('Rezervasyon sahibi bulunamadı');

    // FIX #6 — Sahiplik: yalnızca rezervasyonun sahibi OWNER bu siparişe işlem
    // yapabilir. Başka bir OWNER'ın deposundaki siparişe müdahale yasak.
    if (ownerId !== actorId) {
      throw new ForbiddenException(
        'Bu sipariş başka bir deposuna ait — yalnızca depo sahibi işlem yapabilir',
      );
    }

    // Stok sahibi OWNER'ı aynı tenant'ta doğrula (defense-in-depth).
    await this.assertOwnerInTenant(ownerId, tenantId);

    return {
      orderId: order.id,
      orderStatus: order.status as OrderStatusUnion,
      orderHouseStockDispatchedAt: order.houseStockDispatchedAt,
      ownerId,
      items,
    };
  }

  /**
   * "Depodan Gönder" — OWNER siparişin tüm Depo kalemlerini kendi
   * evindeki stoktan göndermeyi onaylar (sipariş bazında, geri alınamaz).
   * Tek transaction'da:
   *  - Her kalem için HouseStockItem.stockQty + reservedQty decrement
   *  - Her kalem için HouseStockSalesLog.create (pay = unitPrice × qty)
   *  - Her OrderItem.houseStockDispatchedAt/By/Kind set
   *  - Order.supplierOrderNo = "Depo {OWNER adı}"
   *  - Order.houseStockDispatchedAt ilk set
   *  - Order.status: 'paid' → 'preparing' + statusChangedAt = now
   *
   * Sipariş "Kargoya Verilecek" sekmesine geçer. Müşteri yalnızca
   * "Hazırlanıyor" statüsünü görür.
   */
  async dispatchOrderFromDepot(
    orderId: string,
    actor: { id: string; tenantId: string },
  ): Promise<{ ok: true; orderId: string; dispatchedQty: number }> {
    const target = await this.loadOrderDepotItemsOrFail(
      orderId,
      actor.tenantId,
      actor.id,
    );

    const ownerUser = await this.prisma.user.findUnique({
      where: { id: target.ownerId },
      select: { name: true },
    });
    const depotLabel = `Depo ${this.depotOwnerName(ownerUser?.name)}`;

    const now = new Date();
    const dispatchedQty = target.items.reduce((s, it) => s + it.reservedQty, 0);

    await this.prisma.$transaction(async (tx) => {
      for (const it of target.items) {
        // Re-check her kalemi tx içinde (eşzamanlı devret/dispatch race-safety).
        const fresh = await tx.orderItem.findUnique({
          where: { id: it.id },
          select: {
            houseStockReservedQty: true,
            houseStockDispatchedAt: true,
            houseStockItemId: true,
          },
        });
        if (!fresh) throw new NotFoundException('Sipariş kalemi bulunamadı');
        if (fresh.houseStockDispatchedAt !== null) {
          throw new ConflictException('Bu sipariş zaten Depodan gönderildi');
        }
        if (fresh.houseStockReservedQty <= 0 || !fresh.houseStockItemId) {
          throw new ConflictException(
            'Rezervasyon kaybedilmiş — yeniden dene veya manuel kontrol et',
          );
        }
        if (fresh.houseStockItemId !== it.houseStockItemId) {
          throw new ConflictException(
            'HouseStockItem değişmiş — race tespit edildi',
          );
        }

        const amount = it.unitPrice.mul(new Prisma.Decimal(it.reservedQty));
        await this.confirmDispatchInTx(tx, {
          houseStockItemId: it.houseStockItemId,
          qty: it.reservedQty,
          ownerId: target.ownerId,
          orderId: target.orderId,
          amount,
        });

        await tx.orderItem.update({
          where: { id: it.id },
          data: {
            houseStockDispatchedAt: now,
            houseStockDispatchedByUserId: actor.id,
            houseStockDispatchKind: 'manual',
          },
        });
      }

      // Sipariş-seviyesi alanlar: tedarikçi-no etiketi + ilk gönderim anı.
      await tx.order.update({
        where: { id: target.orderId },
        data: {
          supplierOrderNo: depotLabel,
          ...(target.orderHouseStockDispatchedAt === null
            ? { houseStockDispatchedAt: now }
            : {}),
        },
      });

      // paid → preparing (race-safe). Zaten preparing/shipped ise dokunma.
      if (target.orderStatus === 'paid') {
        await tx.order.updateMany({
          where: { id: target.orderId, status: 'paid' },
          data: { status: 'preparing', statusChangedAt: now },
        });
      }
    });

    this.logger.log(
      `dispatchOrderFromDepot: order=${target.orderId} qty=${dispatchedQty} owner=${target.ownerId} actor=${actor.id} label="${depotLabel}"`,
    );

    return { ok: true, orderId: target.orderId, dispatchedQty };
  }

  /**
   * "Tedarikçiye Devret" (Bekleyen sekmesi) — OWNER siparişi evden
   * gönderemeyeceğini bildirir. Sipariş Depo'dan ÇIKAR; rezervasyonlar
   * serbest bırakılır ve bot normal tedarikçi rotasından temin eder.
   *
   * Tek transaction'da:
   *  - Her kalem için HouseStockItem.reservedQty decrement (stockQty DEĞİŞMEZ —
   *    ürün gönderilmedi, hâlâ rafta)
   *  - Her OrderItem house-stock alanlarını temizle
   *  - Order.hasHouseStockItems = false
   *
   * Sipariş statüsü DEĞİŞMEZ (paid kalır) — bot bir sonraki tick'te alır.
   */
  async transferOrderToSupplier(
    orderId: string,
    actor: { id: string; tenantId: string },
  ): Promise<{ ok: true; orderId: string; releasedQty: number }> {
    const target = await this.loadOrderDepotItemsOrFail(
      orderId,
      actor.tenantId,
      actor.id,
    );

    let releasedQty = 0;

    await this.prisma.$transaction(async (tx) => {
      for (const it of target.items) {
        const fresh = await tx.orderItem.findUnique({
          where: { id: it.id },
          select: {
            houseStockReservedQty: true,
            houseStockDispatchedAt: true,
            houseStockItemId: true,
          },
        });
        if (!fresh) continue;
        if (fresh.houseStockDispatchedAt !== null) {
          throw new ConflictException(
            'Bu sipariş zaten Depodan gönderildi — devredilemez',
          );
        }
        if (fresh.houseStockReservedQty <= 0 || !fresh.houseStockItemId) {
          // Zaten serbest — idempotent davran.
          continue;
        }
        if (fresh.houseStockItemId !== it.houseStockItemId) {
          throw new ConflictException(
            'HouseStockItem değişmiş — race tespit edildi',
          );
        }

        const released = await this.releaseItemInTx(
          tx,
          it.houseStockItemId,
          fresh.houseStockReservedQty,
        );
        // count=0 → başka aktör (örn. 03:00 cron) bu rezervi zaten serbest
        // bırakmış; OrderItem'ı sıfırlamayı ve sayımı atla (idempotent).
        if (released === 0) continue;
        releasedQty += fresh.houseStockReservedQty;

        await tx.orderItem.update({
          where: { id: it.id },
          data: {
            houseStockReservedQty: 0,
            houseStockReservedUntil: null,
            houseStockReservedOwnerId: null,
            houseStockItemId: null,
          },
        });
      }

      // Sipariş Depo'dan çıktı — bayrak temizlenir (bot yeniden alabilir).
      await tx.order.update({
        where: { id: target.orderId },
        data: { hasHouseStockItems: false },
      });
    });

    this.logger.log(
      `transferOrderToSupplier: order=${target.orderId} qty=${releasedQty} owner=${target.ownerId} actor=${actor.id}`,
    );

    return { ok: true, orderId: target.orderId, releasedQty };
  }

  /**
   * "Kargoya Verdim" (Kargoya Verilecek sekmesi) — OWNER ürünü fiziksel olarak
   * kargoya teslim etti. Statü 'preparing' → 'shipped'. NİHAİ aşama.
   *
   * Stok zaten dispatch sırasında düşüldüğü için burada envanter değişmez —
   * yalnızca sipariş statüsü ilerletilir.
   */
  async markOrderShipped(
    orderId: string,
    actor: { id: string; tenantId: string },
  ): Promise<{ ok: true; orderId: string }> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId: actor.tenantId },
      select: {
        id: true,
        status: true,
        houseStockDispatchedAt: true,
        items: {
          where: { houseStockDispatchedAt: { not: null } },
          select: { id: true, houseStockReservedOwnerId: true },
        },
      },
    });
    if (!order) throw new NotFoundException('Sipariş bulunamadı');
    if (order.houseStockDispatchedAt === null || order.items.length === 0) {
      throw new ConflictException('Bu sipariş Depodan gönderilmedi');
    }
    // FIX #6 — Sahiplik: yalnızca depodan gönderen OWNER kargoya verebilir.
    // Dispatch sırasında houseStockReservedOwnerId temizlenmez, bu yüzden
    // her gönderilmiş kalemde sahip bilinir.
    this.assertActorOwnsDepotItems(order.items, actor.id);
    if ((order.status as OrderStatusUnion) === 'shipped') {
      return { ok: true, orderId: order.id }; // idempotent
    }
    if ((order.status as OrderStatusUnion) !== 'preparing') {
      throw new ConflictException(
        `Sipariş statüsü '${order.status}' — kargoya verilemez`,
      );
    }

    const now = new Date();
    const res = await this.prisma.order.updateMany({
      where: { id: order.id, status: 'preparing' },
      data: { status: 'shipped', statusChangedAt: now },
    });
    if (res.count === 0) {
      throw new ConflictException('Sipariş statüsü değişti — yeniden dene');
    }

    this.logger.log(`markOrderShipped: order=${order.id} actor=${actor.id}`);

    return { ok: true, orderId: order.id };
  }

  /**
   * "Gönderimi Sağlayamayacağım Tedarikçiye Devret" (Kargoya Verilecek
   * sekmesi) — OWNER depodan gönderdi ama kargoya veremiyor. Sipariş
   * Depo'dan ÇIKAR ve tedarikçiye devredilir. Kargoya verilmediği için
   * DÜŞÜLEN STOK GERİ EKLENİR (restock).
   *
   * Tek transaction'da:
   *  - Her dispatch edilmiş kalem için HouseStockItem.stockQty GERİ EKLE
   *    (reservedQty dispatch sırasında zaten düşmüştü → dokunma)
   *  - Bu siparişin HouseStockSalesLog kayıtlarını sil
   *  - Her OrderItem house-stock alanlarını TAMAMEN temizle (dispatchedAt dahil)
   *  - Order.status: 'preparing' → 'paid' (bot yeniden alır)
   *  - Order.supplierOrderNo / houseStockDispatchedAt / hasHouseStockItems temizle
   */
  async revertOrderToSupplier(
    orderId: string,
    actor: { id: string; tenantId: string },
  ): Promise<{ ok: true; orderId: string; restockedQty: number }> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId: actor.tenantId },
      select: {
        id: true,
        status: true,
        items: {
          where: { houseStockDispatchedAt: { not: null } },
          select: {
            id: true,
            houseStockReservedQty: true,
            houseStockItemId: true,
            houseStockReservedOwnerId: true,
          },
        },
      },
    });
    if (!order) throw new NotFoundException('Sipariş bulunamadı');
    if (order.items.length === 0) {
      throw new ConflictException('Bu siparişte geri alınacak Depo kalemi yok');
    }
    // FIX #6 — Sahiplik: yalnızca depodan gönderen OWNER tedarikçiye devredebilir.
    this.assertActorOwnsDepotItems(order.items, actor.id);
    if ((order.status as OrderStatusUnion) !== 'preparing') {
      throw new ConflictException(
        `Sipariş statüsü '${order.status}' — yalnızca 'preparing' geri alınabilir`,
      );
    }

    let restockedQty = 0;

    await this.prisma.$transaction(async (tx) => {
      for (const it of order.items) {
        if (!it.houseStockItemId) continue;
        const qty = it.houseStockReservedQty;
        // RESTOCK: kargoya verilmediği için ürün rafa geri döner.
        await tx.houseStockItem.update({
          where: { id: it.houseStockItemId },
          data: { stockQty: { increment: qty } },
        });
        restockedQty += qty;

        await tx.orderItem.update({
          where: { id: it.id },
          data: {
            houseStockReservedQty: 0,
            houseStockReservedUntil: null,
            houseStockReservedOwnerId: null,
            houseStockItemId: null,
            houseStockDispatchedAt: null,
            houseStockDispatchedByUserId: null,
            houseStockDispatchKind: null,
          },
        });
      }

      // Bu siparişin satış log kayıtlarını sil (gönderim iptal edildi).
      await tx.houseStockSalesLog.deleteMany({ where: { orderId: order.id } });

      // preparing → paid (race-safe) — bot yeniden tedarikten alır.
      const res = await tx.order.updateMany({
        where: { id: order.id, status: 'preparing' },
        data: { status: 'paid', statusChangedAt: new Date() },
      });
      if (res.count === 0) {
        throw new ConflictException('Sipariş statüsü değişti — yeniden dene');
      }

      // Sipariş-seviyesi Depo izlerini temizle (bot yeniden alabilsin).
      await tx.order.update({
        where: { id: order.id },
        data: {
          supplierOrderNo: null,
          houseStockDispatchedAt: null,
          hasHouseStockItems: false,
        },
      });

      // Tedarikçiye geri-devir → daha önce düşülmüş tedarikçi tutarını iade et
      // (idempotent). Sipariş yeniden tedarikten alınınca taze düşüm yapılır,
      // böylece çift-düşüm olmaz ve bakiye düşük kalmaz.
      await this.refundSupplierForOrderTx(tx, order.id);
    });

    this.logger.log(
      `revertOrderToSupplier: order=${order.id} restocked=${restockedQty} actor=${actor.id}`,
    );

    return { ok: true, orderId: order.id, restockedQty };
  }

  // ─────────────────────────── 03:00 oto-devir (cron) ─────────────

  /**
   * 03:00 OTO-DEVİR — gün içinde hiçbir OWNER tarafından aksiyon alınmamış,
   * hâlâ "Bekleyen" sekmesinde duran siparişleri otomatik tedarikçiye devreder.
   *
   * Bu bir SİSTEM aksiyonudur: FIX #6 sahiplik kontrolü UYGULANMAZ (o yalnızca
   * kullanıcı butonları içindir). Tüm tenant'larda global çalışır.
   *
   * KAPSAM — yalnızca TAM olarak "Bekleyen" (asla başka sekme):
   *  - OrderItem.houseStockReservedQty > 0
   *  - OrderItem.houseStockDispatchedAt = null  → dispatch edilmiş kalemler
   *    "Kargoya Verilecek" sekmesindedir; ASLA dokunulmaz (tekrar-satın-alma
   *    riski yok — sahibi zaten fiziksel olarak gönderecek).
   *  - Order.status = 'paid'  → dispatch sonrası 'preparing' olur, kapsam dışı.
   *
   * Sonuç (kullanıcı "Tedarikçiye Devret" ile birebir aynı):
   *  - HouseStockItem.reservedQty decrement (stockQty DEĞİŞMEZ — ürün rafta)
   *  - OrderItem house-stock alanları temizlenir
   *  - Order.hasHouseStockItems = false → bot bir sonraki tick'te temin eder
   *  - Order.status DEĞİŞMEZ (paid kalır)
   */
  async autoTransferStalePendingToSupplier(): Promise<{
    orders: number;
    releasedQty: number;
  }> {
    const pendingItems = await this.prisma.orderItem.findMany({
      where: {
        houseStockReservedQty: { gt: 0 },
        houseStockDispatchedAt: null,
        order: { status: 'paid' },
      },
      select: { orderId: true },
    });
    const orderIds = Array.from(new Set(pendingItems.map((i) => i.orderId)));
    if (orderIds.length === 0) return { orders: 0, releasedQty: 0 };

    let processedOrders = 0;
    let totalReleased = 0;

    for (const orderId of orderIds) {
      try {
        const released = await this.autoTransferOneOrderToSupplier(orderId);
        if (released > 0) {
          processedOrders += 1;
          totalReleased += released;
        }
      } catch (err) {
        this.logger.error(
          `autoTransfer order=${orderId} başarısız: ${(err as Error).message}`,
        );
      }
    }

    this.logger.log(
      `autoTransferStalePendingToSupplier: orders=${processedOrders} releasedQty=${totalReleased}`,
    );
    return { orders: processedOrders, releasedQty: totalReleased };
  }

  /**
   * Tek bir siparişin bekleyen Depo kalemlerini serbest bırakır (sistem
   * aksiyonu, sahiplik kontrolü yok). Race-safe: kalemler tx içinde tazelenir;
   * dispatch edilmiş (dispatchedAt≠null) kalem ATLANIR — yalnızca gerçekten
   * bekleyen kalemler devredilir.
   */
  private async autoTransferOneOrderToSupplier(
    orderId: string,
  ): Promise<number> {
    let releasedQty = 0;

    await this.prisma.$transaction(async (tx) => {
      const items = await tx.orderItem.findMany({
        where: {
          orderId,
          houseStockReservedQty: { gt: 0 },
          houseStockDispatchedAt: null,
        },
        select: {
          id: true,
          houseStockReservedQty: true,
          houseStockItemId: true,
        },
      });

      for (const it of items) {
        if (it.houseStockReservedQty <= 0 || !it.houseStockItemId) continue;
        const released = await this.releaseItemInTx(
          tx,
          it.houseStockItemId,
          it.houseStockReservedQty,
        );
        // count=0 → OWNER "Tedarikçiye Devret" ile aynı anda serbest bırakmış;
        // çift düşümü önlemek için OrderItem sıfırlamayı atla (idempotent).
        if (released === 0) continue;
        releasedQty += it.houseStockReservedQty;

        await tx.orderItem.update({
          where: { id: it.id },
          data: {
            houseStockReservedQty: 0,
            houseStockReservedUntil: null,
            houseStockReservedOwnerId: null,
            houseStockItemId: null,
          },
        });
      }

      // Siparişte hâlâ rezerve kalem kalmadıysa Depo bayrağını temizle
      // (dispatch edilmiş kalemler reservedQty>0 tutar → onlara dokunmuyoruz).
      const remaining = await tx.orderItem.count({
        where: { orderId, houseStockReservedQty: { gt: 0 } },
      });
      if (remaining === 0) {
        await tx.order.updateMany({
          where: { id: orderId, hasHouseStockItems: true },
          data: { hasHouseStockItems: false },
        });
      }

      // Oto-devir: depodan tedarikçiye geçen sipariş için daha önce düşülmüş
      // tedarikçi tutarını iade et (idempotent — rezerve-ama-düşülmemiş kalemde
      // no-op; gerçek bir düşüm varsa geri eklenir).
      await this.refundSupplierForOrderTx(tx, orderId);
    });

    return releasedQty;
  }

  // ─────────────────────────── Reservation (Phase 4) ──────────────

  /**
   * Order paid hook → siparişin TAMAMINI tek bir OWNER deposundan
   * karşılayabiliyorsak Depo'ya alır; aksi halde hiç dokunmaz (bot
   * normal tedarikçi rotasından temin eder).
   *
   * WHOLE-ORDER SINGLE-DEPOT (ya hep ya hiç):
   *  - Siparişteki TÜM tedarikçi kalemleri (fulfillmentSource='supplier') TEK
   *    bir OWNER'ın deposundan TAM karşılanabiliyorsa o OWNER'a rezerve edilir.
   *  - Kalemler depolara bölünüyorsa veya tek depo hepsini karşılayamıyorsa
   *    HİÇBİRİ rezerve edilmez — sipariş bütün olarak tedarikçiye gider.
   *    (Eski mantık kalem-bazlıydı; bu split-kargo/çift-takip kaosuna yol
   *    açıyordu.)
   *
   * Garantiler:
   *  - Idempotent: `hasHouseStockItems` zaten true ise dokunmaz.
   *  - Sadece `fulfillmentSource = 'supplier'` kalemler.
   *  - Bir kalemin internalCode'u yoksa depodan karşılanamaz → sipariş bütün
   *    olarak tedarikçiye gider.
   *  - Hata fail-isolated: orders flow'unu bozmaz (orders.service .catch loglar).
   */
  async reserveForOrder(orderId: string, tenantId: string): Promise<void> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId, status: 'paid' },
      select: {
        id: true,
        hasHouseStockItems: true,
        items: {
          where: {
            fulfillmentSource: 'supplier',
            productId: { not: null },
          },
          select: {
            id: true,
            qty: true,
            houseStockReservedQty: true,
            product: { select: { internalCode: true } },
          },
        },
      },
    });
    if (!order) return;
    // Idempotent: sipariş zaten Depo'ya alınmış.
    if (order.hasHouseStockItems) return;
    if (order.items.length === 0) return;
    // Herhangi bir kalem zaten rezerve ise (beklenmedik durum) dokunma.
    if (order.items.some((it) => it.houseStockReservedQty > 0)) return;

    // 1) Gerekli TBDR → toplam adet. Bir kalemde internalCode yoksa whole-order
    //    karşılanamaz → tümüyle vazgeç.
    const requiredByTbdr = new Map<string, number>();
    for (const it of order.items) {
      const tbdr = it.product?.internalCode;
      if (!tbdr) return;
      requiredByTbdr.set(tbdr, (requiredByTbdr.get(tbdr) ?? 0) + it.qty);
    }

    // 2) Her TBDR için OWNER bazında en bol free-stok satırını derle.
    //    byOwner: ownerId → (tbdr → {itemId, freeQty})
    const byOwner = new Map<string, Map<string, { itemId: string; freeQty: number }>>();
    for (const tbdr of requiredByTbdr.keys()) {
      const candidates = await this.findAvailableForReservation(tenantId, tbdr);
      for (const c of candidates) {
        let ownerMap = byOwner.get(c.ownerId);
        if (!ownerMap) {
          ownerMap = new Map();
          byOwner.set(c.ownerId, ownerMap);
        }
        const existing = ownerMap.get(tbdr);
        if (!existing || c.freeQty > existing.freeQty) {
          ownerMap.set(tbdr, { itemId: c.id, freeQty: c.freeQty });
        }
      }
    }
    if (byOwner.size === 0) return;

    // 3) Tüm TBDR'leri TAM karşılayan ilk OWNER'ı seç (createdAt asc — kıdem).
    const ownerIds = Array.from(byOwner.keys());
    const owners = await this.prisma.user.findMany({
      where: { id: { in: ownerIds } },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });

    let chosenOwnerId: string | null = null;
    let chosenByTbdr: Map<string, string> | null = null; // tbdr → houseStockItemId
    for (const o of owners) {
      const ownerMap = byOwner.get(o.id);
      if (!ownerMap) continue;
      const picks = new Map<string, string>();
      let covers = true;
      for (const [tbdr, needed] of requiredByTbdr) {
        const row = ownerMap.get(tbdr);
        if (!row || row.freeQty < needed) {
          covers = false;
          break;
        }
        picks.set(tbdr, row.itemId);
      }
      if (covers) {
        chosenOwnerId = o.id;
        chosenByTbdr = picks;
        break;
      }
    }
    if (!chosenOwnerId || !chosenByTbdr) return;

    // 4) Atomik rezervasyon — tx içinde her TBDR free-stok yeniden doğrulanır;
    //    biri yetmezse THROW ile tüm tx geri alınır (all-or-nothing).
    try {
      await this.prisma.$transaction(async (tx) => {
        for (const [tbdr, needed] of requiredByTbdr) {
          const itemId = chosenByTbdr!.get(tbdr)!;
          const fresh = await tx.houseStockItem.findUnique({
            where: { id: itemId },
            select: { stockQty: true, reservedQty: true },
          });
          if (!fresh) throw new Error(`houseStockItem ${itemId} kayboldu`);
          const freshFree = Math.max(0, fresh.stockQty - fresh.reservedQty);
          if (freshFree < needed) {
            throw new Error(`yetersiz free stok tbdr=${tbdr} (${freshFree}<${needed})`);
          }
          await this.reserveItemInTx(tx, itemId, needed);
        }

        // Her OrderItem'a kendi TBDR'sinin seçilen houseStockItem'ını bağla.
        for (const it of order.items) {
          const tbdr = it.product!.internalCode!;
          const itemId = chosenByTbdr!.get(tbdr)!;
          await tx.orderItem.update({
            where: { id: it.id },
            data: {
              houseStockReservedQty: it.qty,
              // Rezervasyon SÜRESİZ tutulur — zaman bazlı release/expiry yok.
              // Yalnızca kullanıcının açık butonu (dispatch/transfer/revert)
              // rezervasyonu kaldırır. Bkz. GUARANTEE #3.
              houseStockReservedUntil: null,
              houseStockReservedOwnerId: chosenOwnerId!,
              houseStockItemId: itemId,
            },
          });
        }

        await tx.order.update({
          where: { id: order.id },
          data: { hasHouseStockItems: true },
        });
      });
    } catch (err) {
      this.logger.warn(
        `reserveForOrder: order=${orderId} owner=${chosenOwnerId} skipped — ${(err as Error).message}`,
      );
      return;
    }

    // OWNER bildirimi: tek depo, tek bildirim. Müşteri/tedarikçi sızdırılmaz.
    if (this.notifications) {
      await this.emitReservedNotifications(orderId, new Set([chosenOwnerId]));
    }
  }

  /**
   * Etkilenen her OWNER'a "yeni Depo siparişi var" bildirimi yayar. Best-effort:
   * herhangi bir kanal başarısız olursa rezervasyon flow'u etkilenmez.
   *
   * Bildirim içeriği müşteri/tedarikçi alanlarından arındırılmıştır:
   *  - title: kısa
   *  - body: yalnızca sipariş numarası ve toplam
   *  - link: admin paneli Depo "Bekleyen" sekmesine
   */
  private async emitReservedNotifications(
    orderId: string,
    ownerIds: Set<string>,
  ): Promise<void> {
    if (!this.notifications) return;
    try {
      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        select: { humanOrderNo: true },
      });
      const orderNumber = order?.humanOrderNo ?? orderId;
      const link = `/admin/house-stock?tab=pending`;
      await Promise.allSettled(
        Array.from(ownerIds).map((ownerId) =>
          this.notifications!.emit({
            type: 'house_stock.reserved',
            severity: 'info',
            title: 'Yeni Depo siparişi',
            body: `Sipariş #${orderNumber} sizin Depo stokunuza ayrıldı — Bekleyen sekmesine bakın.`,
            link,
            audience: { userId: ownerId },
            data: { orderId, orderNumber },
          }),
        ),
      );
    } catch (err) {
      this.logger.warn(
        `emitReservedNotifications failed order=${orderId}: ${(err as Error).message}`,
      );
    }
  }
}

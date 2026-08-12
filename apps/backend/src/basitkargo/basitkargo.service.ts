import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AdminNotifierService } from '../mail/admin-notifier.service';
import { HouseStockService } from '../house-stock/house-stock.service';
import { BasitKargoClient } from './basitkargo.client';
import { BasitKargoConfigService } from './basitkargo.config.service';
import {
  BASITKARGO_SHIPPED_STATUSES,
  OUR_CARRIER_TO_BASITKARGO,
} from './basitkargo.constants';
import {
  BkCreateOrderRequest,
  BkLocation,
  BkOrder,
  bkWebhookSchema,
  concreteHandlerFromCode,
  extractHandlerCode,
  extractShipmentCode,
} from './basitkargo.types';

/** Basit Kargo `client` (alıcı) alanları için sipariş projeksiyonu. */
const ORDER_SELECT = {
  id: true,
  tenantId: true,
  marketplace: true,
  status: true,
  humanOrderNo: true,
  customerName: true,
  customerPhone: true,
  addressCity: true,
  shippingDistrict: true,
  addressLine1: true,
  basitKargoOrderId: true,
  basitKargoStatus: true,
  cargoBarcode: true,
  items: {
    select: {
      productName: true,
      qty: true,
      product: {
        select: {
          externalCode: true,
          supplier: { select: { id: true, mandatoryCarriers: true } },
        },
      },
    },
  },
} as const;

type OrderForShipment = {
  id: string;
  tenantId: string;
  marketplace: string | null;
  status: string;
  humanOrderNo: string;
  customerName: string;
  customerPhone: string;
  addressCity: string;
  shippingDistrict: string | null;
  addressLine1: string;
  basitKargoOrderId: string | null;
  basitKargoStatus: string | null;
  cargoBarcode: string | null;
  items: Array<{
    productName: string;
    qty: number;
    product: {
      externalCode: string | null;
      supplier: { id: string; mandatoryCarriers: string[] } | null;
    } | null;
  }>;
};

/**
 * "Kendim İçin" (self) sipariş kargo otomasyonunun motoru.
 *
 *  - `fulfillSelfOrder`: paid-hook + retry cron çağırır → barkod üret, sonra
 *    tedarikçi oto-alım akışına sok.
 *  - `ensureShipmentForOrder`: idempotent Basit Kargo sipariş+barkod üretimi.
 *  - `handleWebhook`: durum değişikliğinde firma/takip no tazele + `shipped` geç.
 */
@Injectable()
export class BasitKargoService {
  private readonly logger = new Logger(BasitKargoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: BasitKargoConfigService,
    private readonly client: BasitKargoClient,
    private readonly houseStock: HouseStockService,
    private readonly adminNotifier: AdminNotifierService,
  ) {}

  // ──────────────────────────────────────────────────────────────────────
  //  Sipariş akışı
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Paid-hook'tan (cari/kart) ve retry cron'dan çağrılır. Barkod üretimi
   * BAŞARILIYSA depo rezervi + tedarikçi oto-alım tetiklenir. Başarısızsa
   * route EDİLMEZ (barkodsuz dispatch olmaz) — retry cron toplar. Ödeme
   * ASLA bozulmaz (çağıran fire-and-forget).
   */
  async fulfillSelfOrder(
    orderId: string,
    tenantId: string,
    /** Admin failure maili yalnız İLK denemede (paid-hook) gönderilir; retry
     * cron `false` geçer → bildirim fırtınası olmaz (aynı poison sipariş için
     * 10 dk'da bir mail yağmuru engellenir). */
    notify = true,
  ): Promise<void> {
    let hasBarcode = false;
    try {
      hasBarcode = await this.ensureShipmentForOrder(orderId);
    } catch (err) {
      this.logger.error(
        `BasitKargo self shipment failed (order=${orderId}): ${(err as Error).message}`,
      );
      if (notify) void this.notifyFailure(orderId, (err as Error).message);
      return;
    }
    if (!hasBarcode) {
      // Entegrasyon kapalı / henüz barkod yok → depo rezervi yapma, cron tekrar dener.
      return;
    }
    // Barkod hazır → mevcut fulfillment makinesi (self-DIŞI ile birebir).
    try {
      await this.houseStock.reserveForOrder(orderId, tenantId);
    } catch (e) {
      this.logger.warn(
        `house-stock reserveForOrder failed (order=${orderId}): ${(e as Error).message}`,
      );
    }
  }

  /**
   * Idempotent Basit Kargo sipariş+barkod üretimi.
   *   - Order zaten `basitKargoOrderId` taşıyorsa yeniden POST YAPMAZ, sadece
   *     GET /v2/order/{id} ile firma/barkod/takip no'yu tazeler.
   *   - Yoksa POST /v2/order/barcode ile üretir, id'yi hemen kaydeder (çift
   *     üretim önleme), sonra detayla zenginleştirir.
   * Dönen: barkod dolu mu (route edilebilir mi).
   */
  async ensureShipmentForOrder(orderId: string): Promise<boolean> {
    if (!(await this.config.isEnabled())) {
      this.logger.warn('BasitKargo disabled (token/setting) — self shipment skipped');
      return false;
    }
    const order = (await this.prisma.order.findUnique({
      where: { id: orderId },
      select: ORDER_SELECT,
    })) as OrderForShipment | null;
    if (!order) throw new NotFoundException(`order ${orderId} not found`);
    if ((order.marketplace ?? '').trim() !== 'self') {
      // Yalnız "Kendim İçin" siparişler — güvenlik guard'ı.
      return false;
    }

    let bkOrderId = order.basitKargoOrderId;
    let storedBarcode = order.cargoBarcode;

    // ÇİFT SİPARİŞ KORUMASI: Bir önceki deneme Basit Kargo'da GERÇEKTEN sipariş
    // açmış ama HTTP yanıtı kaybolmuşsa (timeout/5xx → 'FAILED' işaretlendi ama
    // id kaydedilemedi), yeniden POST etmek İKİNCİ (faturalı) bir etiket üretir.
    // Bu yüzden retry'de (status='FAILED') POST'tan ÖNCE Basit Kargo'yu code ile
    // sorgulayıp varsa mevcut siparişi SAHİPLENİRİZ (idempotent). İlk denemede
    // (status='PENDING') bu adım atlanır — gereksiz sorgu yok.
    if (!bkOrderId && (order.basitKargoStatus ?? '').toUpperCase() === 'FAILED') {
      try {
        const existing = await this.findBkOrderByCode(order.humanOrderNo);
        if (existing) {
          bkOrderId = existing.id;
          storedBarcode = existing.barcode?.trim() || storedBarcode;
          await this.prisma.order.update({
            where: { id: orderId },
            data: {
              basitKargoOrderId: existing.id,
              basitKargoStatus: (existing.status ?? 'NEW').toUpperCase(),
              cargoBarcode: existing.barcode?.trim() || undefined,
            },
          });
          this.logger.warn(
            `BasitKargo reconcile: mevcut sipariş sahiplenildi (order=${order.humanOrderNo} bkId=${existing.id}) — çift POST önlendi`,
          );
        }
      } catch (e) {
        this.logger.warn(
          `BasitKargo reconcile lookup failed (order=${order.humanOrderNo}): ${(e as Error).message}`,
        );
      }
    }

    if (!bkOrderId) {
      const client = this.buildClient(order);
      const req: BkCreateOrderRequest = {
        handlerCode: await this.resolveHandlerCode(order),
        type: 'OUTGOING',
        content: await this.buildContent(order),
        client,
      };
      let created: BkOrder;
      try {
        created = await this.client.createOrderWithBarcode(req);
      } catch (err) {
        await this.markStatus(orderId, 'FAILED');
        throw err;
      }
      bkOrderId = created.id;
      storedBarcode = created.barcode?.trim() || storedBarcode;
      // id'yi HEMEN kaydet — sonraki GET/route başarısız olsa da çift POST olmaz.
      await this.prisma.order.update({
        where: { id: orderId },
        data: {
          basitKargoOrderId: bkOrderId,
          basitKargoStatus: (created.status ?? 'NEW').toUpperCase(),
          cargoBarcode: created.barcode?.trim() || undefined,
        },
      });
    }

    // Firma + takip no + güncel durum için detayı çek (ECONOMIC firmayı burada öğreniriz).
    let detail: BkOrder;
    try {
      detail = await this.client.getOrder(bkOrderId);
    } catch (err) {
      // Barkod POST yanıtından geldiyse yine de route edilebilir.
      const row = await this.prisma.order.findUnique({
        where: { id: orderId },
        select: { cargoBarcode: true },
      });
      if (row?.cargoBarcode) return true;
      await this.markStatus(orderId, 'FAILED');
      throw err;
    }

    const barcode = detail.barcode?.trim() || storedBarcode || null;
    const handler =
      extractHandlerCode(detail) ??
      concreteHandlerFromCode(await this.resolveHandlerCode(order));
    const shipmentCode = extractShipmentCode(detail);

    await this.prisma.order.update({
      where: { id: orderId },
      data: {
        cargoBarcode: barcode ?? undefined,
        cargoCompany: handler ?? undefined,
        trackingNumber: shipmentCode ?? undefined,
        basitKargoStatus: (detail.status ?? 'CREATED').toUpperCase(),
      },
    });

    if (!barcode) {
      // Basit Kargo siparişi kabul etti (2xx) ama barkod YOK. validationFailed
      // (ör. adres doğrulanamadı) KALICI hatadır → terminal işaretle + admin'e
      // BİR KEZ haber ver (bayi ödedi, 3 gün sessizce beklemesin). Aksi halde
      // geçici pending → cron tekrar dener (id saklı, çift üretim yok).
      const permanent =
        detail.validationFailed === true ||
        (detail.status ?? '').toUpperCase() === 'FAILED';
      if (permanent) {
        // VALIDATION_FAILED, BASITKARGO_PENDING_STATUSES'te YOK → cron artık
        // toplamaz, bildirim tek sefer gider.
        await this.markStatus(orderId, 'VALIDATION_FAILED');
        void this.notifyFailure(
          orderId,
          `Basit Kargo barkod üretemedi (validationFailed, status=${detail.status ?? '?'}) — adres/hesap kontrol edin`,
        );
      }
      this.logger.warn(
        `BasitKargo order ${bkOrderId} has no barcode yet (order=${order.humanOrderNo}, permanent=${permanent})`,
      );
      return false;
    }
    this.logger.log(
      `BasitKargo shipment ready #${order.humanOrderNo}: bkId=${bkOrderId} barcode=${barcode} handler=${handler ?? '?'}`,
    );
    return true;
  }

  /**
   * Sipariş kalemleri → tedarikçi `mandatoryCarriers` kesişimi. Zorunlu firma
   * varsa Basit Kargo koduna eşlenir; yoksa (veya eşlenemezse) handler stratejisi
   * (ECONOMIC/FAST/sabit) kullanılır.
   */
  async resolveHandlerCode(order: OrderForShipment): Promise<string> {
    const strategy = await this.config.getHandlerStrategy();
    const lists: string[][] = [];
    const seen = new Set<string>();
    for (const it of order.items) {
      const sup = it.product?.supplier;
      if (!sup || seen.has(sup.id)) continue;
      seen.add(sup.id);
      const list = (sup.mandatoryCarriers ?? [])
        .map((c) => c.trim().toLowerCase())
        .filter((c) => c.length > 0);
      if (list.length > 0) lists.push(list);
    }
    if (lists.length > 0) {
      const intersection = lists.reduce<string[]>(
        (acc, list, idx) =>
          idx === 0 ? [...list] : acc.filter((c) => list.includes(c)),
        [],
      );
      for (const c of intersection) {
        const bk = OUR_CARRIER_TO_BASITKARGO[c];
        if (bk) return bk; // zorunlu kargo ECONOMIC'e tercih edilir
      }
    }
    return strategy;
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Webhook
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Durum Değişikliği webhook'u — firma/takip no tazele, `SHIPPED`+ durumda
   * siparişi `shipped`+`shippedAt` işaretle. Idempotent (tekrar gelirse no-op).
   */
  async handleWebhook(rawPayload: unknown): Promise<{ matched: boolean }> {
    const payload = bkWebhookSchema.parse(rawPayload);
    const bkId = payload.id?.trim() || null;
    const barcode = payload.barcode?.trim() || null;
    if (!bkId && !barcode) return { matched: false };

    // id ile eşleşme birincil. barcode fallback'i YALNIZ self siparişlere
    // kapsanır: cargoBarcode paylaşılan kolon (self-DIŞI'nda bayinin girdiği
    // takip barkodu) → barkod çakışması yanlışlıkla self-DIŞI bir siparişi
    // 'shipped'e çevirmesin.
    const order = await this.prisma.order.findFirst({
      where: bkId
        ? { basitKargoOrderId: bkId }
        : { marketplace: 'self', cargoBarcode: barcode ?? undefined },
      select: { id: true, status: true, shippedAt: true, humanOrderNo: true },
    });
    if (!order) {
      this.logger.warn(
        `BasitKargo webhook: order not found (id=${bkId ?? '-'} barcode=${barcode ?? '-'})`,
      );
      return { matched: false };
    }

    const status = (payload.status ?? '').trim().toUpperCase();
    const handler = extractHandlerCode(payload);
    const shipmentCode = extractShipmentCode(payload);

    const data: Prisma.OrderUpdateInput = {
      basitKargoStatus: status || undefined,
    };
    if (handler) data.cargoCompany = handler;
    if (shipmentCode) data.trackingNumber = shipmentCode;

    const shouldShip =
      BASITKARGO_SHIPPED_STATUSES.has(status) &&
      (order.status === 'paid' || order.status === 'preparing');
    if (shouldShip) {
      data.status = 'shipped';
      data.statusChangedAt = new Date();
      // shippedAt = konsolide fatura kesim uygunluğunun kaynağı — yalnız boşsa yaz.
      if (order.shippedAt === null) data.shippedAt = new Date();
    }

    await this.prisma.order.update({ where: { id: order.id }, data });
    this.logger.log(
      `BasitKargo webhook #${order.humanOrderNo}: status=${status}${shouldShip ? ' → shipped' : ''} handler=${handler ?? '-'}`,
    );
    return { matched: true };
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Konum proxy (frontend açılır menüleri)
  // ──────────────────────────────────────────────────────────────────────

  private citiesCache: { at: number; data: BkLocation[] } | null = null;

  async getCities(): Promise<BkLocation[]> {
    const now = Date.now();
    if (this.citiesCache && now - this.citiesCache.at < 24 * 60 * 60 * 1000) {
      return this.citiesCache.data;
    }
    // ÖNEMLİ: şehir kaydında `id` (geo id, ör. 2148) ile `iso2` (PLAKA, ör. 74)
    // FARKLIDIR ve ilçe ucu (/city/{id}/towns) PLAKA ister. Bu yüzden
    // location.id olarak iso2'yi döndürürüz → frontend cityId=plaka ile ilçe çeker.
    const data = normalizeCities(await this.client.listCities());
    if (data.length > 0) this.citiesCache = { at: now, data };
    return data;
  }

  async getTowns(cityId: string): Promise<BkLocation[]> {
    return normalizeLocations(await this.client.listTowns(cityId));
  }

  async getNeighborhoods(
    cityName: string,
    townName: string,
  ): Promise<BkLocation[]> {
    return normalizeNeighborhoods(
      await this.client.listNeighborhoods(cityName, townName),
    );
  }

  async getLabelSvg(orderId: string): Promise<string | null> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { basitKargoOrderId: true },
    });
    if (!order?.basitKargoOrderId) return null;
    return this.client.getLabelSvg(order.basitKargoOrderId);
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Yardımcılar
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Basit Kargo'da content.code == humanOrderNo olan mevcut siparişi bulur
   * (son 4 gün penceresi). Reconcile (çift-POST önleme) için. content.code
   * sipariş başına benzersizdir (buildContent). Bulunamazsa null.
   */
  private async findBkOrderByCode(code: string): Promise<BkOrder | null> {
    const now = new Date();
    const start = new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000);
    const fmt = (d: Date) => d.toISOString().slice(0, 19);
    const list = await this.client.filterOrders({
      startDate: fmt(start),
      endDate: fmt(now),
      size: 100,
    });
    const target = code.trim();
    return (
      list.find(
        (o) =>
          (o.content?.code ?? '').trim() === target ||
          (o.foreignCode ?? '').trim() === target,
      ) ?? null
    );
  }

  private buildClient(order: OrderForShipment): BkCreateOrderRequest['client'] {
    const name = order.customerName?.trim() ?? '';
    const phone = (order.customerPhone ?? '').replace(/\D/g, '');
    const city = order.addressCity?.trim() ?? '';
    const town = order.shippingDistrict?.trim() ?? '';
    const address = order.addressLine1?.trim() ?? '';
    if (!name || !phone || !city || city === '-' || !town || !address) {
      throw new Error(
        `eksik alıcı adresi (order=${order.humanOrderNo}): ad/tel/il/ilçe/adres zorunlu`,
      );
    }
    return { name, phone, city, town, address };
  }

  private async buildContent(
    order: OrderForShipment,
  ): Promise<BkCreateOrderRequest['content']> {
    const pkg = await this.config.getDefaultPackage();
    return {
      name: `Sipariş #${order.humanOrderNo}`,
      code: order.humanOrderNo,
      items: order.items.map((it) => ({
        name: it.productName,
        code: it.product?.externalCode?.trim() || order.humanOrderNo,
        quantity: String(it.qty),
      })),
      packages: [pkg],
    };
  }

  private async markStatus(orderId: string, status: string): Promise<void> {
    await this.prisma.order
      .update({
        where: { id: orderId },
        data: { basitKargoStatus: status },
      })
      .catch(() => undefined);
  }

  private async notifyFailure(orderId: string, reason: string): Promise<void> {
    try {
      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        select: { humanOrderNo: true, tenantId: true },
      });
      if (!order) return;
      await this.adminNotifier.notifyAdmins({
        tenantId: order.tenantId,
        subject: `Basit Kargo etiketi oluşturulamadı — #${order.humanOrderNo}`,
        html: `<p><strong>Kendim İçin</strong> siparişte kargo etiketi üretilemedi.</p><p>Sipariş <strong>#${order.humanOrderNo}</strong> için Basit Kargo barkodu oluşturulamadı ve sipariş tedarikçiye yönlendirilmedi. Sistem periyodik olarak yeniden deneyecek.</p><p>Sebep: ${escapeHtml(reason)}</p>`,
        context: 'basitkargo-shipment-failed',
      });
    } catch {
      /* bildirim best-effort */
    }
  }
}

/**
 * Şehir yanıtı: [{id, name, iso2, ...}]. İlçe ucu (/city/{id}/towns) PLAKA kodu
 * (iso2) ister — geo `id` DEĞİL. Bu yüzden location.id = iso2 döndürülür (yoksa
 * geo id fallback). Baştaki sıfırlar (ör. "07") Basit Kargo tarafından kabul edilir.
 */
function normalizeCities(raw: unknown): BkLocation[] {
  if (!Array.isArray(raw)) return [];
  const out: BkLocation[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const obj = entry as Record<string, unknown>;
    const name = typeof obj.name === 'string' ? obj.name.trim() : '';
    if (!name) continue;
    const iso2 =
      typeof obj.iso2 === 'string' && obj.iso2.trim() ? obj.iso2.trim() : null;
    const id = iso2 ?? (obj.id != null ? String(obj.id) : undefined);
    out.push(id ? { id, name } : { name });
  }
  return out;
}

/**
 * Mahalle yanıtı OBJE gelir ve yapı ilçe tipine göre DEĞİŞİR:
 *   - Kentsel (Kadıköy): { "Merkez": ["Caddebostan","Fenerbahçe",...] } → mahalleler DEĞERDE
 *   - Kırsal (Yalvaç):   { "Dedeçam": ["Orta","Yeni"], "Terziler": [] }   → köy ADI ANAHTARDA
 * Bu yüzden anahtarları + tüm dizi değerlerini DÜZLEŞTİRİP tekilleştiririz;
 * datalist (otomatik tamamlama) olduğundan üst-küme sunmak güvenlidir. İhtiyaten
 * dizi gelirse normalizeLocations'a düşer.
 */
function normalizeNeighborhoods(raw: unknown): BkLocation[] {
  if (Array.isArray(raw)) return normalizeLocations(raw);
  if (raw && typeof raw === 'object') {
    const set = new Set<string>();
    for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
      const k = key.trim();
      if (k) set.add(k);
      if (Array.isArray(val)) {
        for (const v of val) {
          if (typeof v === 'string' && v.trim()) set.add(v.trim());
        }
      }
    }
    return [...set]
      .sort((a, b) => a.localeCompare(b, 'tr'))
      .map((name) => ({ name }));
  }
  return [];
}

/** Basit Kargo konum yanıtı hem [{id,name}] hem ["Ad", ...] gelebilir → normalize. */
function normalizeLocations(raw: unknown): BkLocation[] {
  if (!Array.isArray(raw)) return [];
  const out: BkLocation[] = [];
  for (const entry of raw) {
    if (typeof entry === 'string') {
      const name = entry.trim();
      if (name) out.push({ name });
    } else if (entry && typeof entry === 'object') {
      const obj = entry as Record<string, unknown>;
      const name = typeof obj.name === 'string' ? obj.name.trim() : '';
      if (!name) continue;
      const id =
        obj.id !== undefined && obj.id !== null ? String(obj.id) : undefined;
      out.push(id ? { id, name } : { name });
    }
  }
  return out;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

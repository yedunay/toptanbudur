import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AppSettingsService } from '../app-settings/app-settings.service';
import {
  DEFAULT_MIN_PREPARE_HOURS,
  MIN_PREPARE_HOURS_SETTING,
  shipEligibilityCutoff,
  shipEligibleOrderWhere,
} from './ship-eligibility';

/// BİRLEŞİK "KARGOYA VERİLDİ" SÜPÜRÜCÜSÜ
/// ────────────────────────────────────────────────────────────────────────
/// 'hazırlanıyor'da (preparing) takılı kalan siparişleri TEDARİKÇİ FARK
/// ETMEKSİZİN otomatik 'shipped'e (kargoya verildi) çeker. Amaç: bir sürü
/// sipariş (özellikle bot'lu tedarikçilerde, tedarikçi API'si gerçek kargo
/// onayı vermediğinde) 'hazırlanıyor'da sonsuza
/// dek takılıyor ve e-fatura (konsolide) kesimini bloke ediyordu — shippedAt
/// dolmadığı için (birfatura.md §3.2). Bu servis o boşluğu kapatan güvenlik
/// ağıdır.
///
/// KURAL (herkes için AYNI pencere, yalnızca SAAT farklı):
///   • ÖNCE minimum hazırlanıyor süresi: sipariş 'hazırlanıyor'a girdiği andan
///     itibaren autoship.minPrepareHours saat (varsayılan 96 = 4 tam gün)
///     dolmadan KESİNLİKLE kargoya verildiye çekilmez (ship-eligibility.ts —
///     statusChangedAt → paidAt → createdAt fallback zinciri). 0 = kilit kapalı.
///   • "Kesim saati"ne (autoship.cutoffTime, varsayılan 08:45, Europe/Istanbul)
///     kadar VERİLMİŞ (Order.createdAt < bugün kesim) VE hâlâ 'hazırlanıyor'daki
///     uygun siparişler o gün kargoya verildiye çekilir.
///   • Alternatif takvimli tedarikçi HARİÇ herkes → autoship.shipTime
///     (vars. 18:30); autoship.skipSunday AÇIKSA Pazar atlanır (Pzt–Cmt).
///   • Alternatif takvimli tedarikçi (autoship.altSupplierId) → hafta içi
///     autoship.altWeekdayTime (vars. 15:00) / Cumartesi
///     autoship.altSaturdayTime (vars. 13:00); Pazar yok.
///
/// SAATLER AYARLANABİLİR: tüm saat/toggle değerleri AppSetting 'autoship.*'
/// kategorisinden (admin "Değişkenler" ekranı) RUNTIME değiştirilebilir — deploy
/// gerekmez. Bu yüzden statik @Cron yerine dakikalık tick + Istanbul HH:MM
/// karşılaştırması kullanılır.
///
/// ESKİ/TAKILI SİPARİŞLER: Alt sınır YOKTUR — createdAt < bugün kesim olan her
/// 'hazırlanıyor' süpürülür, dolayısıyla birikmiş eski siparişler de temizlenir.
/// Kendi kendini iyileştirir: bir gün tick kaçarsa, ertesi gün createdAt hâlâ
/// (ertesi günün) kesiminden küçük olduğu için sipariş yine yakalanır.
///
/// ÇİFT-KARGO İMKANSIZ: yalnızca status='preparing' seçilir ve yazım da
/// updateMany({where:{id,status:'preparing'}}) ile korunur. Sipariş daha erken
/// 'shipped' olduysa bu süpürme onu görmez (0 satır günceller).
///
/// YAN ETKİLER: shippedAt=now (e-fatura tek kaynağı) + statusChangedAt=now
/// (status-poll cadence + gün-sınırı hesapları buna bağlı) set edilir ve bir
/// OrderTrackingEvent('shipped') yazılır. Tedarikçi bakiyesi YENİDEN düşülmez
/// (paid→preparing'de zaten düşüldü). Cari'ye dokunulmaz. SESSİZDİR: müşteriye
/// 'kargoya verildi' maili GÖNDERİLMEZ (tüm mevcut otomatik ship yollarıyla
/// birebir aynı; birikmiş eski siparişlerde toplu mail spam'i olmaz).
///
/// DIŞLANANLAR: 'dealer_return' (iade satışı — statüsü satıcı bayinin kargo
/// girişiyle ilerler, biz kargolamayız) her zaman dışlanır. Alternatif takvim
/// ayrımı sipariş kalemlerinin tedarikçisine göre yapılır (override → snapshot
/// → product, 3 katman) — Order'da supplierId kolonu yoktur, tedarikçi
/// OrderItem seviyesindedir.

/// AppSetting anahtarları — hepsi 'autoship' kategorisinde, admin "Değişkenler"
/// ekranından düzenlenebilir (migration ile seed edilir).
const SETTING = {
  ENABLED: 'autoship.enabled',
  CUTOFF_TIME: 'autoship.cutoffTime',
  SHIP_TIME: 'autoship.shipTime',
  SKIP_SUNDAY: 'autoship.skipSunday',
  ALT_WEEKDAY_TIME: 'autoship.altWeekdayTime',
  ALT_SATURDAY_TIME: 'autoship.altSaturdayTime',
  MIN_PREPARE_HOURS: MIN_PREPARE_HOURS_SETTING,
} as const;

const DEFAULTS = {
  CUTOFF_TIME: '08:45',
  SHIP_TIME: '18:30',
  ALT_WEEKDAY_TIME: '15:00',
  ALT_SATURDAY_TIME: '13:00',
} as const;

/// Tek turda çekilecek sipariş sayısı. Birikmiş backlog için döngü, ilerleme
/// olmayınca (hepsi hata) durur.
const BATCH_SIZE = 200;

/// Alternatif kargo takvimine tabi tedarikçinin id'si (boşsa özel takvim yok).
const ALT_SCHEDULE_SUPPLIER_SETTING_KEY = 'autoship.altSupplierId';

export interface AutoShipResult {
  shipped: number;
  errors: number;
}

type ShipScope = 'alt' | 'default';

/// Europe/Istanbul "HH:MM" (24h) — shipTime karşılaştırması için.
function currentIstanbulHHMM(): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Istanbul',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date());
}

/// Europe/Istanbul günü kısaltması ('Sun' | 'Mon' | ... | 'Sat').
function istanbulWeekday(): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Istanbul',
    weekday: 'short',
  }).format(new Date());
}

const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/// "HH:MM" → {hour, minute}; geçersizse fallback.
function parseHHMM(
  value: string,
  fallbackHour: number,
  fallbackMinute: number,
): { hour: number; minute: number } {
  const m = HHMM_RE.exec(value.trim());
  if (!m) return { hour: fallbackHour, minute: fallbackMinute };
  return { hour: Number(m[1]), minute: Number(m[2]) };
}

/// Geçerli "HH:MM" ise kendisini, değilse default'u döner. Admin ayar alanına
/// hatalı değer girerse ("abc") saat karşılaştırması hiç eşleşmez ve sessizce
/// çalışmazdı — bu, o durumda güvenli default'a düşürür.
function validHHMMor(value: string, fallback: string): string {
  return HHMM_RE.test(value.trim()) ? value.trim() : fallback;
}

/// Bugünün Europe/Istanbul takviminde HH:MM anına karşılık gelen UTC Date.
/// Türkiye kalıcı UTC+3 (DST yok) — sabit +03:00 ofseti güvenlidir; kod
/// tabanındaki istanbulTodayStart() ile aynı desen.
function istanbulTodayAt(hour: number, minute: number): Date {
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  return new Date(`${ymd}T${hh}:${mm}:00+03:00`);
}

/// Bir OrderItem'ın alternatif takvimli tedarikçiye ait olup olmadığını,
/// tek-kaynak çözümleme önceliğiyle (supplierIdOverride → supplierIdSnapshot →
/// product.supplierId) eşleştiren OR koşulları. resolveSupplierId ile birebir
/// aynı öncelik.
function altItemMatchOr(altId: string): Prisma.OrderItemWhereInput[] {
  return [
    { supplierIdOverride: altId },
    { supplierIdOverride: null, supplierIdSnapshot: altId },
    {
      supplierIdOverride: null,
      supplierIdSnapshot: null,
      product: { supplierId: altId },
    },
  ];
}

@Injectable()
export class AutoShipService {
  private readonly logger = new Logger(AutoShipService.name);
  private tickInFlight = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly appSettings: AppSettingsService,
  ) {}

  /// Her dakika :30'da tetiklenir; Istanbul HH:MM ayarlı saatlerle eşleşirse
  /// ilgili süpürmeyi çalıştırır. tickInFlight ile üst üste binmez.
  @Cron('30 * * * * *', {
    name: 'unified-ship-tick',
    timeZone: 'Europe/Istanbul',
  })
  async tick(): Promise<void> {
    if (this.tickInFlight) return;
    this.tickInFlight = true;
    try {
      if (!(await this.appSettings.getBoolean(SETTING.ENABLED, true))) return;

      const now = currentIstanbulHHMM();
      const weekday = istanbulWeekday();

      // 1) Alternatif takvimli tedarikçi — hafta içi / Cumartesi (Pazar yok).
      if (weekday !== 'Sun') {
        const altTime =
          weekday === 'Sat'
            ? validHHMMor(
                await this.appSettings.getString(
                  SETTING.ALT_SATURDAY_TIME,
                  DEFAULTS.ALT_SATURDAY_TIME,
                ),
                DEFAULTS.ALT_SATURDAY_TIME,
              )
            : validHHMMor(
                await this.appSettings.getString(
                  SETTING.ALT_WEEKDAY_TIME,
                  DEFAULTS.ALT_WEEKDAY_TIME,
                ),
                DEFAULTS.ALT_WEEKDAY_TIME,
              );
        if (now === altTime) {
          await this.sweep('alt');
          return;
        }
      }

      // 2) Geri kalan herkes — ayarlı shipTime; Pazar (skipSunday açıksa) atlanır.
      const shipTime = validHHMMor(
        await this.appSettings.getString(SETTING.SHIP_TIME, DEFAULTS.SHIP_TIME),
        DEFAULTS.SHIP_TIME,
      );
      if (now === shipTime) {
        if (
          weekday === 'Sun' &&
          (await this.appSettings.getBoolean(SETTING.SKIP_SUNDAY, true))
        ) {
          this.logger.log('auto-ship [default]: Pazar — atlandı');
          return;
        }
        await this.sweep('default');
        return;
      }
    } catch (e) {
      this.logger.error(`auto-ship tick hatası: ${(e as Error).message}`);
    } finally {
      this.tickInFlight = false;
    }
  }

  /// Admin manuel tetikleyicisi (POST /admin/auto-ship/run-now) — gün/saat
  /// gate'ini atlar, her iki kapsamı da çalıştırır.
  async runAutoShip(): Promise<AutoShipResult> {
    const def = await this.sweep('default');
    const alt = await this.sweep('alt');
    return {
      shipped: def.shipped + alt.shipped,
      errors: def.errors + alt.errors,
    };
  }

  /// Verilen kapsam için 'preparing' → 'shipped' süpürmesini yürütür.
  async sweep(scope: ShipScope): Promise<AutoShipResult> {
    const altId = await this.getAltScheduleSupplierId();

    // Alternatif kapsam için tedarikçi id'si tanımsızsa o siparişler tespit
    // edilemez → hiçbir şey yapma (yanlışlıkla herkesi kapsama almamak için).
    if (scope === 'alt' && !altId) {
      this.logger.debug(
        'auto-ship [alt]: autoship.altSupplierId tanımsız — süpürme atlandı',
      );
      return { shipped: 0, errors: 0 };
    }

    const cutoffStr = await this.appSettings.getString(
      SETTING.CUTOFF_TIME,
      DEFAULTS.CUTOFF_TIME,
    );
    const { hour, minute } = parseHHMM(cutoffStr, 8, 45);
    const cutoff = istanbulTodayAt(hour, minute);
    // Minimum hazırlanıyor süresi (vars. 96 saat): preparing'e girişten bu
    // süre geçmemiş sipariş KESİNLİKLE çekilmez. Ertelenen sipariş preparing'de
    // kaldığı için sonraki günlerin süpürmelerinde kendiliğinden yakalanır.
    const minPrepareHours = await this.appSettings.getNumber(
      SETTING.MIN_PREPARE_HOURS,
      DEFAULT_MIN_PREPARE_HOURS,
    );
    const eligibleCutoff = shipEligibilityCutoff(new Date(), minPrepareHours);
    const where = this.buildWhere(scope, altId, cutoff, eligibleCutoff);

    let shipped = 0;
    let errors = 0;

    // Backlog için batch döngüsü; bir turda hiç ilerleme olmazsa (hepsi hata,
    // örn. zehirli sipariş) sonsuz döngüyü önlemek için durur.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const candidates = await this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        take: BATCH_SIZE,
        select: { id: true, humanOrderNo: true, supplierOrderNo: true },
      });

      if (candidates.length === 0) break;

      let batchShipped = 0;
      for (const order of candidates) {
        try {
          const now = new Date();
          // shippedAt = konsolide fatura kesim uygunluğunun tek kaynağı
          // (birfatura.md §3.2). statusChangedAt = status-poll cadence + gün
          // sınırı hesapları buna dayanır.
          await this.prisma.$transaction([
            this.prisma.order.updateMany({
              where: { id: order.id, status: 'preparing' },
              data: { status: 'shipped', shippedAt: now, statusChangedAt: now },
            }),
            this.prisma.orderTrackingEvent.create({
              data: {
                orderId: order.id,
                status: 'shipped',
                description:
                  'Otomatik kargoya verildi (zamanlı)',
              },
            }),
          ]);

          shipped++;
          batchShipped++;
          this.logger.log(
            `auto-ship [${scope}]: ${order.humanOrderNo} kargoya verildi ` +
              `(supplierOrderNo=${order.supplierOrderNo ?? 'yok'})`,
          );
        } catch (err) {
          errors++;
          this.logger.error(
            `auto-ship [${scope}] hata: ${order.humanOrderNo} — ${(err as Error).message}`,
          );
        }
      }

      // Bu turda hiç sipariş çekilemediyse (hepsi hata) ilerleme yok → dur.
      if (batchShipped === 0) break;
      // Tam batch dolmadıysa aday kalmadı → dur.
      if (candidates.length < BATCH_SIZE) break;
    }

    if (shipped === 0 && errors === 0) {
      this.logger.debug(`auto-ship [${scope}]: aday yok`);
    } else {
      this.logger.log(
        `auto-ship [${scope}] tamamlandı: ${shipped} kargoya verildi, ${errors} hata`,
      );
    }
    return { shipped, errors };
  }

  /// Kapsam + alternatif takvimli tedarikçi id + kesim saati +
  /// minimum-hazırlanıyor eşiğine göre Prisma where filtresini kurar.
  private buildWhere(
    scope: ShipScope,
    altId: string | null,
    cutoff: Date,
    eligibleCutoff: Date,
  ): Prisma.OrderWhereInput {
    const base: Prisma.OrderWhereInput = {
      status: 'preparing',
      // "...bugün kesim saatine kadar verilmiş" — üst sınır (alt sınır YOK →
      // eski takılı siparişler de dahil).
      createdAt: { lt: cutoff },
    };
    // Minimum hazırlanıyor süresi: preparing'e giriş <= eligibleCutoff.
    const eligibility = shipEligibleOrderWhere(eligibleCutoff);

    if (scope === 'alt') {
      // Alternatif takvimli kalem İÇEREN + 'dealer_return' İÇERMEYEN siparişler.
      return {
        ...base,
        AND: [
          eligibility,
          { items: { some: { OR: altItemMatchOr(altId as string) } } },
          { items: { none: { fulfillmentSource: 'dealer_return' } } },
        ],
      };
    }

    // Varsayılan: 'dealer_return' VE alternatif takvimli kalem İÇERMEYEN.
    const noneOr: Prisma.OrderItemWhereInput[] = [
      { fulfillmentSource: 'dealer_return' },
    ];
    if (altId) noneOr.push(...altItemMatchOr(altId));

    return {
      ...base,
      AND: [eligibility],
      items: { none: { OR: noneOr } },
    };
  }

  /// Alternatif takvimli tedarikçi id'sini AppSetting'ten okur (boş → null).
  private async getAltScheduleSupplierId(): Promise<string | null> {
    const v = (
      await this.appSettings.getString(ALT_SCHEDULE_SUPPLIER_SETTING_KEY, '')
    ).trim();
    return v ? v : null;
  }
}

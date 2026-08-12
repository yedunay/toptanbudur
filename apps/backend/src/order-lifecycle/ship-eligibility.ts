import { Prisma } from '@prisma/client';

/// MİNİMUM "HAZIRLANIYOR" BEKLEME PENCERESİ (kargoya verilme kilidi)
/// ────────────────────────────────────────────────────────────────────────
/// KURAL: Bir sipariş 'hazırlanıyor'a (preparing) girdiği andan itibaren
/// autoship.minPrepareHours saat (varsayılan 96 = 4 tam gün) dolmadan HİÇBİR
/// OTOMATİK mekanizma onu 'kargoya verildi'ye (shipped) çekemez. Tedarikçi
/// fiilen kargolamış olsa bile gerçek Order.status geçişi bekletilir —
/// müşteri-yüzlü 96 saat görünüm kuralının (order-customer-status.ts)
/// gerçek-statü karşılığıdır; erken "kargoya verildi" iptal/iade süreçlerinde
/// sorun çıkarıyordu.
///
/// KAPIYA TABİ (otomatik yollar): AutoShipService süpürücüsü, tedarikçi API
/// statü-poll'ları, status-sync akışları ve zamanlı Excel botları.
///
/// MUAF (gerçek fiziksel kargo veya insan iradesi): admin manuel statü
/// değişikliği (AdminOrdersService.updateOrder doğrudan admin çağrısı),
/// Depo "Kargoya Verdim", iade-satışı (dealer_return) kargo onayı,
/// Basit Kargo webhook'u (fiilen kargolanmış "Kendim İçin" siparişi),
/// BirFatura legacy cargo-update push'u.
///
/// ZAMAN REFERANSI (preparing'e giriş anı) — üç katmanlı fallback:
///   1. statusChangedAt — tüm alım botları + admin updateOrder paid→preparing
///      geçişinde set eder; sipariş preparing'de kaldığı sürece kimse ezmez.
///   2. paidAt          — statusChangedAt null ise (eski yol).
///      paid→preparing genelde dakikalar içinde olduğundan konservatif ve
///      güvenli bir alt sınırdır.
///   3. createdAt       — ikisi de null ise son çare.
/// Ertelenen sipariş TAKILMAZ: preparing'de kaldığı için günlük AutoShip
/// süpürücüsü pencere dolduktan sonraki ilk sevk saatinde çeker (güvenlik ağı).
///
/// Ayar admin "Değişkenler" ekranında (autoship kategorisi) RUNTIME
/// düzenlenebilir; 0 girilirse kilit tamamen kapanır (eski davranış).

export const MIN_PREPARE_HOURS_SETTING = 'autoship.minPrepareHours';
export const DEFAULT_MIN_PREPARE_HOURS = 96;

/// Şu andan geriye minPrepareHours giderek eşik anını hesaplar. Bu eşikten
/// ÖNCE preparing'e girmiş siparişler kargoya çekilebilir.
export function shipEligibilityCutoff(now: Date, minPrepareHours: number): Date {
  const hours = Number.isFinite(minPrepareHours)
    ? Math.max(0, minPrepareHours)
    : DEFAULT_MIN_PREPARE_HOURS;
  return new Date(now.getTime() - hours * 3_600_000);
}

/// Prisma where parçası: "preparing'e giriş anı <= cutoff" (fallback zinciri
/// statusChangedAt → paidAt → createdAt). status filtresi İÇERMEZ — çağıran
/// kendi status='preparing' koşuluyla AND'ler.
export function shipEligibleOrderWhere(cutoff: Date): Prisma.OrderWhereInput {
  return {
    OR: [
      { statusChangedAt: { lte: cutoff } },
      { statusChangedAt: null, paidAt: { lte: cutoff } },
      { statusChangedAt: null, paidAt: null, createdAt: { lte: cutoff } },
    ],
  };
}

/// Tek sipariş için bellek-içi aynı kontrol (poll botlarının karar anında).
export function isShipEligible(
  order: {
    statusChangedAt: Date | null;
    paidAt: Date | null;
    createdAt: Date;
  },
  cutoff: Date,
): boolean {
  const anchor = order.statusChangedAt ?? order.paidAt ?? order.createdAt;
  return anchor.getTime() <= cutoff.getTime();
}

/// Ertelenen geçişlerde log/event mesajı için kalan süreyi insan-okur yazar.
export function shipHoldMessage(
  order: {
    statusChangedAt: Date | null;
    paidAt: Date | null;
    createdAt: Date;
  },
  minPrepareHours: number,
  now: Date,
): string {
  const anchor = order.statusChangedAt ?? order.paidAt ?? order.createdAt;
  const readyAt = new Date(anchor.getTime() + minPrepareHours * 3_600_000);
  const remainingH = Math.max(
    0,
    Math.ceil((readyAt.getTime() - now.getTime()) / 3_600_000),
  );
  return (
    `Minimum hazırlanıyor süresi (${minPrepareHours} saat) dolmadı — ` +
    `kargoya verildi geçişi ertelendi (~${remainingH} saat kaldı, ` +
    `uygun: ${readyAt.toISOString()})`
  );
}

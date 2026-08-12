// ──────────────────────────────────────────────────────────────────────────
//  FİYATA GÖRE KADEMELİ KÂR — satış fiyatı motoru (TEK KAYNAK)
//
//  Tedarikçi/kategori "Kâr Tipi" iki moddan biridir:
//   • fixed  : satış = costPrice × (1 + profitMargin/100) + extraCostTry  (mevcut davranış)
//   • tiered : ürünün ALIŞ maliyetine (costPrice) göre bir BAREM seçilir; o baremin
//              oranı (% marj veya TL kâr) + ek maliyetleri uygulanır.
//
//  ÖNEMLİ: Bu motor YALNIZCA SATIŞ fiyatını belirler. Maliyet/cüzdan/kâr/cari
//  hesapları HEP costPrice'tan türer (unified-supplier-pricing tek kaynağı) ve
//  bu dosyadan ETKİLENMEZ. Barem TABANI = costPrice (kullanıcı kararı 2026-06-24).
//
//  Hem ingest (feed sync fiyatlama) hem admin recompute (tedarikçi/kategori ayarı
//  değişince yeniden fiyatlama) bu dosyayı kullanır → ikisi asla sapmasın.
// ──────────────────────────────────────────────────────────────────────────

export type RateType = 'percent' | 'amount';

/** Tek bir kademeli kâr baremi. Aralık [min, max): min dahil, max hariç (null=∞). */
export interface ProfitTier {
  /** Alt limit — costPrice >= min. */
  min: number;
  /** Üst limit — costPrice < max. null = sonsuz (en üst barem). */
  max: number | null;
  /** "percent" = costPrice'a % marj; "amount" = costPrice'a TL kâr ekle. */
  rateType: RateType;
  /** rateType'a göre yüzde (örn 35) veya TL tutar (örn 50). */
  rate: number;
  /** Bareme özel ek maliyetler (TL) — satışa eklenir, toplanır. */
  extraCosts: number[];
}

/** Bir ürüne uygulanacak ÇÖZÜLMÜŞ fiyatlandırma (tedarikçi/kategori sonrası). */
export type EffectivePricing =
  | { type: 'fixed'; margin: number; extra: number }
  | { type: 'tiered'; tiers: ProfitTier[] };

/** Prisma Decimal / string / number / null → number (güvenli). */
export function toNum(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') return parseFloat(v) || 0;
  if (typeof (v as { toString?: () => string }).toString === 'function') {
    return parseFloat((v as { toString: () => string }).toString()) || 0;
  }
  return 0;
}

// NOT: mevcut ingest.markupPrice ve SQL recompute ile BİREBİR aynı yuvarlama
// (Math.round(x*100)/100) — fixed modda eski fiyatlar bir kuruş bile kaymasın.
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Ham JSON'u (DB/DTO) güvenli ProfitTier[]'e çevirir. Bozuk/eksik elemanları
 * eler. Sıralama min'e göre artan yapılır (findTier deterministik olsun diye).
 */
export function parseTiers(raw: unknown): ProfitTier[] {
  if (!Array.isArray(raw)) return [];
  const out: ProfitTier[] = [];
  for (const el of raw) {
    if (!el || typeof el !== 'object') continue;
    const e = el as Record<string, unknown>;
    const min = toNum(e.min);
    const max = e.max == null ? null : toNum(e.max);
    const rateType: RateType = e.rateType === 'amount' ? 'amount' : 'percent';
    const rate = toNum(e.rate);
    const extraCosts = Array.isArray(e.extraCosts)
      ? e.extraCosts.map(toNum).filter((x) => Number.isFinite(x))
      : [];
    if (!Number.isFinite(min) || (max != null && !Number.isFinite(max))) continue;
    out.push({ min, max, rateType, rate, extraCosts });
  }
  out.sort((a, b) => a.min - b.min);
  return out;
}

/**
 * costPrice'ın düştüğü baremi bulur (min <= cost < max). Bitişik [0,∞) baremlerde
 * daima eşleşir. Bozuk/boşluklu veride savunmacı: min'i cost'u geçmeyen EN YÜKSEK
 * baremi, o da yoksa ilk baremi döner. tiers boşsa null.
 */
export function findTier(tiers: ProfitTier[], cost: number): ProfitTier | null {
  if (!tiers.length) return null;
  for (const t of tiers) {
    if (cost >= t.min && (t.max == null || cost < t.max)) return t;
  }
  let fb: ProfitTier | null = null;
  for (const t of tiers) if (cost >= t.min) fb = t;
  return fb ?? tiers[0];
}

/** Bir baremin SATIŞ fiyatı (costPrice'tan). */
function tierSale(cost: number, tier: ProfitTier): number {
  const base =
    tier.rateType === 'amount'
      ? cost + tier.rate
      : cost * (1 + tier.rate / 100);
  const extra = tier.extraCosts.reduce((s, x) => s + (Number.isFinite(x) ? x : 0), 0);
  return base + extra;
}

/**
 * costPrice + çözülmüş fiyatlandırmadan SATIŞ fiyatı (2 hane yuvarlı).
 * fixed:  cost × (1 + margin/100) + extra
 * tiered: seçilen baremin oran/tutarı + ek maliyetleri
 */
export function computeSalePrice(cost: number, pricing: EffectivePricing): number {
  const c = toNum(cost);
  if (pricing.type === 'fixed') {
    const margin = Math.max(0, toNum(pricing.margin));
    const extra = Math.max(0, toNum(pricing.extra));
    return round2(c * (1 + margin / 100) + extra);
  }
  const tier = findTier(pricing.tiers, c);
  if (!tier) return round2(c); // son çare (tiers boş): maliyetine eşit, asla altı değil
  return round2(tierSale(c, tier));
}

/**
 * Çözülmüş fiyatlandırmanın STABİL imzası — ingest contentHash'ine girer.
 * Fiyatlandırma değişince (marj/ek kâr VEYA barem) imza değişir → sync reprice.
 * fixed imzası ESKİ format `${markup}|${extra}` ile BİREBİR aynı tutulur →
 * sabit-kâr tedarikçilerde gereksiz toplu reprice olmaz.
 */
export function pricingSignature(p: EffectivePricing): string {
  if (p.type === 'fixed') {
    const markup = Math.max(0, toNum(p.margin)) / 100;
    const extra = Math.max(0, toNum(p.extra));
    return `${markup}|${extra}`;
  }
  return (
    'tiered|' +
    p.tiers
      .map(
        (t) =>
          `${t.min}:${t.max ?? '∞'}:${t.rateType}:${t.rate}:${t.extraCosts.join('+')}`,
      )
      .join(',')
  );
}

// ── ÇÖZÜMLEME (tedarikçi + kategori override) ──────────────────────────────

export interface SupplierPricingInput {
  profitType?: string | null;
  profitMargin: unknown;
  extraCostTry: unknown;
  profitTiers?: unknown;
}

export interface CategoryPricingInput {
  profitTypeOverride?: string | null;
  marginPercentOverride?: unknown;
  extraCostTryOverride?: unknown;
  profitTiers?: unknown;
}

function supplierPricing(s: SupplierPricingInput): EffectivePricing {
  if (s.profitType === 'tiered') {
    const tiers = parseTiers(s.profitTiers);
    if (tiers.length) return { type: 'tiered', tiers };
    // tiered seçili ama barem yok → bozuk; fixed'e düş (davranış kaybı olmasın).
  }
  return { type: 'fixed', margin: toNum(s.profitMargin), extra: toNum(s.extraCostTry) };
}

/**
 * Bir ürünün NİHAİ fiyatlandırmasını çözer. Öncelik:
 *   1) Kategori override (profitTypeOverride veya eski margin/extra alanları)
 *   2) Tedarikçi (profitType fixed/tiered)
 * Kategori "tiered" ama baremi boşsa / override yoksa tedarikçiye düşülür.
 * Eski (legacy) marginPercentOverride/extraCostTryOverride alanları KORUNUR
 * (geriye dönük uyumluluk): profitTypeOverride null ama biri doluysa fixed override.
 */
export function resolveEffectivePricing(
  supplier: SupplierPricingInput,
  category?: CategoryPricingInput | null,
): EffectivePricing {
  if (category) {
    if (category.profitTypeOverride === 'tiered') {
      const tiers = parseTiers(category.profitTiers);
      if (tiers.length) return { type: 'tiered', tiers };
      // boş barem → override geçersiz, tedarikçiye düş.
    } else if (
      category.profitTypeOverride === 'fixed' ||
      category.marginPercentOverride != null ||
      category.extraCostTryOverride != null
    ) {
      return {
        type: 'fixed',
        margin:
          category.marginPercentOverride != null
            ? toNum(category.marginPercentOverride)
            : toNum(supplier.profitMargin),
        extra:
          category.extraCostTryOverride != null
            ? toNum(category.extraCostTryOverride)
            : toNum(supplier.extraCostTry),
      };
    }
  }
  return supplierPricing(supplier);
}

// ── DOĞRULAMA (DTO/admin) ──────────────────────────────────────────────────

export interface TierValidationResult {
  ok: boolean;
  error?: string;
  /** Temizlenmiş, sıralı baremler (ok ise). */
  tiers?: ProfitTier[];
}

/**
 * Kademeli kâr baremlerini doğrular. Kurallar (admin UI ile birebir):
 *  - en az 1 barem
 *  - ilk barem min=0; son barem max=null (∞); aradakiler bitişik (t.max === next.min)
 *  - min < max (max varsa), rate sonlu ve ≥0, rateType percent|amount
 *  - extraCosts ≥0
 */
export function validateTiers(raw: unknown): TierValidationResult {
  const tiers = parseTiers(raw);
  if (!tiers.length) return { ok: false, error: 'En az bir kâr baremi gerekli.' };

  for (let i = 0; i < tiers.length; i++) {
    const t = tiers[i];
    if (t.rateType !== 'percent' && t.rateType !== 'amount') {
      return { ok: false, error: `Barem ${i + 1}: geçersiz oran tipi.` };
    }
    if (!Number.isFinite(t.rate) || t.rate < 0) {
      return { ok: false, error: `Barem ${i + 1}: oran/tutar 0 veya üstü olmalı.` };
    }
    if (t.rateType === 'percent' && t.rate > 100000) {
      return { ok: false, error: `Barem ${i + 1}: yüzde değeri çok büyük.` };
    }
    if (t.min < 0) return { ok: false, error: `Barem ${i + 1}: alt limit negatif olamaz.` };
    if (t.max != null && t.max <= t.min) {
      return { ok: false, error: `Barem ${i + 1}: üst limit alt limitten büyük olmalı.` };
    }
    if (t.extraCosts.some((x) => !Number.isFinite(x) || x < 0)) {
      return { ok: false, error: `Barem ${i + 1}: ek maliyet 0 veya üstü olmalı.` };
    }
  }

  if (tiers[0].min !== 0) {
    return { ok: false, error: 'İlk baremin alt limiti 0 olmalı.' };
  }
  if (tiers[tiers.length - 1].max != null) {
    return { ok: false, error: 'Son baremin üst limiti boş (∞) olmalı.' };
  }
  for (let i = 0; i < tiers.length - 1; i++) {
    if (tiers[i].max !== tiers[i + 1].min) {
      return {
        ok: false,
        error: `Baremler bitişik olmalı: ${i + 1}. baremin üst limiti ${i + 2}. baremin alt limitine eşit değil.`,
      };
    }
  }
  return { ok: true, tiers };
}

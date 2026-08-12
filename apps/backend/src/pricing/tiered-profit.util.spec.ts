import {
  computeSalePrice,
  findTier,
  parseTiers,
  resolveEffectivePricing,
  validateTiers,
  type ProfitTier,
} from './tiered-profit.util';

// Ekran görüntüsündeki örnek baremler (costPrice bazlı).
const SCREENSHOT_TIERS: ProfitTier[] = [
  { min: 0, max: 200, rateType: 'percent', rate: 35, extraCosts: [50] },
  { min: 200, max: 350, rateType: 'percent', rate: 32, extraCosts: [99] },
  { min: 350, max: 1000, rateType: 'percent', rate: 29, extraCosts: [152] },
  { min: 1000, max: 2000, rateType: 'percent', rate: 26, extraCosts: [152] },
  { min: 2000, max: 4000, rateType: 'percent', rate: 23, extraCosts: [152] },
  { min: 4000, max: null, rateType: 'percent', rate: 20, extraCosts: [152] },
];

describe('findTier', () => {
  it('selects the bracket by costPrice [min, max)', () => {
    expect(findTier(SCREENSHOT_TIERS, 150)?.rate).toBe(35);
    expect(findTier(SCREENSHOT_TIERS, 0)?.rate).toBe(35);
    // sınır: 200 üst-hariç → 2. bareme düşer
    expect(findTier(SCREENSHOT_TIERS, 200)?.rate).toBe(32);
    expect(findTier(SCREENSHOT_TIERS, 999)?.rate).toBe(29);
    expect(findTier(SCREENSHOT_TIERS, 1000)?.rate).toBe(26);
    expect(findTier(SCREENSHOT_TIERS, 50_000)?.rate).toBe(20); // ∞ barem
  });

  it('returns null for empty tiers', () => {
    expect(findTier([], 100)).toBeNull();
  });
});

describe('computeSalePrice', () => {
  it('fixed: cost*(1+margin/100)+extra', () => {
    expect(computeSalePrice(100, { type: 'fixed', margin: 20, extra: 10 })).toBeCloseTo(130);
  });

  it('tiered percent: cost*(1+rate/100)+Σextra', () => {
    // cost 150 → barem %35 + 50 → 150*1.35 + 50 = 252.5
    expect(
      computeSalePrice(150, { type: 'tiered', tiers: SCREENSHOT_TIERS }),
    ).toBeCloseTo(252.5);
    // cost 4500 → barem %20 + 152 → 4500*1.2 + 152 = 5552
    expect(
      computeSalePrice(4500, { type: 'tiered', tiers: SCREENSHOT_TIERS }),
    ).toBeCloseTo(5552);
  });

  it('tiered amount: cost + rate(TL) + Σextra', () => {
    const tiers: ProfitTier[] = [
      { min: 0, max: null, rateType: 'amount', rate: 40, extraCosts: [10, 5] },
    ];
    // 100 + 40 + 15 = 155
    expect(computeSalePrice(100, { type: 'tiered', tiers })).toBeCloseTo(155);
  });

  it('empty tiers → cost (never below cost)', () => {
    expect(computeSalePrice(100, { type: 'tiered', tiers: [] })).toBeCloseTo(100);
  });
});

describe('resolveEffectivePricing', () => {
  const supplierFixed = { profitType: 'fixed', profitMargin: 20, extraCostTry: 5, profitTiers: null };
  const supplierTiered = {
    profitType: 'tiered',
    profitMargin: 20,
    extraCostTry: 5,
    profitTiers: SCREENSHOT_TIERS,
  };

  it('supplier fixed when no category', () => {
    expect(resolveEffectivePricing(supplierFixed)).toEqual({ type: 'fixed', margin: 20, extra: 5 });
  });

  it('supplier tiered when no category', () => {
    const p = resolveEffectivePricing(supplierTiered);
    expect(p.type).toBe('tiered');
  });

  it('category tiered override beats supplier', () => {
    const cat = { profitTypeOverride: 'tiered', profitTiers: SCREENSHOT_TIERS };
    const p = resolveEffectivePricing(supplierFixed, cat);
    expect(p.type).toBe('tiered');
  });

  it('legacy category margin/extra override still works (no profitTypeOverride)', () => {
    const cat = { profitTypeOverride: null, marginPercentOverride: 40, extraCostTryOverride: null };
    expect(resolveEffectivePricing(supplierFixed, cat)).toEqual({
      type: 'fixed',
      margin: 40,
      extra: 5, // extra override null → supplier extra
    });
  });

  it('category fixed override falls back to supplier values for null fields', () => {
    const cat = { profitTypeOverride: 'fixed', marginPercentOverride: null, extraCostTryOverride: 99 };
    expect(resolveEffectivePricing(supplierTiered, cat)).toEqual({
      type: 'fixed',
      margin: 20, // supplier margin (override null)
      extra: 99,
    });
  });

  it('category tiered but empty → inherits supplier', () => {
    const cat = { profitTypeOverride: 'tiered', profitTiers: [] };
    const p = resolveEffectivePricing(supplierTiered, cat);
    expect(p.type).toBe('tiered'); // supplier's tiers
  });

  it('supplier tiered but empty → degrades to fixed', () => {
    const s = { profitType: 'tiered', profitMargin: 20, extraCostTry: 5, profitTiers: [] };
    expect(resolveEffectivePricing(s)).toEqual({ type: 'fixed', margin: 20, extra: 5 });
  });
});

describe('validateTiers', () => {
  it('accepts a valid contiguous [0,∞) set', () => {
    expect(validateTiers(SCREENSHOT_TIERS).ok).toBe(true);
  });

  it('rejects empty', () => {
    expect(validateTiers([]).ok).toBe(false);
  });

  it('rejects first min != 0', () => {
    const t = [{ min: 10, max: null, rateType: 'percent', rate: 20, extraCosts: [] }];
    expect(validateTiers(t).ok).toBe(false);
  });

  it('rejects last max not ∞', () => {
    const t = [{ min: 0, max: 100, rateType: 'percent', rate: 20, extraCosts: [] }];
    expect(validateTiers(t).ok).toBe(false);
  });

  it('rejects non-contiguous brackets', () => {
    const t = [
      { min: 0, max: 200, rateType: 'percent', rate: 35, extraCosts: [] },
      { min: 250, max: null, rateType: 'percent', rate: 20, extraCosts: [] },
    ];
    expect(validateTiers(t).ok).toBe(false);
  });

  it('rejects negative extra cost', () => {
    const t = [{ min: 0, max: null, rateType: 'percent', rate: 20, extraCosts: [-5] }];
    expect(validateTiers(t).ok).toBe(false);
  });
});

describe('parseTiers', () => {
  it('coerces strings/Decimal-likes and sorts by min', () => {
    const raw = [
      { min: '200', max: '350', rateType: 'percent', rate: '32', extraCosts: ['99'] },
      { min: 0, max: 200, rateType: 'percent', rate: 35, extraCosts: [50] },
    ];
    const t = parseTiers(raw);
    expect(t[0].min).toBe(0);
    expect(t[1].min).toBe(200);
    expect(t[1].rate).toBe(32);
    expect(t[1].extraCosts).toEqual([99]);
  });

  it('drops malformed entries and non-arrays', () => {
    expect(parseTiers(null)).toEqual([]);
    expect(parseTiers('x')).toEqual([]);
    expect(parseTiers([{ rateType: 'percent' }, null, 5]).length).toBe(1);
  });
});

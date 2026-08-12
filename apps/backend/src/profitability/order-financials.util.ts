// ──────────────────────────────────────────────────────────────────────────
//  SİPARİŞ FİNANSAL MOTORU — TEK KAYNAK (single source of truth)
//
//  Bir siparişin/kaleminin TÜM finansal büyüklüklerini TEK yerden üretir.
//  Muhasebe (Bayi/Tedarikçi Hesap), Karlılık, Tedarikçi Cari raporu, Z-rapor,
//  Export ve Tedarikçi Cüzdanı bu motoru kullanır → "alış maliyeti / satış /
//  kâr / KDV" her sayfada AYNI sayıyı verir (bin tane ayrı inline hesap yok).
//
//  Mevcut kanonik yapı taşlarının üstüne kurulur:
//   • supplier-attribution.util → resolveSupplier (override→snapshot→product)
//   • profit-cost.util          → calcItemSupplyCost / supplierUnitQty /
//                                  calcItemCollectedKdv / calcSupplyKdvPortion /
//                                  calcCardCommissionSpread / composeCentralProfit
//
//  ── İKİ AYRI MALİYET (kullanıcı kararı 2026-06-24: "ayrı ama etiketli") ────
//   • cogs       : EKONOMİK mal maliyeti — TÜM adet (depo malı dahil), kâr
//                  raporları bunu sayar. ("Mal Maliyeti")
//   • walletCost : tedarikçiye FİİLEN ödenen nakit — yalnız supplierUnitQty
//                  (depo/dealer_return adetleri 0). Tedarikçi cüzdanı
//                  bunu düşer. ("Gerçek Tedarikçi Ödemesi")
//   Pür-tedarikçi siparişte ikisi EŞİT; depo karışınca BİLİNÇLİ farklı
//   ve raporda ayrı kolonda gösterilir (sessiz sapma yok).
//
//  ── BAYİLER-ARASI İADE (dealer_return) ────────────────────────────────────
//   Platform o malı tedarikçiden ALMAZ; yalnız %komisyon kazanır. Bu yüzden
//   dealer_return kaleminde: gelir = SADECE platform komisyonu, mal maliyeti
//   = 0, cüzdan = 0, KDV = 0. (Kullanıcı kuralı: "bayiler-arası iadelerde
//   sadece bizim komisyon karımız girmeli".)
//
//  ── KART KOMİSYON KÂRI (ayrı kalem) ────────────────────────────────────────
//   Müşteriden alınan %3 ile POS'a ödenen ~%2,79 farkı sipariş düzeyinde AYRI
//   bir kâr satırı olarak raporlanır (cardCommissionSpread) — üründen ayrı.
// ──────────────────────────────────────────────────────────────────────────

import {
  calcCardCommissionSpread,
  calcItemCollectedKdv,
  calcItemSupplyCost,
  calcPackagingKdvPortion,
  calcSupplyKdvPortion,
  composeCentralProfit,
  supplierUnitQty,
  toNum,
  type CardCommissionSpreadInput,
  type ItemFulfillmentFields,
} from './profit-cost.util';
import {
  DELETED_SUPPLIER_ID,
  DELETED_SUPPLIER_NAME,
  resolveSupplier,
  type SupplierResolvableItem,
} from './supplier-attribution.util';

/** Bayiler-arası iade (dealer_return) varsayılan platform komisyon yüzdesi. */
export const DEFAULT_DEALER_RETURN_COMMISSION_PERCENT = 10;

/** Motorun bir kalemden ihtiyaç duyduğu minimal şekil. */
export type FinancialItem = SupplierResolvableItem &
  ItemFulfillmentFields & {
    qty: number;
    /** KDV-hariç, bayi-indirimli birim satış fiyatı (Order anında snapshot). */
    unitPrice?: unknown;
    /** Sipariş anındaki alış fiyatı snapshot'ı (yoksa product.costPrice). */
    costPriceSnapshot?: unknown;
    /** dealer_return kaleminde platform komisyon yüzdesi. */
    returnDealerCommissionPercent?: number | null;
    product?: {
      supplierId?: string | null;
      costPrice?: unknown;
      supplier?: { name?: string | null } | null;
    } | null;
  };

/** Sipariş bağlamı (kalemlerden bağımsız ortak alanlar). */
export interface OrderFinancialContext {
  /** Order.kdvRate ?? 20 — satış KDV oranı. */
  saleKdvRate: number;
  /** Tedarikçi başına alış KDV oranı (Supplier.purchaseVatRate). */
  vatBySupplier: Map<string, { purchaseVatRate?: number | null }>;
  /** Kart komisyon farkı girdisi (sipariş düzeyinde; kart değilse 0). */
  card?: CardCommissionSpreadInput;
  /** dealer_return varsayılan komisyon yüzdesi (kalem taşımıyorsa). */
  dealerReturnCommissionPercent?: number;
  /** Order.packagingUnitFee — birim başı paketleme/hizmet ücreti. KDV-DAHİL
   *  kabul edilir (kullanıcı kararı): gelire eklenir + KDV'si collectedKdv'ye. */
  packagingUnitFee?: number;
}

/** Tek kalemin finansal kırılımı (hepsi TRY, KDV-dahil tutarlar). */
export interface ItemFinancials {
  supplierId: string;
  supplierName: string;
  qty: number;
  isDealerReturn: boolean;
  /** EKONOMİK mal maliyeti (TÜM adet, KDV-dahil). Kâr raporları. */
  cogs: number;
  /** Tedarikçiye FİİLEN ödenen nakit (supplierUnitQty, KDV-dahil). Cüzdan. */
  walletCost: number;
  /** Gelir KDV-dahil (dealer_return'da YALNIZCA platform komisyonu). */
  revenue: number;
  /** Müşteriden tahsil edilen satış KDV'si. */
  collectedKdv: number;
  /** Alışta ödenen (maliyete gömülü) KDV. */
  paidKdv: number;
  /** Maliyet snapshot'ı 0/boş → "tahmini" uyarısı için. */
  zeroCost: boolean;
}

/**
 * Bir kalemin tüm finansal büyüklüklerini TEK çözümlemeyle üretir.
 * Tedarikçi atfı, COGS, cüzdan maliyeti, gelir, KDV ve dealer_return özel
 * kuralı burada — başka yerde tekrar hesaplanmaz.
 */
export function computeItemFinancials(
  item: FinancialItem,
  ctx: OrderFinancialContext,
): ItemFinancials {
  const { id: resolvedId, name } = resolveSupplier(item);
  const supplierId = resolvedId ?? DELETED_SUPPLIER_ID;
  const supplierName = resolvedId ? name : DELETED_SUPPLIER_NAME;
  const qty = item.qty;
  const isDealerReturn = item.fulfillmentSource === 'dealer_return';

  // ── BAYİLER-ARASI İADE: yalnız platform komisyonu gelir; maliyet/KDV yok ──
  if (isDealerReturn) {
    const pct =
      item.returnDealerCommissionPercent ??
      ctx.dealerReturnCommissionPercent ??
      DEFAULT_DEALER_RETURN_COMMISSION_PERCENT;
    const commission = toNum(item.unitPrice) * qty * (pct / 100);
    return {
      supplierId,
      supplierName,
      qty,
      isDealerReturn: true,
      cogs: 0,
      walletCost: 0,
      revenue: commission,
      collectedKdv: 0,
      paidKdv: 0,
      zeroCost: false,
    };
  }

  // ── NORMAL (tedarikçi / depo) kalem ────────────────────────────────────
  const vatConfig = resolvedId ? (ctx.vatBySupplier.get(supplierId) ?? null) : null;
  const purchaseVatRate = vatConfig?.purchaseVatRate ?? 20;
  const costPrice = item.costPriceSnapshot ?? item.product?.costPrice ?? null;

  const cogs = calcItemSupplyCost(costPrice, qty, vatConfig);
  const walletCost = calcItemSupplyCost(costPrice, supplierUnitQty(item), vatConfig);
  // Paketleme ücreti KDV-DAHİL (kullanıcı kararı): gelire eklenir + KDV'si
  // tahsil edilen satış KDV'sine girer (KDV farkına yansır).
  const packagingTotal = (ctx.packagingUnitFee ?? 0) * qty;
  const revenue =
    toNum(item.unitPrice) * qty * (1 + ctx.saleKdvRate / 100) + packagingTotal;
  const collectedKdv =
    calcItemCollectedKdv(item.unitPrice, qty, ctx.saleKdvRate) +
    calcPackagingKdvPortion(packagingTotal, ctx.saleKdvRate);
  const paidKdv = calcSupplyKdvPortion(cogs, purchaseVatRate);

  return {
    supplierId,
    supplierName,
    qty,
    isDealerReturn: false,
    cogs,
    walletCost,
    revenue,
    collectedKdv,
    paidKdv,
    zeroCost: toNum(costPrice) === 0,
  };
}

/** Sipariş düzeyinde toplanmış finansal sonuç. */
export interface OrderFinancials {
  /** Gelir KDV-dahil (ürün + dealer_return komisyonu). */
  revenue: number;
  /** Ekonomik mal maliyeti KDV-dahil (kâr raporları). */
  cogs: number;
  /** Tedarikçiye fiilen ödenen nakit KDV-dahil (cüzdan). */
  walletCost: number;
  collectedKdv: number;
  paidKdv: number;
  /** Net KDV = tahsil − ödenen. */
  netKdv: number;
  /** Kart komisyon kârı (ayrı kalem). */
  cardCommissionSpread: number;
  /** KDV-dahil brüt marj = (gelir − cogs) + kart komisyon kârı. */
  grossMarginKdvIncl: number;
  /** KDV-hariç net kâr (merkezî kâr). */
  netProfitKdvExcl: number;
  zeroCostItemCount: number;
  items: ItemFinancials[];
}

/**
 * Bir siparişin tüm kalemlerini toplayıp merkezî kârı üretir. Kart komisyon
 * kârı AYRI satır olarak eklenir (composeCentralProfit invariantı korunur).
 */
export function computeOrderFinancials(
  items: FinancialItem[],
  ctx: OrderFinancialContext,
): OrderFinancials {
  let revenue = 0;
  let cogs = 0;
  let walletCost = 0;
  let collectedKdv = 0;
  let paidKdv = 0;
  let zeroCostItemCount = 0;
  const breakdown: ItemFinancials[] = [];

  for (const item of items) {
    const fin = computeItemFinancials(item, ctx);
    revenue += fin.revenue;
    cogs += fin.cogs;
    walletCost += fin.walletCost;
    collectedKdv += fin.collectedKdv;
    paidKdv += fin.paidKdv;
    if (fin.zeroCost) zeroCostItemCount += fin.qty;
    breakdown.push(fin);
  }

  const cardCommissionSpread = ctx.card
    ? calcCardCommissionSpread(ctx.card)
    : 0;

  const central = composeCentralProfit({
    revenue,
    cost: cogs,
    collectedKdv,
    paidKdv,
    cardCommissionSpread,
  });

  return {
    revenue,
    cogs,
    walletCost,
    collectedKdv,
    paidKdv,
    netKdv: central.netKdv,
    cardCommissionSpread,
    grossMarginKdvIncl: central.grossMarginKdvIncl,
    netProfitKdvExcl: central.netProfitKdvExcl,
    zeroCostItemCount,
    items: breakdown,
  };
}

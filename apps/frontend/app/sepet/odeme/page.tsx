"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, ChevronRight, ShieldCheck } from "lucide-react";
import { formatPrice } from "@/lib/api";
import { apiCustomer, useCustomer } from "@/lib/auth";
import { LANDING_URLS } from "@/lib/urls";
import { useCartStore, useHydratedCart } from "@/lib/cart";
import { countDistinctSuppliers } from "@/lib/cart-split";
import { cartItemUnitPrice, cartSubtotal } from "@/lib/dealer-pricing";
import {
  useCheckoutStore,
  isSelfShippingComplete,
  buildSelfAddressLine,
} from "@/lib/checkout-state";
import {
  createOrder,
  SELF_CARGO_FEE,
  type InsufficientItem,
} from "@/lib/orders";
import { usePublicPricing } from "@/lib/pricing";
import { CheckoutSteps } from "@/components/cart/CheckoutSteps";
import { PaymentLogos } from "@/components/PaymentLogos";
import {
  ShippingInfoCard,
  type SavedAddress,
} from "@/components/cart/ShippingInfoCard";
import { useEffectivePrices } from "@/components/EffectivePricesProvider";

// Komisyon oranı rozeti — diğer yüzeylerle (kart yükleme modalı) tutarlı
// tr-TR biçimi (örn. %2,49), ham nokta ondalık değil.
const RATE_FORMATTER = new Intl.NumberFormat("tr-TR", {
  maximumFractionDigits: 2,
});

function isSavedAddressArray(value: unknown): value is SavedAddress[] {
  return (
    Array.isArray(value) &&
    value.every(
      (v) =>
        v !== null &&
        typeof v === "object" &&
        typeof (v as { id?: unknown }).id === "string",
    )
  );
}

function extractSavedAddresses(payload: unknown): SavedAddress[] {
  if (isSavedAddressArray(payload)) return payload;
  if (
    payload &&
    typeof payload === "object" &&
    "data" in payload &&
    isSavedAddressArray((payload as { data?: unknown }).data)
  ) {
    return (payload as { data: SavedAddress[] }).data;
  }
  return [];
}

type SalesChannelKey = "self" | "other";

type CargoKey = "ARAS" | "SURAT" | "PTT" | "DHL" | "YURTICI";

const CHANNEL_LABELS: Record<SalesChannelKey, string> = {
  self: "Kendim İçin",
  other: "Diğer Satış Kanalı",
};

const CARGO_LABELS: Record<CargoKey, string> = {
  ARAS: "Aras Kargo",
  SURAT: "Sürat Kargo",
  PTT: "PTT Kargo",
  DHL: "DHL Kargo",
  YURTICI: "Yurtiçi Kargo",
};

export default function OdemePage() {
  const router = useRouter();
  const items = useHydratedCart((s) => s.items);
  const clear = useCartStore((s) => s.clear);
  const { customer } = useCustomer();
  const pricing = usePublicPricing();
  const KDV_RATE = pricing.kdvRate / 100;
  const PACKAGING_PER_UNIT = pricing.packagingUnitFee;

  // ADMIN_DISCOUNT müşterilerine birim fiyatları backend'in döndürdüğü
  // effectivePrice ile göstermek için sepet slug'larını provider'a kaydet.
  // STANDARD müşteride harita boş döner; mevcut bayi indirimi akışı bozulmaz.
  const {
    pricesBySlug: effectivePriceBySlug,
    registerSlug,
    isAdminDiscount,
  } = useEffectivePrices();
  useEffect(() => {
    if (!items) return;
    for (const it of items) {
      if (it.slug) registerSlug(it.slug);
    }
  }, [items, registerSlug]);

  const marketplace = useCheckoutStore((s) => s.marketplace);
  const cargoCompany = useCheckoutStore((s) => s.cargoCompany);
  const cargoBarcode = useCheckoutStore((s) => s.cargoBarcode);
  const endCustomerName = useCheckoutStore((s) => s.endCustomerName);
  const selfShipping = useCheckoutStore((s) => s.selfShipping);
  const pdfUrl = useCheckoutStore((s) => s.pdfUrl);
  const pdfKey = useCheckoutStore((s) => s.pdfKey);
  const orderNote = useCheckoutStore((s) => s.orderNote);
  const resetCheckout = useCheckoutStore((s) => s.reset);

  // "Kendim İçin" modu — tek serbest-metin adres + sabit kargo bedeli.
  const isSelf = marketplace === "self";

  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([]);
  const [cariBalance, setCariBalance] = useState<number | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<"card" | "cari_balance">(
    "cari_balance",
  );
  // Kart komisyon oranı (%) — aktif POS sitesi oranı. null ise komisyon
  // satırı gizlenir ama kart yine seçilebilir; kesin hesabı backend yapar,
  // buradaki tutar yalnızca GÖSTERİMDİR.
  const [cardFeeRate, setCardFeeRate] = useState<number | null>(null);
  // Kart ödemesi sitede açık mı (aktif POS var mı)? false → "ÇOK YAKINDA".
  const [cardAvailable, setCardAvailable] = useState(false);
  const [insufficient, setInsufficient] = useState<InsufficientItem[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Mesafeli satış sözleşmesi onayı — bilinçli olarak DEFAULT İŞARETLİ
  // (müşteri her siparişte yeniden tiklemek zorunda kalmasın); istenirse
  // kaldırılabilir, kaldırılmışsa sipariş verilemez.
  const [contractAccepted, setContractAccepted] = useState(true);

  // Sepet boşsa /sepet'e dön.
  useEffect(() => {
    if (items !== undefined && items.length === 0 && !submitting) {
      router.replace("/sepet");
    }
  }, [items, router, submitting]);

  // Sepet bilgileri eksikse, kullanıcıyı /sepet'e geri yolla — bu sayfa artık
  // veri toplamıyor, yalnızca onaylıyor. self: yalnız adres; diğer: kargo/barkod.
  useEffect(() => {
    if (items === undefined || items.length === 0) return;
    if (isSelf) {
      if (!isSelfShippingComplete(selfShipping)) router.replace("/sepet");
      return;
    }
    if (!marketplace || !cargoCompany || !cargoBarcode.trim()) {
      router.replace("/sepet");
    }
  }, [items, isSelf, selfShipping, marketplace, cargoCompany, cargoBarcode, router]);

  // Kayıtlı adresler — varsayılan adres, sipariş için kullanılır.
  useEffect(() => {
    if (!customer) {
      setSavedAddresses([]);
      return;
    }
    let cancelled = false;
    apiCustomer<unknown>("/me/addresses", { method: "GET", general: true })
      .then((res) => {
        if (!cancelled) setSavedAddresses(extractSavedAddresses(res));
      })
      .catch(() => {
        if (!cancelled) setSavedAddresses([]);
      });
    return () => {
      cancelled = true;
    };
  }, [customer]);

  // Kart ödemesi açık mı + komisyon oranı — mount'ta bir kez çekilir.
  // available=false (aktif POS yok / geçici kapalı) → kart seçeneği GRİ,
  // tıklanamaz, "ÇOK YAKINDA" gösterilir. Hata durumunda da kapalı kalır
  // (güvenli taraf); backend zaten kart siparişini reddeder.
  useEffect(() => {
    let cancelled = false;
    apiCustomer<{ available?: boolean; ratePercent: number | null }>(
      "/payments/paytr/card-fee",
      { method: "GET", general: true },
    )
      .then((res) => {
        if (cancelled) return;
        setCardAvailable(res?.available === true);
        const raw = res?.ratePercent;
        const value = typeof raw === "number" ? raw : Number(raw ?? NaN);
        setCardFeeRate(Number.isFinite(value) && value > 0 ? value : null);
      })
      .catch(() => {
        if (!cancelled) {
          setCardAvailable(false);
          setCardFeeRate(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Kart kapalıyken seçim asla kartta kalmasın.
  useEffect(() => {
    if (!cardAvailable && paymentMethod === "card") {
      setPaymentMethod("cari_balance");
    }
  }, [cardAvailable, paymentMethod]);

  const defaultAddress = useMemo<SavedAddress | null>(() => {
    if (savedAddresses.length === 0) return null;
    return (
      savedAddresses.find((a) => a.isDefault === true) ??
      savedAddresses[0] ??
      null
    );
  }, [savedAddresses]);

  const billingAddress = useMemo<SavedAddress | null>(() => {
    if (savedAddresses.length === 0) return null;
    return (
      savedAddresses.find((a) => a.title === "Fatura Adresi") ??
      savedAddresses.find((a) => a.isDefault !== true) ??
      null
    );
  }, [savedAddresses]);

  // Cari bakiye.
  useEffect(() => {
    if (!customer) {
      setCariBalance(null);
      return;
    }
    let cancelled = false;
    setBalanceLoading(true);
    apiCustomer<{
      success?: boolean;
      data?: { balance: number; currency: string };
    }>("/me/cari-balance", { general: true })
      .then((res) => {
        if (cancelled) return;
        const raw = res?.data?.balance;
        const value = typeof raw === "number" ? raw : Number(raw ?? 0);
        setCariBalance(Number.isFinite(value) ? value : 0);
      })
      .catch(() => {
        if (!cancelled) setCariBalance(null);
      })
      .finally(() => {
        if (!cancelled) setBalanceLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [customer]);

  if (items === undefined) {
    return (
      <main className="mx-auto max-w-7xl px-6 py-10">
        <div className="h-40 animate-pulse rounded-2xl bg-[var(--surface-muted)]" />
      </main>
    );
  }

  if (items.length === 0) return null;

  const currency = items[0]?.currency ?? "TRY";
  // Bayi indirimi birim fiyata uygulanır — KDV indirimli ara toplam üzerinden
  // hesaplanır. Backend `orders.service.ts` ile birebir aynı mantık.
  const subtotalExclKdv = cartSubtotal(items, customer, effectivePriceBySlug);
  const totalQuantity = items.reduce((sum, i) => sum + i.qty, 0);
  // self: "Kargo Bedeli" (sabit) paketleme yerine geçer ve KDV'ye TABİDİR (KDV
  // matrahına dahil). Kesin tutarı backend hesaplar; bu yalnız önizleme +
  // cari-yeterlilik. self-DIŞI: paketleme + KDV yalnız ürünlerde (mevcut mantık).
  const selfCargoFee = isSelf ? SELF_CARGO_FEE : 0;
  const kdvAmount = (subtotalExclKdv + selfCargoFee) * KDV_RATE;
  const packagingCost = isSelf ? 0 : totalQuantity * PACKAGING_PER_UNIT;
  const total = subtotalExclKdv + kdvAmount + packagingCost + selfCargoFee;

  // Kart komisyonu — HER ŞEY DAHİL toplamın %X'i; YALNIZCA kartlı ödemede
  // görünür/uygulanır, cari ödemede asla yok. Backend kesin tutarı kendisi
  // snapshot'lar; bu değer yalnızca önizlemedir.
  const cardCommission =
    paymentMethod === "card" && cardFeeRate !== null && cardFeeRate > 0
      ? Math.round(((total * cardFeeRate) / 100) * 100) / 100
      : null;

  const insufficientSlugs = new Set(insufficient.map((i) => i.slug));
  const hasEnoughBalance =
    cariBalance !== null && cariBalance + 1e-6 >= total;
  const cariEligible = !!customer && hasEnoughBalance;

  // Profil + adres bütünlüğü — sipariş için backend zorunluluk listesi.
  // self: kayıtlı adres GEREKMEZ; hesap e-postası + yapılandırılmış teslimat
  // adresi (alıcı/tel/il/ilçe/mahalle/açık adres) yeterli. self-DIŞI: mevcut
  // katı kural (kayıtlı varsayılan adres + profil).
  const profileBasicsComplete = !!(
    customer &&
    customer.name?.trim() &&
    customer.email?.trim() &&
    customer.phone?.trim()
  );
  const shippingComplete = isSelf
    ? !!customer?.email?.trim() && isSelfShippingComplete(selfShipping)
    : !!(
        profileBasicsComplete &&
        defaultAddress &&
        defaultAddress.line1?.trim() &&
        defaultAddress.city?.trim() &&
        defaultAddress.postalCode?.trim()
      );

  async function handleSubmit() {
    setSubmitError(null);
    setInsufficient([]);
    if (!shippingComplete || !customer || (!isSelf && !defaultAddress)) {
      setSubmitError(
        isSelf
          ? "Teslimat bilgileri eksik. Alıcı ad-soyad, telefon, il, ilçe, mahalle ve açık adresi eksiksiz doldurun."
          : "Sipariş bilgileri eksik. Profilinizi ve varsayılan adresinizi tamamlayın.",
      );
      return;
    }
    // items hydration öncesi undefined olabilir — handleSubmit closure'ında
    // sayfa gövdesindeki guard'ın daralması geçerli değil; burada netleştir.
    if (!items || items.length === 0) {
      router.replace("/sepet");
      return;
    }
    if (isSelf) {
      if (!isSelfShippingComplete(selfShipping) || items.length === 0) {
        router.replace("/sepet");
        return;
      }
    } else if (
      !marketplace ||
      !cargoCompany ||
      !cargoBarcode.trim() ||
      !endCustomerName.trim() ||
      items.length === 0
    ) {
      router.replace("/sepet");
      return;
    }
    if (paymentMethod === "cari_balance" && !cariEligible) {
      setSubmitError(
        "Cari bakiyeniz bu sipariş için yeterli değil. Lütfen bakiye yükleyin veya kart ile ödeyin.",
      );
      return;
    }
    if (!contractAccepted) {
      setSubmitError(
        "Sipariş verebilmek için Mesafeli Satış Sözleşmesi’ni onaylamanız gerekir.",
      );
      return;
    }
    // Çoklu tedarikçi guard — sepette 2+ farklı tedarikçi varsa /sepet'e
    // gönder, müşteri orada "Sepeti Paketlere Ayır" akışını tamamlasın.
    if (countDistinctSuppliers(items) > 1) {
      router.replace("/sepet");
      return;
    }

    setSubmitting(true);
    const orderItems = items.map((i) => ({
      productSlug: i.slug,
      qty: i.qty,
    }));
    const result = await createOrder(
      isSelf
        ? {
            // "Kendim İçin": yapılandırılmış teslimat adresi (Basit Kargo etiketine
            // birebir). Kargo firması/barkod/müşteri ismi/PDF gönderilmez — barkod
            // backend'de Basit Kargo'dan otomatik üretilir.
            items: orderItems,
            customer: {
              name: selfShipping.recipientName.trim(),
              email: customer.email.trim(),
              phone: selfShipping.phone.trim(),
              address: {
                line1: buildSelfAddressLine(selfShipping),
                city: selfShipping.cityName.trim(),
                district: selfShipping.townName.trim(),
                country: "TR",
              },
            },
            paymentMethod,
            marketplace: "self",
            orderNote: orderNote?.trim() || undefined,
          }
        : {
            items: orderItems,
            customer: {
              name: (defaultAddress!.fullName || customer.name || "").trim(),
              email: customer.email.trim(),
              phone: (defaultAddress!.phone || customer.phone || "").trim(),
              address: {
                line1: defaultAddress!.line1.trim(),
                city: defaultAddress!.city.trim(),
                postalCode: defaultAddress!.postalCode!.trim(),
                country: "TR",
              },
            },
            paymentMethod,
            cargoCompany: cargoCompany as CargoKey,
            cargoBarcode: cargoBarcode.trim(),
            marketplace: marketplace as SalesChannelKey,
            pdfUrl: pdfUrl ?? undefined,
            pdfKey: pdfKey ?? undefined,
            orderNote: orderNote?.trim() || undefined,
            endCustomerName: endCustomerName.trim(),
          },
    );

    if (result.ok) {
      // Kartlı ödeme: sipariş 'awaiting_payment' oluştu — güvenli kart
      // ödeme sayfasına geç (PayTR iFrame orada açılır, tahsilat sonrası
      // Bildirim URL siparişi onaylar). SEPET BURADA SİLİNMEZ: ödeme
      // başarısız olur ya da müşteri vazgeçerse sepet aynen kalır; temizlik
      // ödeme onaylanınca sonuç sayfasında yapılır.
      if (paymentMethod === "card") {
        router.push(
          `/sepet/odeme/kart/${result.data.orderId}?t=${encodeURIComponent(result.data.token)}`,
        );
        return;
      }
      // Cari: ödeme anında tahsil edildi — sepeti temizle, teşekkürlere git.
      clear();
      resetCheckout();
      router.push(
        `/sepet/tesekkurler/${result.data.orderId}?t=${encodeURIComponent(result.data.token)}`,
      );
      return;
    }

    setSubmitting(false);
    // Backend 422 MULTI_SUPPLIER_CART — sepete dön, kullanıcıyı modal
    // akışına yönlendir. (Frontend gate normalde önce yakalar, bu ikinci
    // savunma hattıdır.)
    if (result.status === 422 && result.code === "MULTI_SUPPLIER_CART") {
      router.replace("/sepet");
      return;
    }
    if (
      result.status === 422 &&
      result.insufficient &&
      result.insufficient.length > 0
    ) {
      setInsufficient(result.insufficient);
      setSubmitError(
        "Bazı ürünlerde yeterli stok bulunmuyor. Lütfen sepeti güncelleyin.",
      );
      return;
    }
    setSubmitError(result.message ?? "Sipariş oluşturulamadı");
  }

  return (
    <main className="mx-auto max-w-[1540px] px-6 pb-10 pt-5">
      <nav className="mb-4 text-sm">
        <Link
          href="/sepet"
          className="inline-flex items-center gap-1 font-semibold text-[var(--text-muted)] hover:text-[var(--brand-navy)]"
        >
          <ArrowLeft className="h-4 w-4" />
          Sepete dön
        </Link>
      </nav>

      <h1 className="text-3xl font-black tracking-tight text-[var(--brand-navy)] sm:text-4xl">
        Ödeme
      </h1>
      <p className="mt-1 text-sm text-[var(--text-muted)]">
        Sipariş bilgileriniz hazır — ödeme yöntemini seçip onaylayın.
      </p>

      <div className="mt-5">
        <CheckoutSteps currentStep={3} />
      </div>

      <div className="mt-6 grid gap-5 xl:grid-cols-[1fr_360px]">
        <div className="space-y-5">
          <ShippingInfoCard
            customer={customer}
            defaultAddress={defaultAddress}
            billingAddress={billingAddress}
            showCompleteness
          />

          <section className="rounded-3xl border border-[var(--border)] bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-sm font-black text-[var(--text)]">
              {isSelf ? "Teslimat Bilgileri" : "Sevkiyat Bilgileri"}
            </h2>
            {isSelf ? (
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs font-semibold text-[var(--text-muted)]">
                    Satış Kanalı
                  </dt>
                  <dd className="mt-0.5 font-black text-[var(--text)]">
                    Kendim İçin
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold text-[var(--text-muted)]">
                    Alıcı
                  </dt>
                  <dd className="mt-0.5 font-black text-[var(--text)]">
                    {selfShipping.recipientName || "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold text-[var(--text-muted)]">
                    Telefon
                  </dt>
                  <dd className="mt-0.5 font-black text-[var(--text)]">
                    {selfShipping.phone || "—"}
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-xs font-semibold text-[var(--text-muted)]">
                    Teslimat Adresi
                  </dt>
                  <dd className="mt-0.5 whitespace-pre-wrap font-black text-[var(--text)]">
                    {buildSelfAddressLine(selfShipping) || "—"}
                    {selfShipping.townName || selfShipping.cityName
                      ? ` — ${[selfShipping.townName, selfShipping.cityName]
                          .filter(Boolean)
                          .join(" / ")}`
                      : ""}
                  </dd>
                </div>
                {orderNote ? (
                  <div className="sm:col-span-2">
                    <dt className="text-xs font-semibold text-[var(--text-muted)]">
                      Sipariş Notu
                    </dt>
                    <dd className="mt-0.5 text-sm font-semibold text-[var(--text)]">
                      {orderNote}
                    </dd>
                  </div>
                ) : null}
              </dl>
            ) : (
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs font-semibold text-[var(--text-muted)]">
                  Satış Kanalı
                </dt>
                <dd className="mt-0.5 font-black text-[var(--text)]">
                  {marketplace
                    ? CHANNEL_LABELS[marketplace as SalesChannelKey] ??
                      marketplace
                    : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-[var(--text-muted)]">
                  Kargo Şirketi
                </dt>
                <dd className="mt-0.5 font-black text-[var(--text)]">
                  {cargoCompany
                    ? CARGO_LABELS[cargoCompany as CargoKey] ?? cargoCompany
                    : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-[var(--text-muted)]">
                  Kargo Barkodu
                </dt>
                <dd className="mt-0.5 font-black text-[var(--text)]">
                  {cargoBarcode || "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-[var(--text-muted)]">
                  Sipariş PDF
                </dt>
                <dd className="mt-0.5 font-semibold text-[var(--text)]">
                  {pdfUrl ? (
                    <span className="text-emerald-700">Yüklendi</span>
                  ) : (
                    <span className="text-[var(--text-muted)]">Yok</span>
                  )}
                </dd>
              </div>
              {endCustomerName ? (
                <div>
                  <dt className="text-xs font-semibold text-[var(--text-muted)]">
                    Müşteri İsmi
                  </dt>
                  <dd className="mt-0.5 font-black text-[var(--text)]">
                    {endCustomerName}
                  </dd>
                </div>
              ) : null}
              {orderNote ? (
                <div className="sm:col-span-2">
                  <dt className="text-xs font-semibold text-[var(--text-muted)]">
                    Sipariş Notu
                  </dt>
                  <dd className="mt-0.5 text-sm font-semibold text-[var(--text)]">
                    {orderNote}
                  </dd>
                </div>
              ) : null}
            </dl>
            )}
            <Link
              href="/sepet"
              className="mt-3 inline-block text-xs font-black text-[var(--brand-blue)] hover:underline"
            >
              Sevkiyat bilgilerini düzenle →
            </Link>
          </section>

          <fieldset className="space-y-3 rounded-3xl border border-[var(--border)] bg-white p-5 shadow-sm">
            <legend className="px-1 text-sm font-black text-[var(--text)]">
              Ödeme yöntemi
            </legend>

            <label
              className={`flex items-start gap-3 rounded-2xl border p-3 transition ${
                !cardAvailable
                  ? "cursor-not-allowed border-[var(--border)] bg-slate-50 opacity-60 grayscale"
                  : paymentMethod === "card"
                  ? "cursor-pointer border-[var(--brand-blue)] ring-2 ring-blue-100"
                  : "cursor-pointer border-[var(--border)] hover:border-[var(--brand-blue)]"
              }`}
            >
              <input
                type="radio"
                name="paymentMethod"
                value="card"
                disabled={!cardAvailable}
                checked={paymentMethod === "card"}
                onChange={() => {
                  if (cardAvailable) setPaymentMethod("card");
                }}
                className="mt-0.5 h-4 w-4 accent-[var(--brand-blue)]"
              />
              <div className="flex-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-black text-[var(--text)]">
                    Kart ile öde
                  </div>
                  {!cardAvailable ? (
                    <span
                      translate="no"
                      className="text-base font-black uppercase tracking-widest text-slate-400"
                    >
                      DEVRE DIŞI
                    </span>
                  ) : paymentMethod === "card" ? (
                    <PaymentLogos height={24} />
                  ) : null}
                </div>
                <div className="text-xs text-[var(--text-muted)]">
                  {cardAvailable
                    ? "Kredi/banka kartıyla güvenli ödeme — bir sonraki adımda güvenli ödeme ekranı açılır."
                    : "Kart ile ödeme şu an devre dışı; cari bakiyenizle ödeyebilirsiniz."}
                </div>
              </div>
            </label>

            <label
              className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-3 transition ${
                !cariEligible
                  ? "cursor-not-allowed border-[var(--border)] bg-slate-50 opacity-60"
                  : paymentMethod === "cari_balance"
                  ? "border-[var(--brand-blue)] ring-2 ring-blue-100"
                  : "border-[var(--border)] hover:border-[var(--brand-blue)]"
              }`}
            >
              <input
                type="radio"
                name="paymentMethod"
                value="cari_balance"
                disabled={!cariEligible}
                checked={paymentMethod === "cari_balance"}
                onChange={() => setPaymentMethod("cari_balance")}
                className="mt-0.5 h-4 w-4 accent-[var(--brand-blue)]"
              />
              <div className="flex-1">
                <div className="text-sm font-black text-[var(--text)]">
                  Cari bakiyemden öde
                </div>
                {!customer ? (
                  <div className="text-xs text-[var(--text-muted)]">
                    Cari bakiye ile ödeme için giriş yapın.
                  </div>
                ) : balanceLoading ? (
                  <div className="text-xs text-[var(--text-muted)]">
                    Bakiye kontrol ediliyor…
                  </div>
                ) : cariBalance === null ? (
                  <div className="text-xs text-[var(--text-muted)]">
                    Bakiye bilgisi alınamadı.
                  </div>
                ) : hasEnoughBalance ? (
                  <div className="text-xs text-[var(--text-muted)]">
                    Mevcut bakiye:{" "}
                    <span className="font-black text-[var(--text)]">
                      {formatPrice(cariBalance, currency)}
                    </span>
                    . Sipariş anında bakiyenizden düşülecektir.
                  </div>
                ) : (
                  <div className="text-xs text-red-600">
                    Bakiyeniz bu sipariş için yetersiz (mevcut:{" "}
                    {formatPrice(cariBalance, currency)}).{" "}
                    <Link
                      href="/hesabim/bakiyem"
                      className="underline hover:text-[var(--brand-blue)]"
                    >
                      Bakiye yükle
                    </Link>
                    .
                  </div>
                )}
              </div>
            </label>

            <div className="flex items-center gap-2 rounded-2xl bg-slate-50 p-3 text-xs text-[var(--text-muted)]">
              <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600" />
              <span>
                Tüm ödemeler 256-bit SSL ile şifrelenir. Kart bilgileriniz
                sistemlerimizde saklanmaz.
              </span>
            </div>
          </fieldset>

          {!shippingComplete ? (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-2xl border border-amber-300 bg-amber-50 p-3 text-sm font-semibold text-amber-900"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Profil bilgileriniz veya varsayılan adresiniz eksik. Yukarıdaki
                kartlardan tamamlayın.
              </span>
            </div>
          ) : null}

          {submitError ? (
            <div
              role="alert"
              className="rounded-2xl border border-red-300 bg-red-50 p-3 text-sm font-semibold text-red-700"
            >
              {submitError}
            </div>
          ) : null}
        </div>

        <aside className="xl:sticky xl:top-24 xl:self-start">
          <div className="rounded-3xl border border-[var(--border)] bg-white p-5 shadow-sm">
            <h2 className="text-base font-black text-[var(--brand-navy)]">
              Sipariş özeti
            </h2>
            <ul className="mt-4 max-h-72 divide-y divide-[var(--border)] overflow-y-auto">
              {items.map((item) => {
                const isShort = insufficientSlugs.has(item.slug);
                const available = insufficient.find(
                  (i) => i.slug === item.slug,
                )?.available;
                const unitPrice = cartItemUnitPrice(
                  item,
                  customer,
                  effectivePriceBySlug,
                );
                const hasDiscount = unitPrice < item.price;
                return (
                  <li
                    key={item.slug}
                    className={`flex justify-between gap-3 py-3 text-sm ${
                      isShort ? "rounded bg-red-50 px-2 text-red-700" : ""
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold">{item.name}</div>
                      <div className="text-xs text-[var(--text-muted)]">
                        {item.qty} ×{" "}
                        {hasDiscount ? (
                          <>
                            <span className="text-[var(--text-muted)] line-through">
                              {formatPrice(item.price, item.currency)}
                            </span>{" "}
                            <span className="font-black text-green-700">
                              {formatPrice(unitPrice, item.currency)}
                            </span>
                            <span className="ml-1 inline-flex rounded-md bg-green-50 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide text-green-700">
                              {isAdminDiscount ? "Admin İndirimi" : "Özel Bayi İndirimi"}
                            </span>
                          </>
                        ) : (
                          formatPrice(unitPrice, item.currency)
                        )}
                      </div>
                      {isShort ? (
                        <div className="text-xs font-black text-red-700">
                          Stok yetersiz
                          {typeof available === "number"
                            ? ` (mevcut: ${available})`
                            : ""}
                        </div>
                      ) : null}
                    </div>
                    <div className="whitespace-nowrap text-sm font-black">
                      {formatPrice(unitPrice * item.qty, item.currency)}
                    </div>
                  </li>
                );
              })}
            </ul>
            <dl className="mt-4 space-y-2 border-t border-[var(--border)] pt-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-[var(--text-muted)]">
                  Ara toplam (KDV hariç)
                </dt>
                <dd className="font-semibold text-[var(--text)]">
                  {formatPrice(subtotalExclKdv, currency)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[var(--text-muted)]">KDV (%{pricing.kdvRate})</dt>
                <dd className="font-semibold text-[var(--text)]">
                  {formatPrice(kdvAmount, currency)}
                </dd>
              </div>
              {packagingCost > 0 ? (
                <div className="flex justify-between">
                  <dt className="text-[var(--text-muted)]">
                    Koruyucu ambalaj ({totalQuantity} × {formatPrice(PACKAGING_PER_UNIT, currency)})
                  </dt>
                  <dd className="font-semibold text-[var(--text)]">
                    {formatPrice(packagingCost, currency)}
                  </dd>
                </div>
              ) : null}
              {selfCargoFee > 0 ? (
                <div className="flex justify-between">
                  <dt className="text-[var(--text-muted)]">Kargo Bedeli</dt>
                  <dd className="font-semibold text-[var(--text)]">
                    {formatPrice(selfCargoFee, currency)}
                  </dd>
                </div>
              ) : null}
              <div className="flex justify-between border-t border-[var(--border)] pt-3 text-base font-black text-[var(--brand-navy)]">
                <dt>Toplam (KDV dahil)</dt>
                <dd>{formatPrice(total, currency)}</dd>
              </div>
              {cardCommission !== null ? (
                <>
                  <div className="flex justify-between">
                    <dt className="text-[var(--text-muted)]">
                      Kart Komisyonu (%{RATE_FORMATTER.format(cardFeeRate ?? 0)})
                    </dt>
                    <dd className="font-semibold text-[var(--text)]">
                      {formatPrice(cardCommission, currency)}
                    </dd>
                  </div>
                  <div className="flex justify-between border-t border-[var(--border)] pt-3 text-base font-black text-[var(--brand-navy)]">
                    <dt>Karttan Çekilecek</dt>
                    <dd>{formatPrice(total + cardCommission, currency)}</dd>
                  </div>
                </>
              ) : null}
            </dl>

            <label className="mt-4 flex cursor-pointer items-start gap-2 text-xs text-[var(--text-muted)]">
              <input
                type="checkbox"
                checked={contractAccepted}
                onChange={(e) => setContractAccepted(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--brand-blue)]"
              />
              <span>
                {/* target="_blank" bilinçli: checkout formu doldurulmuşken
                    sözleşmeye tıklamak sayfadan çıkarıp state'i kaybettirmesin. */}
                <Link
                  href={LANDING_URLS.mesafeliSatis}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold underline hover:text-[var(--brand-blue)]"
                >
                  Mesafeli Satış Sözleşmesi
                </Link>
                {"’ni ve "}
                <Link
                  href={LANDING_URLS.iadeIptal}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold underline hover:text-[var(--brand-blue)]"
                >
                  İptal ve İade Şartları
                </Link>
                {"’nı okudum, onaylıyorum."}
              </span>
            </label>

            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={submitting || !shippingComplete || !contractAccepted}
              translate="no"
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--brand-blue)] px-5 py-3.5 text-sm font-black text-white shadow-sm transition hover:bg-[var(--brand-navy)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting
                ? "Gönderiliyor…"
                : paymentMethod === "cari_balance"
                ? "Cari Bakiyeden Öde"
                : "Ödemeye Geç"}
              {!submitting ? <ChevronRight className="h-4 w-4" /> : null}
            </button>
          </div>
        </aside>
      </div>
    </main>
  );
}

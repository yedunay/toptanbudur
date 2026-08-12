"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, ShoppingCart } from "lucide-react";
import { useHydratedCart, useCartStore } from "@/lib/cart";
import {
  useCheckoutStore,
  isSelfShippingComplete,
  type SelfShipping,
} from "@/lib/checkout-state";
import { SelfShippingForm } from "@/components/cart/SelfShippingForm";
import { useUploadPdf } from "@/lib/use-upload-pdf";
import { apiCustomer, useCustomer } from "@/lib/auth";
import { CheckoutSteps } from "@/components/cart/CheckoutSteps";
import { CartItemsTable } from "@/components/cart/CartItemsTable";
import { SalesChannelCargoPanel } from "@/components/cart/SalesChannelCargoPanel";
import { OrderDocumentsPanel } from "@/components/cart/OrderDocumentsPanel";
import { CartSummary } from "@/components/cart/CartSummary";
import { MultiSupplierWarning } from "@/components/cart/MultiSupplierWarning";
import { SupplierSplitModal } from "@/components/cart/SupplierSplitModal";
import { CargoBarcodeDuplicateModal } from "@/components/cart/CargoBarcodeDuplicateModal";
import { splitCartBySupplier } from "@/lib/cart-split";
import { cartSubtotal } from "@/lib/dealer-pricing";
import {
  checkCargoBarcodeDuplicate,
  fetchCheckoutPolicy,
  SELF_CARGO_FEE,
  type CargoBarcodeMatch,
} from "@/lib/orders";
import { useCartStashStore } from "@/lib/cart-stash";
import { usePublicPricing } from "@/lib/pricing";
import { useEffectivePrices } from "@/components/EffectivePricesProvider";
import {
  ShippingInfoCard,
  type SavedAddress,
} from "@/components/cart/ShippingInfoCard";

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

export default function SepetPage() {
  const router = useRouter();
  const items = useHydratedCart((s) => s.items);
  const setQty = useCartStore((s) => s.setQty);
  const remove = useCartStore((s) => s.remove);
  const { customer } = useCustomer();
  const pricing = usePublicPricing();
  const KDV_RATE = pricing.kdvRate / 100;
  const PACKAGING_PER_UNIT = pricing.packagingUnitFee;

  // ADMIN_DISCOUNT müşterileri için backend'den birim bazlı effectivePrice
  // çek; STANDARD müşteride boş Map döner ve klasik bayi indirimi akışı
  // bozulmaz. Sepetteki tüm slug'ları kayda al → provider batch fetch eder.
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

  // Kayıtlı adresleri çek + varsayılanı tut. Sipariş için tek hakikat
  // kaynağı /me/addresses; bu sayede form dublikasyonu yok.
  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([]);
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

  const defaultAddress = useMemo<SavedAddress | null>(() => {
    if (savedAddresses.length === 0) return null;
    return (
      savedAddresses.find((a) => a.isDefault === true) ??
      savedAddresses[0] ??
      null
    );
  }, [savedAddresses]);

  // Fatura adresi — defaultAddress'ten farklıysa ShippingInfoCard iki ayrı
  // blok gösterir. "Fatura Adresi" başlıklı kayıt varsa onu, yoksa default
  // olmayan ilk kaydı kullan.
  const billingAddress = useMemo<SavedAddress | null>(() => {
    if (savedAddresses.length === 0) return null;
    return (
      savedAddresses.find((a) => a.title === "Fatura Adresi") ??
      savedAddresses.find((a) => a.isDefault !== true) ??
      null
    );
  }, [savedAddresses]);

  const shippingComplete = useMemo<boolean>(() => {
    if (!customer) return false;
    if (!customer.name?.trim()) return false;
    if (!customer.email?.trim()) return false;
    if (!customer.phone?.trim()) return false;
    if (!defaultAddress) return false;
    if (!defaultAddress.line1?.trim()) return false;
    if (!defaultAddress.city?.trim()) return false;
    if (!defaultAddress.postalCode?.trim()) return false;
    return true;
  }, [customer, defaultAddress]);

  // Checkout session state
  const marketplace = useCheckoutStore((s) => s.marketplace);
  const setMarketplace = useCheckoutStore((s) => s.setMarketplace);
  const cargoCompany = useCheckoutStore((s) => s.cargoCompany);
  const setCargoCompany = useCheckoutStore((s) => s.setCargoCompany);
  const cargoBarcode = useCheckoutStore((s) => s.cargoBarcode);
  const setCargoBarcode = useCheckoutStore((s) => s.setCargoBarcode);
  const endCustomerName = useCheckoutStore((s) => s.endCustomerName);
  const setEndCustomerName = useCheckoutStore((s) => s.setEndCustomerName);
  const selfShipping = useCheckoutStore((s) => s.selfShipping);
  const setSelfShipping = useCheckoutStore((s) => s.setSelfShipping);
  const orderNote = useCheckoutStore((s) => s.orderNote);
  const setOrderNote = useCheckoutStore((s) => s.setOrderNote);

  // "Kendim İçin" modu — bayi kendisi için alır: kargo firması/barkod/müşteri
  // ismi SORULMAZ; yapılandırılmış teslimat adresi (Basit Kargo etiketine uygun)
  // toplanır ve kargo barkodu otomatik üretilir. Toplama sabit kargo eklenir.
  const isSelf = marketplace === "self";
  // self için hesap gereği yalnız e-posta gerekli (alıcı ad/tel formdan gelir).
  const selfAccountReady = !!customer?.email?.trim();

  // Alıcı ad/tel'i profilden bir kez ön-doldur (kullanıcı düzenlemesini ezmeden).
  useEffect(() => {
    if (!isSelf || !customer) return;
    const cur = useCheckoutStore.getState().selfShipping;
    const patch: Partial<SelfShipping> = {};
    if (!cur.recipientName.trim() && customer.name?.trim())
      patch.recipientName = customer.name.trim();
    if (!cur.phone.trim() && customer.phone?.trim())
      patch.phone = customer.phone.trim();
    if (Object.keys(patch).length > 0) setSelfShipping(patch);
  }, [isSelf, customer, setSelfShipping]);

  // PDF upload
  const {
    pdfFile,
    pdfUploading,
    pdfUrl,
    pdfKey,
    pdfError,
    handlePdfPick,
    clearPdf,
    setPdfUrl,
  } = useUploadPdf();

  // Sync pdfUrl + pdfKey to checkout store
  const storePdfUrl = useCheckoutStore((s) => s.pdfUrl);
  const setStorePdfUrl = useCheckoutStore((s) => s.setPdfUrl);
  const storePdfKey = useCheckoutStore((s) => s.pdfKey);
  const setStorePdfKey = useCheckoutStore((s) => s.setPdfKey);
  useEffect(() => {
    if (pdfUrl && pdfUrl !== storePdfUrl) setStorePdfUrl(pdfUrl);
  }, [pdfUrl, storePdfUrl, setStorePdfUrl]);
  useEffect(() => {
    if (pdfKey && pdfKey !== storePdfKey) setStorePdfKey(pdfKey);
  }, [pdfKey, storePdfKey, setStorePdfKey]);

  // Selection state
  const [selectedSlugs, setSelectedSlugs] = useState<Set<string>>(
    () => new Set(),
  );

  // Initialize selection when items load
  const itemsLoaded = items !== undefined;
  const [initialized, setInitialized] = useState(false);
  useEffect(() => {
    if (itemsLoaded && !initialized && items && items.length > 0) {
      setSelectedSlugs(new Set(items.map((i) => i.slug)));
      setInitialized(true);
    }
  }, [itemsLoaded, initialized, items]);

  // Sepetteki ürünleri opak tedarikçi UUID'sine göre grupla. 2+ grup varsa
  // "Sepeti Paketlere Ayır" akışı zorunludur — banner gösterilir, ödemeye
  // geçiş kilitlenir (canProceed false). Tedarikçi adı/UUID UI'ya sızmaz;
  // sadece "1. Paket / 2. Paket" etiketleri görünür.
  const supplierGroups = useMemo(() => {
    if (!items || items.length === 0) return [];
    return splitCartBySupplier(items, customer, effectivePriceBySlug);
  }, [items, customer, effectivePriceBySlug]);
  const hasMultipleSuppliers = supplierGroups.length > 1;

  const [splitModalOpen, setSplitModalOpen] = useState(false);
  const setStash = useCartStashStore((s) => s.set);
  const clearCart = useCartStore((s) => s.clear);

  const [duplicateModalOpen, setDuplicateModalOpen] = useState(false);
  const [duplicateMatches, setDuplicateMatches] = useState<CargoBarcodeMatch[]>(
    [],
  );
  const [duplicateBarcode, setDuplicateBarcode] = useState("");

  // Carrier intersection from suppliers
  const allowedCarriers = useMemo(() => {
    if (!items || items.length === 0) return [];
    const carrierSets = items
      .map((i) => i.supplier?.mandatoryCarriers)
      .filter(
        (c): c is string[] => Array.isArray(c) && c.length > 0,
      );
    if (carrierSets.length === 0) return [];
    let intersection = new Set(carrierSets[0]);
    for (let i = 1; i < carrierSets.length; i++) {
      const next = new Set(carrierSets[i]);
      intersection = new Set([...intersection].filter((c) => next.has(c)));
    }
    return Array.from(intersection);
  }, [items]);

  // Auto-select cargo if forced
  const mandatoryCargo = allowedCarriers.length === 1 ? allowedCarriers[0] : null;
  useEffect(() => {
    if (mandatoryCargo && cargoCompany !== mandatoryCargo) {
      setCargoCompany(mandatoryCargo);
    }
  }, [mandatoryCargo, cargoCompany, setCargoCompany]);

  // Sepete sonradan eklenen tedarikçi mevcut seçimi geçersiz kılarsa,
  // eski (artık izinsiz) kargo seçimini otomatik temizle. Aksi halde
  // disabled buton seçili görünmeye devam eder ve canProceed sızabilir.
  useEffect(() => {
    if (
      cargoCompany &&
      allowedCarriers.length > 0 &&
      !allowedCarriers.includes(cargoCompany)
    ) {
      setCargoCompany("");
    }
  }, [cargoCompany, allowedCarriers, setCargoCompany]);

  // Efektif (daha ucuz override) tedarikçi PDF gerektiriyor mu? Vitrin
  // tedarikçisi PDF istemese bile sipariş, alım anında daha ucuz bir PDF'li
  // tedarikçiye düşecekse kutu ŞİMDİDEN gösterilmeli — aksi halde müşteri
  // kutuyu hiç görmez, checkout'ta 400'e çarpar (bkz. #61003950). Backend
  // salt-okunur tahmin döner; asıl zorunluluğu create() yine dayatır.
  const [serverRequiresPdf, setServerRequiresPdf] = useState(false);
  useEffect(() => {
    if (!items || items.length === 0 || marketplace === "self") {
      setServerRequiresPdf(false);
      return;
    }
    let cancelled = false;
    fetchCheckoutPolicy(
      items.map((i) => ({ slug: i.slug, qty: i.qty })),
      marketplace || undefined,
    )
      .then((r) => {
        if (!cancelled) setServerRequiresPdf(r.requiresPdf);
      })
      .catch(() => {
        if (!cancelled) setServerRequiresPdf(false);
      });
    return () => {
      cancelled = true;
    };
  }, [items, marketplace]);

  // requiresPdf from any supplier. Ek olarak efektif override tedarikçisi
  // PDF istiyorsa (serverRequiresPdf) yine zorunlu.
  const requiresPdf = useMemo(() => {
    if (!items) return false;
    const localRequires = items.some((i) => i.supplier?.requiresPdf === true);
    return localRequires || serverRequiresPdf;
  }, [items, serverRequiresPdf]);

  const handleToggle = useCallback(
    (slug: string) => {
      setSelectedSlugs((prev) => {
        const next = new Set(prev);
        if (next.has(slug)) next.delete(slug);
        else next.add(slug);
        return next;
      });
    },
    [],
  );

  const handleToggleAll = useCallback(() => {
    if (!items) return;
    setSelectedSlugs((prev) => {
      const allSelected = items.every((i) => prev.has(i.slug));
      if (allSelected) return new Set();
      return new Set(items.map((i) => i.slug));
    });
  }, [items]);

  const handleQtyChange = useCallback(
    (slug: string, qty: number) => {
      setQty(slug, qty);
    },
    [setQty],
  );

  const handleRemove = useCallback(
    (slug: string) => {
      remove(slug);
      setSelectedSlugs((prev) => {
        const next = new Set(prev);
        next.delete(slug);
        return next;
      });
    },
    [remove],
  );

  // Price calculations — bayi indirimi `customer` üzerinden canlı uygulanır
  // (sepet kaydına gömülmez). KDV indirimli ara toplam üzerinden hesaplanır.
  const currency = items?.[0]?.currency ?? "TRY";
  const subtotalExclKdv = items
    ? cartSubtotal(items, customer, effectivePriceBySlug)
    : 0;
  const totalQuantity = items
    ? items.reduce((sum, i) => sum + i.qty, 0)
    : 0;
  // self: "Kargo Bedeli" (sabit) paketlemenin yerine geçer ve KDV'ye TABİDİR
  // (KDV matrahına dahil). self-DIŞI: paketleme alınır, KDV yalnız ürünlerde.
  const selfCargoFee = isSelf ? SELF_CARGO_FEE : 0;
  const kdvAmount = (subtotalExclKdv + selfCargoFee) * KDV_RATE;
  const packagingCost = isSelf ? 0 : totalQuantity * PACKAGING_PER_UNIT;
  const grandTotal =
    subtotalExclKdv + kdvAmount + packagingCost + selfCargoFee;

  const cargoIsAllowed =
    allowedCarriers.length === 0 || allowedCarriers.includes(cargoCompany);

  // self: yalnızca serbest-metin adres + geçerli profil yeterli (kargo/barkod/
  // müşteri ismi/PDF/kayıtlı adres gerekmez). self-DIŞI: mevcut katı kurallar.
  const canProceed = isSelf
    ? !hasMultipleSuppliers &&
      isSelfShippingComplete(selfShipping) &&
      selfAccountReady
    : !hasMultipleSuppliers &&
      !!marketplace &&
      !!cargoCompany &&
      cargoIsAllowed &&
      cargoBarcode.trim().length > 0 &&
      endCustomerName.trim().length > 0 &&
      (!requiresPdf || !!pdfUrl) &&
      shippingComplete;

  function goToCheckout() {
    router.push("/sepet/odeme");
  }

  /**
   * "Ödemeye Geç" tıklaması.
   *
   * Akış MÜŞTERİYE GÖRE DEĞİŞMEZ — buton metni / disabled aynı kalır.
   * Sadece arka planda kargo barkodu duplicate check yapılır:
   *   - Eşleşme YOK / hata / oturum yok → direkt /sepet/odeme'ye gider
   *   - Eşleşme VAR → uyarı popup'ı açılır; müşteri "Yine de devam et"
   *     derse akış normal devam eder, "Kapat" derse /sepet'te kalır.
   */
  async function handleProceed() {
    if (!canProceed) return;
    // self siparişte kargo barkodu yok → duplicate kontrolü atlanır.
    if (isSelf) {
      goToCheckout();
      return;
    }
    const value = cargoBarcode.trim();
    const { matches } = await checkCargoBarcodeDuplicate(value);
    if (matches.length > 0) {
      setDuplicateBarcode(value);
      setDuplicateMatches(matches);
      setDuplicateModalOpen(true);
      return;
    }
    goToCheckout();
  }

  /**
   * "Bu paketi şimdi sipariş et" → modal'dan gelen handler.
   *
   * Akış:
   *   1. Seçilen grubun kalemleri sepette bırakılır
   *   2. Diğer grupların kalemleri stash'lenir (tb-cart-stash-v1)
   *   3. Modal kapanır
   *   4. Müşteri normal akışla 1. paketi sipariş eder
   *   5. Teşekkür sayfası stash'i pop'layıp tekrar sepete ekler ve toast gösterir
   */
  const handleConfirmSplit = useCallback(
    (selectedSupplierId: string) => {
      if (!items) return;
      const keep: typeof items = [];
      const stash: typeof items = [];
      for (const it of items) {
        const sid = it.supplier?.id ?? "__unknown__";
        if (sid === selectedSupplierId) keep.push(it);
        else stash.push(it);
      }
      if (keep.length === 0) return;
      setStash(stash);
      clearCart();
      for (const k of keep) {
        // toCartItem zaten id'yi koruyor; sadece state'i yeniden inşa ediyoruz.
        useCartStore.setState((s) => ({ items: [...s.items, k] }));
      }
      setSplitModalOpen(false);
    },
    [items, setStash, clearCart],
  );

  // Loading state
  if (items === undefined) {
    return (
      <main className="mx-auto max-w-[1540px] px-6 py-10">
        <div className="h-40 animate-pulse rounded-2xl bg-[var(--surface-muted)]" />
        <div className="mt-4 h-96 animate-pulse rounded-3xl bg-[var(--surface-muted)]" />
      </main>
    );
  }

  // Empty cart
  if (items.length === 0) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-16 text-center">
        <ShoppingCart className="mx-auto h-16 w-16 text-[var(--text-muted)]" />
        <h1 className="mt-4 text-2xl font-black text-[var(--brand-navy)]">
          Sepetiniz boş
        </h1>
        <p className="mt-2 text-[var(--text-muted)]">
          Eklemek istediğiniz ürünleri katalogdan inceleyebilirsiniz.
        </p>
        <Link
          href="/katalog"
          className="mt-6 inline-block rounded-xl bg-[var(--brand-blue)] px-6 py-3 text-sm font-black text-white transition hover:bg-[var(--brand-navy)]"
        >
          Katalog&apos;a git
        </Link>
      </main>
    );
  }

  return (
    <main
      className="mx-auto max-w-[1540px] px-6 pb-10 pt-5"
      style={
        {
          "--ab-bg": "radial-gradient(circle at top right, rgba(18,103,244,0.08), transparent 34rem), #f7faff",
        } as React.CSSProperties
      }
    >
      {/* Breadcrumb + Başlık */}
      <div className="mb-5">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-[var(--text-muted)]">
          <ShoppingCart className="h-4 w-4" />
          <span>Sepet</span>
          <ChevronRight className="h-4 w-4" />
          <span className="font-black text-[var(--text)]">Sipariş Özeti</span>
        </div>

        <div className="flex items-center gap-3">
          <ShoppingCart className="h-9 w-9 text-[var(--brand-blue)]" />
          <div>
            <h1 className="text-3xl font-black tracking-tight text-[var(--brand-navy)] sm:text-4xl">
              Sepetim
            </h1>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              Siparişlerinizi kontrol edin, satış kanalı ve kargo tercihlerinizi
              hızlı tamamlayın.
            </p>
          </div>
        </div>
      </div>

      <CheckoutSteps currentStep={2} />

      <div className="mt-6 grid gap-5 xl:grid-cols-[1fr_340px]">
        <div className="space-y-5">
          <CartItemsTable
            items={items}
            customer={customer}
            selectedSlugs={selectedSlugs}
            effectivePriceBySlug={effectivePriceBySlug}
            isAdminDiscount={isAdminDiscount}
            onToggle={handleToggle}
            onToggleAll={handleToggleAll}
            onQtyChange={handleQtyChange}
            onRemove={handleRemove}
          />

          {hasMultipleSuppliers && (
            <MultiSupplierWarning
              packageCount={supplierGroups.length}
              onOpenSplit={() => setSplitModalOpen(true)}
            />
          )}

          <SalesChannelCargoPanel
            selectedMarketplace={marketplace}
            onMarketplaceChange={setMarketplace}
            selectedCargo={cargoCompany}
            onCargoChange={setCargoCompany}
            allowedCarriers={allowedCarriers}
          />

          {isSelf ? (
            <>
              <SelfShippingForm
                value={selfShipping}
                onChange={setSelfShipping}
              />
              {!selfAccountReady ? (
                <p className="mt-2 text-xs font-semibold text-amber-700">
                  Hesabınızda e-posta adresi tanımlı olmalıdır.
                </p>
              ) : null}
            </>
          ) : (
            <OrderDocumentsPanel
              cargoBarcode={cargoBarcode}
              onBarcodeChange={setCargoBarcode}
              endCustomerName={endCustomerName}
              onEndCustomerNameChange={setEndCustomerName}
              pdfFile={pdfFile}
              pdfUploading={pdfUploading}
              pdfUrl={pdfUrl}
              pdfError={pdfError}
              onPdfPick={handlePdfPick}
              onPdfClear={clearPdf}
              requiresPdf={requiresPdf}
              orderNote={orderNote}
              onNoteChange={setOrderNote}
            />
          )}
        </div>

        <div className="space-y-4 xl:sticky xl:top-24 xl:self-start">
          <ShippingInfoCard
            customer={customer}
            defaultAddress={defaultAddress}
            billingAddress={billingAddress}
            showCompleteness
          />
          <CartSummary
            totalProducts={items.length}
            totalQuantity={totalQuantity}
            subtotalExclKdv={subtotalExclKdv}
            kdvAmount={kdvAmount}
            kdvRatePct={pricing.kdvRate}
            currency={currency}
            packagingCost={packagingCost}
            packagingUnitFee={PACKAGING_PER_UNIT}
            selfCargoFee={selfCargoFee}
            grandTotal={grandTotal}
            canProceed={canProceed}
            onProceed={handleProceed}
          />
        </div>
      </div>

      <SupplierSplitModal
        open={splitModalOpen}
        groups={supplierGroups}
        onClose={() => setSplitModalOpen(false)}
        onConfirm={handleConfirmSplit}
      />

      <CargoBarcodeDuplicateModal
        open={duplicateModalOpen}
        barcode={duplicateBarcode}
        matches={duplicateMatches}
        onClose={() => setDuplicateModalOpen(false)}
        onContinue={() => {
          setDuplicateModalOpen(false);
          goToCheckout();
        }}
      />
    </main>
  );
}

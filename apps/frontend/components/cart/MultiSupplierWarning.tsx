"use client";

import { AlertTriangle, PackageSearch } from "lucide-react";

interface MultiSupplierWarningProps {
  /** Kaç farklı pakete bölündüğü (2+). */
  packageCount: number;
  /** "Sepeti Paketlere Ayır" modalını açan handler. */
  onOpenSplit: () => void;
}

/**
 * Sepette birden fazla depoya/tedarikçiye ait ürün olduğunda gösterilen
 * amber tonlu uyarı banner'ı. GİZLİLİK: Tedarikçi adı/UUID burada
 * gösterilmez — sadece paket sayısı ("X paket") müşteriye iletilir.
 *
 * Bu banner görünür olduğu sürece `canProceed` false tutulur (sepet
 * sayfası bunu zorunlu kılar).
 */
export function MultiSupplierWarning({
  packageCount,
  onOpenSplit,
}: MultiSupplierWarningProps) {
  return (
    <section
      role="alert"
      aria-live="polite"
      className="rounded-3xl border border-amber-300 bg-amber-50 p-5 shadow-sm"
    >
      <div className="flex items-start gap-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber-200 text-amber-800">
          <AlertTriangle className="h-6 w-6" aria-hidden="true" />
        </div>

        <div className="flex-1">
          <h3 className="text-base font-black text-amber-900">
            Sepetiniz {packageCount} ayrı pakete bölünmek zorunda
          </h3>
          <p className="mt-1 text-sm leading-relaxed text-amber-900/90">
            Sepet içeriğinizde birden fazla depomuza ait ürün bulunmaktadır.
            Lütfen kargo paketinizi parçalayınız ve her siparişinizi ürün ürün
            kendi kargo barkodlarıyla giriniz. Sipariş tamamlanabilmesi için
            paketler tek tek girilmelidir.
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={onOpenSplit}
              className="inline-flex items-center gap-2 rounded-xl bg-amber-600 px-4 py-2.5 text-sm font-black text-white shadow-sm transition hover:bg-amber-700 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2"
            >
              <PackageSearch className="h-4 w-4" aria-hidden="true" />
              Sepeti Paketlere Ayır
            </button>
            <span className="text-xs font-semibold text-amber-800/80">
              Paketler ayrılana kadar ödemeye geçilemez.
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

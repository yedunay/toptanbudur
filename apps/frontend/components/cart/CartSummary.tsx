"use client";

import {
  ChevronRight,
  Info,
  ShieldCheck,
} from "lucide-react";
import { formatPrice } from "@/lib/api";

interface CartSummaryProps {
  totalProducts: number;
  totalQuantity: number;
  subtotalExclKdv: number;
  kdvAmount: number;
  kdvRatePct: number;
  currency: string;
  packagingCost: number;
  packagingUnitFee: number;
  /** "Kendim İçin" siparişte eklenen sabit kargo bedeli; 0/undefined ise gizli. */
  selfCargoFee?: number;
  grandTotal: number;
  canProceed: boolean;
  onProceed: () => void;
}

export function CartSummary({
  totalProducts,
  totalQuantity,
  subtotalExclKdv,
  kdvAmount,
  kdvRatePct,
  currency,
  packagingCost,
  packagingUnitFee,
  selfCargoFee,
  grandTotal,
  canProceed,
  onProceed,
}: CartSummaryProps) {
  return (
    <aside>
      <section className="rounded-3xl border border-[var(--border)] bg-white p-5 shadow-sm">
        <h2 className="mb-5 text-xl font-black text-[var(--text)]">
          Sepet Özeti
        </h2>

        <div className="space-y-4">
          <SummaryRow label="Toplam ürün" value={String(totalProducts)} />
          <SummaryRow label="Toplam adet" value={String(totalQuantity)} />
          <SummaryRow
            label="Ara toplam"
            value={formatPrice(subtotalExclKdv, currency)}
          />
          <SummaryRow
            label={`KDV (%${kdvRatePct})`}
            value={formatPrice(kdvAmount, currency)}
          />

          {/* Koruyucu ambalaj — self'te alınmaz (0 → gizli) */}
          {packagingCost > 0 ? (
            <div className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-1.5 text-sm font-semibold text-[var(--text-muted)]">
                Koruyucu ambalaj (+{formatPrice(packagingUnitFee, currency)} / ürün)
                <Info className="h-4 w-4" />
              </span>
              <span className="text-sm font-black text-[var(--text)]">
                {formatPrice(packagingCost, currency)}
              </span>
            </div>
          ) : null}

          {/* Kargo Bedeli — yalnızca "Kendim İçin" siparişte (KDV üstte hesaba dahil) */}
          {selfCargoFee && selfCargoFee > 0 ? (
            <div className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-1.5 text-sm font-semibold text-[var(--text-muted)]">
                Kargo Bedeli
                <Info className="h-4 w-4" />
              </span>
              <span className="text-sm font-black text-[var(--text)]">
                {formatPrice(selfCargoFee, currency)}
              </span>
            </div>
          ) : null}
        </div>

        <div className="my-5 h-px bg-slate-100" />

        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-sm font-black text-[var(--text)]">
              Genel toplam
            </p>
            <p className="mt-1 text-xs font-semibold text-[var(--text-muted)]">
              KDV dahildir.
            </p>
          </div>
          <p className="text-3xl font-black text-[var(--brand-blue)]">
            {formatPrice(grandTotal, currency)}
          </p>
        </div>
      </section>

      <div className="mt-5 space-y-3">
        <button
          type="button"
          onClick={onProceed}
          disabled={!canProceed}
          // translate="no": tarayıcı otomatik çevirisi ödeme butonunu
          // bozmasın ("Ödemeye Geç" yerine melez/anlamsız metin görünmesin).
          translate="no"
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--brand-blue)] px-5 py-4 text-sm font-black text-white shadow-sm transition hover:bg-[var(--brand-navy)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          Ödemeye Geç
          <ChevronRight className="h-5 w-5" />
        </button>

      </div>

      <section className="mt-5 rounded-3xl border border-blue-100 bg-blue-50 p-5">
        <div className="flex gap-3">
          <ShieldCheck className="h-7 w-7 shrink-0 text-[var(--brand-blue)]" />
          <div>
            <p className="text-sm font-black text-[var(--text)]">
              Güvenli ve hızlı sipariş akışı
            </p>
            <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">
              Bilgileriniz güvenle işlenir, siparişiniz en kısa sürede
              hazırlanır.
            </p>
          </div>
        </div>
      </section>
    </aside>
  );
}

function SummaryRow({
  label,
  value,
  hasInfo,
}: {
  label: string;
  value: string;
  hasInfo?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="flex items-center gap-1.5 text-sm font-semibold text-[var(--text-muted)]">
        {label}
        {hasInfo ? <Info className="h-4 w-4" /> : null}
      </span>
      <span className="text-sm font-black text-[var(--text)]">{value}</span>
    </div>
  );
}

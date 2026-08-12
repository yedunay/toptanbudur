"use client";

import { AlertTriangle, Check, Info } from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Satış kanalı ve kargo seçim kartları                               */
/*  Kanal anahtarları backend MARKETPLACE_VALUES ile birebir aynıdır   */
/*  (Order.marketplace = satış kanalı etiketi).                        */
/* ------------------------------------------------------------------ */

interface ChannelOption {
  key: string;
  label: string;
}

interface CargoOption {
  key: string;
  label: string;
  logo: string;
}

const CHANNELS: ChannelOption[] = [
  { key: "self", label: "Kendim İçin" },
  { key: "other", label: "Diğer Satış Kanalı" },
];

const CARGO_OPTIONS: CargoOption[] = [
  { key: "SURAT", label: "Sürat Kargo", logo: "/logolar/suratkargo.png" },
  { key: "YURTICI", label: "Yurtiçi Kargo", logo: "/logolar/yurtici.png" },
  { key: "ARAS", label: "Aras Kargo", logo: "/logolar/aras.png" },
  { key: "PTT", label: "PTT Kargo", logo: "/logolar/pttkargo.png" },
  { key: "DHL", label: "DHL Kargo", logo: "/logolar/dhl.png" },
];

const CARGO_LABELS: Record<string, string> = CARGO_OPTIONS.reduce<
  Record<string, string>
>((acc, o) => {
  acc[o.key] = o.label;
  return acc;
}, {});

function formatCarrierList(keys: readonly string[]): string {
  const labels = keys.map((k) => CARGO_LABELS[k] ?? k);
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} ve ${labels[labels.length - 1]}`;
}

interface SalesChannelCargoPanelProps {
  selectedMarketplace: string;
  onMarketplaceChange: (key: string) => void;
  selectedCargo: string;
  onCargoChange: (key: string) => void;
  allowedCarriers: string[];
}

export function SalesChannelCargoPanel({
  selectedMarketplace,
  onMarketplaceChange,
  selectedCargo,
  onCargoChange,
  allowedCarriers,
}: SalesChannelCargoPanelProps) {
  return (
    <section className="rounded-3xl border border-[var(--border)] bg-white p-4 shadow-sm">
      <h2 className="mb-4 text-lg font-black text-[var(--text)]">
        Satış Kanalı ve Kargo Tercihleri
      </h2>

      {/* Satış kanalı */}
      <div>
        <p className="mb-2 text-sm font-black text-[var(--text)]">
          Satış kanalı seçimi
        </p>
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
          {CHANNELS.map((ch) => {
            const isSelected = selectedMarketplace === ch.key;
            return (
              <button
                key={ch.key}
                type="button"
                onClick={() => onMarketplaceChange(ch.key)}
                className={[
                  "relative flex h-16 items-center justify-center rounded-2xl border bg-white px-3 text-center transition hover:border-[var(--brand-blue)] hover:bg-blue-50",
                  isSelected
                    ? "border-[var(--brand-blue)] ring-2 ring-blue-100"
                    : "border-[var(--border)]",
                ].join(" ")}
              >
                {isSelected ? (
                  <span className="absolute right-2 top-2 grid h-5 w-5 place-items-center rounded-full bg-[var(--brand-blue)] text-white">
                    <Check className="h-3.5 w-3.5" />
                  </span>
                ) : null}
                <span className="text-sm font-black text-[var(--text)]">
                  {ch.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Kargo — "Kendim İçin" siparişlerde kargo seçimi gerekmez (tedarikçiye
          gönderim yok); bunun yerine bilgilendirme gösterilir. */}
      {selectedMarketplace === "self" ? (
        <div className="mt-5 flex items-center gap-3 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-700">
          <Info className="h-5 w-5 shrink-0" />
          <span>
            Kendim İçin siparişlerde kargo şirketi ve barkod gerekmez — yalnızca
            teslimat adresini girmeniz yeterli.
          </span>
        </div>
      ) : (
      <div className="mt-5">
        <div className="mb-2 flex items-center gap-2">
          <p className="text-sm font-black text-[var(--text)]">Kargo seçimi</p>
          {allowedCarriers.length > 0 ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-black uppercase tracking-wide text-rose-700 ring-1 ring-rose-200">
              <AlertTriangle className="h-3 w-3" />
              Zorunlu
            </span>
          ) : null}
        </div>
        <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
          {CARGO_OPTIONS.map((cargo) => {
            const isSelected = selectedCargo === cargo.key;
            const isDisabled =
              allowedCarriers.length > 0 && !allowedCarriers.includes(cargo.key);

            return (
              <button
                key={cargo.key}
                type="button"
                onClick={() => !isDisabled && onCargoChange(cargo.key)}
                disabled={isDisabled}
                className={[
                  "relative flex h-16 items-center justify-center gap-2 rounded-2xl border bg-white px-3 transition",
                  isDisabled
                    ? "cursor-not-allowed border-slate-100 opacity-40"
                    : "hover:border-[var(--brand-blue)] hover:bg-blue-50",
                  isSelected
                    ? "border-[var(--brand-blue)] ring-2 ring-blue-100"
                    : "border-[var(--border)]",
                ].join(" ")}
              >
                {isSelected ? (
                  <span className="absolute right-2 top-2 grid h-5 w-5 place-items-center rounded-full bg-[var(--brand-blue)] text-white">
                    <Check className="h-3.5 w-3.5" />
                  </span>
                ) : null}

                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={cargo.logo}
                  alt={cargo.label}
                  className="h-6 w-auto object-contain"
                />
                <span className="text-sm font-black text-[var(--text)]">
                  {cargo.label}
                </span>
              </button>
            );
          })}
        </div>

        {/* Uyarı şeridi — kargo kartı grid'inin DIŞINDA, tam genişlik tek satır:
            dar bir grid kolonuna sıkışıp alt alta uzamaz; mobil/küçük ekranda da
            bir cümle gibi kompakt durur. */}
        {allowedCarriers.length === 0 ? (
          <div className="mt-3 flex items-center gap-3 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-2.5 text-sm font-semibold text-blue-700">
            <Info className="h-5 w-5 shrink-0" />
            <span>
              Bu siparişiniz için kargo firmasını serbestçe seçebilirsiniz.
            </span>
          </div>
        ) : allowedCarriers.length === 1 ? (
          <div className="mt-3 flex items-center gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-semibold text-rose-700">
            <AlertTriangle className="h-5 w-5 shrink-0" />
            <span>
              Bu sipariş için kargo firması{" "}
              <strong>{formatCarrierList(allowedCarriers)}</strong> olarak{" "}
              <strong>belirlenmiştir</strong>.
            </span>
          </div>
        ) : (
          <div className="mt-3 flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-800">
            <AlertTriangle className="h-5 w-5 shrink-0" />
            <span>
              Bu sipariş için yalnızca{" "}
              <strong>{formatCarrierList(allowedCarriers)}</strong>{" "}
              seçilebilir. Birini seçmeniz <strong>zorunludur</strong>.
            </span>
          </div>
        )}
      </div>
      )}
    </section>
  );
}

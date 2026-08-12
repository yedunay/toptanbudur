import type { CargoKey, MarketplaceKey, MetricTone } from "./types";

export const toneClasses: Record<MetricTone, string> = {
  blue: "bg-blue-50 text-[var(--ab-blue)]",
  green: "bg-green-50 text-green-700",
  orange: "bg-orange-50 text-orange-700",
  purple: "bg-purple-50 text-purple-700",
};

// Satış kanalı rozetleri — üçüncü taraf pazaryeri markası/logosu YOK,
// nötr renk + nokta yeterli (bu yüzden logoSrc/logoAlt alanı da yok).
export interface MarketplaceMeta {
  label: string;
  className: string;
  dotClass: string;
  pillClass: string;
  chartColor: string;
}

export interface CargoMeta {
  label: string;
  className: string;
  pillClass: string;
  barClass: string;
  logoSrc: string;
  logoAlt: string;
}

export const marketplaceMeta: Record<MarketplaceKey, MarketplaceMeta> = {
  self: {
    label: "Kendim İçin",
    className: "text-blue-600",
    dotClass: "bg-[var(--ab-blue)]",
    pillClass: "bg-blue-50 ring-blue-200 text-blue-700",
    chartColor: "#1267f4",
  },
  other: {
    label: "Diğer Satış Kanalı",
    className: "text-slate-700",
    dotClass: "bg-slate-400",
    pillClass: "bg-slate-50 ring-slate-300 text-slate-700",
    chartColor: "#64748b",
  },
};

export const cargoMeta: Record<CargoKey, CargoMeta> = {
  aras: {
    label: "Aras Kargo",
    className: "text-blue-700",
    pillClass: "bg-blue-50 ring-blue-200 text-blue-700",
    barClass: "bg-blue-500",
    logoSrc: "/logolar/aras.png",
    logoAlt: "Aras Kargo logosu",
  },
  surat: {
    label: "Sürat Kargo",
    className: "text-red-600",
    pillClass: "bg-red-50 ring-red-200 text-red-700",
    barClass: "bg-red-500",
    logoSrc: "/logolar/suratkargo.png",
    logoAlt: "Sürat Kargo logosu",
  },
  yurtici: {
    label: "Yurtiçi Kargo",
    className: "text-orange-600",
    pillClass: "bg-orange-50 ring-orange-200 text-orange-700",
    barClass: "bg-orange-500",
    logoSrc: "/logolar/yurtici.png",
    logoAlt: "Yurtiçi Kargo logosu",
  },
  ptt: {
    label: "PTT Kargo",
    className: "text-yellow-700",
    pillClass: "bg-yellow-50 ring-yellow-200 text-yellow-700",
    barClass: "bg-yellow-500",
    logoSrc: "/logolar/pttkargo.png",
    logoAlt: "PTT Kargo logosu",
  },
  dhl: {
    label: "DHL",
    className: "text-red-600",
    pillClass: "bg-rose-50 ring-rose-200 text-rose-700",
    barClass: "bg-rose-500",
    logoSrc: "/logolar/dhl.png",
    logoAlt: "DHL logosu",
  },
};

import {
  DollarSign,
  Percent,
  ShoppingCart,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { formatAmount } from "../../../lib/format";
import type { TedarikciCariSummary } from "../types";

interface TedarikciCariSummaryCardsProps {
  summary: TedarikciCariSummary;
}

interface CardSpec {
  title: string;
  value: number;
  Icon: typeof ShoppingCart;
  iconBg: string;
  iconColor: string;
  valueColor: string;
}

export function TedarikciCariSummaryCards({
  summary,
}: TedarikciCariSummaryCardsProps): React.ReactElement {
  const cards: CardSpec[] = [
    {
      title: "Toplam Alış Tutarı",
      value: summary.totalPurchaseAmount,
      Icon: ShoppingCart,
      iconBg: "bg-blue-100",
      iconColor: "text-blue-600",
      valueColor: "text-blue-700",
    },
    {
      title: "Toplam Satış Tutarı",
      value: summary.totalSalesAmount,
      Icon: TrendingUp,
      iconBg: "bg-emerald-100",
      iconColor: "text-emerald-600",
      valueColor: "text-emerald-700",
    },
    {
      title: "Toplam Brüt Kâr",
      value: summary.totalGrossProfit,
      Icon: DollarSign,
      iconBg: "bg-orange-100",
      iconColor: "text-orange-600",
      valueColor: "text-orange-700",
    },
    {
      title: "Toplam KDV Farkı",
      value: summary.totalVatDifference,
      Icon: Percent,
      iconBg: "bg-purple-100",
      iconColor: "text-purple-600",
      valueColor: "text-purple-700",
    },
    {
      title: "Net Kâr",
      value: summary.netProfit,
      Icon: Wallet,
      iconBg: "bg-sky-100",
      iconColor: "text-sky-600",
      valueColor: "text-sky-700",
    },
  ];

  return (
    <section
      aria-label="Tedarikçi cari özet"
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5"
    >
      {cards.map(({ title, value, Icon, iconBg, iconColor, valueColor }) => (
        <article
          key={title}
          className="flex flex-col gap-3 rounded-2xl border border-[var(--color-border)] bg-white p-4 shadow-sm"
        >
          <div className="flex items-start justify-between gap-3">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
              {title}
            </span>
            <span
              className={`inline-flex h-9 w-9 items-center justify-center rounded-full ${iconBg}`}
              aria-hidden="true"
            >
              <Icon className={`h-4 w-4 ${iconColor}`} />
            </span>
          </div>
          <div className={`text-2xl font-semibold tabular-nums ${valueColor}`}>
            {formatAmount(value)}
          </div>
          <div className="text-xs text-slate-500">Bu Dönem</div>
        </article>
      ))}
    </section>
  );
}

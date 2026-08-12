import type { BalanceMetricTone, MoneyDirection } from "./types";

export const toneClasses: Record<BalanceMetricTone, string> = {
  green: "bg-green-50 text-green-600",
  blue: "bg-blue-50 text-[var(--ab-blue)]",
  orange: "bg-orange-50 text-orange-500",
  purple: "bg-purple-50 text-purple-500",
};

export const valueColorClass: Record<BalanceMetricTone, string> = {
  green: "text-green-600",
  blue: "text-[var(--ab-blue)]",
  orange: "text-orange-500",
  purple: "text-purple-500",
};

export const barColorClass: Record<BalanceMetricTone, string> = {
  green: "bg-green-500",
  blue: "bg-blue-500",
  orange: "bg-orange-400",
  purple: "bg-purple-500",
};

export function amountClass(direction: MoneyDirection): string {
  if (direction === "positive") {
    return "text-green-600";
  }

  if (direction === "negative") {
    return "text-[var(--ab-text)]";
  }

  return "text-slate-600";
}

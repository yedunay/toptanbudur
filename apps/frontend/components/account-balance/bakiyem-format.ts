import type { BalanceLedgerEntry } from "@/lib/customer-api";
import type { BalanceHistoryItem, BalanceStatus, MoneyDirection } from "./types";

const TRY_FORMATTER = new Intl.NumberFormat("tr-TR", {
  style: "currency",
  currency: "TRY",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const DATE_FORMATTER = new Intl.DateTimeFormat("tr-TR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Istanbul",
});

const SHORT_DATE_FORMATTER = new Intl.DateTimeFormat("tr-TR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "Europe/Istanbul",
});

const EMPTY_AMOUNT = "0,00 ₺";

export function formatTRY(value: number): string {
  if (!Number.isFinite(value)) return EMPTY_AMOUNT;
  return TRY_FORMATTER.format(value);
}

export function formatSignedTRY(value: number): string {
  if (!Number.isFinite(value)) return EMPTY_AMOUNT;
  const abs = Math.abs(value);
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${TRY_FORMATTER.format(abs)}`;
}

export function formatDate(input: string | Date | null | undefined): string {
  if (!input) return "-";
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return "-";
  return DATE_FORMATTER.format(d);
}

export function formatShortDate(
  input: string | Date | null | undefined,
): string {
  if (!input) return "-";
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return "-";
  return SHORT_DATE_FORMATTER.format(d);
}

export function toNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export function ledgerLabel(
  type: string,
  topupMethod?: string | null,
): { title: string; method: string } {
  switch (type) {
    case "TOPUP":
      return {
        title: "Bakiye Yüklemesi",
        method:
          topupMethod === "card"
            ? "Kredi/Banka Kartı"
            : "Banka Havalesi / EFT",
      };
    case "ORDER_PAYMENT":
      return { title: "Ürün Alımı", method: "Bakiyeden Tahsilat" };
    case "REFUND":
      return { title: "İptal Ücreti", method: "Sipariş İptali — Bakiyeye Aktarıldı" };
    case "ADJUSTMENT":
      return { title: "Manuel Düzeltme", method: "Admin Tarafından" };
    default:
      return { title: type, method: "Bakiye Hareketi" };
  }
}

export function ledgerStatusLabel(
  type: string,
  topupStatus: string | null | undefined,
): BalanceStatus {
  if (type === "TOPUP") {
    if (topupStatus === "PENDING") return "Beklemede";
    if (topupStatus === "REJECTED") return "Reddedildi";
    if (topupStatus === "APPROVED") return "Onaylandı";
    return "Başarılı";
  }
  if (type === "REFUND") return "Başarılı";
  return "Tamamlandı";
}

export function ledgerDirection(amount: number): MoneyDirection {
  if (amount > 0) return "positive";
  if (amount < 0) return "negative";
  return "neutral";
}

export function ledgerReferenceNo(entry: BalanceLedgerEntry): string {
  if (entry.humanTopupNo) return entry.humanTopupNo;
  if (entry.humanOrderNo) return entry.humanOrderNo;
  if (entry.topupId) return `BKY-${entry.topupId.slice(-6).toUpperCase()}`;
  if (entry.orderId) return `ORD-${entry.orderId.slice(-6).toUpperCase()}`;
  return entry.id.slice(0, 8).toUpperCase();
}

export function mapLedgerEntryToHistoryItem(
  entry: BalanceLedgerEntry,
): BalanceHistoryItem {
  const labels = ledgerLabel(entry.type, entry.topupMethod);
  const amountValue = toNumber(entry.amount);
  // Hediye bakiye kaydı ADJUSTMENT tipindedir; müşteriye "🎁 Hediye Bakiye"
  // olarak gösterilir (nötr "Manuel Düzeltme" yerine kampanya hissi).
  const transactionType = entry.isGift ? "🎁 Hediye Bakiye" : labels.title;
  const paymentMethod = entry.isGift ? "Toptan Budur Hediyesi" : labels.method;
  return {
    id: entry.id,
    date: formatDate(entry.createdAt),
    transactionType,
    description: entry.description ?? transactionType,
    paymentMethod,
    amount: formatSignedTRY(amountValue),
    direction: ledgerDirection(amountValue),
    status: ledgerStatusLabel(entry.type, entry.topupStatus),
    referenceNo: ledgerReferenceNo(entry),
    orderId: entry.orderId,
    humanOrderNo: entry.humanOrderNo,
    topupId: entry.topupId,
    hasReceipt: entry.hasReceipt ?? false,
  };
}

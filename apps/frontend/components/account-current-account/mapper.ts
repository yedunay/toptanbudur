import type { BalanceLedgerEntry } from "@/lib/customer-types";
import type {
  CurrentAccountStatementRow,
  CurrentAccountTransactionType,
} from "./types";

function defaultDescription(e: BalanceLedgerEntry): string {
  if (e.type === "TOPUP") return "Bakiye Yükleme";
  if (e.type === "ORDER_PAYMENT") {
    return e.humanOrderNo
      ? `Sipariş Ödemesi — ${e.humanOrderNo}`
      : "Sipariş Ödemesi";
  }
  if (e.type === "REFUND") {
    return e.humanOrderNo
      ? `İptal Ücreti — ${e.humanOrderNo}`
      : "İptal Ücreti";
  }
  return "Bakiye Düzeltmesi";
}

function asKnownType(value: string): CurrentAccountTransactionType {
  if (
    value === "TOPUP" ||
    value === "ORDER_PAYMENT" ||
    value === "REFUND" ||
    value === "ADJUSTMENT"
  ) {
    return value;
  }
  return "ADJUSTMENT";
}

export function mapLedgerEntryToStatementRow(
  entry: BalanceLedgerEntry,
): CurrentAccountStatementRow {
  const amount = entry.amount;
  const balance = entry.balanceAfter;
  const type = asKnownType(entry.type);

  let loadedAmount: number | null = null;
  let spentAmount: number | null = null;

  if (type === "TOPUP" || type === "REFUND") {
    loadedAmount = Math.abs(amount);
  } else if (type === "ORDER_PAYMENT") {
    spentAmount = Math.abs(amount);
  } else if (type === "ADJUSTMENT") {
    if (amount >= 0) loadedAmount = amount;
    else spentAmount = Math.abs(amount);
  }

  return {
    id: entry.id,
    dateIso: entry.createdAt,
    type,
    description: entry.description ?? defaultDescription(entry),
    humanOrderNo: entry.humanOrderNo,
    orderId: entry.orderId,
    loadedAmount,
    spentAmount,
    balance,
  };
}

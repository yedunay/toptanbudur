import type {
  BalanceBankAccount,
  BalanceLedgerEntry,
  BalanceSummaryResponse,
  BalanceTopupEntry,
} from "@/lib/customer-api";
import type {
  AccountBalancePageData,
  BalanceHistoryItem,
  BalanceMetric,
  BankAccountInfo,
  RecentMovement,
  SuggestionItem,
} from "./types";
import {
  formatDate,
  formatShortDate,
  formatSignedTRY,
  formatTRY,
  ledgerDirection,
  ledgerLabel,
  ledgerReferenceNo,
  ledgerStatusLabel,
  mapLedgerEntryToHistoryItem,
  toNumber,
} from "./bakiyem-format";

const RELATIVE_FORMATTER = new Intl.DateTimeFormat("tr-TR", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Istanbul",
});

const EMPTY_AMOUNT = "0,00 ₺";

function isToday(d: Date): boolean {
  const opts: Intl.DateTimeFormatOptions = {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  };
  const fmt = new Intl.DateTimeFormat("en-CA", opts);
  return fmt.format(d) === fmt.format(new Date());
}

function formatUpdatedAt(input: string | Date | null | undefined): string {
  if (!input) return "-";
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return "-";
  if (isToday(d)) {
    return `Bugün ${RELATIVE_FORMATTER.format(d)}`;
  }
  return formatDate(d);
}

function formatIban(iban: string | null | undefined): string {
  if (!iban) return "-";
  const cleaned = iban.replace(/\s+/g, "").toUpperCase();
  return cleaned.replace(/(.{4})/g, "$1 ").trim();
}

function padLeft(values: number[], length: number): number[] {
  if (values.length >= length) return values.slice(-length);
  const padding = new Array(length - values.length).fill(0);
  return [...padding, ...values];
}

function buildSparkline(values: number[], length = 7): number[] {
  if (values.length === 0) return new Array(length).fill(0);
  const tail = padLeft(values.slice(-length), length);
  return tail.map((v) => Math.max(0, Math.round(Math.abs(v))));
}

function buildUsageBars(values: number[], length = 24): number[] {
  if (values.length === 0) return new Array(length).fill(0);
  const tail = padLeft(values.slice(-length), length);
  const max = Math.max(...tail, 1);
  return tail.map((v) => Math.max(2, Math.round((Math.abs(v) / max) * 30)));
}

function buildBalanceTrend(
  ledger: BalanceLedgerEntry[],
  currentBalance: number,
  length = 10,
): number[] {
  if (ledger.length === 0) return new Array(length).fill(0);
  const sorted = [...ledger].sort(
    (a, b) =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
  const trend: number[] = [];
  let running = currentBalance;
  for (let i = sorted.length - 1; i >= 0 && trend.length < length; i -= 1) {
    trend.unshift(running);
    running -= toNumber(sorted[i]?.amount);
  }
  return padLeft(trend, length).map((v) => Math.max(0, v));
}

interface MapBalanceInput {
  customerName: string;
  balance: number | null;
  summary: BalanceSummaryResponse["data"] | null;
  ledger: BalanceLedgerEntry[];
  topups: BalanceTopupEntry[];
  bankAccounts: BalanceBankAccount[];
}

export function mapBalance(input: MapBalanceInput): AccountBalancePageData {
  const balance = toNumber(input.balance ?? input.summary?.balance);

  const monthlyTopUp = toNumber(input.summary?.monthly.topupSum);
  const monthlyUsage = toNumber(input.summary?.monthly.usageSum);
  const last30DaysUsage = toNumber(input.summary?.last30Days.usageSum);
  const last30DaysUsageCount = toNumber(
    input.summary?.last30Days.usageCount,
  );
  const lifetimeOrderDeductionSum = toNumber(input.summary?.lifetime.usageSum);
  const lifetimeOrderDeductionCount = toNumber(
    input.summary?.lifetime.orderDeductionCount,
  );
  const pendingTopupSum = toNumber(input.summary?.pendingTopup.sum);
  const lastTopupEntry = input.summary?.lastTopup ?? null;

  const ledgerAmounts = input.ledger.map((e) => toNumber(e.amount));
  const topupAmounts = input.ledger
    .filter((e) => e.type === "TOPUP")
    .map((e) => toNumber(e.amount));
  const usageAmounts = input.ledger
    .filter((e) => e.type === "ORDER_PAYMENT")
    .map((e) => Math.abs(toNumber(e.amount)));

  const metrics: BalanceMetric[] = [
    {
      title: "Cari Bakiye",
      value: formatTRY(balance),
      description: "Anlık güncel bakiye",
      tone: "green",
      sparkline: buildSparkline(ledgerAmounts),
    },
    {
      title: "Bu Ay Toplam Yükleme",
      value: formatSignedTRY(monthlyTopUp),
      description: "Bu ay yüklenen bakiye",
      tone: "blue",
      sparkline: buildSparkline(topupAmounts),
    },
    {
      title: "Bu Ay Kullanılan",
      value: monthlyUsage > 0
        ? formatSignedTRY(-monthlyUsage)
        : formatSignedTRY(0),
      description: "Siparişlerde kullanılan",
      tone: "orange",
      sparkline: buildSparkline(usageAmounts),
    },
    {
      title: "Onay Bekleyen Yükleme",
      value: formatTRY(pendingTopupSum),
      description:
        pendingTopupSum > 0 ? "Admin onayı bekliyor" : "Bekleyen talep yok",
      tone: "purple",
      sparkline: buildSparkline(topupAmounts),
    },
  ];

  const bankAccounts: BankAccountInfo[] = input.bankAccounts.map(
    (b, idx): BankAccountInfo => ({
      bankName: b.bankName,
      accountHolder: b.accountName,
      iban: formatIban(b.iban),
      branch: b.branchCode ? `Şube ${b.branchCode}` : "Merkez Şube",
      reference: b.note ?? `Açıklama: ${input.customerName}`,
      isActive: idx === 0,
    }),
  );

  const history: BalanceHistoryItem[] = input.ledger.map(
    mapLedgerEntryToHistoryItem,
  );

  const recentMovements: RecentMovement[] = input.ledger
    .slice(0, 4)
    .map((entry) => {
      const labels = ledgerLabel(entry.type, entry.topupMethod);
      const amountValue = toNumber(entry.amount);
      return {
        id: entry.id,
        title: entry.isGift ? "🎁 Hediye Bakiye" : labels.title,
        date: formatDate(entry.createdAt),
        amount: formatSignedTRY(amountValue),
        direction: ledgerDirection(amountValue),
      };
    });

  const suggestions: SuggestionItem[] = [
    {
      id: "s1",
      title: "Otomatik yükleme limiti tanımlayın",
      description: "Bakiye düştüğünde otomatik yükleme için limit belirleyin.",
      tone: "purple",
    },
    {
      id: "s2",
      title: "Minimum bakiye uyarısı açın",
      description: "Bakiye yetersizliğinde erken uyarı alın.",
      tone: "orange",
    },
    {
      id: "s3",
      title:
        bankAccounts.length > 0
          ? "Banka hesapları aktif"
          : "Banka hesabı tanımlayın",
      description:
        bankAccounts.length > 0
          ? "Havale/EFT ile yükleme yapabilirsiniz."
          : "Havale ile yükleme için banka hesabı bilgilerini görüntüleyin.",
      tone: "green",
    },
  ];

  const lastTopUp = lastTopupEntry
    ? formatSignedTRY(toNumber(lastTopupEntry.amount))
    : "-";
  const lastTopUpDate = lastTopupEntry
    ? formatDate(lastTopupEntry.createdAt)
    : "-";

  const mainTrend = buildBalanceTrend(input.ledger, balance);
  const historyDateRange = computeHistoryDateRange(input.ledger);

  // HEDİYE BAKİYE rozeti — ömür boyu tanımlanan toplam hediye > 0 ise gösterilir.
  const giftTotal = toNumber(input.summary?.gift?.total);
  const giftCount = toNumber(input.summary?.gift?.count);
  const gift =
    giftTotal > 0
      ? { totalLabel: formatTRY(giftTotal), count: giftCount }
      : null;

  const averageOrderDeduction =
    lifetimeOrderDeductionCount > 0
      ? formatTRY(lifetimeOrderDeductionSum / lifetimeOrderDeductionCount)
      : last30DaysUsageCount > 0
        ? formatTRY(last30DaysUsage / last30DaysUsageCount)
        : EMPTY_AMOUNT;

  return {
    updatedAt: formatUpdatedAt(new Date()),
    mainBalance: formatTRY(balance),
    mainTrend,
    metrics,
    bankAccounts,
    usageSummary: {
      usedLastThirtyDays: formatTRY(last30DaysUsage),
      averageOrderDeduction,
      lastTopUp,
      lastTopUpDate,
      bars: buildUsageBars(usageAmounts),
    },
    balanceSummary: {
      availableBalance: formatTRY(balance),
      blockedAmount: formatTRY(pendingTopupSum),
      monthlyTopUp: formatTRY(monthlyTopUp),
      monthlyUsage: formatTRY(monthlyUsage),
    },
    history,
    recentMovements,
    suggestions,
    historyDateRange,
    gift,
  };
}

function computeHistoryDateRange(ledger: BalanceLedgerEntry[]): string {
  if (ledger.length === 0) return "Kayıt yok";
  let minTs = Number.POSITIVE_INFINITY;
  let maxTs = Number.NEGATIVE_INFINITY;
  for (const entry of ledger) {
    const ts = new Date(entry.createdAt).getTime();
    if (!Number.isFinite(ts)) continue;
    if (ts < minTs) minTs = ts;
    if (ts > maxTs) maxTs = ts;
  }
  if (!Number.isFinite(minTs) || !Number.isFinite(maxTs)) return "Kayıt yok";
  const start = formatShortDate(new Date(minTs));
  const end = formatShortDate(new Date(maxTs));
  return start === end ? start : `${start} - ${end}`;
}

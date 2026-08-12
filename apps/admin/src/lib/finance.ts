import { apiFetch, getToken } from "./auth";

// ─────────────────────────────────────────────────────────────────────────────
// Aylık Finans ve Ortak Dağılım Paneli — API istemcisi.
// Tipler backend AdminFinanceService.getMonthlyPanel çıktısıyla BİREBİR; sözleşme
// değişirse iki tarafı birlikte güncelle (apps/backend/src/admin/finance).
// ─────────────────────────────────────────────────────────────────────────────

const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api";

export type FinanceEntryType = "INCOME" | "EXPENSE";
export type FinanceExpenseKind = "RECURRING" | "ONE_TIME";
export type FinanceExpenseStatus = "PAID" | "UNPAID";

export interface FinanceKpi {
  gelen: number;
  giden: number;
  kar: number;
  kdvFarki: number;
}

export interface FinanceKpiBlock {
  current: FinanceKpi;
  previous: FinanceKpi;
  delta: {
    gelen: number | null;
    giden: number | null;
    kar: number | null;
    kdvFarki: number | null;
  };
}

export interface FinanceExpenseRow {
  id: string;
  kind: FinanceExpenseKind;
  templateId: string | null;
  category: string;
  description: string;
  amount: number;
  kdvRate: number;
  status: FinanceExpenseStatus;
  paidByPartnerId: string | null;
  paidByPartnerName: string | null;
  enabled: boolean;
  note: string | null;
}

export interface FinancePartnerDist {
  id: string;
  name: string;
  initials: string | null;
  colorHex: string | null;
  sharePercent: number;
  paidTotal: number;
  expenseCount: number;
  share: number;
  dengeleme: number;
  onerilen: number;
}

export interface FinanceSettlement {
  fromPartnerId: string;
  fromName: string;
  toPartnerId: string;
  toName: string;
  amount: number;
}

export interface FinanceDistribution {
  toplamGelen: number;
  toplamGiden: number;
  toplamKar: number;
  toplamKdvFarki: number;
  havuzMasraf: number;
  cardSpread: number;
  promo: number;
  dagitilabilirBakiye: number;
  partners: FinancePartnerDist[];
  settlement: FinanceSettlement | null;
}

export interface FinanceAdvance {
  id: string;
  partnerId: string;
  partnerName: string | null;
  month: string;
  advanceDate: string;
  grossAmount: number;
  netAmount: number;
  description: string | null;
}

export interface FinancePartnerCapital {
  id: string;
  name: string;
  initials: string | null;
  colorHex: string | null;
  sharePercent: number;
  netCredit: number;
  advTotal: number;
  netBalance: number;
}

export interface FinanceCapital {
  monthLabel: string;
  karCum: number;
  kdvFarkiCum: number;
  poolCum: number;
  promoCum: number;
  cardSpreadCum: number;
  netDistCum: number;
  partners: FinancePartnerCapital[];
  netTotal: number;
  advances: FinanceAdvance[];
}

export interface FinanceTrendPoint {
  month: string;
  label: string;
  gelen: number;
  giden: number;
  kar: number;
}

export interface FinanceTransaction {
  date: string | null;
  company: "Toptan Budur" | "Manuel Kayıt";
  description: string;
  category: string | null;
  paidByName: string | null;
  amount: number;
  sign: "positive" | "negative";
}

export interface TraceStep {
  label: string;
  formula: string;
  inputs?: Array<{ label: string; value: string }>;
  result: number;
  source: string;
  note?: string;
}

export interface TraceSection {
  key: string;
  title: string;
  description?: string;
  steps: TraceStep[];
}

export interface CalculationTrace {
  month: string;
  monthLabel: string;
  sections: TraceSection[];
}

export interface FinanceMonthlyPanel {
  month: string;
  monthLabel: string;
  prevMonth: string;
  prevMonthLabel: string;
  bayi: FinanceKpiBlock;
  entegrasyon: FinanceKpiBlock;
  toplam: FinanceKpi;
  expenses: {
    recurring: FinanceExpenseRow[];
    oneTime: FinanceExpenseRow[];
    total: number;
    paidTotal: number;
  };
  distribution: FinanceDistribution;
  capital: FinanceCapital;
  partners: FinancePartnerDist[];
  trend: FinanceTrendPoint[];
  recentTransactions: FinanceTransaction[];
  trace: CalculationTrace;
}

export interface IntegrationEntry {
  id: string;
  month: string;
  entryDate: string;
  type: FinanceEntryType;
  description: string;
  amount: number;
  kdvRate: number;
  category: string | null;
}

export interface ExpenseTemplate {
  id: string;
  category: string;
  description: string;
  amount: number;
  kdvRate: number;
  paidByPartnerId: string | null;
  isActive: boolean;
  startMonth: string;
  endMonth: string | null;
}

export interface FinancePartner {
  id: string;
  name: string;
  initials: string | null;
  colorHex: string | null;
  sharePercent: number;
  isActive: boolean;
  sortOrder: number;
}

// ── Panel ────────────────────────────────────────────────────────────────────
export async function fetchMonthlyPanel(
  month: string,
  trendMonths = 12,
): Promise<FinanceMonthlyPanel> {
  return apiFetch(
    `/admin/finance/monthly?month=${encodeURIComponent(month)}&trendMonths=${trendMonths}`,
  );
}

// ── Ortaklar ───────────────────────────────────────────────────────────────
export async function listPartners(): Promise<FinancePartner[]> {
  return apiFetch(`/admin/finance/partners`);
}

export async function updatePartner(
  id: string,
  body: Partial<Pick<FinancePartner, "name" | "initials" | "colorHex" | "sharePercent" | "isActive" | "sortOrder">>,
): Promise<FinancePartner> {
  return apiFetch(`/admin/finance/partners/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

// ── Manuel gelir/gider satırları ─────────────────────────────────────────────
export interface IntegrationEntryInput {
  entryDate: string;
  type: FinanceEntryType;
  description: string;
  amount: number;
  kdvRate?: number;
  category?: string;
}

export async function listIntegrationEntries(
  month: string,
): Promise<IntegrationEntry[]> {
  return apiFetch(
    `/admin/finance/integration-entries?month=${encodeURIComponent(month)}`,
  );
}

export async function createIntegrationEntry(
  body: IntegrationEntryInput,
): Promise<IntegrationEntry> {
  return apiFetch(`/admin/finance/integration-entries`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updateIntegrationEntry(
  id: string,
  body: Partial<IntegrationEntryInput>,
): Promise<IntegrationEntry> {
  return apiFetch(`/admin/finance/integration-entries/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function deleteIntegrationEntry(id: string): Promise<void> {
  await apiFetch(`/admin/finance/integration-entries/${id}`, {
    method: "DELETE",
  });
}

// ── Sürekli gider tanımları ──────────────────────────────────────────────────
export interface ExpenseTemplateInput {
  category: string;
  description: string;
  amount: number;
  kdvRate?: number;
  paidByPartnerId?: string | null;
  startMonth: string;
  endMonth?: string | null;
  isActive?: boolean;
}

export async function listTemplates(): Promise<ExpenseTemplate[]> {
  return apiFetch(`/admin/finance/expense-templates`);
}

export async function createTemplate(
  body: ExpenseTemplateInput,
): Promise<ExpenseTemplate> {
  return apiFetch(`/admin/finance/expense-templates`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updateTemplate(
  id: string,
  body: Partial<ExpenseTemplateInput>,
): Promise<ExpenseTemplate> {
  return apiFetch(`/admin/finance/expense-templates/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function deleteTemplate(id: string): Promise<void> {
  await apiFetch(`/admin/finance/expense-templates/${id}`, { method: "DELETE" });
}

// ── Aya düşen gider satırları ────────────────────────────────────────────────
export interface ExpenseInput {
  month: string;
  category: string;
  description: string;
  amount: number;
  kdvRate?: number;
  status?: FinanceExpenseStatus;
  paidByPartnerId?: string | null;
  note?: string;
}

export async function createExpense(body: ExpenseInput): Promise<unknown> {
  return apiFetch(`/admin/finance/expenses`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updateExpense(
  id: string,
  body: Partial<Omit<ExpenseInput, "month">> & { enabled?: boolean },
): Promise<unknown> {
  return apiFetch(`/admin/finance/expenses/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function deleteExpense(id: string): Promise<void> {
  await apiFetch(`/admin/finance/expenses/${id}`, { method: "DELETE" });
}

// ── Kâr Avansı (ortak cari çekimi) ───────────────────────────────────────────
export interface AdvanceInput {
  partnerId: string;
  advanceDate: string;
  grossAmount: number;
  netAmount: number;
  description?: string;
}

export async function listAdvances(month?: string): Promise<FinanceAdvance[]> {
  const qs = month ? `?month=${encodeURIComponent(month)}` : "";
  return apiFetch(`/admin/finance/advances${qs}`);
}

export async function createAdvance(body: AdvanceInput): Promise<FinanceAdvance> {
  return apiFetch(`/admin/finance/advances`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updateAdvance(
  id: string,
  body: Partial<AdvanceInput>,
): Promise<FinanceAdvance> {
  return apiFetch(`/admin/finance/advances/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function deleteAdvance(id: string): Promise<void> {
  await apiFetch(`/admin/finance/advances/${id}`, { method: "DELETE" });
}

// ── Dışa aktarım (yetkili blob indirme) ──────────────────────────────────────
async function downloadFile(
  url: string,
  accept: string,
  fallbackName: string,
): Promise<void> {
  const token = getToken();
  const headers = new Headers();
  headers.set("Accept", accept);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(url, { headers, credentials: "include" });
  if (!response.ok) {
    let message = `İndirilemedi (HTTP ${response.status})`;
    try {
      const data = (await response.json()) as { message?: string };
      if (data?.message) message = data.message;
    } catch {
      // binary gövde olabilir
    }
    throw new Error(message);
  }
  const blob = await response.blob();
  const cd = response.headers.get("Content-Disposition");
  let filename = fallbackName;
  if (cd) {
    const m = /filename="?([^";]+)"?/i.exec(cd);
    if (m?.[1]) filename = m[1];
  }
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}

export async function downloadMonthlyXlsx(month: string): Promise<void> {
  await downloadFile(
    `${API_BASE}/admin/finance/monthly/export.xlsx?month=${encodeURIComponent(month)}`,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/octet-stream",
    `aylik-finans-${month}.xlsx`,
  );
}

export async function downloadMonthlyPdf(month: string): Promise<void> {
  await downloadFile(
    `${API_BASE}/admin/finance/monthly/export.pdf?month=${encodeURIComponent(month)}`,
    "application/pdf",
    `aylik-finans-${month}.pdf`,
  );
}

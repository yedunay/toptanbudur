/**
 * Faz 4 — Rapor istemcisi (preview + download + scheduled CRUD).
 */
import { ApiError, apiFetch, getToken } from "./auth";

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api";

export type ReportType =
  | "monthly_sales"
  | "dealer_performance"
  | "inventory_value"
  | "supplier_profit";

export type ReportFormat = "xlsx" | "pdf";

export const REPORT_TYPES: ReadonlyArray<{
  value: ReportType;
  label: string;
  description: string;
}> = [
  {
    value: "monthly_sales",
    label: "Aylık Satış",
    description: "Sipariş & ciro toplamı, kanal/tedarikçi kırılımı.",
  },
  {
    value: "dealer_performance",
    label: "Bayi Performansı",
    description: "Müşteri bazında sipariş adedi, ciro, ortalama sepet.",
  },
  {
    value: "inventory_value",
    label: "Stok Değeri",
    description: "Aktif ürünlerin maliyet × stok değeri snapshot'ı.",
  },
  {
    value: "supplier_profit",
    label: "Tedarikçi Kârlılık",
    description: "Tedarikçi bazında satış/maliyet/kâr/marj.",
  },
];

export type ReportPeriod =
  | "current_month"
  | "last_month"
  | "last_30_days"
  | "last_3_months"
  | "last_6_months"
  | "year_to_date"
  | "last_year"
  | "custom";

export interface ReportSummary {
  type: ReportType;
  rowCount: number;
  rangeFrom: string;
  rangeTo: string;
  totalAmount?: number;
  metrics?: Record<string, number | string>;
}

export type PreviewColumnFormat =
  | "currency"
  | "number"
  | "percent"
  | "date"
  | "datetime"
  | "text";

export interface PreviewColumn {
  key: string;
  label: string;
  align?: "left" | "right" | "center";
  format?: PreviewColumnFormat;
  width?: number;
}

export interface ReportPreview {
  summary: ReportSummary;
  columns: ReadonlyArray<PreviewColumn>;
  rows: ReadonlyArray<Record<string, unknown>>;
  totalRows: number;
  totals?: Record<string, number | string>;
}

export interface ReportPreviewParams {
  type: ReportType;
  from?: string;
  to?: string;
  period?: ReportPeriod;
  supplierId?: string;
}

function buildQuery(params: Record<string, string | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v) sp.set(k, v);
  }
  return sp.toString();
}

export async function fetchReportPreview(
  params: ReportPreviewParams,
): Promise<ReportPreview> {
  const qs = buildQuery({ ...params });
  const res = await apiFetch<{ success: boolean; data: ReportPreview }>(
    `/admin/reports/preview?${qs}`,
  );
  return res.data;
}

export async function downloadReport(
  params: ReportPreviewParams & { format?: ReportFormat },
): Promise<void> {
  const qs = buildQuery({ ...params, format: params.format ?? "xlsx" });
  const token = getToken();
  const headers = new Headers();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const response = await fetch(`${API_BASE}/admin/reports/download?${qs}`, {
    headers,
    credentials: "include",
  });

  if (!response.ok) {
    throw new ApiError(response.status, `İndirme başarısız (HTTP ${response.status})`);
  }

  const blob = await response.blob();
  const disposition = response.headers.get("content-disposition") ?? "";
  const match = /filename="?([^"]+)"?/i.exec(disposition);
  const filename =
    match?.[1] ?? `rapor-${new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Istanbul" })}.xlsx`;

  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}

// ─────────────────────── Scheduled reports ───────────────────────

export interface ReportSchedule {
  id: string;
  name: string;
  reportType: ReportType;
  format: ReportFormat;
  cron: string;
  recipients: string[];
  enabled: boolean;
  params: Record<string, unknown> | null;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduleInput {
  name: string;
  reportType: ReportType;
  format?: ReportFormat;
  cron: string;
  recipients: string[];
  enabled?: boolean;
  params?: Record<string, unknown> | null;
}

export async function fetchSchedules(): Promise<ReportSchedule[]> {
  const res = await apiFetch<{ success: boolean; data: ReportSchedule[] }>(
    "/admin/reports/schedules",
  );
  return res.data;
}

export async function createSchedule(
  input: ScheduleInput,
): Promise<ReportSchedule> {
  const res = await apiFetch<{ success: boolean; data: ReportSchedule }>(
    "/admin/reports/schedules",
    { method: "POST", body: JSON.stringify(input) },
  );
  return res.data;
}

export async function updateSchedule(
  id: string,
  patch: Partial<ScheduleInput>,
): Promise<ReportSchedule> {
  const res = await apiFetch<{ success: boolean; data: ReportSchedule }>(
    `/admin/reports/schedules/${id}`,
    { method: "PATCH", body: JSON.stringify(patch) },
  );
  return res.data;
}

export async function deleteSchedule(id: string): Promise<void> {
  await apiFetch<void>(`/admin/reports/schedules/${id}`, { method: "DELETE" });
}

export async function runScheduleNow(
  id: string,
): Promise<{ status: "success" | "failed"; error?: string }> {
  const res = await apiFetch<{
    success: boolean;
    data: { status: "success" | "failed"; error?: string };
  }>(`/admin/reports/schedules/${id}/run`, { method: "POST" });
  return res.data;
}

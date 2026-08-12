import { ApiError, apiFetch, getToken } from "./auth";

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api";

export type AuditAudience = "admin" | "customer";

/**
 * Loglar sayfası sekme ayrımı (#42). Backend audit.controller bu değeri
 * `logCategory` DB kolonu üzerinden filtreler — audience'tan bağımsızdır.
 */
export type AuditLogCategory = "ADMIN" | "BIRFATURA" | "CUSTOMER";

export interface AuditLogEntry {
  id: string;
  tenantId: string | null;
  actorType: string;
  actorId: string | null;
  actorEmail: string | null;
  actorName: string | null;
  action: string;
  target: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  // Lifted from metadata by the backend response shape
  summary?: string | null;
  targetLabel?: string | null;
  targetType?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  deviceType?: string | null;
  statusCode?: number | null;
  durationMs?: number | null;
  path?: string | null;
  method?: string | null;
}

export interface AuditLogListMeta {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface AuditLogListResponse {
  success: boolean;
  data: AuditLogEntry[];
  meta: AuditLogListMeta;
}

export interface AuditLogFilters {
  page?: number;
  pageSize?: number;
  actorId?: string;
  action?: string;
  from?: string;
  to?: string;
  audience?: AuditAudience;
  /** ADMIN / BIRFATURA / CUSTOMER kova filtresi (#42). */
  logCategory?: AuditLogCategory;
  hideHttp?: boolean;
  q?: string;
}

function buildQuery(filters: AuditLogFilters): string {
  const params = new URLSearchParams();
  if (filters.page) params.set("page", String(filters.page));
  if (filters.pageSize) params.set("pageSize", String(filters.pageSize));
  if (filters.actorId) params.set("actorId", filters.actorId);
  if (filters.action) params.set("action", filters.action);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.audience) params.set("audience", filters.audience);
  if (filters.logCategory) params.set("logCategory", filters.logCategory);
  if (filters.hideHttp === false) params.set("hideHttp", "false");
  if (filters.q) params.set("q", filters.q);
  return params.toString();
}

export async function fetchAuditLogs(
  filters: AuditLogFilters = {},
): Promise<AuditLogListResponse> {
  const qs = buildQuery(filters);
  return apiFetch<AuditLogListResponse>(
    `/admin/audit-logs${qs ? `?${qs}` : ""}`,
  );
}

export interface RecipientsResponse {
  success: boolean;
  data: { emails: string[] };
}

export async function fetchRecipients(): Promise<string[]> {
  const res = await apiFetch<RecipientsResponse>("/admin/audit-logs/recipients");
  return res.data.emails;
}

export async function updateRecipients(emails: string[]): Promise<string[]> {
  const res = await apiFetch<RecipientsResponse>("/admin/audit-logs/recipients", {
    method: "PUT",
    body: JSON.stringify({ emails }),
  });
  return res.data.emails;
}

export interface DigestRunResult {
  success: boolean;
  data: {
    date: string;
    actorCount: number;
    totalEvents: number;
    recipients: string[];
    delivered: "smtp" | "file" | "noop";
    filePath?: string;
  };
}

export async function triggerTestDigest(): Promise<DigestRunResult> {
  return apiFetch<DigestRunResult>("/admin/audit-logs/digest/test", {
    method: "POST",
  });
}

export interface AuditTodaySummary {
  date: string;
  totalEvents: number;
  actorCount: number;
  byAction: Array<{ action: string; count: number }>;
  byActor: Array<{
    actorId: string | null;
    actorType: string | null;
    email: string | null;
    name: string | null;
    count: number;
  }>;
  recent: Array<{
    id: string;
    action: string;
    target: string | null;
    actorEmail: string | null;
    actorName: string | null;
    actorType: string | null;
    createdAt: string;
    summary: string | null;
  }>;
  suspicious: Array<{
    kind: "rapid_delete" | "auth_failures" | "permission_denied";
    actorId: string | null;
    email: string | null;
    count: number;
    windowMinutes: number;
    sample: string[];
  }>;
}

interface AuditTodaySummaryResponse {
  success: boolean;
  data: AuditTodaySummary;
}

export async function fetchAuditTodaySummary(): Promise<AuditTodaySummary> {
  const res = await apiFetch<AuditTodaySummaryResponse>(
    "/admin/audit-logs/today-summary",
  );
  return res.data;
}

export type AuditExportFilters = Pick<
  AuditLogFilters,
  "actorId" | "action" | "from" | "to" | "audience" | "q"
>;

export async function downloadAuditLogExport(
  filters: AuditExportFilters,
): Promise<void> {
  const params = new URLSearchParams();
  if (filters.actorId) params.set("actorId", filters.actorId);
  if (filters.action) params.set("action", filters.action);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.audience) params.set("audience", filters.audience);
  if (filters.q) params.set("q", filters.q);
  const qs = params.toString();

  const token = getToken();
  const headers = new Headers();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const response = await fetch(
    `${API_BASE}/admin/exports/audit-logs${qs ? `?${qs}` : ""}`,
    { headers, credentials: "include" },
  );

  if (!response.ok) {
    throw new ApiError(response.status, `Export failed (HTTP ${response.status})`);
  }

  const blob = await response.blob();
  const disposition = response.headers.get("content-disposition") ?? "";
  const match = /filename="?([^"]+)"?/i.exec(disposition);
  const filename = match?.[1] ?? `loglar-${new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Istanbul" })}.xlsx`;

  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}

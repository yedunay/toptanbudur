import { ApiError, getToken } from "./auth";

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api";

export interface ExportFilters {
  // Products
  q?: string;
  inStock?: boolean;
  supplierId?: string;
  categorySlug?: string;
  brand?: string;
  minPrice?: number;
  maxPrice?: number;
  // Orders
  status?: string;
  customer?: string;
  from?: string;
  to?: string;
  // Common
  scope?: "all" | "filtered";
}

// Modal'daki form key'leri ile backend DTO'sunda beklenen query parametre
// adlarının map'i — frontend "categorySlug" der, backend "category" bekler.
const QUERY_KEY_ALIASES: Record<string, string> = {
  categorySlug: "category",
};

function buildQuery(filters: ExportFilters): string {
  const params = new URLSearchParams();
  for (const [rawKey, value] of Object.entries(filters)) {
    if (value === undefined || value === null) continue;
    if (typeof value === "string" && value.trim().length === 0) continue;
    const key = QUERY_KEY_ALIASES[rawKey] ?? rawKey;
    if (typeof value === "boolean") {
      if (value) params.set(key, "true");
      continue;
    }
    params.set(key, String(value));
  }
  return params.toString();
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Backend export attempt. The API is expected to return a binary XLSX file.
 *   GET /api/admin/<resource>/export?<filters>
 * If the endpoint isn't available (404/501) the caller falls back to CSV.
 */
export async function exportFromBackend(
  resource: "products" | "orders" | "customers" | "xml-customers",
  filters: ExportFilters,
): Promise<{ ok: true; filename: string } | { ok: false; status: number }> {
  const qs = buildQuery(filters);
  const token = getToken();
  const headers = new Headers();
  headers.set(
    "Accept",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/octet-stream",
  );
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const response = await fetch(
    `${API_BASE}/admin/exports/${resource}${qs ? `?${qs}` : ""}`,
    { headers, credentials: "include" },
  );

  if (!response.ok) {
    return { ok: false, status: response.status };
  }
  const blob = await response.blob();
  const cd = response.headers.get("content-disposition") ?? "";
  const match = /filename="?([^"]+)"?/i.exec(cd);
  const stamp = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Istanbul" });
  const filename = match?.[1] ?? `${resource}-${stamp}.xlsx`;
  downloadBlob(blob, filename);
  return { ok: true, filename };
}

/* ---------- Client-side CSV fallback ---------- */

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (/[",\n;]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function exportRowsAsCsv<T extends Record<string, unknown>>(
  rows: T[],
  columns: ReadonlyArray<{ key: keyof T; label: string }>,
  filename: string,
): void {
  const headerLine = columns.map((c) => csvCell(c.label)).join(";");
  const lines = rows.map((row) =>
    columns.map((c) => csvCell(row[c.key])).join(";"),
  );
  // BOM so Excel detects UTF-8 correctly with Turkish characters
  const csv = "﻿" + [headerLine, ...lines].join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  downloadBlob(blob, filename);
}

export function isMissingEndpoint(err: unknown): boolean {
  if (err instanceof ApiError) {
    return err.status === 404 || err.status === 501;
  }
  return false;
}

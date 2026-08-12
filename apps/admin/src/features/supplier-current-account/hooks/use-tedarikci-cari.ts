import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../../../lib/auth";
import type { TedarikciCariQuery, TedarikciCariResponse } from "../types";

const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api";

function buildQueryString(query: TedarikciCariQuery): string {
  const params = new URLSearchParams();
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  if (query.supplierId) params.set("supplierId", query.supplierId);
  if (query.search) params.set("search", query.search);
  if (query.paymentType) params.set("paymentType", query.paymentType);
  if (query.kdvRate) params.set("kdvRate", String(query.kdvRate));
  if (query.page) params.set("page", String(query.page));
  if (query.pageSize) params.set("pageSize", String(query.pageSize));
  return params.toString();
}

export function useTedarikciCari(
  query: TedarikciCariQuery,
  enabled = true,
): ReturnType<typeof useQuery<TedarikciCariResponse>> {
  const qs = buildQueryString(query);
  return useQuery<TedarikciCariResponse>({
    queryKey: ["admin-tedarikci-cari", query],
    queryFn: () =>
      apiFetch<TedarikciCariResponse>(
        `/admin/tedarikci-cari/report${qs ? `?${qs}` : ""}`,
      ),
    enabled,
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });
}

export function buildTedarikciCariExportUrl(query: TedarikciCariQuery): string {
  const params = new URLSearchParams();
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  if (query.supplierId) params.set("supplierId", query.supplierId);
  if (query.search) params.set("search", query.search);
  if (query.paymentType) params.set("paymentType", query.paymentType);
  if (query.kdvRate) params.set("kdvRate", String(query.kdvRate));
  const qs = params.toString();
  const base = `${API_BASE}/admin/tedarikci-cari/export`;
  return qs ? `${base}?${qs}` : base;
}

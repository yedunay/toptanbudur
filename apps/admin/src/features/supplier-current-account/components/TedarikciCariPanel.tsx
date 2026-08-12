import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, getToken } from "../../../lib/auth";
import { useToast } from "../../../components/Toast";
import {
  buildTedarikciCariExportUrl,
  useTedarikciCari,
} from "../hooks/use-tedarikci-cari";
import type {
  TedarikciCariQuery,
  TedarikciCariResponse,
  TedarikciCariSummary,
} from "../types";
import { TedarikciCariCharts } from "./TedarikciCariCharts";
import { TedarikciCariFilters } from "./TedarikciCariFilters";
import { TedarikciCariSummaryCards } from "./TedarikciCariSummaryCards";
import { TedarikciCariTable } from "./TedarikciCariTable";

const URL_PARAM_KEYS = [
  "from",
  "to",
  "supplierId",
  "search",
  "paymentType",
  "kdvRate",
  "page",
  "pageSize",
] as const;

const EMPTY_SUMMARY: TedarikciCariSummary = {
  totalPurchaseAmount: 0,
  totalSalesAmount: 0,
  totalGrossProfit: 0,
  totalVatDifference: 0,
  netProfit: 0,
  orderCount: 0,
  itemCount: 0,
};

function readQueryFromUrl(): TedarikciCariQuery {
  if (typeof window === "undefined") return { page: 1, pageSize: 50 };
  const sp = new URLSearchParams(window.location.search);
  const query: TedarikciCariQuery = { page: 1, pageSize: 50 };
  const from = sp.get("from");
  const to = sp.get("to");
  const supplierId = sp.get("supplierId");
  const search = sp.get("search");
  const paymentType = sp.get("paymentType");
  const kdvRate = sp.get("kdvRate");
  const page = sp.get("page");
  const pageSize = sp.get("pageSize");
  if (from) query.from = from;
  if (to) query.to = to;
  if (supplierId) query.supplierId = supplierId;
  if (search) query.search = search;
  if (paymentType === "cari" || paymentType === "card") {
    query.paymentType = paymentType;
  }
  if (kdvRate === "1" || kdvRate === "10" || kdvRate === "20") {
    query.kdvRate = Number(kdvRate) as 1 | 10 | 20;
  }
  if (page) {
    const parsed = Number(page);
    if (Number.isFinite(parsed) && parsed > 0) query.page = parsed;
  }
  if (pageSize) {
    const parsed = Number(pageSize);
    if (Number.isFinite(parsed) && parsed > 0) query.pageSize = parsed;
  }
  return query;
}

function writeQueryToUrl(query: TedarikciCariQuery): void {
  if (typeof window === "undefined") return;
  const sp = new URLSearchParams(window.location.search);
  // Preserve params we don't own (e.g. `tab`).
  for (const key of URL_PARAM_KEYS) {
    sp.delete(key);
  }
  if (query.from) sp.set("from", query.from);
  if (query.to) sp.set("to", query.to);
  if (query.supplierId) sp.set("supplierId", query.supplierId);
  if (query.search) sp.set("search", query.search);
  if (query.paymentType) sp.set("paymentType", query.paymentType);
  if (query.kdvRate) sp.set("kdvRate", String(query.kdvRate));
  if (query.page && query.page !== 1) sp.set("page", String(query.page));
  if (query.pageSize && query.pageSize !== 50) {
    sp.set("pageSize", String(query.pageSize));
  }
  const qs = sp.toString();
  const next = `${window.location.pathname}${qs ? `?${qs}` : ""}`;
  window.history.replaceState(null, "", next);
}

interface TedarikciCariPanelProps {
  enabled?: boolean;
}

export function TedarikciCariPanel({
  enabled = true,
}: TedarikciCariPanelProps): React.ReactElement {
  const initialQuery = useMemo<TedarikciCariQuery>(
    () => readQueryFromUrl(),
    [],
  );
  const [applied, setApplied] = useState<TedarikciCariQuery>(initialQuery);
  const [draft, setDraft] = useState<TedarikciCariQuery>(initialQuery);
  const [isExporting, setIsExporting] = useState(false);
  const toast = useToast();

  const queryResult = useTedarikciCari(applied, enabled);
  const data: TedarikciCariResponse | undefined = queryResult.data;
  const isLoading = queryResult.isLoading || queryResult.isFetching;

  useEffect(() => {
    writeQueryToUrl(applied);
  }, [applied]);

  useEffect(() => {
    if (queryResult.error instanceof ApiError) {
      toast.push("error", queryResult.error.message);
    } else if (queryResult.error instanceof Error) {
      toast.push("error", queryResult.error.message);
    }
  }, [queryResult.error, toast]);

  const onApply = useCallback((): void => {
    setApplied({ ...draft, page: 1 });
  }, [draft]);

  const onClear = useCallback((): void => {
    const cleared: TedarikciCariQuery = { page: 1, pageSize: 50 };
    setDraft(cleared);
    setApplied(cleared);
  }, []);

  const onPageChange = useCallback(
    (next: number): void => {
      const totalPages = data?.meta.totalPages ?? 1;
      const clamped = Math.max(1, Math.min(totalPages, next));
      setApplied((prev) => ({ ...prev, page: clamped }));
    },
    [data?.meta.totalPages],
  );

  const onExport = useCallback(async (): Promise<void> => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      const token = getToken();
      const url = buildTedarikciCariExportUrl(applied);
      const headers: Record<string, string> = {
        Accept:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      };
      if (token) headers.Authorization = `Bearer ${token}`;
      const response = await fetch(url, {
        method: "GET",
        headers,
        credentials: "include",
      });
      if (!response.ok) {
        let message = `HTTP ${response.status}`;
        try {
          const errData = (await response.json()) as { message?: string };
          if (errData?.message) message = errData.message;
        } catch {
          // ignore
        }
        throw new Error(message);
      }
      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      const stamp = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Istanbul" });
      link.download = `tedarikci-cari-${stamp}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(downloadUrl);
      toast.push("success", "Excel indirildi");
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Excel indirilemedi";
      toast.push("error", message);
    } finally {
      setIsExporting(false);
    }
  }, [applied, isExporting, toast]);

  const suppliers = data?.suppliers ?? [];
  const summary = data?.summary ?? EMPTY_SUMMARY;
  const rows = data?.rows ?? [];
  const meta = data?.meta ?? {
    page: applied.page ?? 1,
    pageSize: applied.pageSize ?? 50,
    total: 0,
    totalPages: 1,
  };
  const profitDistribution = data?.profitDistribution ?? [];
  const monthlyTrend = data?.monthlyTrend ?? [];
  const salesTotalsBySupplier = data?.salesTotalsBySupplier ?? [];

  return (
    <div className="flex flex-col gap-4">
      <TedarikciCariFilters
        draft={draft}
        setDraft={setDraft}
        suppliers={suppliers}
        onApply={onApply}
        onClear={onClear}
        onExport={onExport}
        isExporting={isExporting}
      />

      <TedarikciCariSummaryCards summary={summary} />

      <TedarikciCariCharts
        profitDistribution={profitDistribution}
        monthlyTrend={monthlyTrend}
        salesTotalsBySupplier={salesTotalsBySupplier}
      />

      <TedarikciCariTable
        rows={rows}
        meta={meta}
        summary={summary}
        isLoading={isLoading}
        onPageChange={onPageChange}
      />
    </div>
  );
}

export default TedarikciCariPanel;

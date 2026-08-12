"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  BalanceLedgerEntry,
  CariStatementQuery,
  CariStatementResponse,
  CariStatementSummaryResponse,
} from "@/lib/customer-types";
import { CurrentAccountSummaryCards } from "./CurrentAccountSummaryCards";
import { CurrentAccountTable } from "./CurrentAccountTable";
import { CurrentAccountToolbar } from "./CurrentAccountToolbar";
import { mapLedgerEntryToStatementRow } from "./mapper";
import type {
  CurrentAccountFilters,
  CurrentAccountPageMeta,
  CurrentAccountStatementRow,
  CurrentAccountSummary,
} from "./types";

const DEFAULT_PAGE_SIZE = 50;

interface CurrentAccountPageProps {
  initialBalance: number;
  initialSummary: CurrentAccountSummary | null;
  initialStatement: BalanceLedgerEntry[];
  initialMeta: CurrentAccountPageMeta;
}

function buildStatementUrl(q: CariStatementQuery): string {
  const params = new URLSearchParams();
  if (q.page) params.set("page", String(q.page));
  if (q.pageSize) params.set("pageSize", String(q.pageSize));
  if (q.type) params.set("type", q.type);
  if (q.from) params.set("from", q.from);
  if (q.to) params.set("to", q.to);
  if (q.search) params.set("search", q.search);
  const qs = params.toString();
  return `/api/me/cari-balance/statement${qs ? `?${qs}` : ""}`;
}

// Client-side fetchers. HttpOnly `tb_session` cookie is sent automatically
// for same-origin requests. NEVER reach into localStorage; NEVER add an
// Authorization header — server reads the cookie.
async function fetchStatementClient(
  q: CariStatementQuery,
): Promise<CariStatementResponse | null> {
  try {
    const res = await fetch(buildStatementUrl(q), {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    return (await res.json()) as CariStatementResponse;
  } catch {
    return null;
  }
}

async function fetchStatementSummaryClient(): Promise<CariStatementSummaryResponse | null> {
  try {
    const res = await fetch("/api/me/cari-balance/statement/summary", {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    return (await res.json()) as CariStatementSummaryResponse;
  } catch {
    return null;
  }
}

function buildExportUrl(filters: CurrentAccountFilters): string {
  const params = new URLSearchParams();
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.type) params.set("type", filters.type);
  if (filters.search) params.set("search", filters.search);
  const qs = params.toString();
  return `/api/me/cari-balance/statement/export${qs ? `?${qs}` : ""}`;
}

export function CurrentAccountPage({
  initialBalance,
  initialSummary,
  initialStatement,
  initialMeta,
}: CurrentAccountPageProps) {
  const [summary, setSummary] = useState<CurrentAccountSummary | null>(
    initialSummary ?? {
      currentBalance: initialBalance,
      totalLoaded: 0,
      totalSpent: 0,
      pendingTopupCount: 0,
    },
  );
  const [rows, setRows] = useState<CurrentAccountStatementRow[]>(() =>
    initialStatement.map(mapLedgerEntryToStatementRow),
  );
  const [meta, setMeta] = useState<CurrentAccountPageMeta>(initialMeta);
  const [filters, setFilters] = useState<CurrentAccountFilters>({});
  const [page, setPage] = useState(initialMeta.page ?? 1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isFirstRender = useRef(true);

  const refresh = useCallback(
    async (
      currentFilters: CurrentAccountFilters,
      currentPage: number,
      withSummary: boolean,
    ) => {
      setIsLoading(true);
      setError(null);
      try {
        const [statement, summaryRes] = await Promise.all([
          fetchStatementClient({
            page: currentPage,
            pageSize: DEFAULT_PAGE_SIZE,
            type: currentFilters.type || undefined,
            from: currentFilters.from || undefined,
            to: currentFilters.to || undefined,
            search: currentFilters.search || undefined,
          }),
          withSummary
            ? fetchStatementSummaryClient()
            : Promise.resolve(null),
        ]);

        if (statement?.success) {
          setRows(statement.data.map(mapLedgerEntryToStatementRow));
          setMeta(statement.meta);
        } else {
          setError(
            "Cari hareketler yüklenemedi. Lütfen daha sonra tekrar deneyin.",
          );
        }
        if (withSummary && summaryRes?.success) {
          setSummary(summaryRes.data);
        }
      } catch {
        setError(
          "Cari hareketler yüklenemedi. Lütfen daha sonra tekrar deneyin.",
        );
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    void refresh(filters, page, true);
  }, [filters, page, refresh]);

  const handleApply = useCallback((next: CurrentAccountFilters) => {
    setFilters(next);
    setPage(1);
  }, []);

  const handleExport = useCallback((current: CurrentAccountFilters) => {
    const url = buildExportUrl(current);
    window.location.href = url;
  }, []);

  const handlePageChange = useCallback(
    (next: number) => {
      if (next < 1 || next > meta.totalPages || next === meta.page) return;
      setPage(next);
    },
    [meta.page, meta.totalPages],
  );

  return (
    <div className="flex flex-col gap-5">
      <CurrentAccountSummaryCards summary={summary} />

      <CurrentAccountToolbar
        initial={filters}
        onApply={handleApply}
        onExport={handleExport}
        isLoading={isLoading}
      />

      {error ? (
        <div
          role="alert"
          className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700"
        >
          {error}
        </div>
      ) : null}

      <CurrentAccountTable
        rows={rows}
        meta={meta}
        isLoading={isLoading}
        onPageChange={handlePageChange}
      />
    </div>
  );
}

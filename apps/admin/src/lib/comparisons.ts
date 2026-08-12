import { apiFetch } from "./auth";

const JSON_HEADERS = { "Content-Type": "application/json" };

export interface Competitor {
  id: string;
  name: string;
  type: "competitor" | "supplier";
  feedUrl: string | null;
  priceKdvIncluded: boolean;
  purchaseDiscountPercent: number;
  packagingFee: string | null;
  isDealerPrice: boolean;
  cleanupWords: string[] | null;
  active: boolean;
  lastSyncedAt: string | null;
}

export interface OurSide {
  id: string;
  name: string;
  listGross: number | null;
  cost: number | null;
  supplier: string | null;
  imageUrl: string | null;
  url: string | null;
}

export interface PendingMatch {
  matchId: string;
  confidence: number;
  matchedBy: string | null;
  rival: { name: string; price: string; imageUrl: string | null; url: string | null; code: string; competitor: string; isDealerPrice: boolean };
  ours: OurSide | null;
}

export interface ApprovedMatch extends PendingMatch {
  status: "auto" | "approved";
}

export interface MissingItem {
  id: string;
  name: string;
  price: string;
  imageUrl: string | null;
  productUrl: string | null;
  externalCode: string;
  barcode: string | null;
  competitor: string;
}

export interface SupplierEvalRow {
  name: string;
  supplier: string | null;
  theirPrice: number;
  ourCost: number | null;
  saving: number | null;
  cheaper: boolean;
  rival: string;
}

export interface PriceCompareRow {
  productId: string;
  name: string;
  supplier: string | null;
  ourGross: number | null;
  imageUrl: string | null;
  url: string | null;
  rivals: { competitor: string; price: number; isDealerPrice: boolean; url: string | null }[];
  weCheapest: boolean;
}

export interface OverviewRow {
  id: string;
  name: string;
  type: "competitor" | "supplier";
  isDealerPrice: boolean;
  lastSyncedAt: string | null;
  products: number;
  matched: number;
  pending: number;
  missing: number;
}

export interface Overview {
  totals: { competitors: number; products: number; matched: number; pending: number; missing: number };
  competitors: OverviewRow[];
}

export interface Opportunity {
  productId: string;
  name: string;
  url: string | null;
  imageUrl: string | null;
  ourGross: number;
  rivalName: string;
  rivalPrice: number;
  rivalUrl: string | null;
  advantage: number;
  advantagePct: number;
}

export function fetchOverview() {
  return apiFetch<{ totals: Overview["totals"]; competitors: OverviewRow[] }>("/admin/comparisons/overview");
}

export function fetchOpportunities(take = 40) {
  return apiFetch<{ cheaperCount: number; comparedCount: number; data: Opportunity[] }>(
    `/admin/comparisons/opportunities?take=${take}`,
  );
}

export function fetchCompetitors() {
  return apiFetch<{ data: Competitor[] }>("/admin/comparisons/competitors").then((r) => r.data ?? []);
}

export interface AnalysisRow {
  name: string;
  matched: number;
  cheaper: number;
  expensive: number;
  avgAdvantagePct: number;
}

export interface SupplierAnalysisProduct {
  productId: string;
  name: string; ourCode: string | null; ourImage: string | null; url: string | null; ourStock: number;
  theirName: string; theirCode: string | null; theirImage: string | null; theirUrl: string | null;
  currentSupplier: string | null; ourCost: number; theirCost: number; fark: number; diffPct: number; cheaper: boolean;
  confidence: number; orderQty: number; projectedSaving: number;
  rivalSales: { competitor: string; price: number }[];
}

export interface SupplierAnalysis {
  competitor: { name: string; priceKdvIncluded: boolean; purchaseDiscountPercent: number; packagingFee: number };
  totals: { xmlTotal: number; matched: number; matchedPct: number; cheaper: number; cheaperPct: number; expensive: number; expensivePct: number; avgAdvantagePct: number; worthScore: number };
  insight: { recommend: string; annualSaving: number; switchable: number };
  categories: AnalysisRow[];
  suppliers: AnalysisRow[];
  brands: AnalysisRow[];
  total: number;
  page: number;
  pageSize: number;
  products: SupplierAnalysisProduct[];
}

export function fetchSupplierAnalysis(
  competitorId: string,
  opts: { page?: number; pageSize?: number; priceStatus?: string; stockStatus?: string; q?: string; sortBy?: string; sortDir?: string } = {},
) {
  const p = new URLSearchParams();
  if (opts.page) p.set("page", String(opts.page));
  if (opts.pageSize) p.set("pageSize", String(opts.pageSize));
  if (opts.priceStatus && opts.priceStatus !== "all") p.set("priceStatus", opts.priceStatus);
  if (opts.stockStatus && opts.stockStatus !== "all") p.set("stockStatus", opts.stockStatus);
  if (opts.q && opts.q.trim()) p.set("q", opts.q.trim());
  if (opts.sortBy) { p.set("sortBy", opts.sortBy); p.set("sortDir", opts.sortDir || "desc"); }
  const qs = p.toString();
  return apiFetch<SupplierAnalysis>(`/admin/comparisons/competitors/${competitorId}/supplier-analysis${qs ? `?${qs}` : ""}`);
}

export function supplierAnalysisExportUrl(competitorId: string) {
  return `/admin/comparisons/competitors/${competitorId}/supplier-analysis-export`;
}

export interface CheaperHint {
  productId: string;
  supplierName: string;
  theirCost: string;
  ourCost: string;
  savingPerUnit: string;
}

export function fetchCheaperHints() {
  return apiFetch<{ data: CheaperHint[] }>("/admin/comparisons/cheaper-hints").then((r) => r.data ?? []);
}

export function setCheaperHint(body: {
  productId: string; supplierName: string; competitorId?: string; theirCost: number; ourCost: number; productUrl?: string | null;
}) {
  return apiFetch("/admin/comparisons/cheaper-hint", {
    method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body),
  });
}

export function removeCheaperHint(productId: string) {
  return apiFetch(`/admin/comparisons/cheaper-hint/${productId}`, { method: "DELETE" });
}

export function createCompetitor(body: Partial<Competitor> & { name: string }) {
  return apiFetch<{ data: Competitor }>("/admin/comparisons/competitors", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
}

export function updateCompetitor(id: string, body: Partial<Competitor>) {
  return apiFetch<{ data: Competitor }>(`/admin/comparisons/competitors/${id}`, {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
}

export function deleteCompetitor(id: string) {
  return apiFetch(`/admin/comparisons/competitors/${id}`, { method: "DELETE" });
}

export function syncCompetitor(id: string) {
  return apiFetch<{ ingest: { total: number; upserted: number }; match: { auto: number; pending: number; unmatched: number } }>(
    `/admin/comparisons/competitors/${id}/sync`,
    { method: "POST" },
  );
}

export function fetchPending(ids: string[], take = 50, skip = 0, sort: "conf_desc" | "conf_asc" = "conf_desc") {
  return apiFetch<{ total: number; data: PendingMatch[] }>(
    `/admin/comparisons/pending?${listQs(ids, { take: String(take), skip: String(skip), sort })}`,
  );
}

function listQs(ids: string[], extra: Record<string, string>) {
  const p = new URLSearchParams(extra);
  if (ids.length) p.set("ids", ids.join(","));
  return p.toString();
}

export function fetchApproved(ids: string[], take = 60, skip = 0) {
  return apiFetch<{ total: number; data: ApprovedMatch[] }>(
    `/admin/comparisons/approved?${listQs(ids, { take: String(take), skip: String(skip) })}`,
  );
}

export function decideMatch(matchId: string, status: "approved" | "rejected") {
  return apiFetch(`/admin/comparisons/matches/${matchId}`, {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify({ status }),
  });
}

export function fetchMissing(ids: string[], take = 50, skip = 0) {
  return apiFetch<{ total: number; data: MissingItem[] }>(
    `/admin/comparisons/missing?${listQs(ids, { take: String(take), skip: String(skip) })}`,
  );
}

export function manualMatch(competitorProductId: string, code: string) {
  return apiFetch<{ matched: { productId: string; name: string } }>(
    `/admin/comparisons/competitor-products/${competitorProductId}/manual-match`,
    { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ code }) },
  );
}

export function fetchSupplierEval(competitorId: string) {
  return apiFetch<{ summary: { total: number; cheaper: number; expensive: number }; data: SupplierEvalRow[] }>(
    `/admin/comparisons/competitors/${competitorId}/supplier-eval`,
  );
}

export interface PriceSuggestion {
  mode: "profit" | "offlist";
  currentPct: number;
  pool: number;
  cheaperPct: number;
  lower: { suggestedPct: number; keepCheaperPct: number; gainPct: number } | null;
  raise: { suggestedPct: number; reachCheaperPct: number; coversAll: boolean; marginDropPct: number; unwinnable: number } | null;
}

export interface PriceCompareResult {
  discount: string;
  total: number;
  summary: { cheaper: number; expensive: number };
  suggestion: PriceSuggestion | null;
  data: PriceCompareRow[];
}

export function fetchPriceCompare(customerId: string, search?: string, competitorId?: string) {
  const params = new URLSearchParams({ customerId });
  if (competitorId) params.set("competitorId", competitorId);
  if (search && search.trim()) params.set("q", search.trim());
  return apiFetch<PriceCompareResult>(`/admin/comparisons/price-compare?${params.toString()}`);
}

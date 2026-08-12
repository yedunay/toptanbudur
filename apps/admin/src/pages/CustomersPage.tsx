import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRequireAuth } from "../lib/auth";
import { useDebounce } from "../lib/useDebounce";
import {
  adjustCustomerBalance,
  bulkCustomerAction,
  createTestCustomer,
  fetchCustomers,
  updateCustomerProfile,
  type CustomerFilters,
  type CustomerListItem,
  type CustomersResponse,
} from "../lib/customers";
import { formatTRY } from "../lib/products";
import { formatDateTime } from "../lib/orders";
import { exportFromBackend } from "../lib/exporting";
import { fetchCustomerTags } from "../lib/customer-tags";
import { CustomerTagEditor } from "../components/CustomerTagEditor";
import { useToast } from "../components/Toast";
import { useDocumentTitle } from "../lib/useDocumentTitle";
import { ApiError } from "../lib/auth";
import { canDoMoneyOps, canSeeCostProfit, isPrivilegedAdmin } from "../lib/permissions";

type PageSizeOption = 25 | 50 | 100 | "all";
const DEFAULT_PAGE_SIZE: PageSizeOption = 25;

/** URL'den gelen ham `pageSize` değerini geçerli bir seçeneğe daraltır. */
function parsePageSize(raw: string | null): PageSizeOption {
  if (raw === "all") return "all";
  const n = Number(raw);
  if (n === 25 || n === 50 || n === 100) return n;
  return DEFAULT_PAGE_SIZE;
}

function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

function AvatarBadge({ name }: { name: string }): React.ReactElement {
  const colors = [
    "bg-blue-100 text-blue-700",
    "bg-violet-100 text-violet-700",
    "bg-emerald-100 text-emerald-700",
    "bg-amber-100 text-amber-700",
    "bg-rose-100 text-rose-700",
  ];
  const idx = name.charCodeAt(0) % colors.length;
  return (
    <span
      className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${colors[idx]}`}
    >
      {initials(name) || "?"}
    </span>
  );
}

function DiscountCell({ customer }: { customer: CustomerListItem }): React.ReactElement {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  // Global Kâr İndirimi (kardan) — eski off-list iskonto değil. %100 ⇒ maliyet.
  const [value, setValue] = useState(String(customer.profitDiscountPercent ?? 0));
  // PATCH /admin/customers/:id yalnız OWNER/ADMIN; ayrıca backend çalışana bu
  // alanı null döndürüyor — çalışanda tıklanabilir rozet yerine düz "—" durur.
  const canEditDiscount = canSeeCostProfit();

  const mutation = useMutation({
    mutationFn: (next: number) =>
      updateCustomerProfile(customer.id, { profitDiscountPercent: next }),
    onSuccess: () => {
      toast.push("success", "Kâr İndirimi güncellendi");
      setEditing(false);
      void queryClient.invalidateQueries({ queryKey: ["customers"] });
    },
    onError: (err) => {
      toast.push("error", err instanceof Error ? err.message : "Güncellenemedi");
    },
  });

  if (!canEditDiscount) {
    const pct = customer.profitDiscountPercent;
    return (
      <span className="text-xs tabular-nums text-[var(--color-text-muted)]">
        {pct == null ? "—" : `${pct}%`}
      </span>
    );
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setValue(String(customer.profitDiscountPercent ?? 0));
          setEditing(true);
        }}
        title="Global Kâr İndirimi (kardan) — düzenlemek için tıkla"
        className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2 py-0.5 text-xs font-medium hover:border-[var(--color-brand-blue)] hover:text-[var(--color-brand-blue)] transition-colors"
      >
        {customer.profitDiscountPercent ?? 0}%
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <input
        autoFocus
        type="number"
        min={0}
        max={100}
        step={1}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            const n = Math.max(0, Math.min(100, Number(value) || 0));
            mutation.mutate(n);
          }
          if (e.key === "Escape") setEditing(false);
        }}
        className="w-14 rounded-md border border-[var(--color-border)] px-2 py-0.5 text-xs"
      />
      <button
        type="button"
        disabled={mutation.isPending}
        onClick={() => mutation.mutate(Math.max(0, Math.min(100, Number(value) || 0)))}
        className="rounded-md bg-emerald-600 px-2 py-0.5 text-xs text-white hover:bg-emerald-700 disabled:opacity-60"
      >
        ✓
      </button>
      <button
        type="button"
        onClick={() => setEditing(false)}
        className="rounded-md border border-[var(--color-border)] bg-white px-2 py-0.5 text-xs hover:bg-[var(--color-surface-muted)]"
      >
        ✕
      </button>
    </div>
  );
}

/** Bakiyenin işaretine göre renk sınıfı (pozitif yeşil / negatif kırmızı / sıfır nötr). */
function balanceToneClass(balance: number): string {
  if (balance > 0) return "text-emerald-700";
  if (balance < 0) return "text-red-600";
  return "text-[var(--color-text-muted)]";
}

function BalanceCell({ customer }: { customer: CustomerListItem }): React.ReactElement {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const current = customer.cariBalance ?? 0;
  const [value, setValue] = useState(String(current));
  // Bakiye düzeltme ucu (POST :id/balance-adjustment) OWNER/ADMIN — çalışanda
  // tıklayınca 403 dönecek tetikleyici yerine salt okunur tutar kalır.
  const canEditBalance = canDoMoneyOps();

  const mutation = useMutation({
    mutationFn: (next: number) => adjustCustomerBalance(customer.id, next),
    onSuccess: (res) => {
      toast.push(
        "success",
        `Bakiye güncellendi (${formatTRY(res.newBalance)})`,
      );
      setEditing(false);
      void queryClient.invalidateQueries({ queryKey: ["customers"] });
    },
    onError: (err) => {
      toast.push("error", err instanceof Error ? err.message : "Güncellenemedi");
    },
  });

  if (!canEditBalance) {
    return (
      <span
        className={`text-xs font-semibold tabular-nums ${balanceToneClass(current)}`}
      >
        {formatTRY(current)}
      </span>
    );
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setValue(String(current));
          setEditing(true);
        }}
        title="Cari bakiyeyi düzenle"
        className={`inline-flex items-center gap-1 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2 py-0.5 text-xs font-semibold tabular-nums hover:border-[var(--color-brand-blue)] hover:text-[var(--color-brand-blue)] transition-colors ${balanceToneClass(current)}`}
      >
        {formatTRY(current)}
      </button>
    );
  }

  const submit = (): void => {
    const n = Number(value);
    if (!Number.isFinite(n)) {
      toast.push("error", "Geçerli bir tutar girin");
      return;
    }
    mutation.mutate(Math.round(n * 100) / 100);
  };

  return (
    <div className="flex items-center justify-end gap-1">
      <input
        autoFocus
        type="number"
        step="0.01"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") setEditing(false);
        }}
        className="w-24 rounded-md border border-[var(--color-border)] px-2 py-0.5 text-xs tabular-nums"
      />
      <button
        type="button"
        disabled={mutation.isPending}
        onClick={submit}
        className="rounded-md bg-emerald-600 px-2 py-0.5 text-xs text-white hover:bg-emerald-700 disabled:opacity-60"
      >
        ✓
      </button>
      <button
        type="button"
        onClick={() => setEditing(false)}
        className="rounded-md border border-[var(--color-border)] bg-white px-2 py-0.5 text-xs hover:bg-[var(--color-surface-muted)]"
      >
        ✕
      </button>
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }): React.ReactElement {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-white px-5 py-4">
      <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-[var(--color-text)]">{value}</p>
      {sub ? <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{sub}</p> : null}
    </div>
  );
}

export default function CustomersPage(): React.ReactElement | null {
  useDocumentTitle("Müşteriler");
  const authed = useRequireAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  // Toplu işlem ucu (POST bulk-action) ve kâr/indirim alanları OWNER/ADMIN'e
  // özel; çalışanda seçim kutuları da amaçsız kaldığı için birlikte gizlenir.
  const isAdmin = isPrivilegedAdmin();
  const columnCount = isAdmin ? 10 : 9;
  const [creatingTest, setCreatingTest] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [testCredential, setTestCredential] = useState<{ email: string; password: string } | null>(null);

  const [qInput, setQInput] = useState(searchParams.get("q") ?? "");
  const debouncedQ = useDebounce(qInput, 300);
  const [page, setPage] = useState(Math.max(1, Number(searchParams.get("page") ?? "1") || 1));
  const [pageSize, setPageSize] = useState<PageSizeOption>(() =>
    parsePageSize(searchParams.get("pageSize")),
  );
  // Etiket filtresi: "" (tümü) | "tag:<id>" | "auto:<key>".
  const [tagFilter, setTagFilter] = useState<string>("");

  useEffect(() => {
    const next = new URLSearchParams();
    if (debouncedQ.trim()) next.set("q", debouncedQ.trim());
    if (page > 1) next.set("page", String(page));
    if (pageSize !== DEFAULT_PAGE_SIZE) next.set("pageSize", String(pageSize));
    setSearchParams(next, { replace: true });
  }, [debouncedQ, page, pageSize, setSearchParams]);

  useEffect(() => {
    setPage(1);
  }, [debouncedQ]);

  // Sayfa boyutu değişince ilk sayfaya dön; aksi halde yüksek bir `page`
  // değeri yeni boyutta boş sayfaya düşebilir.
  const handlePageSizeChange = (next: PageSizeOption): void => {
    setPageSize(next);
    setPage(1);
  };

  const filters: CustomerFilters = useMemo(
    () => ({
      page,
      pageSize,
      q: debouncedQ.trim().length > 0 ? debouncedQ.trim() : undefined,
      tagId: tagFilter.startsWith("tag:") ? tagFilter.slice(4) : undefined,
      autoTag: tagFilter.startsWith("auto:") ? tagFilter.slice(5) : undefined,
    }),
    [page, pageSize, debouncedQ, tagFilter],
  );

  const customersQuery = useQuery<CustomersResponse>({
    queryKey: ["customers", filters],
    queryFn: () => fetchCustomers(filters),
    enabled: authed,
  });

  // Etiket filtresi menüsü için tenant etiketleri (+ oto-etiket tanımları).
  const tagsQuery = useQuery({
    queryKey: ["customer-tags"],
    queryFn: fetchCustomerTags,
    enabled: authed,
  });

  // Etiket filtresi değişince sayfayı başa al.
  useEffect(() => {
    setPage(1);
  }, [tagFilter]);

  const data = customersQuery.data;
  const customers = data?.data ?? [];
  const meta = data?.meta;

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    setSelectedIds(new Set());
  }, [debouncedQ, page, pageSize]);

  const allOnPageSelected =
    customers.length > 0 && customers.every((c) => selectedIds.has(c.id));
  const someOnPageSelected =
    customers.some((c) => selectedIds.has(c.id)) && !allOnPageSelected;

  const togglePageSelection = (): void => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) {
        for (const c of customers) next.delete(c.id);
      } else {
        for (const c of customers) next.add(c.id);
      }
      return next;
    });
  };

  const toggleOne = (id: string): void => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const bulkActionMutation = useMutation({
    mutationFn: ({ ids, action }: { ids: string[]; action: "activate" | "deactivate" }) =>
      bulkCustomerAction(ids, action),
    onSuccess: (res, vars) => {
      setSelectedIds(new Set());
      void queryClient.invalidateQueries({ queryKey: ["customers"] });
      const label = vars.action === "activate" ? "aktifleştirildi" : "pasifleştirildi";
      toast.push("success", `${res.updated} müşteri ${label}`);
    },
    onError: (err: unknown) => {
      toast.push(
        "error",
        err instanceof Error ? err.message : "Toplu işlem başarısız",
      );
    },
  });

  const handleBulkAction = (action: "activate" | "deactivate"): void => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const label = action === "activate" ? "aktifleştirilecek" : "pasifleştirilecek";
    const confirmed = window.confirm(`${ids.length} müşteri ${label}. Devam edilsin mi?`);
    if (!confirmed) return;
    bulkActionMutation.mutate({ ids, action });
  };

  const totalRevenue = customers.reduce((s, c) => s + (c.totalSpent ?? 0), 0);
  const withDiscount = customers.filter(
    (c) => (c.profitDiscountPercent ?? 0) > 0 || (c.discountPercent ?? 0) > 0,
  ).length;

  const handleExport = async (): Promise<void> => {
    setExporting(true);
    try {
      const result = await exportFromBackend("customers", {});
      if (result.ok) {
        toast.push("success", "Müşteri analizi Excel'i indirildi");
      } else if (result.status === 404 || result.status === 501) {
        toast.push("error", "Backend export endpoint'i henüz hazır değil");
      } else if (result.status === 401 || result.status === 403) {
        toast.push("error", "Bu dışa aktarım için yetkiniz yok");
      } else {
        toast.push("error", `İndirme başarısız (HTTP ${result.status})`);
      }
    } catch (err) {
      toast.push("error", err instanceof Error ? err.message : "İndirilemedi");
    } finally {
      setExporting(false);
    }
  };

  const handleCreateTest = async (): Promise<void> => {
    setCreatingTest(true);
    try {
      const created = await createTestCustomer();
      setTestCredential({ email: created.email ?? "", password: created.password ?? "test1234" });
      toast.push("success", "Test müşteri oluşturuldu");
      void queryClient.invalidateQueries({ queryKey: ["customers"] });
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 501)) {
        toast.push("error", "Backend endpoint henüz hazır değil");
      } else {
        toast.push("error", err instanceof Error ? err.message : "Oluşturulamadı");
      }
    } finally {
      setCreatingTest(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[var(--color-text)]">Müşteriler</h1>
          <p className="mt-0.5 text-sm text-[var(--color-text-muted)]">
            {meta ? `${meta.total.toLocaleString("tr-TR")} kayıtlı müşteri` : "Yükleniyor…"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void handleExport()}
            disabled={exporting}
            title="Sipariş vermeyen / XML kullanmayan bayileri segmentlere ayıran detaylı Excel"
            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-60 transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M10 3v9m0 0 3.5-3.5M10 12 6.5 8.5M4 15.5h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {exporting ? "Hazırlanıyor…" : "Excel İndir"}
          </button>
          <button
            type="button"
            onClick={() => void handleCreateTest()}
            disabled={creatingTest}
            className="rounded-lg border border-[var(--color-border)] bg-white px-3 py-1.5 text-sm hover:bg-[var(--color-surface-muted)] disabled:opacity-60 transition-colors"
          >
            {creatingTest ? "Oluşturuluyor…" : "+ Test Müşteri"}
          </button>
        </div>
      </div>

      {/* Test credential banner */}
      {testCredential ? (
        <div className="flex items-start justify-between gap-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm">
          <div>
            <p className="font-semibold text-emerald-800 mb-1">Test müşteri hazır</p>
            <p className="text-xs text-emerald-700">
              E-posta: <code className="font-mono">{testCredential.email}</code>{" "}
              &nbsp;·&nbsp; Şifre: <code className="font-mono">{testCredential.password}</code>
            </p>
          </div>
          <button
            type="button"
            onClick={() => setTestCredential(null)}
            className="text-xs text-emerald-700 underline whitespace-nowrap"
          >
            Kapat
          </button>
        </div>
      ) : null}

      {/* Stats */}
      {!customersQuery.isLoading && meta ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Toplam Müşteri" value={meta.total.toLocaleString("tr-TR")} />
          <StatCard
            label="Bu Sayfada Ciro"
            value={formatTRY(totalRevenue)}
            sub="Sayfa toplamı"
          />
          {/* İndirim alanları çalışana null geldiği için bu sayaç daima 0
              çıkardı — yanlış rakam göstermektense kartı gizliyoruz. */}
          {isAdmin ? (
            <StatCard
              label="İskontolu"
              value={withDiscount.toLocaleString("tr-TR")}
              sub="Bu sayfada"
            />
          ) : null}
          <StatCard
            label="Sayfa"
            value={`${meta.page} / ${meta.totalPages}`}
            sub={pageSize === "all" ? "Tümü gösteriliyor" : `${pageSize} müşteri/sayfa`}
          />
        </div>
      ) : null}

      {/* Search */}
      <div className="relative w-full max-w-sm">
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[var(--color-text-muted)]">
          <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
            <circle cx="8.5" cy="8.5" r="5.75" stroke="currentColor" strokeWidth="1.5" />
            <path d="M13 13l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </span>
        <input
          type="search"
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
          placeholder="Müşteri, e-posta, telefon ara…"
          className="w-full rounded-lg border border-[var(--color-border)] bg-white py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-blue)]"
        />
      </div>

      {/* Etiket filtresi */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-[var(--color-text-muted)]">
          Etikete göre:
        </span>
        <select
          value={tagFilter}
          onChange={(e) => setTagFilter(e.target.value)}
          className="rounded-lg border border-[var(--color-border)] bg-white px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-blue)]"
        >
          <option value="">Tüm müşteriler</option>
          {(tagsQuery.data?.autoTags ?? []).map((t) => (
            <option key={t.key} value={`auto:${t.key}`}>
              {t.name}
            </option>
          ))}
          {(tagsQuery.data?.tags ?? []).map((t) => (
            <option key={t.id} value={`tag:${t.id}`}>
              {t.name}
              {t.customerCount ? ` (${t.customerCount})` : ""}
            </option>
          ))}
        </select>
        {tagFilter ? (
          <button
            type="button"
            onClick={() => setTagFilter("")}
            className="text-xs font-medium text-[var(--color-brand-blue)] hover:underline"
          >
            Temizle
          </button>
        ) : null}
      </div>

      {/* Bulk action toolbar */}
      {isAdmin && selectedIds.size > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--color-brand-blue)] bg-[var(--color-brand-blue)]/5 px-4 py-2 text-sm">
          <span className="font-medium">{selectedIds.size} müşteri seçildi</span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => handleBulkAction("activate")}
              disabled={bulkActionMutation.isPending}
              className="rounded-md border border-emerald-300 bg-white px-3 py-1.5 text-xs text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
            >
              Aktifleştir
            </button>
            <button
              type="button"
              onClick={() => handleBulkAction("deactivate")}
              disabled={bulkActionMutation.isPending}
              className="rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs text-amber-700 hover:bg-amber-50 disabled:opacity-50"
            >
              Pasifleştir
            </button>
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] underline"
            >
              Seçimi temizle
            </button>
          </div>
        </div>
      ) : null}

      {/* Table */}
      {customersQuery.isError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {customersQuery.error instanceof Error ? customersQuery.error.message : "Veri alınamadı"}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] bg-[var(--color-surface-muted)] text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
                  {isAdmin ? (
                    <th className="w-10 px-3 py-3">
                      <input
                        type="checkbox"
                        aria-label="Sayfadaki tümünü seç"
                        checked={allOnPageSelected}
                        ref={(el) => {
                          if (el) el.indeterminate = someOnPageSelected;
                        }}
                        onChange={togglePageSelection}
                        className="h-4 w-4 rounded border-[var(--color-border)]"
                      />
                    </th>
                  ) : null}
                  <th className="px-4 py-3 text-left">Müşteri</th>
                  <th className="px-4 py-3 text-left">Etiketler</th>
                  <th className="hidden px-4 py-3 text-left md:table-cell">Telefon</th>
                  <th className="px-4 py-3 text-center">Kâr İnd.</th>
                  <th className="px-4 py-3 text-right">Bakiye</th>
                  <th className="px-4 py-3 text-right">Sipariş</th>
                  <th className="px-4 py-3 text-right">Tutar</th>
                  <th className="hidden px-4 py-3 text-left lg:table-cell">Bayi ID</th>
                  <th className="hidden px-4 py-3 text-left lg:table-cell">Son Sipariş</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {customersQuery.isLoading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i}>
                      {Array.from({ length: columnCount }).map((__, j) => (
                        <td key={j} className="px-4 py-3">
                          <div className="h-4 animate-pulse rounded bg-[var(--color-surface-muted)]" />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : customers.length === 0 ? (
                  <tr>
                    <td colSpan={columnCount} className="px-4 py-12 text-center text-sm text-[var(--color-text-muted)]">
                      {debouncedQ ? "Aramanızla eşleşen müşteri bulunamadı." : "Henüz müşteri yok."}
                    </td>
                  </tr>
                ) : (
                  customers.map((c) => (
                    <tr key={c.id} className="hover:bg-[var(--color-surface-muted)] transition-colors">
                      {isAdmin ? (
                        <td className="w-10 px-3 py-3">
                          <input
                            type="checkbox"
                            aria-label={`${c.name} seç`}
                            checked={selectedIds.has(c.id)}
                            onChange={() => toggleOne(c.id)}
                            className="h-4 w-4 rounded border-[var(--color-border)]"
                          />
                        </td>
                      ) : null}
                      <td className="px-4 py-3">
                        <Link to={`/customers/${c.id}`} className="flex items-center gap-2.5 group">
                          <AvatarBadge name={c.name} />
                          <span className="font-medium group-hover:text-[var(--color-brand-blue)] transition-colors">
                            {c.name}
                          </span>
                          {c.customerStatus === "ADMIN_DISCOUNT" ? (
                            <span
                              title="Admin İndirimi aktif — maliyet fiyatından satış"
                              className="rounded-full border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800"
                            >
                              Admin
                            </span>
                          ) : null}
                          {c.isActive === false &&
                            (c.mustChangePassword ? (
                              <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">
                                Onay Bekliyor
                              </span>
                            ) : (
                              <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                                Pasif
                              </span>
                            ))}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <CustomerTagEditor
                          customerId={c.id}
                          tags={c.tags ?? []}
                          autoTags={c.autoTags ?? []}
                          onChanged={() => void customersQuery.refetch()}
                        />
                      </td>
                      <td className="hidden px-4 py-3 text-[var(--color-text-muted)] md:table-cell">
                        {c.phone ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <DiscountCell customer={c} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <BalanceCell customer={c} />
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-[var(--color-text-muted)]">
                        {(c.ordersCount ?? 0).toLocaleString("tr-TR")}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium">
                        {formatTRY(c.totalSpent ?? 0)}
                      </td>
                      <td className="hidden px-4 py-3 text-sm font-mono font-medium uppercase tracking-wide text-[var(--color-text)] lg:table-cell">
                        {c.bayiNo ?? "—"}
                      </td>
                      <td className="hidden px-4 py-3 text-sm text-[var(--color-text-muted)] lg:table-cell">
                        {formatDateTime(c.lastOrderAt)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {meta ? (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border)] bg-[var(--color-surface-muted)] px-4 py-3 text-xs">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <span className="text-[var(--color-text-muted)]">
                  {(meta.total > 0
                    ? (meta.page - 1) * meta.pageSize + 1
                    : 0
                  ).toLocaleString("tr-TR")}
                  –
                  {Math.min(meta.page * meta.pageSize, meta.total).toLocaleString("tr-TR")}{" "}
                  / {meta.total.toLocaleString("tr-TR")}
                </span>
                <label className="flex items-center gap-1.5 text-[var(--color-text-muted)]">
                  <span>Sayfa başına</span>
                  <select
                    value={String(pageSize)}
                    onChange={(e) =>
                      handlePageSizeChange(parsePageSize(e.target.value))
                    }
                    disabled={customersQuery.isFetching}
                    className="rounded-md border border-[var(--color-border)] bg-white px-2 py-1 text-[var(--color-text)] disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30"
                  >
                    <option value="25">25</option>
                    <option value="50">50</option>
                    <option value="100">100</option>
                    <option value="all">Tümü</option>
                  </select>
                </label>
              </div>
              {meta.totalPages > 1 ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={meta.page <= 1 || customersQuery.isFetching}
                    className="rounded-md border border-[var(--color-border)] bg-white px-3 py-1 hover:bg-white/70 disabled:opacity-50 transition-colors"
                  >
                    ← Önceki
                  </button>
                  <span className="px-1 text-[var(--color-text-muted)]">
                    {meta.page} / {meta.totalPages}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPage((p) => p + 1)}
                    disabled={meta.page >= meta.totalPages || customersQuery.isFetching}
                    className="rounded-md border border-[var(--color-border)] bg-white px-3 py-1 hover:bg-white/70 disabled:opacity-50 transition-colors"
                  >
                    Sonraki →
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

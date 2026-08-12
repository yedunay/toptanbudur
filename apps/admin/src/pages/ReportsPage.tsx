/**
 * Faz 4 — Raporlar sayfası.
 *
 * Üst kısım: rapor tipi seç → önizle (satır sayısı/toplam) → indir (XLSX).
 * Alt kısım: zamanlanmış raporlar listesi + ekle/düzenle/sil/şimdi çalıştır.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRequireAuth } from "../lib/auth";
import { useToast } from "../components/Toast";
import { useDocumentTitle } from "../lib/useDocumentTitle";
import ConfirmDialog from "../components/ConfirmDialog";
import {
  REPORT_TYPES,
  createSchedule,
  deleteSchedule,
  downloadReport,
  fetchReportPreview,
  fetchSchedules,
  runScheduleNow,
  updateSchedule,
  type PreviewColumn,
  type ReportPeriod,
  type ReportPreview,
  type ReportSchedule,
  type ReportType,
  type ScheduleInput,
} from "../lib/reports";

const TR_MONTHS: ReadonlyArray<string> = [
  "Ocak",
  "Şubat",
  "Mart",
  "Nisan",
  "Mayıs",
  "Haziran",
  "Temmuz",
  "Ağustos",
  "Eylül",
  "Ekim",
  "Kasım",
  "Aralık",
];

function currentMonthLabel(): string {
  const now = new Date();
  return `${TR_MONTHS[now.getMonth()]} ${now.getFullYear()} (1–${now.getDate()})`;
}

function lastMonthLabel(): string {
  const now = new Date();
  const m = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
  const y = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  return `${TR_MONTHS[m]} ${y}`;
}

function lastYearLabel(): string {
  return `${new Date().getFullYear() - 1} yılı`;
}

function periodOptions(): ReadonlyArray<{ value: ReportPeriod; label: string }> {
  return [
    { value: "current_month", label: currentMonthLabel() },
    { value: "last_month", label: lastMonthLabel() },
    { value: "last_30_days", label: "Son 30 gün" },
    { value: "last_3_months", label: "Son 3 ay" },
    { value: "last_6_months", label: "Son 6 ay" },
    { value: "year_to_date", label: "Yıl başından bugüne" },
    { value: "last_year", label: lastYearLabel() },
  ];
}

const CRON_PRESETS: ReadonlyArray<{ label: string; value: string }> = [
  { label: "Her gün 09:00", value: "0 9 * * *" },
  { label: "Her Pazartesi 08:00", value: "0 8 * * 1" },
  { label: "Her ayın 1'i 07:00", value: "0 7 1 * *" },
  { label: "Her 6 saatte bir", value: "0 */6 * * *" },
];

function formatTRY(value: number | undefined): string {
  if (value === undefined) return "—";
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
  }).format(value);
}

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString("tr-TR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return value;
  }
}

function formatCellValue(
  value: unknown,
  format: PreviewColumn["format"],
): string {
  if (value === null || value === undefined || value === "") return "—";
  switch (format) {
    case "currency": {
      const n = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(n)) return String(value);
      return formatTRY(n);
    }
    case "number": {
      const n = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(n)) return String(value);
      return new Intl.NumberFormat("tr-TR").format(n);
    }
    case "percent": {
      const n = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(n)) return String(value);
      return `${n.toFixed(1)}%`;
    }
    case "date": {
      const s = String(value);
      try {
        return new Date(s).toLocaleDateString("tr-TR");
      } catch {
        return s;
      }
    }
    case "datetime":
      return formatDateTime(String(value));
    case "text":
    default:
      return String(value);
  }
}

const METRIC_LABELS: Record<string, string> = {
  rowCount: "Satır",
  totalAmount: "Toplam Ciro",
  totalCost: "Toplam Maliyet",
  totalProfit: "Toplam Kâr",
  avgMargin: "Ort. Marj",
  avgOrderValue: "Ort. Sepet",
  orderCount: "Sipariş Sayısı",
  customerCount: "Müşteri Sayısı",
  productCount: "Ürün Sayısı",
  supplierCount: "Tedarikçi Sayısı",
  totalStock: "Toplam Stok",
  potentialRevenue: "Potansiyel Ciro",
};

function metricLabel(key: string): string {
  return METRIC_LABELS[key] ?? key;
}

function isCurrencyMetric(key: string): boolean {
  return (
    key === "totalAmount" ||
    key === "totalCost" ||
    key === "totalProfit" ||
    key === "avgOrderValue" ||
    key === "potentialRevenue"
  );
}

function isPercentMetric(key: string): boolean {
  return key === "avgMargin";
}

function formatMetric(key: string, value: number | string): string {
  if (typeof value === "string") return value;
  if (isCurrencyMetric(key)) return formatTRY(value);
  if (isPercentMetric(key)) return `${value.toFixed(1)}%`;
  return new Intl.NumberFormat("tr-TR").format(value);
}

export default function ReportsPage(): React.ReactElement | null {
  useDocumentTitle("Raporlar");
  const authed = useRequireAuth();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [reportType, setReportType] = useState<ReportType>("monthly_sales");
  const [period, setPeriod] = useState<ReportPeriod>("current_month");
  const [preview, setPreview] = useState<ReportPreview | null>(null);
  const periodOpts = useMemo(periodOptions, []);
  const [editing, setEditing] = useState<ReportSchedule | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<ReportSchedule | null>(
    null,
  );

  const selectedReport = useMemo(
    () => REPORT_TYPES.find((r) => r.value === reportType) ?? REPORT_TYPES[0],
    [reportType],
  );

  const schedulesQuery = useQuery<ReportSchedule[]>({
    queryKey: ["report-schedules"],
    queryFn: fetchSchedules,
    enabled: authed,
  });

  const previewMutation = useMutation({
    mutationFn: () => fetchReportPreview({ type: reportType, period }),
    onSuccess: (data) => {
      setPreview(data);
      toast.push(
        "success",
        `Önizleme hazır — ${data.summary.rowCount.toLocaleString("tr-TR")} satır`,
      );
    },
    onError: (err: unknown) => {
      toast.push(
        "error",
        err instanceof Error ? err.message : "Önizleme alınamadı",
      );
    },
  });

  const downloadMutation = useMutation({
    mutationFn: () => downloadReport({ type: reportType, period, format: "xlsx" }),
    onSuccess: () => toast.push("success", "Rapor indirildi"),
    onError: (err: unknown) =>
      toast.push("error", err instanceof Error ? err.message : "İndirme hatası"),
  });

  const createMutation = useMutation({
    mutationFn: (input: ScheduleInput) => createSchedule(input),
    onSuccess: () => {
      toast.push("success", "Plan oluşturuldu");
      setShowForm(false);
      setEditing(null);
      void queryClient.invalidateQueries({ queryKey: ["report-schedules"] });
    },
    onError: (err: unknown) =>
      toast.push("error", err instanceof Error ? err.message : "Plan oluşturulamadı"),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<ScheduleInput> }) =>
      updateSchedule(id, patch),
    onSuccess: () => {
      toast.push("success", "Plan güncellendi");
      setShowForm(false);
      setEditing(null);
      void queryClient.invalidateQueries({ queryKey: ["report-schedules"] });
    },
    onError: (err: unknown) =>
      toast.push("error", err instanceof Error ? err.message : "Plan güncellenemedi"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteSchedule(id),
    onSuccess: () => {
      toast.push("success", "Plan silindi");
      setConfirmDelete(null);
      void queryClient.invalidateQueries({ queryKey: ["report-schedules"] });
    },
    onError: (err: unknown) =>
      toast.push("error", err instanceof Error ? err.message : "Plan silinemedi"),
  });

  const runMutation = useMutation({
    mutationFn: (id: string) => runScheduleNow(id),
    onSuccess: (data, id) => {
      if (data.status === "success") {
        toast.push("success", "Plan çalıştırıldı, mail gönderildi");
      } else {
        toast.push("error", `Hata: ${data.error ?? "bilinmiyor"}`);
      }
      void queryClient.invalidateQueries({ queryKey: ["report-schedules"] });
      void id;
    },
    onError: (err: unknown) =>
      toast.push("error", err instanceof Error ? err.message : "Çalıştırılamadı"),
  });

  if (!authed) return null;

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 py-8 space-y-8">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">Raporlar</h1>
        <p className="mt-1 text-sm text-slate-600">
          Hazır raporları anında indirin veya periyodik olarak mail
          alıcılarınıza gönderilmesini sağlayın.
        </p>
      </header>

      {/* ─── Anlık önizleme & indirme ─── */}
      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-900">
            Hızlı Rapor İndir
          </h2>
        </div>
        <div className="px-6 py-5 grid gap-6 md:grid-cols-[1fr_auto_auto]">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Rapor Tipi
              </label>
              <div className="grid gap-2 sm:grid-cols-2">
                {REPORT_TYPES.map((rt) => {
                  const active = rt.value === reportType;
                  return (
                    <button
                      type="button"
                      key={rt.value}
                      onClick={() => {
                        setReportType(rt.value);
                        setPreview(null);
                      }}
                      className={`text-left rounded-lg border px-3 py-2.5 transition ${
                        active
                          ? "border-indigo-500 bg-indigo-50 ring-1 ring-indigo-200"
                          : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                      }`}
                    >
                      <div
                        className={`text-sm font-semibold ${
                          active ? "text-indigo-900" : "text-slate-900"
                        }`}
                      >
                        {rt.label}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {rt.description}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Dönem
              </label>
              <div className="flex flex-wrap gap-2">
                {periodOpts.map((p) => {
                  const active = p.value === period;
                  return (
                    <button
                      type="button"
                      key={p.value}
                      onClick={() => {
                        setPeriod(p.value);
                        setPreview(null);
                      }}
                      className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition ${
                        active
                          ? "bg-slate-900 text-white"
                          : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                      }`}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="md:border-l md:border-slate-200 md:pl-6 flex flex-col justify-center min-w-[200px]">
            <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">
              Önizleme
            </div>
            {preview ? (
              <div className="space-y-1.5">
                <div className="text-2xl font-bold text-slate-900">
                  {preview.summary.rowCount.toLocaleString("tr-TR")}{" "}
                  <span className="text-sm font-normal text-slate-500">
                    satır
                  </span>
                </div>
                {preview.summary.totalAmount !== undefined && (
                  <div className="text-sm text-emerald-700 font-semibold">
                    {formatTRY(preview.summary.totalAmount)}
                  </div>
                )}
                <div className="text-xs text-slate-500">
                  {preview.summary.rangeFrom.slice(0, 10)} →{" "}
                  {preview.summary.rangeTo.slice(0, 10)}
                </div>
              </div>
            ) : (
              <div className="text-sm text-slate-400 italic">
                Henüz önizleme alınmadı
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2 justify-center min-w-[150px]">
            <button
              type="button"
              onClick={() => previewMutation.mutate()}
              disabled={previewMutation.isPending}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {previewMutation.isPending ? "Hesaplanıyor…" : "Önizle"}
            </button>
            <button
              type="button"
              onClick={() => downloadMutation.mutate()}
              disabled={downloadMutation.isPending}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
            >
              {downloadMutation.isPending ? "İndiriliyor…" : "XLSX İndir"}
            </button>
          </div>
        </div>
        <div className="border-t border-slate-100 bg-slate-50 px-6 py-3 text-xs text-slate-600">
          Seçili rapor: <strong>{selectedReport.label}</strong> —{" "}
          {selectedReport.description}
        </div>
      </section>

      {/* ─── Detaylı önizleme dökümü ─── */}
      {preview && <PreviewDetailPanel preview={preview} />}

      {/* ─── Zamanlanmış raporlar ─── */}
      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Zamanlanmış Raporlar
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Cron tabanlı periyodik üretim + alıcıya mail gönderimi
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setEditing(null);
              setShowForm(true);
            }}
            className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
          >
            + Yeni Plan
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-6 py-3 text-left">İsim</th>
                <th className="px-4 py-3 text-left">Rapor</th>
                <th className="px-4 py-3 text-left">Cron</th>
                <th className="px-4 py-3 text-left">Alıcılar</th>
                <th className="px-4 py-3 text-left">Son Çalışma</th>
                <th className="px-4 py-3 text-left">Durum</th>
                <th className="px-4 py-3 text-right">İşlem</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {schedulesQuery.isLoading ? (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-slate-400">
                    Yükleniyor…
                  </td>
                </tr>
              ) : !schedulesQuery.data?.length ? (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-slate-400">
                    Henüz zamanlanmış rapor yok
                  </td>
                </tr>
              ) : (
                schedulesQuery.data.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50">
                    <td className="px-6 py-3">
                      <div className="font-medium text-slate-900">{s.name}</div>
                      {!s.enabled && (
                        <span className="inline-block mt-0.5 text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
                          Devre dışı
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {REPORT_TYPES.find((r) => r.value === s.reportType)?.label ??
                        s.reportType}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">
                      {s.cron}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      {s.recipients.slice(0, 2).join(", ")}
                      {s.recipients.length > 2 && (
                        <span className="text-slate-400">
                          {" "}
                          +{s.recipients.length - 2}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      {formatDateTime(s.lastRunAt)}
                    </td>
                    <td className="px-4 py-3">
                      {s.lastStatus === "success" ? (
                        <span className="inline-block text-xs px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800">
                          Başarılı
                        </span>
                      ) : s.lastStatus === "failed" ? (
                        <span
                          className="inline-block text-xs px-1.5 py-0.5 rounded bg-rose-100 text-rose-800"
                          title={s.lastError ?? ""}
                        >
                          Hata
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => runMutation.mutate(s.id)}
                          disabled={runMutation.isPending}
                          className="text-xs px-2 py-1 rounded border border-slate-200 hover:bg-slate-100"
                        >
                          ▶ Şimdi
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditing(s);
                            setShowForm(true);
                          }}
                          className="text-xs px-2 py-1 rounded border border-slate-200 hover:bg-slate-100"
                        >
                          Düzenle
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDelete(s)}
                          className="text-xs px-2 py-1 rounded border border-rose-200 text-rose-700 hover:bg-rose-50"
                        >
                          Sil
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {showForm && (
        <ScheduleFormModal
          initial={editing}
          onClose={() => {
            setShowForm(false);
            setEditing(null);
          }}
          onSubmit={(input) => {
            if (editing) {
              updateMutation.mutate({ id: editing.id, patch: input });
            } else {
              createMutation.mutate(input);
            }
          }}
          busy={createMutation.isPending || updateMutation.isPending}
        />
      )}

      <ConfirmDialog
        open={confirmDelete !== null}
        title="Plan silinsin mi?"
        message={`"${confirmDelete?.name}" planı kalıcı olarak silinecek.`}
        confirmLabel="Sil"
        cancelLabel="Vazgeç"
        destructive
        onConfirm={() => {
          if (confirmDelete) deleteMutation.mutate(confirmDelete.id);
        }}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}

// ───────────────────────── Preview Detail ─────────────────────────

interface PreviewDetailPanelProps {
  preview: ReportPreview;
}

function PreviewDetailPanel({
  preview,
}: PreviewDetailPanelProps): React.ReactElement {
  const { summary, columns, rows, totalRows, totals } = preview;
  const metricEntries = Object.entries(summary.metrics ?? {});

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-6 py-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">
            Detaylı Döküm
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {summary.rangeFrom.slice(0, 10)} → {summary.rangeTo.slice(0, 10)} •{" "}
            <strong>{totalRows.toLocaleString("tr-TR")}</strong> satırın ilk{" "}
            <strong>{rows.length.toLocaleString("tr-TR")}</strong> tanesi
            gösteriliyor. Tam dökümü XLSX ile indirebilirsiniz.
          </p>
        </div>
      </div>

      {metricEntries.length > 0 && (
        <div className="border-b border-slate-100 bg-slate-50 px-6 py-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {metricEntries.map(([key, value]) => (
            <div key={key} className="rounded-lg bg-white border border-slate-200 px-3 py-2">
              <div className="text-xs uppercase tracking-wide text-slate-500">
                {metricLabel(key)}
              </div>
              <div className="mt-0.5 text-base font-semibold text-slate-900">
                {formatMetric(key, value)}
              </div>
            </div>
          ))}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="px-6 py-12 text-center text-sm text-slate-400">
          Bu dönem için kayıt bulunamadı.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                {columns.map((col) => (
                  <th
                    key={col.key}
                    className={`px-4 py-2.5 whitespace-nowrap ${
                      col.align === "right"
                        ? "text-right"
                        : col.align === "center"
                          ? "text-center"
                          : "text-left"
                    }`}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row, idx) => (
                <tr key={idx} className="hover:bg-slate-50">
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={`px-4 py-2 whitespace-nowrap text-slate-700 ${
                        col.align === "right"
                          ? "text-right tabular-nums"
                          : col.align === "center"
                            ? "text-center"
                            : "text-left"
                      } ${col.format === "currency" || col.format === "number" || col.format === "percent" ? "tabular-nums" : ""}`}
                    >
                      {formatCellValue(row[col.key], col.format)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            {totals && Object.keys(totals).length > 0 && (
              <tfoot className="bg-slate-100 text-xs font-semibold text-slate-700">
                <tr>
                  {columns.map((col, idx) => {
                    const total = totals[col.key];
                    const isFirst = idx === 0;
                    if (total === undefined) {
                      return (
                        <td
                          key={col.key}
                          className="px-4 py-2.5 whitespace-nowrap"
                        >
                          {isFirst ? "Toplam" : ""}
                        </td>
                      );
                    }
                    return (
                      <td
                        key={col.key}
                        className={`px-4 py-2.5 whitespace-nowrap tabular-nums ${
                          col.align === "right"
                            ? "text-right"
                            : col.align === "center"
                              ? "text-center"
                              : "text-left"
                        }`}
                      >
                        {typeof total === "number"
                          ? formatCellValue(total, col.format)
                          : String(total)}
                      </td>
                    );
                  })}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </section>
  );
}

// ───────────────────────── Form Modal ─────────────────────────

interface ScheduleFormModalProps {
  initial: ReportSchedule | null;
  onClose: () => void;
  onSubmit: (input: ScheduleInput) => void;
  busy: boolean;
}

function ScheduleFormModal({
  initial,
  onClose,
  onSubmit,
  busy,
}: ScheduleFormModalProps): React.ReactElement {
  const [name, setName] = useState(initial?.name ?? "");
  const [reportType, setReportType] = useState<ReportType>(
    initial?.reportType ?? "monthly_sales",
  );
  const [cron, setCron] = useState(initial?.cron ?? "0 9 * * 1");
  const [recipientsText, setRecipientsText] = useState(
    initial?.recipients.join(", ") ?? "",
  );
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const recipients = recipientsText
      .split(/[,;\s]+/)
      .map((r) => r.trim())
      .filter(Boolean);
    onSubmit({
      name: name.trim(),
      reportType,
      format: "xlsx",
      cron: cron.trim(),
      recipients,
      enabled,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl">
        <form onSubmit={handleSubmit}>
          <div className="border-b border-slate-200 px-6 py-4">
            <h3 className="text-lg font-semibold text-slate-900">
              {initial ? "Planı Düzenle" : "Yeni Zamanlanmış Rapor"}
            </h3>
          </div>

          <div className="px-6 py-5 space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                İsim
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Aylık Satış Raporu"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Rapor Tipi
              </label>
              <select
                value={reportType}
                onChange={(e) => setReportType(e.target.value as ReportType)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                {REPORT_TYPES.map((rt) => (
                  <option key={rt.value} value={rt.value}>
                    {rt.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Cron İfadesi
              </label>
              <input
                type="text"
                required
                value={cron}
                onChange={(e) => setCron(e.target.value)}
                placeholder="0 9 * * 1"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
              <div className="mt-2 flex flex-wrap gap-1.5">
                {CRON_PRESETS.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => setCron(p.value)}
                    className="text-xs px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Alıcılar (virgülle ayırın)
              </label>
              <textarea
                required
                value={recipientsText}
                onChange={(e) => setRecipientsText(e.target.value)}
                rows={2}
                placeholder="ornek@firma.com, yonetim@firma.com"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              Aktif (cron tetikleyici çalışsın)
            </label>
          </div>

          <div className="border-t border-slate-200 bg-slate-50 px-6 py-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Vazgeç
            </button>
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {busy ? "Kaydediliyor…" : initial ? "Güncelle" : "Oluştur"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

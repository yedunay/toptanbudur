import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, FileText, Loader2 } from "lucide-react";
import { useRequireAuth } from "../lib/auth";
import { useToast } from "../components/Toast";
import { useDocumentTitle } from "../lib/useDocumentTitle";
import { formatAmount } from "../lib/format";
import {
  fetchReceiptDealers,
  fetchReceiptPdfUrl,
  fetchReceipts,
  type AdminReceipt,
  type ReceiptDealerOption,
  type ReceiptKind,
  type ReceiptListFilters,
  type ReceiptListResult,
} from "../lib/receipts";

const PAGE_SIZE = 50;

type KindFilter = "all" | ReceiptKind;

const KIND_CHIPS: ReadonlyArray<{ key: KindFilter; label: string }> = [
  { key: "all", label: "Tümü" },
  { key: "order", label: "Sipariş" },
  { key: "cari_topup", label: "Cari Yükleme" },
];

function formatDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("tr-TR", { dateStyle: "medium", timeStyle: "short" });
}

function kindBadge(kind: ReceiptKind): React.ReactElement {
  if (kind === "cari_topup") {
    return (
      <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
        Cari Yükleme
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-semibold text-blue-700">
      Sipariş
    </span>
  );
}

/**
 * `from`/`to` tarih input'larını (yerel `YYYY-MM-DD`) backend'in beklediği ISO
 * sınırlarına çevirir: `from` günün başı, `to` günün sonu (dahil). Boşsa
 * undefined döner — filtre uygulanmaz.
 */
function dayStartIso(value: string): string | undefined {
  if (!value) return undefined;
  const d = new Date(`${value}T00:00:00`);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function dayEndIso(value: string): string | undefined {
  if (!value) return undefined;
  const d = new Date(`${value}T23:59:59.999`);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function dealerLabel(d: ReceiptDealerOption): string {
  const no = d.bayiNo ? `${d.bayiNo} · ` : "";
  return `${no}${d.bayiAdi || "İsimsiz bayi"}`;
}

export default function MakbuzlarPage(): React.ReactElement {
  const authed = useRequireAuth();
  useDocumentTitle("Makbuzlar");
  const toast = useToast();

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [kind, setKind] = useState<KindFilter>("all");
  const [page, setPage] = useState(1);
  const [openingId, setOpeningId] = useState<string | null>(null);

  const filters = useMemo<ReceiptListFilters>(
    () => ({
      from: dayStartIso(from),
      to: dayEndIso(to),
      customerId: customerId || undefined,
      kind: kind === "all" ? undefined : kind,
      page,
      pageSize: PAGE_SIZE,
    }),
    [from, to, customerId, kind, page],
  );

  const receiptsQuery = useQuery<ReceiptListResult>({
    queryKey: ["admin-receipts", filters],
    queryFn: () => fetchReceipts(filters),
    enabled: authed,
    placeholderData: (prev) => prev,
  });

  const dealersQuery = useQuery<ReceiptDealerOption[]>({
    queryKey: ["admin-receipt-dealers"],
    queryFn: fetchReceiptDealers,
    enabled: authed,
  });

  const items = receiptsQuery.data?.items ?? [];
  const meta = receiptsQuery.data?.meta ?? {
    total: 0,
    page,
    pageSize: PAGE_SIZE,
    totalPages: 1,
  };
  const dealers = dealersQuery.data ?? [];

  const hasFilters =
    from !== "" || to !== "" || customerId !== "" || kind !== "all";

  // Herhangi bir filtre değiştiğinde 1. sayfaya dön.
  const resetPageThen = <T,>(setter: (v: T) => void) => (value: T) => {
    setter(value);
    setPage(1);
  };

  function clearFilters(): void {
    setFrom("");
    setTo("");
    setCustomerId("");
    setKind("all");
    setPage(1);
  }

  /**
   * PDF'i yeni sekmede açar. Admin paneli Bearer JWT ile çalıştığından düz
   * `<a href>` linki auth taşımaz; imzalı (self-authenticating) URL JSON
   * olarak alınır ve `window.open` ile açılır. Popup engelleyicisine
   * takılmamak için boş sekme SENKRON açılır, URL fetch sonrası set edilir.
   */
  async function handleOpenPdf(receipt: AdminReceipt): Promise<void> {
    if (openingId) return;
    const win = window.open("about:blank", "_blank");
    if (win) win.opener = null;
    setOpeningId(receipt.id);
    try {
      const url = await fetchReceiptPdfUrl(receipt.id);
      if (win && !win.closed) {
        win.location.href = url;
      } else {
        // Popup engellendi → mevcut sekmede aç (son çare).
        window.location.href = url;
      }
    } catch (err) {
      if (win && !win.closed) win.close();
      toast.push(
        "error",
        err instanceof Error ? err.message : "Makbuz PDF'i açılamadı",
      );
    } finally {
      setOpeningId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Makbuzlar</h1>
          <p className="mt-1 text-sm text-slate-500">
            Kredi kartı tahsilat makbuzları. Kartla ödenen siparişler ve kartla
            yapılan cari yüklemeler için otomatik üretilir; her satırın PDF'i
            görüntülenip indirilebilir.
          </p>
        </div>
        <span className="text-sm text-slate-500">
          Toplam <strong className="text-slate-900">{meta.total}</strong> makbuz
        </span>
      </div>

      {/* Filtreler */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500">
              Başlangıç
            </label>
            <input
              type="date"
              value={from}
              max={to || undefined}
              onChange={(e) => resetPageThen(setFrom)(e.target.value)}
              className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500">
              Bitiş
            </label>
            <input
              type="date"
              value={to}
              min={from || undefined}
              onChange={(e) => resetPageThen(setTo)(e.target.value)}
              className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="min-w-[220px]">
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500">
              Bayi
            </label>
            <select
              value={customerId}
              onChange={(e) => resetPageThen(setCustomerId)(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Tüm bayiler</option>
              {dealers.map((d) => (
                <option key={d.customerId} value={d.customerId}>
                  {dealerLabel(d)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <span className="block text-xs font-semibold uppercase tracking-wider text-slate-500">
              Tür
            </span>
            <div className="mt-1 flex gap-1.5">
              {KIND_CHIPS.map((chip) => {
                const active = chip.key === kind;
                return (
                  <button
                    key={chip.key}
                    type="button"
                    onClick={() => resetPageThen(setKind)(chip.key)}
                    aria-pressed={active}
                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                      active
                        ? "border-slate-900 bg-slate-900 text-white"
                        : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {chip.label}
                  </button>
                );
              })}
            </div>
          </div>
          {hasFilters ? (
            <button
              type="button"
              onClick={clearFilters}
              className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              Filtreleri temizle
            </button>
          ) : null}
        </div>
      </div>

      {/* Tablo */}
      {receiptsQuery.isLoading ? (
        <p className="text-sm text-slate-500">Yükleniyor…</p>
      ) : receiptsQuery.isError ? (
        <p className="text-sm text-red-600">Makbuzlar yüklenemedi.</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">Makbuz No</th>
                <th className="px-4 py-3">Tür</th>
                <th className="px-4 py-3">Bayi</th>
                <th className="px-4 py-3">Kart Sahibi</th>
                <th className="px-4 py-3 text-right">Tutar</th>
                <th className="px-4 py-3">İlgili Kayıt</th>
                <th className="px-4 py-3">Durum</th>
                <th className="px-4 py-3">POS</th>
                <th className="px-4 py-3">Tarih</th>
                <th className="px-4 py-3 text-right">PDF</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((r) => (
                <tr key={r.id} className="align-top">
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs font-semibold text-slate-900">
                      {r.humanReceiptNo || "—"}
                    </span>
                    {r.aciklama ? (
                      <div
                        className="mt-0.5 max-w-[280px] truncate text-xs text-slate-400"
                        title={r.aciklama}
                      >
                        {r.aciklama}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">{kindBadge(r.kind)}</td>
                  <td className="px-4 py-3">
                    <span className="font-medium text-slate-900">
                      {r.bayiAdi || "—"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {r.kartSahibi || "—"}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums text-slate-900">
                    {formatAmount(r.amount)}
                  </td>
                  <td className="px-4 py-3">
                    {r.kind === "order" && r.humanOrderNo ? (
                      <span className="font-mono text-xs text-slate-700">
                        {r.humanOrderNo}
                      </span>
                    ) : r.kind === "cari_topup" && r.humanTopupNo ? (
                      <span className="font-mono text-xs text-slate-700">
                        {r.humanTopupNo}
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-700">{r.durum || "—"}</td>
                  <td className="px-4 py-3 text-slate-700">
                    {r.posProviderKey || "—"}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-slate-700">
                    {formatDate(r.issuedAt)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => void handleOpenPdf(r)}
                      disabled={openingId === r.id}
                      title="Makbuz PDF'ini görüntüle / indir"
                      aria-label="Makbuz PDF'ini görüntüle / indir"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      {openingId === r.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : r.hasPdf ? (
                        <Download className="h-3.5 w-3.5" />
                      ) : (
                        <FileText className="h-3.5 w-3.5" />
                      )}
                      {openingId === r.id ? "Açılıyor…" : "PDF"}
                    </button>
                  </td>
                </tr>
              ))}
              {items.length === 0 ? (
                <tr>
                  <td
                    colSpan={10}
                    className="px-4 py-8 text-center text-sm text-slate-400"
                  >
                    {hasFilters
                      ? "Bu filtrelerle eşleşen makbuz yok."
                      : "Henüz makbuz yok. Kartlı ödeme alındığında otomatik oluşur."}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}

      {/* Sayfalama */}
      {meta.totalPages > 1 ? (
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-slate-500">
            Sayfa <strong className="text-slate-900">{meta.page}</strong> /{" "}
            {meta.totalPages}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={meta.page <= 1 || receiptsQuery.isFetching}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Önceki
            </button>
            <button
              type="button"
              onClick={() =>
                setPage((p) => Math.min(meta.totalPages, p + 1))
              }
              disabled={meta.page >= meta.totalPages || receiptsQuery.isFetching}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Sonraki
            </button>
          </div>
        </div>
      ) : null}

      <p className="text-xs text-slate-400">
        Not: Makbuz yalnızca kredi kartı işlemlerinde üretilir. Cari bakiyeyle
        ödenen siparişler veya banka havalesiyle yapılan yüklemeler için makbuz
        oluşmaz.
      </p>
    </div>
  );
}

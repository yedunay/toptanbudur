import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Wallet, AlertTriangle, Building2 } from "lucide-react";
import {
  fetchSupplierBalanceSummary,
  type SupplierBalanceRow,
} from "../lib/supplier-balance";
import { formatTRY } from "../lib/products";
import { canAccess } from "../lib/permissions";

const REFRESH_MS = 60_000;

interface SupplierBalanceStripProps {
  /** Verildiğinde tedarikçi çipine tıklamak yönetim modalını açar. */
  onManageSupplier?: (supplierId: string) => void;
  className?: string;
}

/**
 * TEDARİKÇİ BAKİYE SENKRONU — özet şerit.
 * Adminin tedarikçi sitelerindeki kendi cüzdan bakiyesinin toplamını ve
 * düşük bakiyeli tedarikçileri gösterir. Kâr/maliyet ile ilgisi yoktur.
 */
export default function SupplierBalanceStrip({
  onManageSupplier,
  className,
}: SupplierBalanceStripProps): React.ReactElement | null {
  // Özet ucu 'suppliers' sayfa iznine bağlı — izinsiz çalışanda 403 dönüp
  // kalıcı amber "alınamadı" kutusu bırakıyordu. Sorguyu hiç atmayıp şeridi
  // tamamen gizliyoruz.
  const allowed = canAccess("suppliers");
  const query = useQuery({
    queryKey: ["supplier-balance", "summary"],
    queryFn: fetchSupplierBalanceSummary,
    refetchInterval: REFRESH_MS,
    enabled: allowed,
  });

  if (!allowed) return null;

  const data = query.data;

  // İlk yükleme — ince iskelet
  if (query.isLoading && !data) {
    return (
      <div
        className={`animate-pulse rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 ${className ?? ""}`}
      >
        <div className="h-4 w-40 rounded bg-slate-100" />
        <div className="mt-3 h-7 w-56 rounded bg-slate-100" />
      </div>
    );
  }

  // Hata — sessizce küçük bir uyarı (dashboard'u bloklamasın)
  if (query.isError && !data) {
    return (
      <div
        className={`rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 ${className ?? ""}`}
      >
        Tedarikçi bakiyeleri alınamadı.{" "}
        <button
          type="button"
          onClick={() => void query.refetch()}
          className="font-medium underline underline-offset-2"
        >
          Tekrar dene
        </button>
      </div>
    );
  }

  // Hiç tedarikçi yoksa şeridi gösterme
  if (!data || data.totals.supplierCount === 0) return null;

  const { totals, suppliers } = data;
  const hasLow = totals.lowCount > 0;
  const lowSuppliers = suppliers.filter((s) => s.isLow);
  // Düşük olanlar önce; zaten backend balance asc döndürüyor.
  const visible = [...lowSuppliers, ...suppliers.filter((s) => !s.isLow)];

  return (
    <section
      aria-label="Tedarikçi bakiye özeti"
      className={`overflow-hidden rounded-2xl border bg-white shadow-[0_4px_16px_-6px_rgba(15,23,42,0.06)] ${
        hasLow ? "border-rose-200" : "border-slate-200"
      } ${className ?? ""}`}
    >
      {/* Üst satır: toplam + sayaçlar */}
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-3.5 sm:px-5">
        <div className="flex items-center gap-3">
          <span
            className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${
              hasLow ? "bg-rose-50 text-rose-600" : "bg-blue-50 text-blue-600"
            }`}
          >
            <Wallet size={20} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Tedarikçi cüzdan bakiyesi
            </p>
            <p className="text-xl font-semibold tabular-nums text-slate-900 sm:text-2xl">
              {formatTRY(totals.totalBalance)}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <Building2 size={14} aria-hidden="true" />
            <span className="font-medium text-slate-700">
              {totals.supplierCount.toLocaleString("tr-TR")}
            </span>
            tedarikçi
          </div>
          {hasLow ? (
            <div className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700">
              <AlertTriangle size={13} aria-hidden="true" />
              {totals.lowCount.toLocaleString("tr-TR")} düşük bakiye
            </div>
          ) : (
            <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
              Tümü yeterli
            </span>
          )}
        </div>
      </div>

      {/* Alt satır: tedarikçi çipleri */}
      <div className="flex gap-2 overflow-x-auto border-t border-slate-100 bg-slate-50/60 px-4 py-3 sm:px-5">
        {visible.map((s) => (
          <SupplierChip
            key={s.supplierId}
            row={s}
            onClick={
              onManageSupplier ? () => onManageSupplier(s.supplierId) : undefined
            }
          />
        ))}
      </div>
    </section>
  );
}

interface SupplierChipProps {
  row: SupplierBalanceRow;
  onClick?: () => void;
}

function SupplierChip({ row, onClick }: SupplierChipProps): React.ReactElement {
  const tone = row.isLow
    ? "border-rose-200 bg-rose-50 text-rose-700 hover:border-rose-300"
    : "border-slate-200 bg-white text-slate-700 hover:border-slate-300";

  const inner = (
    <>
      <span className="max-w-[10rem] truncate text-xs font-medium">
        {row.supplierName || "—"}
      </span>
      <span
        className={`text-xs font-semibold tabular-nums ${
          row.isLow ? "text-rose-700" : "text-slate-900"
        }`}
      >
        {formatTRY(row.balance)}
      </span>
      {row.isLow ? (
        <AlertTriangle size={12} className="text-rose-500" aria-hidden="true" />
      ) : null}
    </>
  );

  const base =
    "inline-flex shrink-0 items-center gap-2 rounded-lg border px-3 py-1.5 transition";

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`${base} ${tone} cursor-pointer`}
        title={`${row.supplierName} bakiyesini yönet`}
      >
        {inner}
      </button>
    );
  }

  // Yönetim callback'i yoksa tedarikçiler sayfasına götür
  return (
    <Link to="/suppliers" className={`${base} ${tone}`} title={row.supplierName}>
      {inner}
    </Link>
  );
}

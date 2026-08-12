import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRequireAuth } from "../lib/auth";
import {
  adjustCustomerBalance,
  giftCustomerBalance,
  fetchCustomer,
  fetchCustomerCariLedger,
  fetchCustomerPassword,
  fetchSupplierDiscounts,
  resetCustomerPassword,
  setCustomerPassword,
  setCustomerVacationMode,
  updateCustomerDiscount,
  updateCustomerProfile,
  updateCustomerStatus,
  updateSupplierDiscounts,
  CARI_LEDGER_TYPE_LABELS,
  type CariLedgerEntry,
  type CustomerAddress,
  type CustomerDetail,
  type CustomerStatus,
  type CustomerSupplierDiscount,
} from "../lib/customers";
import { formatTRY } from "../lib/products";
import {
  ORDER_STATUS_LABELS,
  formatDateTime,
  formatOrderNo,
  formatShortDateTime,
  type OrderStatus,
} from "../lib/orders";
import { useDocumentTitle } from "../lib/useDocumentTitle";
import {
  canDoMoneyOps,
  canSeeCostProfit,
  isPrivilegedAdmin,
} from "../lib/permissions";
import { useToast } from "../components/Toast";
import { CustomerTagEditor } from "../components/CustomerTagEditor";
import CustomerSettingsModal from "../components/CustomerSettingsModal";
import ErrorBoundary from "../components/ErrorBoundary";

function buildXmlFeedUrl(token: string): string {
  if (typeof window === "undefined") return `/xml/customer/${token}.xml`;
  return `${window.location.origin}/xml/customer/${token}.xml`;
}

/**
 * Yapısal adres defteri kaydını tek satırlık string'e çevirir — backend'deki
 * formatCompanyAddress ile aynı format. "Firma Adresi" (companyAddress) boşken
 * varsayılan adrese düşmek için kullanılır.
 */
function formatAddressLine(a: CustomerAddress | null | undefined): string {
  if (!a) return "";
  const districtCity = [a.district, a.city]
    .map((p) => (typeof p === "string" ? p.trim() : ""))
    .filter((p) => p.length > 0)
    .join("/");
  return [a.line1, a.line2, districtCity, a.postalCode]
    .map((p) => (typeof p === "string" ? p.trim() : ""))
    .filter((p) => p.length > 0)
    .join(", ");
}

function safeNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

/** Cari bakiye işaretine göre renk tonu — pozitif yeşil, negatif kırmızı. */
function balanceAccentClass(balance: number): string | undefined {
  if (balance > 0) return "border-emerald-200 bg-emerald-50";
  if (balance < 0) return "border-red-200 bg-red-50";
  return undefined;
}

function balanceTextClass(balance: number): string {
  if (balance > 0) return "text-emerald-700";
  if (balance < 0) return "text-red-600";
  return "text-[var(--color-text-muted)]";
}

function StatBadge({ label, value, accent }: { label: string; value: string; accent?: string }): React.ReactElement {
  return (
    <div className={`rounded-lg border px-4 py-3 ${accent ?? "border-[var(--color-border)] bg-white"}`}>
      <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p>
      <p className="mt-0.5 text-lg font-semibold text-[var(--color-text)]">{value}</p>
    </div>
  );
}

/** `hidden` → bölüm hiç render edilmez. Para/maliyet/kimlik bölümlerini
 *  çalışan (MEMBER) rolünde gizlemek için kullanılır; ilgili API uçları
 *  backend'de zaten OWNER/ADMIN'e kilitli, bu yalnız kırık kutu göstermemek
 *  içindir. */
function SectionCard({
  title,
  children,
  hidden = false,
}: {
  title: string;
  children: React.ReactNode;
  hidden?: boolean;
}): React.ReactElement | null {
  if (hidden) return null;
  return (
    <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-white">
      <div className="border-b border-[var(--color-border)] px-5 py-3">
        <h2 className="text-sm font-medium text-[var(--color-text)]">{title}</h2>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function SupplierDiscountsCard({
  customerId,
  globalProfitDiscount,
  disabled = false,
}: {
  customerId: string;
  globalProfitDiscount: number;
  disabled?: boolean;
}): React.ReactElement {
  const toast = useToast();
  const queryClient = useQueryClient();
  // Tedarikçi-bazlı "Kâr İndirimi" (kardan) yerel düzenleme durumu (string input).
  const [localOverrides, setLocalOverrides] = useState<Record<string, string>>({});
  // Tedarikçi-bazlı Admin İndirimi toggle'larının kaydedilmemiş yerel durumu.
  const [localAdmin, setLocalAdmin] = useState<Record<string, boolean>>({});
  const [dirty, setDirty] = useState(false);

  const { data: discounts = [], isLoading } = useQuery<CustomerSupplierDiscount[]>({
    queryKey: ["supplier-discounts", customerId],
    queryFn: () => fetchSupplierDiscounts(customerId),
  });

  const saveMutation = useMutation({
    mutationFn: () => {
      // YALNIZCA dokunulan satırları gönder — dokunulmayan satırlar (ör. eski
      // liste indirimi olanlar) backend'de aynen korunur (silinmez).
      const touched = new Set([
        ...Object.keys(localOverrides),
        ...Object.keys(localAdmin),
      ]);
      const payload = discounts
        .filter((d) => touched.has(d.supplierId))
        .map((d) => {
          const adminOn = localAdmin[d.supplierId] ?? d.adminDiscount;
          // Admin İndirimi açık → maliyet fiyatı; legacy off-list korunur.
          if (adminOn) {
            return { supplierId: d.supplierId, adminDiscount: true };
          }
          const lo = localOverrides[d.supplierId];
          // lo "" (✕ / alanı boşalt) → override'ı tamamen kaldır (global'e dön).
          if (lo === "") {
            return { supplierId: d.supplierId, clearOverride: true };
          }
          // lo undefined (yalnız Admin kapatıldı) → Kâr İndirimi'ne DOKUNMA,
          // legacy off-list korunur (sadece adminDiscount=false yapılır).
          if (lo === undefined) {
            return { supplierId: d.supplierId, adminDiscount: false };
          }
          return {
            supplierId: d.supplierId,
            profitDiscountPercent: Math.max(0, Math.min(100, Number(lo) || 0)),
            adminDiscount: false,
          };
        });
      return updateSupplierDiscounts(customerId, payload);
    },
    onSuccess: () => {
      toast.push("success", "Tedarikçi iskontolar kaydedildi");
      setDirty(false);
      setLocalOverrides({});
      setLocalAdmin({});
      void queryClient.invalidateQueries({ queryKey: ["supplier-discounts", customerId] });
    },
    onError: (err) => {
      toast.push("error", err instanceof Error ? err.message : "Kaydedilemedi");
    },
  });

  const effectiveValue = (d: CustomerSupplierDiscount): number | null => {
    const lo = localOverrides[d.supplierId];
    if (lo !== undefined) return lo === "" ? null : Number(lo) || 0;
    return d.profitDiscountPercent;
  };

  const effectiveAdmin = (d: CustomerSupplierDiscount): boolean =>
    localAdmin[d.supplierId] ?? d.adminDiscount;

  if (isLoading) {
    return (
      <div className="space-y-2 py-1">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-8 animate-pulse rounded-lg bg-[var(--color-surface-muted)]" />
        ))}
      </div>
    );
  }

  if (discounts.length === 0) {
    return (
      <p className="text-sm text-[var(--color-text-muted)]">Tanımlı tedarikçi bulunamadı.</p>
    );
  }

  return (
    <div className={`space-y-3 ${disabled ? "opacity-60" : ""}`} aria-disabled={disabled || undefined}>
      <p className="text-xs text-[var(--color-text-muted)]">
        {disabled
          ? "Global Admin İndirimi aktif: tüm tedarikçi override'ları devre dışı, her tedarikçide maliyet fiyatı uygulanıyor."
          : `Kâr İndirimi: indirim ürünün kârından yapılır, maliyetin altına inmez. Boş bırakılan tedarikçilerde global Kâr İndirimi (%${globalProfitDiscount}) uygulanır. %100 ⇒ maliyet (Admin İndirimi). "Admin İndirimi" açık tedarikçide ürünler maliyet + paketleme (4,80) fiyatından satılır.`}
      </p>
      <div className="space-y-2">
        {discounts.map((d) => {
          const adminOn = effectiveAdmin(d);
          const effective = effectiveValue(d);
          const isOverridden = !adminOn && effective !== null;
          return (
            <div
              key={d.supplierId}
              className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm ${
                adminOn
                  ? "border-emerald-200 bg-emerald-50"
                  : isOverridden
                  ? "border-blue-200 bg-blue-50"
                  : "border-[var(--color-border)] bg-[var(--color-surface-muted)]"
              }`}
            >
              <div className="min-w-0">
                <span className="block font-medium text-[var(--color-text)] truncate">{d.supplierName}</span>
                {d.discountPercent !== null && d.discountPercent > 0 ? (
                  <span className="mt-0.5 block text-[10px] text-amber-600">
                    Eski liste indirimi: %{d.discountPercent} (Kâr İndirimi girilince geçersiz)
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {adminOn ? (
                  <span className="rounded-md bg-emerald-100 px-2 py-1 text-[11px] font-semibold text-emerald-700">
                    Maliyet + paketleme
                  </span>
                ) : (
                  <>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      disabled={disabled}
                      placeholder={`Global: ${globalProfitDiscount}%`}
                      title="Kâr İndirimi % (kardan). %100 = maliyet. Boş = global."
                      value={
                        localOverrides[d.supplierId] !== undefined
                          ? localOverrides[d.supplierId]
                          : d.profitDiscountPercent !== null
                          ? String(d.profitDiscountPercent)
                          : ""
                      }
                      onChange={(e) => {
                        setLocalOverrides((prev) => ({ ...prev, [d.supplierId]: e.target.value }));
                        setDirty(true);
                      }}
                      className="w-24 rounded-md border border-[var(--color-border)] bg-white px-2 py-1 text-xs disabled:cursor-not-allowed disabled:bg-[var(--color-surface-muted)]"
                    />
                    <span className="text-xs text-[var(--color-text-muted)]">%</span>
                    {isOverridden && !disabled ? (
                      <button
                        type="button"
                        onClick={() => {
                          setLocalOverrides((prev) => ({ ...prev, [d.supplierId]: "" }));
                          setDirty(true);
                        }}
                        title="Override'ı kaldır (global kullan)"
                        className="text-xs text-red-500 hover:text-red-700"
                      >
                        ✕
                      </button>
                    ) : null}
                  </>
                )}
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    setLocalAdmin((prev) => ({ ...prev, [d.supplierId]: !adminOn }));
                    setDirty(true);
                  }}
                  title="Bu tedarikçide Admin İndirimi: ürünler maliyet fiyatından satılır, yalnızca paketleme (4,80) karı kalır"
                  className={`rounded-md border px-2 py-1 text-[11px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                    adminOn
                      ? "border-emerald-300 bg-emerald-600 text-white hover:bg-emerald-700"
                      : "border-[var(--color-border)] bg-white text-[var(--color-text-muted)] hover:border-emerald-300 hover:text-emerald-700"
                  }`}
                >
                  Admin İndirimi
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {dirty && !disabled ? (
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            disabled={saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
            className="rounded-lg bg-[var(--color-brand-blue)] px-3 py-1.5 text-xs text-white hover:opacity-90 disabled:opacity-60"
          >
            {saveMutation.isPending ? "Kaydediliyor…" : "Kaydet"}
          </button>
          <button
            type="button"
            onClick={() => {
              setLocalOverrides({});
              setLocalAdmin({});
              setDirty(false);
            }}
            className="rounded-lg border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs hover:bg-[var(--color-surface-muted)]"
          >
            İptal
          </button>
        </div>
      ) : null}
    </div>
  );
}

function GiftBalanceModal({
  currentBalance,
  giftAmount,
  giftNote,
  giftIsValid,
  projectedBalance,
  isPending,
  onAmountChange,
  onNoteChange,
  onSubmit,
  onClose,
}: {
  currentBalance: number;
  giftAmount: string;
  giftNote: string;
  giftIsValid: boolean;
  projectedBalance: number;
  isPending: boolean;
  onAmountChange: (v: string) => void;
  onNoteChange: (v: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}): React.ReactElement {
  const giftValue = giftIsValid ? Number(giftAmount) : 0;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Hediye bakiye tanımla"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-gradient-to-br from-emerald-500 to-green-600 px-5 py-4 text-white">
          <p className="text-lg font-semibold">🎁 Hediye Bakiye Tanımla</p>
          <p className="mt-0.5 text-xs text-emerald-50">
            Girilen tutar müşterinin cari bakiyesine <strong>eklenir</strong> ve
            müşteriye otomatik bilgilendirme e-postası gönderilir.
          </p>
        </div>

        <form
          className="space-y-4 p-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (giftIsValid && !isPending) onSubmit();
          }}
        >
          <div>
            <label className="text-xs font-medium text-[var(--color-text-muted)]">
              Hediye tutarı (₺)
            </label>
            <input
              autoFocus
              type="number"
              step="0.01"
              min="1"
              inputMode="decimal"
              placeholder="ör. 250"
              value={giftAmount}
              onChange={(e) => onAmountChange(e.target.value)}
              className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-lg font-semibold tabular-nums focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-100"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-[var(--color-text-muted)]">
              Mesaj / kampanya notu (opsiyonel)
            </label>
            <input
              type="text"
              maxLength={280}
              placeholder="ör. Sadakatiniz için teşekkürler!"
              value={giftNote}
              onChange={(e) => onNoteChange(e.target.value)}
              className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-100"
            />
            <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">
              Bu not müşteriye giden hediye e-postasında "size özel not" olarak
              görünür.
            </p>
          </div>

          <div className="space-y-1.5 rounded-xl border border-emerald-100 bg-emerald-50/60 p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-[var(--color-text-muted)]">Önceki bakiye</span>
              <span className="font-medium tabular-nums text-[var(--color-text)]">
                {formatTRY(currentBalance)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[var(--color-text-muted)]">Hediye bakiye</span>
              <span className="font-semibold tabular-nums text-emerald-700">
                {giftIsValid ? `+ ${formatTRY(giftValue)}` : "—"}
              </span>
            </div>
            <div className="mt-1 flex items-center justify-between border-t border-emerald-200 pt-2">
              <span className="font-semibold text-[var(--color-text)]">
                Toplam yeni bakiye
              </span>
              <span className="text-base font-bold tabular-nums text-emerald-700">
                {formatTRY(projectedBalance)}
              </span>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={isPending}
              className="rounded-lg border border-[var(--color-border)] bg-white px-4 py-2 text-sm hover:bg-[var(--color-surface-muted)] disabled:opacity-60"
            >
              Vazgeç
            </button>
            <button
              type="submit"
              disabled={!giftIsValid || isPending}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isPending ? "Tanımlanıyor…" : "🎁 Hediyeyi Tanımla"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function CariBalanceCard({
  customerId,
  currentBalance,
}: {
  customerId: string;
  currentBalance: number;
}): React.ReactElement {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [balanceValue, setBalanceValue] = useState("");
  const [reasonValue, setReasonValue] = useState("");
  const [showLedger, setShowLedger] = useState(false);
  const [expandedLedgerId, setExpandedLedgerId] = useState<string | null>(null);
  const [ledgerPage, setLedgerPage] = useState<number>(1);
  const LEDGER_PAGE_SIZE = 25;

  // 🎁 Hediye bakiye popup'ı — girilen tutar EKLENECEK pozitif hediyedir.
  const [giftOpen, setGiftOpen] = useState(false);
  const [giftAmount, setGiftAmount] = useState("");
  const [giftNote, setGiftNote] = useState("");

  const adjustMutation = useMutation({
    mutationFn: () => {
      const next = Number(balanceValue);
      if (!Number.isFinite(next)) {
        return Promise.reject(new Error("Geçerli bir tutar girin"));
      }
      return adjustCustomerBalance(customerId, next, reasonValue);
    },
    onSuccess: (result) => {
      toast.push(
        "success",
        `Bakiye güncellendi: ${formatTRY(result.previousBalance)} → ${formatTRY(result.newBalance)}`,
      );
      setEditing(false);
      setBalanceValue("");
      setReasonValue("");
      void queryClient.invalidateQueries({ queryKey: ["customer", customerId] });
      void queryClient.invalidateQueries({ queryKey: ["customers"] });
      void queryClient.invalidateQueries({ queryKey: ["cari-ledger", customerId] });
    },
    onError: (err) => {
      toast.push("error", err instanceof Error ? err.message : "Güncellenemedi");
    },
  });

  const giftMutation = useMutation({
    mutationFn: () => {
      const amount = Number(giftAmount);
      if (!Number.isFinite(amount) || amount <= 0) {
        return Promise.reject(new Error("Geçerli bir hediye tutarı girin"));
      }
      return giftCustomerBalance(customerId, amount, giftNote);
    },
    onSuccess: (result) => {
      toast.push(
        "success",
        `🎁 Hediye bakiye tanımlandı: +${formatTRY(result.giftAmount)} · Yeni bakiye ${formatTRY(result.newBalance)}`,
      );
      setGiftOpen(false);
      setGiftAmount("");
      setGiftNote("");
      void queryClient.invalidateQueries({ queryKey: ["customer", customerId] });
      void queryClient.invalidateQueries({ queryKey: ["customers"] });
      void queryClient.invalidateQueries({ queryKey: ["cari-ledger", customerId] });
    },
    onError: (err) => {
      toast.push(
        "error",
        err instanceof Error ? err.message : "Hediye bakiye tanımlanamadı",
      );
    },
  });

  const parsedGift = Number(giftAmount);
  const giftIsValid = Number.isFinite(parsedGift) && parsedGift > 0;
  const giftProjectedBalance = giftIsValid
    ? currentBalance + parsedGift
    : currentBalance;

  const ledgerQuery = useQuery({
    queryKey: ["cari-ledger", customerId, ledgerPage, LEDGER_PAGE_SIZE],
    queryFn: () =>
      fetchCustomerCariLedger(customerId, ledgerPage, LEDGER_PAGE_SIZE),
    enabled: showLedger,
    placeholderData: (prev) => prev,
  });
  const ledger: CariLedgerEntry[] = ledgerQuery.data?.data ?? [];
  const ledgerLoading = ledgerQuery.isLoading;
  const ledgerMeta = ledgerQuery.data?.meta;
  const ledgerTotal = ledgerMeta?.total ?? 0;
  const ledgerTotalPages = Math.max(ledgerMeta?.totalPages ?? 1, 1);
  const ledgerRangeStart =
    ledgerTotal === 0 ? 0 : (ledgerPage - 1) * LEDGER_PAGE_SIZE + 1;
  const ledgerRangeEnd = Math.min(ledgerPage * LEDGER_PAGE_SIZE, ledgerTotal);

  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-xs text-[var(--color-text-muted)]">Güncel cari bakiye</p>
          <p className={`mt-0.5 text-2xl font-semibold tabular-nums ${balanceTextClass(currentBalance)}`}>
            {formatTRY(currentBalance)}
          </p>
        </div>
        {!editing ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setGiftAmount("");
                setGiftNote("");
                setGiftOpen(true);
              }}
              className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
            >
              🎁 Hediye Bakiye
            </button>
            <button
              type="button"
              onClick={() => {
                setBalanceValue(String(currentBalance));
                setReasonValue("");
                setEditing(true);
              }}
              className="rounded-md border border-[var(--color-border)] bg-white px-2.5 py-1 text-xs hover:bg-[var(--color-surface-muted)]"
            >
              Düzenle
            </button>
          </div>
        ) : null}
      </div>

      {giftOpen ? (
        <GiftBalanceModal
          currentBalance={currentBalance}
          giftAmount={giftAmount}
          giftNote={giftNote}
          giftIsValid={giftIsValid}
          projectedBalance={giftProjectedBalance}
          isPending={giftMutation.isPending}
          onAmountChange={setGiftAmount}
          onNoteChange={setGiftNote}
          onSubmit={() => giftMutation.mutate()}
          onClose={() => {
            if (giftMutation.isPending) return;
            setGiftOpen(false);
          }}
        />
      ) : null}

      {editing ? (
        <div className="space-y-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3">
          <div>
            <label className="text-xs text-[var(--color-text-muted)]">Yeni bakiye (₺)</label>
            <input
              autoFocus
              type="number"
              step="0.01"
              value={balanceValue}
              onChange={(e) => setBalanceValue(e.target.value)}
              className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-white px-2 py-1.5 text-sm tabular-nums"
            />
          </div>
          <div>
            <label className="text-xs text-[var(--color-text-muted)]">Açıklama (opsiyonel)</label>
            <input
              type="text"
              maxLength={280}
              placeholder="ör. Banka havalesi mutabakatı"
              value={reasonValue}
              onChange={(e) => setReasonValue(e.target.value)}
              className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-white px-2 py-1.5 text-sm"
            />
          </div>
          <p className="text-[11px] text-[var(--color-text-muted)] leading-snug">
            Girilen değer yeni <strong>mutlak</strong> bakiyedir. Fark otomatik hesaplanıp
            cari hareket defterine yazılır ve audit log'a kaydedilir.
          </p>
          <div className="flex gap-2 pt-0.5">
            <button
              type="button"
              disabled={adjustMutation.isPending}
              onClick={() => adjustMutation.mutate()}
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              {adjustMutation.isPending ? "Kaydediliyor…" : "Kaydet"}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setBalanceValue("");
                setReasonValue("");
              }}
              className="rounded-md border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs hover:bg-[var(--color-surface-muted)]"
            >
              İptal
            </button>
          </div>
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => {
          setShowLedger((v) => !v);
          setLedgerPage(1);
        }}
        className="text-xs text-[var(--color-brand-blue)] hover:underline"
      >
        {showLedger ? "Hareket defterini gizle" : "Cari hareket defterini göster"}
      </button>

      {showLedger ? (
        ledgerLoading ? (
          <div className="space-y-1.5">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-9 animate-pulse rounded-lg bg-[var(--color-surface-muted)]" />
            ))}
          </div>
        ) : !ledger || ledger.length === 0 ? (
          <p className="text-xs text-[var(--color-text-muted)]">Henüz cari hareket yok.</p>
        ) : (
          <div className="space-y-2">
          <ul className="space-y-1.5">
            {ledger.map((entry) => {
              const isExpanded = expandedLedgerId === entry.id;
              const hasDetails = Boolean(
                entry.description || entry.orderId || entry.topupId,
              );
              return (
                <li
                  key={entry.id}
                  className="rounded-lg border border-[var(--color-border)] bg-white text-xs transition-colors hover:border-[var(--color-brand-blue)]/40"
                >
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedLedgerId((prev) => (prev === entry.id ? null : entry.id))
                    }
                    className="flex w-full items-start justify-between gap-3 px-3 py-2 text-left"
                    aria-expanded={isExpanded}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="font-medium text-[var(--color-text)]">
                          {entry.isGift
                            ? "🎁 Hediye Bakiye"
                            : (CARI_LEDGER_TYPE_LABELS[entry.type] ?? entry.type)}
                        </span>
                        {entry.isGift ? (
                          <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                            Hediye
                          </span>
                        ) : null}
                        <span className="text-[var(--color-text-muted)]">
                          {formatShortDateTime(entry.createdAt)}
                        </span>
                      </div>
                      {entry.description && !isExpanded ? (
                        <p className="mt-0.5 line-clamp-1 text-[var(--color-text-muted)]">
                          {entry.description}
                        </p>
                      ) : null}
                    </div>
                    <div className="shrink-0 text-right tabular-nums">
                      <p
                        className={`font-medium ${
                          entry.amount < 0 ? "text-red-600" : "text-emerald-700"
                        }`}
                      >
                        {entry.amount > 0 ? "+" : ""}
                        {formatTRY(entry.amount)}
                      </p>
                      <p className="text-[var(--color-text-muted)]">
                        Bakiye: {formatTRY(entry.balanceAfter)}
                      </p>
                    </div>
                  </button>
                  {isExpanded && hasDetails ? (
                    <div className="space-y-2 border-t border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2.5">
                      {entry.description ? (
                        <div>
                          <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
                            Açıklama
                          </p>
                          <p className="mt-0.5 whitespace-pre-wrap break-words text-[var(--color-text)]">
                            {entry.description}
                          </p>
                        </div>
                      ) : null}
                      <div className="flex flex-wrap gap-3">
                        <div>
                          <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
                            Tarih
                          </p>
                          <p className="mt-0.5 text-[var(--color-text)]">
                            {formatDateTime(entry.createdAt)}
                          </p>
                        </div>
                        {entry.orderId ? (
                          <div>
                            <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
                              Sipariş
                            </p>
                            <Link
                              to={`/orders/${entry.orderId}`}
                              className="mt-0.5 inline-block font-mono text-[var(--color-brand-blue)] hover:underline"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {formatOrderNo(entry.humanOrderNo, "—")} ↗
                            </Link>
                          </div>
                        ) : null}
                        {entry.topupId ? (
                          <div>
                            <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
                              Topup
                            </p>
                            <p className="mt-0.5 font-mono text-[var(--color-text)]">
                              {entry.humanTopupNo ?? entry.topupId.slice(0, 8)}
                            </p>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-border)] pt-2">
            <p
              aria-live="polite"
              className="text-[11px] text-[var(--color-text-muted)] tabular-nums"
            >
              {ledgerRangeStart}-{ledgerRangeEnd} / {ledgerTotal} kayıt
              {ledgerQuery.isFetching ? " · Yükleniyor…" : ""}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setLedgerPage((p) => Math.max(1, p - 1))}
                disabled={ledgerPage <= 1 || ledgerQuery.isFetching}
                className="rounded-md border border-[var(--color-border)] bg-white px-2.5 py-1 text-xs hover:bg-[var(--color-surface-muted)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                ← Önceki
              </button>
              <span className="text-[11px] text-[var(--color-text-muted)] tabular-nums">
                Sayfa {ledgerPage} / {ledgerTotalPages}
              </span>
              <button
                type="button"
                onClick={() =>
                  setLedgerPage((p) => Math.min(ledgerTotalPages, p + 1))
                }
                disabled={
                  ledgerPage >= ledgerTotalPages || ledgerQuery.isFetching
                }
                className="rounded-md border border-[var(--color-border)] bg-white px-2.5 py-1 text-xs hover:bg-[var(--color-surface-muted)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Sonraki →
              </button>
            </div>
          </div>
          </div>
        )
      ) : null}
    </div>
  );
}

function TatilModuCard({
  customerId,
  vacationMode,
  vacationStartedAt,
}: {
  customerId: string;
  vacationMode: boolean;
  vacationStartedAt: string | null;
}): React.ReactElement {
  const toast = useToast();
  const queryClient = useQueryClient();

  const vacationMutation = useMutation({
    mutationFn: (enabled: boolean) => setCustomerVacationMode(customerId, enabled),
    onSuccess: (result) => {
      toast.push(
        "success",
        result.vacationMode ? "Tatil modu açıldı" : "Tatil modu kapatıldı",
      );
      void queryClient.invalidateQueries({ queryKey: ["customer", customerId] });
      void queryClient.invalidateQueries({ queryKey: ["customers"] });
    },
    onError: (err) => {
      toast.push("error", err instanceof Error ? err.message : "Tatil modu değiştirilemedi");
    },
  });

  return (
    <div className="rounded-lg border border-[var(--color-border)] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-[var(--color-text)]">Tatil Modu</p>
            {vacationMode ? (
              <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-700">
                Aktif
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            Bayinin geçici olarak siparişe kapalı olduğunu işaretler.
          </p>
          {vacationMode && vacationStartedAt ? (
            <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">
              Başlangıç: {formatDateTime(vacationStartedAt)}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          disabled={vacationMutation.isPending}
          onClick={() => vacationMutation.mutate(!vacationMode)}
          className={`shrink-0 rounded-md px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60 ${
            vacationMode
              ? "bg-amber-600 hover:bg-amber-700"
              : "bg-emerald-600 hover:bg-emerald-700"
          }`}
        >
          {vacationMutation.isPending
            ? "İşleniyor…"
            : vacationMode
              ? "Tatil Modunu Kapat"
              : "Tatil Modunu Aç"}
        </button>
      </div>
    </div>
  );
}

function CustomerDetailContent({
  customer,
  customerId,
}: {
  customer: CustomerDetail;
  customerId: string;
}): React.ReactElement {
  const queryClient = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();

  const [discountValue, setDiscountValue] = useState("");
  const [editingDiscount, setEditingDiscount] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [revealedPassword, setRevealedPassword] = useState<string | null>(null);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [passwordMissing, setPasswordMissing] = useState(false);
  const [editingPassword, setEditingPassword] = useState(false);
  const [newPasswordValue, setNewPasswordValue] = useState("");

  const passwordMutation = useMutation({
    mutationFn: () => fetchCustomerPassword(customerId),
    onSuccess: (result) => {
      if (result.password && result.hasEncryptedPassword) {
        setRevealedPassword(result.password);
        setPasswordVisible(true);
        setPasswordMissing(false);
        toast.push("success", "Şifre çözüldü — audit log'a yazıldı");
      } else {
        setPasswordMissing(true);
        toast.push("info", "Şifreli kopya yok — sıfırlama gerekli");
      }
    },
    onError: (err) => toast.push("error", err instanceof Error ? err.message : "Şifre alınamadı"),
  });

  const setPasswordMutation = useMutation({
    mutationFn: (next: string) => setCustomerPassword(customerId, next),
    onSuccess: (_data, next) => {
      toast.push("success", "Şifre güncellendi");
      setEditingPassword(false);
      setNewPasswordValue("");
      setRevealedPassword(next);
      setPasswordVisible(true);
      setPasswordMissing(false);
    },
    onError: (err) => toast.push("error", err instanceof Error ? err.message : "Güncellenemedi"),
  });

  const resetPasswordMutation = useMutation({
    mutationFn: () => resetCustomerPassword(customerId),
    onSuccess: (data) => {
      toast.push("success", `Şifre sıfırlandı: ${data.password}`);
      setRevealedPassword(data.password);
      setPasswordVisible(true);
      setPasswordMissing(false);
    },
    onError: (err) => toast.push("error", err instanceof Error ? err.message : "Sıfırlanamadı"),
  });

  // Global "Kâr İndirimi" (kardan) — düzenlenebilir birincil oran.
  const profitMutation = useMutation({
    mutationFn: (next: number) =>
      updateCustomerProfile(customerId, { profitDiscountPercent: next }),
    onSuccess: () => {
      toast.push("success", "Global Kâr İndirimi güncellendi");
      setEditingDiscount(false);
      void queryClient.invalidateQueries({ queryKey: ["customer", customerId] });
      void queryClient.invalidateQueries({ queryKey: ["customers"] });
    },
    onError: (err) => toast.push("error", err instanceof Error ? err.message : "Güncellenemedi"),
  });

  // LEGACY off-list global iskonto — yalnız "sıfırla" için kullanılır.
  const discountMutation = useMutation({
    mutationFn: (next: number) => updateCustomerDiscount(customerId, next),
    onSuccess: () => {
      toast.push("success", "Eski liste iskontosu güncellendi");
      void queryClient.invalidateQueries({ queryKey: ["customer", customerId] });
      void queryClient.invalidateQueries({ queryKey: ["customers"] });
    },
    onError: (err) => toast.push("error", err instanceof Error ? err.message : "Güncellenemedi"),
  });

  const statusMutation = useMutation({
    mutationFn: (next: CustomerStatus) => updateCustomerStatus(customerId, next),
    onSuccess: (_data, next) => {
      toast.push(
        "success",
        next === "ADMIN_DISCOUNT"
          ? "Admin İndirimi açıldı: tüm ürünler maliyet fiyatından satılır"
          : "Admin İndirimi kapatıldı: standart iskonto akışına geri dönüldü",
      );
      void queryClient.invalidateQueries({ queryKey: ["customer", customerId] });
      void queryClient.invalidateQueries({ queryKey: ["customers"] });
    },
    onError: (err) =>
      toast.push("error", err instanceof Error ? err.message : "Statü güncellenemedi"),
  });

  const xmlToken = customer?.xmlToken ?? null;
  const xmlUrl = xmlToken ? buildXmlFeedUrl(xmlToken) : null;
  const addresses = customer?.addresses ?? [];
  // "Firma Adresi" (companyAddress) boşken müşterinin adres defterindeki
  // varsayılan adrese düş — adres aslında DOLU iken "girilmemiş gibi" görünmesin.
  const defaultAddress = addresses.find((a) => a.isDefault) ?? addresses[0] ?? null;
  const rawCompanyAddress = customer?.companyAddress?.trim() ?? "";
  const companyAddressDisplay = rawCompanyAddress || formatAddressLine(defaultAddress);
  const companyAddressFromBook = !rawCompanyAddress && Boolean(companyAddressDisplay);
  const recentOrders = customer?.recentOrders ?? [];
  const ordersCount = safeNumber(customer?.ordersCount, recentOrders.length);
  const totalSpent = safeNumber(customer?.totalSpent, 0);
  const discountPercent = safeNumber(customer?.discountPercent, 0);
  const profitDiscountPercent = safeNumber(customer?.profitDiscountPercent, 0);
  const isAdminDiscount = customer?.customerStatus === "ADMIN_DISCOUNT";
  const cariBalance = safeNumber(customer?.cariBalance, 0);
  const avgOrderValue =
    customer?.avgOrderValue !== undefined && customer?.avgOrderValue !== null
      ? safeNumber(customer.avgOrderValue, 0)
      : ordersCount > 0
        ? totalSpent / ordersCount
        : 0;
  const lastOrderAt = customer?.lastOrderAt ?? null;
  const customerName = customer?.name?.trim() || "Müşteri";

  const copyToClipboard = (text: string, label: string): void => {
    if (!navigator?.clipboard) { toast.push("error", "Kopyalanamadı"); return; }
    void navigator.clipboard.writeText(text).then(
      () => toast.push("success", `${label} kopyalandı`),
      () => toast.push("error", "Kopyalanamadı"),
    );
  };

  const memberSince = customer?.createdAt
    ? new Date(customer.createdAt).toLocaleDateString("tr-TR", { year: "numeric", month: "long" })
    : "—";

  const missingBtn = (
    <button
      type="button"
      onClick={() => setShowSettings(true)}
      className="rounded border border-red-300 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 hover:bg-red-100"
    >
      Eksik — doldur
    </button>
  );

  return (
    <div className="space-y-5">
      {/* Breadcrumb + header */}
      <div>
        <Link to="/customers" className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
          ← Müşteriler
        </Link>
        {customer?.bayiNo ? (
          <p className="mt-2 text-2xl font-extrabold uppercase tracking-wider text-[var(--color-brand-navy)]">
            {customer.bayiNo}
          </p>
        ) : null}
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold text-[var(--color-text)]">{customerName}</h1>
            {isAdminDiscount ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden />
                Admin İndirimi
              </span>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => setShowSettings(true)}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-white px-3 py-1.5 text-sm hover:bg-[var(--color-surface-muted)] transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            Ayarlar
          </button>
        </div>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        <StatBadge label="Toplam Sipariş" value={ordersCount.toLocaleString("tr-TR")} />
        <StatBadge label="Toplam Harcama" value={formatTRY(totalSpent)} />
        <StatBadge label="Ortalama Sipariş" value={formatTRY(avgOrderValue)} />
        <StatBadge
          label="Son Sipariş"
          value={lastOrderAt ? formatShortDateTime(lastOrderAt) : "—"}
        />
        <StatBadge
          label="Cari Bakiye"
          value={formatTRY(cariBalance)}
          accent={balanceAccentClass(cariBalance)}
        />
        <StatBadge
          label="Global Kâr İnd."
          value={`%${profitDiscountPercent}`}
          accent={profitDiscountPercent > 0 ? "border-blue-200 bg-blue-50" : undefined}
        />
        <StatBadge label="Üye" value={memberSince} />
      </div>

      {/* Main layout */}
      <div className="grid gap-5 lg:grid-cols-3">
        {/* Left column */}
        <div className="space-y-5 lg:col-span-1">
          {/* Etiketler (YALNIZ ADMIN — müşteri görmez) */}
          <SectionCard title="Etiketler">
            <CustomerTagEditor
              customerId={customerId}
              tags={customer.tags ?? []}
              autoTags={customer.autoTags ?? []}
              onChanged={() => {
                void queryClient.invalidateQueries({
                  queryKey: ["customer", customerId],
                });
                void queryClient.invalidateQueries({ queryKey: ["customers"] });
              }}
            />
          </SectionCard>

          {/* Profile */}
          <SectionCard title="Profil">
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-xs text-[var(--color-text-muted)]">E-posta</dt>
                <dd className="mt-0.5">{customer?.email ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--color-text-muted)]">Telefon</dt>
                <dd className="mt-0.5">{customer?.phone ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--color-text-muted)]">Firma Ünvanı</dt>
                <dd className="mt-0.5">{customer?.companyTitle || missingBtn}</dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--color-text-muted)]">Vergi / TC No</dt>
                <dd className="mt-0.5">
                  {customer?.vergiNo
                    ? `${customer.vergiNo} (VKN)`
                    : customer?.tcKimlik
                    ? `${customer.tcKimlik} (TC)`
                    : missingBtn}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--color-text-muted)]">Vergi Dairesi</dt>
                <dd className="mt-0.5">{customer?.vergiDairesi || missingBtn}</dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--color-text-muted)]">Mersis No</dt>
                <dd className="mt-0.5">{customer?.mersisNumber || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--color-text-muted)]">Firma Adresi</dt>
                <dd className="mt-0.5 whitespace-pre-line">
                  {companyAddressDisplay || "—"}
                  {companyAddressFromBook ? (
                    <span className="mt-0.5 block text-xs text-[var(--color-text-muted)]">
                      Adres defterinden alındı
                    </span>
                  ) : null}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--color-text-muted)]">İletişim Kişisi</dt>
                <dd className="mt-0.5">
                  {[customer?.contactName, customer?.contactPhone, customer?.contactEmail]
                    .filter(Boolean)
                    .join(" · ") || "—"}
                </dd>
              </div>
              {customer?.createdAt ? (
                <div>
                  <dt className="text-xs text-[var(--color-text-muted)]">Kayıt tarihi</dt>
                  <dd className="mt-0.5">{formatDateTime(customer.createdAt)}</dd>
                </div>
              ) : null}
            </dl>
          </SectionCard>

          {/* Cari balance */}
          <SectionCard title="Cari Bakiye" hidden={!canDoMoneyOps()}>
            <CariBalanceCard customerId={customerId} currentBalance={cariBalance} />
          </SectionCard>

          {/* Admin İndirimi (maliyet fiyatı bypass) */}
          <SectionCard title="Admin İndirimi (Maliyet Fiyatı)" hidden={!canSeeCostProfit()}>
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[var(--color-text)]">
                    {isAdminDiscount ? "Aktif" : "Pasif"}
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                    Açıldığında tüm ürünler maliyet fiyatından satılır. Paketleme ücreti yine uygulanır.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={isAdminDiscount}
                  disabled={statusMutation.isPending}
                  onClick={() =>
                    statusMutation.mutate(isAdminDiscount ? "STANDARD" : "ADMIN_DISCOUNT")
                  }
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                    isAdminDiscount
                      ? "border-amber-400 bg-amber-500"
                      : "border-[var(--color-border)] bg-[var(--color-surface-muted)]"
                  }`}
                  title={isAdminDiscount ? "Admin İndirimi kapat" : "Admin İndirimi aç"}
                >
                  <span
                    className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
                      isAdminDiscount ? "translate-x-5" : "translate-x-0.5"
                    }`}
                  />
                </button>
              </div>
              {isAdminDiscount ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  <p className="font-medium">⚠ Admin fiyatı uygulanıyor</p>
                  <p className="mt-0.5">
                    Bu müşterinin yeni siparişlerinde tüm kalemler ürünün maliyet fiyatından
                    (<code>costPrice</code>) hesaplanır. Maliyet fiyatı tanımlı olmayan ürünler
                    siparişe alınamaz (HTTP 422). Mevcut global iskonto ve tedarikçi override'ları
                    geçici olarak bypass edilir.
                  </p>
                </div>
              ) : null}
            </div>
          </SectionCard>

          {/* Global Kâr İndirimi (kardan indirim) */}
          <SectionCard title="Global Kâr İndirimi" hidden={!canSeeCostProfit()}>
            <div className={`flex items-center gap-2 text-sm ${isAdminDiscount ? "opacity-60" : ""}`}>
              {editingDiscount && !isAdminDiscount ? (
                <>
                  <input
                    autoFocus
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={discountValue}
                    onChange={(e) => setDiscountValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") profitMutation.mutate(Math.max(0, Math.min(100, Number(discountValue) || 0)));
                      if (e.key === "Escape") setEditingDiscount(false);
                    }}
                    className="w-20 rounded-md border border-[var(--color-border)] bg-white px-2 py-1 text-sm"
                  />
                  <span className="text-[var(--color-text-muted)]">%</span>
                  <button
                    type="button"
                    disabled={profitMutation.isPending}
                    onClick={() => profitMutation.mutate(Math.max(0, Math.min(100, Number(discountValue) || 0)))}
                    className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs text-white hover:bg-emerald-700 disabled:opacity-60"
                  >
                    Kaydet
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingDiscount(false)}
                    className="rounded-md border border-[var(--color-border)] px-2.5 py-1 text-xs hover:bg-[var(--color-surface-muted)]"
                  >
                    İptal
                  </button>
                </>
              ) : (
                <>
                  <span className="font-semibold text-lg">%{profitDiscountPercent}</span>
                  <button
                    type="button"
                    disabled={isAdminDiscount}
                    onClick={() => { setDiscountValue(String(profitDiscountPercent)); setEditingDiscount(true); }}
                    className="rounded-md border border-[var(--color-border)] bg-white px-2.5 py-1 text-xs hover:bg-[var(--color-surface-muted)] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Düzenle
                  </button>
                </>
              )}
            </div>
            <p className="mt-2 text-xs text-[var(--color-text-muted)]">
              {isAdminDiscount
                ? "Admin İndirimi aktifken bu oran kullanılmaz; sipariş kalemleri maliyet fiyatından hesaplanır."
                : "İndirim ürünün kârından yapılır, maliyetin altına inmez. Tedarikçi override'ı olmayan ürünlere uygulanır. %100 ⇒ maliyet + paketleme."}
            </p>
            {!isAdminDiscount && discountPercent > 0 ? (
              <div className="mt-3 flex items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
                <span className="text-[11px] text-amber-700">
                  Eski liste iskontosu aktif: <strong>%{discountPercent}</strong>. Kâr
                  İndirimi 0 iken bu uygulanır; tam fiyata dönmek için sıfırlayın.
                </span>
                <button
                  type="button"
                  disabled={discountMutation.isPending}
                  onClick={() => discountMutation.mutate(0)}
                  className="shrink-0 rounded-md border border-amber-300 bg-white px-2 py-1 text-[11px] font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-60"
                >
                  Sıfırla
                </button>
              </div>
            ) : null}
          </SectionCard>

          {/* XML Feed */}
          <SectionCard title="XML Feed">
            {xmlToken ? (
              <div className="space-y-2">
                <code className="block break-all rounded-md border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2 py-1.5 font-mono text-xs">
                  {xmlToken}
                </code>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => copyToClipboard(xmlToken, "Token")}
                    className="rounded-md border border-[var(--color-border)] bg-white px-2.5 py-1 text-xs hover:bg-[var(--color-surface-muted)]"
                  >
                    Token Kopyala
                  </button>
                  {xmlUrl ? (
                    <>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(xmlUrl, "XML URL")}
                        className="rounded-md border border-[var(--color-border)] bg-white px-2.5 py-1 text-xs hover:bg-[var(--color-surface-muted)]"
                      >
                        XML URL Kopyala
                      </button>
                      <a
                        href={xmlUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-md border border-[var(--color-border)] bg-white px-2.5 py-1 text-xs hover:bg-[var(--color-surface-muted)]"
                      >
                        Aç ↗
                      </a>
                    </>
                  ) : null}
                </div>
              </div>
            ) : (
              <p className="text-sm text-[var(--color-text-muted)]">
                Henüz token oluşturulmadı. Ayarlar'dan oluşturabilirsin.
              </p>
            )}
          </SectionCard>

          {/* Password */}
          <SectionCard title="Müşteri Şifresi" hidden={!isPrivilegedAdmin()}>
            <div className="space-y-2 text-sm">
              <p className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-800 leading-snug">
                Her görüntüleme audit log'a yazılır · dakika başına 5 istek
              </p>
              {revealedPassword && passwordVisible ? (
                <code className="block break-all rounded-md border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2 py-1 font-mono text-xs">
                  {revealedPassword}
                </code>
              ) : revealedPassword && !passwordVisible ? (
                <code className="block rounded-md border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2 py-1 font-mono text-xs tracking-widest">
                  ••••••••••
                </code>
              ) : passwordMissing ? (
                <p className="text-xs text-[var(--color-text-muted)]">Şifreli kopya yok — yalnızca sıfırlama mümkün.</p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {revealedPassword ? (
                  <>
                    <button type="button" onClick={() => setPasswordVisible((v) => !v)} className="rounded-md border border-[var(--color-border)] bg-white px-2.5 py-1 text-xs hover:bg-[var(--color-surface-muted)]">
                      {passwordVisible ? "Gizle" : "Göster"}
                    </button>
                    <button type="button" onClick={() => copyToClipboard(revealedPassword, "Şifre")} className="rounded-md border border-[var(--color-border)] bg-white px-2.5 py-1 text-xs hover:bg-[var(--color-surface-muted)]">
                      Kopyala
                    </button>
                    <button type="button" onClick={() => { setRevealedPassword(null); setPasswordVisible(false); setPasswordMissing(false); }} className="rounded-md border border-[var(--color-border)] bg-white px-2.5 py-1 text-xs hover:bg-[var(--color-surface-muted)]">
                      Temizle
                    </button>
                  </>
                ) : (
                  <button type="button" disabled={passwordMutation.isPending} onClick={() => passwordMutation.mutate()} className="rounded-md border border-[var(--color-border)] bg-white px-2.5 py-1 text-xs hover:bg-[var(--color-surface-muted)] disabled:opacity-60">
                    {passwordMutation.isPending ? "Çözülüyor…" : "Şifreyi Görüntüle"}
                  </button>
                )}
                <button type="button" onClick={() => { setEditingPassword((v) => !v); setNewPasswordValue(""); }} className="rounded-md border border-[var(--color-border)] bg-white px-2.5 py-1 text-xs hover:bg-[var(--color-surface-muted)]">
                  {editingPassword ? "İptal" : "Yeni Şifre Belirle"}
                </button>
                <button
                  type="button"
                  disabled={resetPasswordMutation.isPending}
                  onClick={() => {
                    if (window.confirm("Şifre sıfırlanacak ve müşteri girişte değiştirmek zorunda kalacak. Devam et?")) {
                      resetPasswordMutation.mutate();
                    }
                  }}
                  className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs text-amber-800 hover:bg-amber-100 disabled:opacity-60"
                >
                  {resetPasswordMutation.isPending ? "Sıfırlanıyor…" : "Sıfırla"}
                </button>
              </div>
              {editingPassword ? (
                <div className="flex flex-wrap items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-2">
                  <input
                    autoFocus
                    type="text"
                    minLength={4}
                    maxLength={128}
                    placeholder="Yeni şifre (en az 4 karakter)"
                    value={newPasswordValue}
                    onChange={(e) => setNewPasswordValue(e.target.value)}
                    className="w-52 rounded-md border border-[var(--color-border)] bg-white px-2 py-1 font-mono text-xs"
                  />
                  <button
                    type="button"
                    disabled={setPasswordMutation.isPending || newPasswordValue.length < 4}
                    onClick={() => setPasswordMutation.mutate(newPasswordValue)}
                    className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs text-white hover:bg-emerald-700 disabled:opacity-60"
                  >
                    {setPasswordMutation.isPending ? "Kaydediliyor…" : "Kaydet"}
                  </button>
                </div>
              ) : null}
            </div>
          </SectionCard>

          {/* Addresses */}
          <SectionCard title="Adresler">
            {addresses.length === 0 ? (
              <p className="text-sm text-[var(--color-text-muted)]">Adres yok</p>
            ) : (
              <ul className="space-y-3">
                {addresses.map((a) => (
                  <li key={a.id} className="rounded-lg border border-[var(--color-border)] p-3 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{a.label ?? "Adres"}</span>
                      {a.isDefault ? (
                        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">
                          Varsayılan
                        </span>
                      ) : null}
                    </div>
                    <address className="mt-1 space-y-0.5 text-xs not-italic text-[var(--color-text-muted)]">
                      {a.fullName ? <div>{a.fullName}</div> : null}
                      {a.line1 ? <div>{a.line1}</div> : null}
                      {a.line2 ? <div>{a.line2}</div> : null}
                      {a.district || a.city ? <div>{[a.district, a.city].filter(Boolean).join(" / ")}</div> : null}
                      {a.postalCode ? <div>{a.postalCode}</div> : null}
                      {a.phone ? <div>{a.phone}</div> : null}
                    </address>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard title="Tatil Modu">
            <TatilModuCard
              customerId={customerId}
              vacationMode={customer.vacationMode ?? false}
              vacationStartedAt={customer.vacationStartedAt ?? null}
            />
          </SectionCard>
        </div>

        {/* Right column */}
        <div className="space-y-5 lg:col-span-2">
          {/* Supplier discounts */}
          <SectionCard title="Tedarikçi Bazlı Kâr İndirimi" hidden={!canSeeCostProfit()}>
            <SupplierDiscountsCard
              customerId={customerId}
              globalProfitDiscount={profitDiscountPercent}
              disabled={isAdminDiscount}
            />
          </SectionCard>

          {/* Recent orders */}
          <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-white">
            <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-3">
              <h2 className="text-sm font-medium">Son Siparişler</h2>
              {recentOrders.length > 0 ? (
                <Link
                  to={`/orders?customerId=${customerId}`}
                  className="text-xs text-[var(--color-brand-blue)] hover:underline"
                >
                  Tümünü Gör →
                </Link>
              ) : null}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border)] bg-[var(--color-surface-muted)] text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
                    <th className="px-4 py-2.5 text-left">Sipariş</th>
                    <th className="px-4 py-2.5 text-left">Ürünler</th>
                    <th className="hidden px-4 py-2.5 text-left sm:table-cell">Tarih</th>
                    <th className="px-4 py-2.5 text-right">Tutar</th>
                    <th className="px-4 py-2.5 text-left">Durum</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {recentOrders.length === 0 ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-4 py-8 text-center text-sm text-[var(--color-text-muted)]"
                      >
                        Sipariş yok
                      </td>
                    </tr>
                  ) : (
                    recentOrders.map((o) => {
                      const status = (o.status ?? "pending") as OrderStatus;
                      const statusLabel =
                        ORDER_STATUS_LABELS[status] ?? String(o.status ?? "—");
                      const products = o.products ?? [];
                      const firstProduct = products[0];
                      const extraCount = Math.max(0, products.length - 1);
                      const suppliers = o.supplierNames ?? [];
                      return (
                        <tr
                          key={o.id}
                          className="hover:bg-[var(--color-surface-muted)] transition-colors"
                        >
                          <td className="px-4 py-2.5 align-top">
                            <Link
                              to={`/orders/${o.id}`}
                              className="font-medium hover:text-[var(--color-brand-blue)] hover:underline"
                            >
                              {formatOrderNo(o.humanOrderNo, o.orderNumber ?? "—")}
                            </Link>
                            {o.orderNumber && o.orderNumber !== o.humanOrderNo ? (
                              <p className="mt-0.5 text-[11px] text-[var(--color-text-muted)]">
                                {o.orderNumber}
                              </p>
                            ) : null}
                            {o.marketplace ? (
                              <span className="mt-1 inline-block rounded-full border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">
                                {o.marketplace}
                              </span>
                            ) : null}
                          </td>
                          <td className="px-4 py-2.5 align-top">
                            {firstProduct ? (
                              <div className="flex items-start gap-2 min-w-0">
                                {firstProduct.imageUrl ? (
                                  <img
                                    src={firstProduct.imageUrl}
                                    alt=""
                                    loading="lazy"
                                    width={40}
                                    height={40}
                                    className="h-10 w-10 shrink-0 rounded-md border border-[var(--color-border)] object-cover"
                                  />
                                ) : (
                                  <div className="h-10 w-10 shrink-0 rounded-md border border-dashed border-[var(--color-border)] bg-[var(--color-surface-muted)]" />
                                )}
                                <div className="min-w-0">
                                  <p className="line-clamp-2 text-xs text-[var(--color-text)]">
                                    {firstProduct.name || "—"}
                                  </p>
                                  <p className="mt-0.5 text-[11px] text-[var(--color-text-muted)]">
                                    {firstProduct.qty} adet
                                    {extraCount > 0 ? ` · +${extraCount} ürün daha` : ""}
                                  </p>
                                  {suppliers.length > 0 ? (
                                    <p className="mt-0.5 line-clamp-1 text-[11px] text-[var(--color-text-muted)]">
                                      {suppliers.join(", ")}
                                    </p>
                                  ) : null}
                                </div>
                              </div>
                            ) : (
                              <span className="text-xs text-[var(--color-text-muted)]">—</span>
                            )}
                          </td>
                          <td className="hidden px-4 py-2.5 align-top text-[var(--color-text-muted)] sm:table-cell">
                            {formatShortDateTime(o.createdAt)}
                          </td>
                          <td className="px-4 py-2.5 text-right align-top tabular-nums font-medium">
                            {formatTRY(safeNumber(o.total, 0))}
                          </td>
                          <td className="px-4 py-2.5 align-top text-[var(--color-text-muted)]">
                            {statusLabel}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {showSettings ? (
        <CustomerSettingsModal
          customer={customer}
          onClose={() => setShowSettings(false)}
          onDeleted={() => { setShowSettings(false); navigate("/customers", { replace: true }); }}
        />
      ) : null}
    </div>
  );
}

export default function CustomerDetailPage(): React.ReactElement | null {
  const authed = useRequireAuth();
  const { id } = useParams<{ id: string }>();
  useDocumentTitle("Müşteri Detayı");

  const customerQuery = useQuery({
    queryKey: ["customer", id],
    queryFn: () => id ? fetchCustomer(id) : Promise.reject(new Error("missing id")),
    enabled: authed && Boolean(id),
    retry: 1,
  });

  if (!id) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Müşteri kimliği eksik.{" "}
        <Link to="/customers" className="underline">Listeye dön</Link>
      </div>
    );
  }

  if (customerQuery.isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-6 w-48 animate-pulse rounded-lg bg-[var(--color-surface-muted)]" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-[var(--color-surface-muted)]" />
          ))}
        </div>
        <div className="h-64 animate-pulse rounded-xl bg-[var(--color-surface-muted)]" />
      </div>
    );
  }

  if (customerQuery.isError || !customerQuery.data) {
    const message = customerQuery.error instanceof Error ? customerQuery.error.message : "Müşteri yüklenemedi.";
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        <p className="mb-2 font-medium">Müşteri yüklenemedi</p>
        <p className="mb-3 text-xs">{message}</p>
        <div className="flex gap-2">
          <button type="button" onClick={() => void customerQuery.refetch()} className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs text-red-700 hover:bg-red-100">
            Tekrar dene
          </button>
          <Link to="/customers" className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs text-red-700 hover:bg-red-100">
            Listeye dön
          </Link>
        </div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <CustomerDetailContent customer={customerQuery.data} customerId={id} />
    </ErrorBoundary>
  );
}

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchInvoiceSettings,
  updateInvoiceSettings,
  type InvoiceSettings,
} from "../../lib/invoices";
import { useToast } from "../Toast";

/**
 * Konsolide fatura ayar bloğu (birfatura.md §9 + §3.4):
 * cutoffDay (1..28), packagingUnitFee (KDV dahil), consolidationEnabled,
 * ordersEnabled (KILL-SWITCH, Faz 0). Yalnızca değişen alanlar PUT edilir.
 */

const CUTOFF_MIN = 1;
const CUTOFF_MAX = 28;

interface FormState {
  cutoffDay: string;
  packagingUnitFee: string;
  consolidationEnabled: boolean;
  ordersEnabled: boolean;
}

function toForm(s: InvoiceSettings): FormState {
  return {
    cutoffDay: String(s.cutoffDay),
    packagingUnitFee: s.packagingUnitFee,
    consolidationEnabled: s.consolidationEnabled,
    ordersEnabled: s.ordersEnabled,
  };
}

export default function InvoiceSettingsCard(): React.ReactElement {
  const toast = useToast();
  const queryClient = useQueryClient();

  const settingsQuery = useQuery<InvoiceSettings>({
    queryKey: ["admin-invoice-settings"],
    queryFn: fetchInvoiceSettings,
  });

  const [form, setForm] = useState<FormState | null>(null);

  // Sunucudan veri gelince formu (sadece bir kez / her başarılı fetch'te) doldur.
  useEffect(() => {
    if (settingsQuery.data) {
      setForm(toForm(settingsQuery.data));
    }
  }, [settingsQuery.data]);

  const mutation = useMutation({
    mutationFn: updateInvoiceSettings,
    onSuccess: (data) => {
      toast.push("success", "Fatura ayarları kaydedildi.");
      setForm(toForm(data));
      queryClient.setQueryData(["admin-invoice-settings"], data);
    },
    onError: (err: unknown) => {
      toast.push(
        "error",
        err instanceof Error ? err.message : "Ayarlar kaydedilemedi",
      );
    },
  });

  if (settingsQuery.isLoading || !form) {
    return (
      <section className="rounded-2xl border border-[var(--color-border)] bg-white p-6 shadow-sm">
        <p className="text-sm text-[var(--color-text-muted)]">
          Ayarlar yükleniyor…
        </p>
      </section>
    );
  }

  if (settingsQuery.isError) {
    return (
      <section className="rounded-2xl border border-red-200 bg-red-50 p-6">
        <p className="text-sm text-red-700">
          {settingsQuery.error instanceof Error
            ? settingsQuery.error.message
            : "Fatura ayarları yüklenemedi"}
        </p>
      </section>
    );
  }

  const original = settingsQuery.data ? toForm(settingsQuery.data) : null;
  const dirty =
    original !== null &&
    (form.cutoffDay !== original.cutoffDay ||
      form.packagingUnitFee !== original.packagingUnitFee ||
      form.consolidationEnabled !== original.consolidationEnabled ||
      form.ordersEnabled !== original.ordersEnabled);

  const cutoffNum = Number(form.cutoffDay);
  const cutoffValid =
    Number.isInteger(cutoffNum) &&
    cutoffNum >= CUTOFF_MIN &&
    cutoffNum <= CUTOFF_MAX;
  const feeValid =
    form.packagingUnitFee.trim().length > 0 &&
    !Number.isNaN(Number(form.packagingUnitFee));

  const handleSave = (): void => {
    if (!cutoffValid) {
      toast.push("error", `Kesim günü ${CUTOFF_MIN}–${CUTOFF_MAX} arası olmalı`);
      return;
    }
    if (!feeValid) {
      toast.push("error", "Paketleme birim ücreti geçerli bir sayı olmalı");
      return;
    }
    if (!original) return;
    // Sadece değişen alanları gönder (PUT patch semantiği).
    const patch: Parameters<typeof updateInvoiceSettings>[0] = {};
    if (form.cutoffDay !== original.cutoffDay) patch.cutoffDay = cutoffNum;
    if (form.packagingUnitFee !== original.packagingUnitFee) {
      patch.packagingUnitFee = form.packagingUnitFee.trim();
    }
    if (form.consolidationEnabled !== original.consolidationEnabled) {
      patch.consolidationEnabled = form.consolidationEnabled;
    }
    if (form.ordersEnabled !== original.ordersEnabled) {
      patch.ordersEnabled = form.ordersEnabled;
    }
    mutation.mutate(patch);
  };

  return (
    <section className="rounded-2xl border border-[var(--color-border)] bg-white p-6 shadow-sm">
      <header className="mb-4">
        <h2 className="text-lg font-semibold text-[var(--color-text)]">
          Konsolidasyon Ayarları
        </h2>
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">
          Aylık tek e-fatura kesiminin kuralları. Her ayın{" "}
          <strong>{form.cutoffDay || "?"}</strong>'inde, o ana dek kargoya
          verilmiş ve faturalanmamış tüm siparişler bayi başına dondurulur.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        {/* Kesim günü */}
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">
            Kesim günü (ayın günü)
          </span>
          <input
            type="number"
            min={CUTOFF_MIN}
            max={CUTOFF_MAX}
            value={form.cutoffDay}
            onChange={(e) =>
              setForm((p) => (p ? { ...p, cutoffDay: e.target.value } : p))
            }
            className={`w-full rounded-lg border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-blue)]/20 ${
              cutoffValid
                ? "border-[var(--color-border)] focus:border-[var(--color-brand-blue)]"
                : "border-red-300 focus:border-red-400"
            }`}
            disabled={mutation.isPending}
          />
          <span className="mt-1 block text-[11px] text-[var(--color-text-muted)]">
            {CUTOFF_MIN}–{CUTOFF_MAX} arası (Şubat güvenliği için max 28).
          </span>
        </label>

        {/* Paketleme birim ücreti */}
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">
            Paketleme birim ücreti (KDV dahil, ₺)
          </span>
          <input
            type="text"
            inputMode="decimal"
            value={form.packagingUnitFee}
            onChange={(e) =>
              setForm((p) =>
                p ? { ...p, packagingUnitFee: e.target.value } : p,
              )
            }
            placeholder="4.8"
            className={`w-full rounded-lg border bg-white px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-blue)]/20 ${
              feeValid
                ? "border-[var(--color-border)] focus:border-[var(--color-brand-blue)]"
                : "border-red-300 focus:border-red-400"
            }`}
            disabled={mutation.isPending}
          />
          <span className="mt-1 block text-[11px] text-[var(--color-text-muted)]">
            Bu tutar (KDV dahil kabul edilip %20 ayrıştırılır) HER ürünün
            matrahına eklenir — ayrı "Kargo Bedeli" satırı yoktur. Örn. 4.80 →
            ürün matrahına +4.00 (KDV dahil ürün başına +4.80).
          </span>
        </label>
      </div>

      <div className="mt-5 space-y-3">
        {/* consolidationEnabled */}
        <ToggleRow
          checked={form.consolidationEnabled}
          onChange={(v) =>
            setForm((p) => (p ? { ...p, consolidationEnabled: v } : p))
          }
          disabled={mutation.isPending}
          title="Aylık konsolidasyon açık"
          description="Kapatılırsa otomatik (cron) kesim çalışmaz; eski sipariş-başına fatura akışına dönülür."
        />

        {/* ordersEnabled — KILL SWITCH */}
        <ToggleRow
          checked={form.ordersEnabled}
          onChange={(v) =>
            setForm((p) => (p ? { ...p, ordersEnabled: v } : p))
          }
          disabled={mutation.isPending}
          danger
          title="BirFatura sipariş push (KILL-SWITCH)"
          description="KAPALI iken /api/orders/ daima boş döner — BirFatura bağlı olsa, TEST ET'e bassa, otomatik poll yapsa bile kazara fatura kesilmez. Her şey test edilip hazır olunca AÇ."
        />
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty || mutation.isPending || !cutoffValid || !feeValid}
          className="rounded-lg bg-[var(--color-brand-blue)] px-4 py-2 text-sm font-medium text-white transition hover:bg-[var(--color-brand-navy)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {mutation.isPending ? "Kaydediliyor…" : "Ayarları Kaydet"}
        </button>
        {dirty ? (
          <button
            type="button"
            onClick={() => original && setForm(original)}
            disabled={mutation.isPending}
            className="rounded-lg border border-[var(--color-border)] bg-white px-4 py-2 text-sm font-medium text-[var(--color-text)] transition hover:bg-slate-50"
          >
            Sıfırla
          </button>
        ) : null}
        {!form.ordersEnabled ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700">
            <span className="inline-block h-2 w-2 rounded-full bg-amber-500" />
            Sipariş push kapalı — fatura kesimi güvende
          </span>
        ) : null}
      </div>
    </section>
  );
}

function ToggleRow({
  checked,
  onChange,
  disabled,
  title,
  description,
  danger,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled: boolean;
  title: string;
  description: string;
  danger?: boolean;
}): React.ReactElement {
  return (
    <div
      className={`flex items-start justify-between gap-4 rounded-lg border p-3 ${
        danger
          ? "border-amber-200 bg-amber-50/40"
          : "border-[var(--color-border)] bg-slate-50/50"
      }`}
    >
      <div className="min-w-0">
        <p className="text-sm font-medium text-[var(--color-text)]">{title}</p>
        <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
          {description}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        disabled={disabled}
        className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-60 ${
          checked
            ? danger
              ? "bg-emerald-500"
              : "bg-[var(--color-brand-blue)]"
            : "bg-slate-300"
        }`}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
            checked ? "translate-x-5" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}

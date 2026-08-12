import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRequireAuth } from "../lib/auth";
import SupplierCategoryDetailModal from "../components/SupplierCategoryDetailModal";
import {
  FEED_CURRENCIES,
  FEED_CURRENCY_LABELS,
  MANDATORY_CARRIERS,
  MANDATORY_CARRIER_LABELS,
  createSupplier,
  createSupplierFeed,
  deleteSupplier,
  deleteSupplierFeed,
  detectFeedCurrencies,
  fetchSupplier,
  fetchSupplierCategories,
  fetchSupplierCanonicalCategories,
  fetchSupplierCanonicalCategoryProducts,
  fetchSupplierFeeds,
  formatRelativeTime,
  syncSupplierCategories,
  syncSupplierFeed,
  updateSupplier,
  updateSupplierFeed,
  type AuthType,
  type FeedCurrency,
  type MandatoryCarrier,
  type ProfitTier,
  type ProfitType,
  type SupplierCategory,
  type SupplierFeed,
  type SupplierFeedInput,
  type SupplierInput,
} from "../lib/suppliers";
import KademeliKarEditor from "../components/KademeliKarEditor";
import {
  fetchSupplierTextRules,
  saveSupplierTextRules,
  type SupplierTextRule,
} from "../lib/supplierTextRules";
import { fetchExchangeRate } from "../lib/exchangeRate";
import { useToast } from "../components/Toast";
import ConfirmDialog from "../components/ConfirmDialog";
import { useDocumentTitle } from "../lib/useDocumentTitle";

// ─── Supplier form state ──────────────────────────────────────────────────────

interface FormState {
  name: string;
  marginPercent: string;
  profitType: ProfitType;
  profitTiers: ProfitTier[];
  extraCostTry: string;
  stockThreshold: string;
  hideBelowThreshold: boolean;
  priceIncludesVat: boolean;
  purchaseVatRate: string;
  minPrice: string;
  purchaseDiscountInclVatPct: string;
  purchaseDiscountTl: string;
  purchaseExtraCostTl: string;
  mandatoryCarriers: MandatoryCarrier[];
  requiresPdf: boolean;
  pttavmEnabled: boolean;
  leadTimeDays: string;
}

const DEFAULT_STATE: FormState = {
  name: "",
  marginPercent: "20",
  profitType: "fixed",
  profitTiers: [],
  extraCostTry: "0",
  stockThreshold: "0",
  hideBelowThreshold: false,
  priceIncludesVat: false,
  purchaseVatRate: "20",
  minPrice: "1",
  purchaseDiscountInclVatPct: "0",
  purchaseDiscountTl: "0",
  purchaseExtraCostTl: "0",
  mandatoryCarriers: [],
  requiresPdf: false,
  pttavmEnabled: false,
  leadTimeDays: "",
};

interface FieldErrors {
  name?: string;
  marginPercent?: string;
  extraCostTry?: string;
  stockThreshold?: string;
  minPrice?: string;
  leadTimeDays?: string;
}

function validate(state: FormState): FieldErrors {
  const errors: FieldErrors = {};
  if (!state.name.trim()) errors.name = "Tedarikçi adı zorunlu";
  // Sabit kâr alanları yalnız "fixed" modda doğrulanır; "tiered" modda baremler
  // editör (inline uyarı) + backend (validateTiers) tarafından doğrulanır.
  if (state.profitType !== "tiered") {
    const margin = Number(state.marginPercent);
    if (!Number.isFinite(margin) || margin < 0 || margin > 100)
      errors.marginPercent = "0 ile 100 arasında bir sayı girin";
    if (state.extraCostTry.trim()) {
      const extra = Number(state.extraCostTry);
      if (!Number.isFinite(extra) || extra < 0)
        errors.extraCostTry = "0 veya üstü bir değer girin";
    }
  }
  const threshold = Number(state.stockThreshold);
  if (!Number.isFinite(threshold) || threshold < 0)
    errors.stockThreshold = "0 veya üstü olmalı";
  if (!state.minPrice.trim()) {
    errors.minPrice = "Min. fiyat zorunlu";
  } else {
    const minP = Number(state.minPrice);
    if (!Number.isFinite(minP) || minP < 0) errors.minPrice = "0 veya üstü bir değer girin";
  }
  if (state.leadTimeDays.trim()) {
    const lt = Number(state.leadTimeDays);
    if (!Number.isFinite(lt) || (lt !== 1 && lt !== 2))
      errors.leadTimeDays = "Sadece 1 veya 2 gün seçilebilir";
  }
  return errors;
}

function clampPct100(value: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n > 100 ? 100 : n;
}

function toSupplierInput(state: FormState): Omit<SupplierInput, "initialFeed"> {
  const extraCostNum = Number(state.extraCostTry);
  const minPriceNum = Number(state.minPrice);
  const leadNum = Number(state.leadTimeDays);
  return {
    name: state.name.trim(),
    marginPercent: Number(state.marginPercent),
    profitType: state.profitType,
    profitTiers: state.profitType === "tiered" ? state.profitTiers : [],
    stockThreshold: Number(state.stockThreshold),
    hideBelowThreshold: state.hideBelowThreshold,
    marketplaces: [],
    isActive: true,
    includeInOwnFeed: true,
    priceIncludesVat: state.priceIncludesVat,
    purchaseVatRate: (() => {
      const n = Number(state.purchaseVatRate);
      return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 20;
    })(),
    extraCostTry:
      !Number.isFinite(extraCostNum) || extraCostNum < 0 ? 0 : extraCostNum,
    minPrice:
      !Number.isFinite(minPriceNum) || minPriceNum < 0 ? 1 : minPriceNum,
    purchaseDiscountInclVatPct: clampPct100(state.purchaseDiscountInclVatPct),
    purchaseDiscountTl: (() => {
      const n = Number(state.purchaseDiscountTl);
      return Number.isFinite(n) && n >= 0 ? n : 0;
    })(),
    purchaseExtraCostTl: (() => {
      const n = Number(state.purchaseExtraCostTl);
      return Number.isFinite(n) && n >= 0 ? n : 0;
    })(),
    mandatoryCarriers: state.mandatoryCarriers,
    requiresPdf: state.requiresPdf,
    pttavmEnabled: state.pttavmEnabled,
    leadTimeDays:
      state.leadTimeDays.trim() &&
      Number.isFinite(leadNum) &&
      leadNum >= 0 &&
      leadNum <= 90
        ? Math.floor(leadNum)
        : null,
  };
}

// ─── Feed form state ──────────────────────────────────────────────────────────

interface FeedFormState {
  name: string;
  feedUrl: string;
  authType: AuthType;
  credentials: string;
  refreshIntervalHours: string;
  feedCurrency: FeedCurrency;
  autoExchangeRate: boolean;
  exchangeRate: string;
  exchangeRateMargin: string;
  active: boolean;
}

const DEFAULT_FEED_STATE: FeedFormState = {
  name: "",
  feedUrl: "",
  authType: "none",
  credentials: "",
  refreshIntervalHours: "6",
  feedCurrency: "TRY",
  autoExchangeRate: true,
  exchangeRate: "",
  exchangeRateMargin: "0.30",
  active: true,
};

interface FeedFieldErrors {
  feedUrl?: string;
  refreshIntervalHours?: string;
  credentials?: string;
  exchangeRate?: string;
  exchangeRateMargin?: string;
}

function isValidUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function validateFeed(state: FeedFormState): FeedFieldErrors {
  const errors: FeedFieldErrors = {};
  if (!state.feedUrl.trim()) errors.feedUrl = "Feed URL zorunlu";
  else if (!isValidUrl(state.feedUrl.trim())) errors.feedUrl = "Geçerli bir URL girin";
  const refresh = Number(state.refreshIntervalHours);
  if (!Number.isFinite(refresh) || refresh < 1)
    errors.refreshIntervalHours = "En az 1 saat";
  if (state.authType !== "none" && !state.credentials.trim())
    errors.credentials = "Kimlik bilgisi zorunlu";
  if (state.feedCurrency !== "TRY") {
    if (!state.autoExchangeRate) {
      if (!state.exchangeRate.trim()) {
        errors.exchangeRate = "Manuel kur girin veya TCMB otomatik kurunu kullanın";
      } else {
        const rate = Number(state.exchangeRate);
        if (!Number.isFinite(rate) || rate <= 0)
          errors.exchangeRate = "Geçerli bir kur girin (0'dan büyük)";
      }
    }
    if (state.exchangeRateMargin.trim()) {
      const m = Number(state.exchangeRateMargin);
      if (!Number.isFinite(m) || m < 0)
        errors.exchangeRateMargin = "0 veya üstü bir değer";
    }
  }
  return errors;
}

function toFeedInput(state: FeedFormState): SupplierFeedInput {
  const isTry = state.feedCurrency === "TRY";
  const rateNum = Number(state.exchangeRate);
  const marginNum = Number(state.exchangeRateMargin);
  return {
    name: state.name.trim() || undefined,
    feedUrl: state.feedUrl.trim(),
    authType: state.authType,
    credentials:
      state.authType !== "none" ? state.credentials.trim() || undefined : undefined,
    refreshIntervalHours: Number(state.refreshIntervalHours),
    feedCurrency: state.feedCurrency,
    exchangeRate:
      isTry || state.autoExchangeRate || !state.exchangeRate.trim()
        ? null
        : Number.isFinite(rateNum)
          ? rateNum
          : null,
    exchangeRateMargin: isTry
      ? 0
      : Number.isFinite(marginNum) && marginNum >= 0
        ? marginNum
        : 0,
    active: state.active,
  };
}

// ─── Shared UI primitives ─────────────────────────────────────────────────────

const inputClass =
  "block w-full rounded-lg border border-[var(--color-border)] bg-white px-3.5 py-2.5 text-sm text-[var(--color-text)] shadow-sm transition placeholder:text-[var(--color-text-muted)]/60 focus:border-[var(--color-brand-blue)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-blue)]/20";

interface FieldProps {
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  children: React.ReactNode;
  className?: string;
}

function Field({ label, required, hint, error, children, className }: FieldProps): React.ReactElement {
  return (
    <label className={`block ${className ?? ""}`}>
      <span className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
        {label}
        {required ? <span className="text-red-500"> *</span> : null}
      </span>
      <div className="mt-1.5">{children}</div>
      {hint ? (
        <span className="mt-1.5 block text-xs leading-relaxed text-[var(--color-text-muted)]">
          {hint}
        </span>
      ) : null}
      {error ? (
        <span className="mt-1.5 block text-xs font-medium text-red-600">{error}</span>
      ) : null}
    </label>
  );
}

interface ToggleRowProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  title: string;
  description?: string;
}

function ToggleRow({ checked, onChange, title, description }: ToggleRowProps): React.ReactElement {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-[var(--color-border)] bg-white p-4 transition hover:border-[var(--color-brand-blue)]/40 hover:bg-[var(--color-surface-muted)]/40">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 cursor-pointer accent-[var(--color-brand-blue)]"
      />
      <span className="flex-1">
        <span className="block text-sm font-medium text-[var(--color-text)]">{title}</span>
        {description ? (
          <span className="mt-0.5 block text-xs leading-relaxed text-[var(--color-text-muted)]">
            {description}
          </span>
        ) : null}
      </span>
    </label>
  );
}

interface SectionCardProps {
  title: string;
  description?: string;
  children: React.ReactNode;
  tone?: "default" | "danger";
  action?: React.ReactNode;
}

function SectionCard({ title, description, children, tone = "default", action }: SectionCardProps): React.ReactElement {
  const isDanger = tone === "danger";
  return (
    <section
      className={`rounded-xl border bg-white p-6 sm:p-8 ${
        isDanger ? "border-red-200 bg-red-50/30" : "border-[var(--color-border)]"
      }`}
    >
      <header className="mb-6 flex items-start justify-between gap-4 border-b border-[var(--color-border)]/60 pb-4">
        <div>
          <h2
            className={`text-base font-semibold ${isDanger ? "text-red-700" : "text-[var(--color-text)]"}`}
          >
            {title}
          </h2>
          {description ? (
            <p className="mt-1 text-sm leading-relaxed text-[var(--color-text-muted)]">
              {description}
            </p>
          ) : null}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

// ─── Feed form fields (reused in modal and initial-feed section) ──────────────

interface FeedFieldsProps {
  state: FeedFormState;
  errors: FeedFieldErrors;
  update: <K extends keyof FeedFormState>(key: K, value: FeedFormState[K]) => void;
  showActive?: boolean;
}

function FeedFields({ state, errors, update, showActive = false }: FeedFieldsProps): React.ReactElement {
  const marginForRate = useMemo(() => {
    const n = Number(state.exchangeRateMargin);
    return Number.isFinite(n) && n >= 0 ? n : 0.3;
  }, [state.exchangeRateMargin]);

  const exchangeRateQuery = useQuery({
    queryKey: ["exchange-rate", state.feedCurrency.toLowerCase(), marginForRate],
    queryFn: () =>
      fetchExchangeRate(
        state.feedCurrency.toLowerCase() as "usd" | "eur" | "gbp",
        marginForRate,
      ),
    enabled: state.feedCurrency !== "TRY",
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  return (
    <div className="space-y-4">
      <Field label="Feed adı (opsiyonel)" hint="Birden fazla feed varsa ayırt etmek için.">
        <input
          type="text"
          value={state.name}
          onChange={(e) => update("name", e.target.value)}
          className={inputClass}
          placeholder="Örn. Ana feed, Stok feed…"
          autoComplete="off"
        />
      </Field>

      <Field label="Feed URL (XML)" required error={errors.feedUrl}>
        <input
          type="url"
          value={state.feedUrl}
          onChange={(e) => update("feedUrl", e.target.value)}
          className={`${inputClass} font-mono text-xs`}
          placeholder="https://..."
          autoComplete="off"
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Kimlik doğrulama">
          <select
            value={state.authType}
            onChange={(e) => update("authType", e.target.value as AuthType)}
            className={inputClass}
          >
            <option value="none">Yok</option>
            <option value="basic">Basic Auth</option>
            <option value="bearer">Bearer Token</option>
          </select>
        </Field>
        <Field
          label="Yenileme aralığı (saat)"
          required
          error={errors.refreshIntervalHours}
          hint="Feed bu sıklıkla yeniden çekilir."
        >
          <input
            type="number"
            min={1}
            value={state.refreshIntervalHours}
            onChange={(e) => update("refreshIntervalHours", e.target.value)}
            className={inputClass}
          />
        </Field>
      </div>

      {state.authType !== "none" ? (
        <Field
          label={state.authType === "basic" ? "Kullanıcı:Şifre" : "Bearer token"}
          required
          error={errors.credentials}
          hint={
            state.authType === "basic"
              ? "kullanici:sifre formatında girin."
              : "Token değerini girin."
          }
        >
          <input
            type="password"
            value={state.credentials}
            onChange={(e) => update("credentials", e.target.value)}
            className={inputClass}
            autoComplete="off"
          />
        </Field>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Para birimi">
          <select
            value={state.feedCurrency}
            onChange={(e) => update("feedCurrency", e.target.value as FeedCurrency)}
            className={inputClass}
          >
            {FEED_CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {FEED_CURRENCY_LABELS[c]}
              </option>
            ))}
          </select>
        </Field>
        {showActive ? (
          <Field label="Durum">
            <select
              value={state.active ? "active" : "passive"}
              onChange={(e) => update("active", e.target.value === "active")}
              className={inputClass}
            >
              <option value="active">Aktif</option>
              <option value="passive">Pasif</option>
            </select>
          </Field>
        ) : null}
      </div>

      {state.feedCurrency !== "TRY" ? (
        <div className="space-y-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)]/40 p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Kur kaynağı"
              hint={
                state.autoExchangeRate
                  ? "Sistem güncel TCMB kurunu kullanacak."
                  : "Aşağıdaki sabit kuru kullanacak."
              }
            >
              <label className="inline-flex items-center gap-2.5 rounded-lg border border-[var(--color-border)] bg-white px-3.5 py-2.5 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={state.autoExchangeRate}
                  onChange={(e) => update("autoExchangeRate", e.target.checked)}
                  className="h-4 w-4 cursor-pointer accent-[var(--color-brand-blue)]"
                />
                <span>Otomatik (TCMB)</span>
              </label>
            </Field>
            <Field
              label='Kur üzerine margin (TL)'
              hint='Örn. "kur + 30 kuruş" için 0.30'
              error={errors.exchangeRateMargin}
            >
              <input
                type="number"
                min={0}
                step="0.01"
                value={state.exchangeRateMargin}
                onChange={(e) => update("exchangeRateMargin", e.target.value)}
                className={inputClass}
                placeholder="0.30"
              />
            </Field>
          </div>

          {!state.autoExchangeRate ? (
            <Field
              label="Sabit kur"
              hint={`Örn. 1 ${state.feedCurrency} = 42.50 ₺`}
              error={errors.exchangeRate}
            >
              <input
                type="number"
                min={0}
                step="0.0001"
                value={state.exchangeRate}
                onChange={(e) => update("exchangeRate", e.target.value)}
                className={inputClass}
                placeholder="42.50"
              />
            </Field>
          ) : null}

          <div className="rounded-lg border border-[var(--color-border)] bg-white px-4 py-3 text-xs text-[var(--color-text-muted)]">
            {exchangeRateQuery.isLoading ? (
              <>Anlık TCMB kuru yükleniyor…</>
            ) : exchangeRateQuery.data ? (
              <>
                Anlık TCMB kuru:{" "}
                <strong className="text-[var(--color-text)]">
                  1 {state.feedCurrency} = {exchangeRateQuery.data.rate.toFixed(4)} ₺
                </strong>
                {" "}(margin dahil:{" "}
                <strong className="text-[var(--color-text)]">
                  {exchangeRateQuery.data.effective.toFixed(4)} ₺
                </strong>
                )
              </>
            ) : (
              <>Anlık TCMB kuru henüz alınamadı.</>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ─── Feed modal (add / edit) ──────────────────────────────────────────────────

interface FeedModalProps {
  supplierId: string;
  feed?: SupplierFeed;
  onClose: () => void;
  onSaved: () => void;
}

function FeedModal({ supplierId, feed, onClose, onSaved }: FeedModalProps): React.ReactElement {
  const toast = useToast();
  const isEdit = Boolean(feed);

  const [state, setState] = useState<FeedFormState>(() =>
    feed
      ? {
          name: feed.name ?? "",
          feedUrl: feed.feedUrl,
          authType: feed.authType,
          credentials: "",
          refreshIntervalHours: String(feed.refreshIntervalHours),
          feedCurrency: feed.feedCurrency,
          autoExchangeRate: feed.exchangeRate === null,
          exchangeRate: feed.exchangeRate !== null ? String(feed.exchangeRate) : "",
          exchangeRateMargin: String(feed.exchangeRateMargin),
          active: feed.active,
        }
      : DEFAULT_FEED_STATE,
  );
  const [errors, setErrors] = useState<FeedFieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  const update = <K extends keyof FeedFormState>(key: K, value: FeedFormState[K]) =>
    setState((prev) => ({ ...prev, [key]: value }));

  // Mevcut feed'lerde XML'de ürün-bazlı para birimi var mı? Varsa rozet gösterip
  // yalnızca yabancı para (USD) için kur sorulduğunu vurgular.
  const currencyDetection = useQuery({
    queryKey: ["feed-currency-detect", supplierId, feed?.id],
    queryFn: () => detectFeedCurrencies(supplierId, feed!.id),
    enabled: Boolean(feed?.id),
    staleTime: 60_000,
    retry: false,
  });
  const detect = currencyDetection.data;

  const createMutation = useMutation({
    mutationFn: (input: SupplierFeedInput) => createSupplierFeed(supplierId, input),
    onSuccess: () => {
      toast.push("success", "Feed eklendi");
      onSaved();
    },
    onError: (err) =>
      toast.push("error", err instanceof Error ? err.message : "Kayıt başarısız"),
  });

  const updateMutation = useMutation({
    mutationFn: (input: Partial<SupplierFeedInput>) =>
      updateSupplierFeed(supplierId, feed!.id, input),
    onSuccess: () => {
      toast.push("success", "Feed güncellendi");
      onSaved();
    },
    onError: (err) =>
      toast.push("error", err instanceof Error ? err.message : "Güncelleme başarısız"),
  });

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    const v = validateFeed(state);
    setErrors(v);
    if (Object.keys(v).length > 0) return;
    setSubmitting(true);
    const input = toFeedInput(state);
    const promise = isEdit
      ? updateMutation.mutateAsync(input)
      : createMutation.mutateAsync(input);
    promise.finally(() => setSubmitting(false));
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="flex w-full max-w-lg flex-col rounded-xl border border-[var(--color-border)] bg-white shadow-xl">
        <div className="flex flex-shrink-0 items-center justify-between border-b border-[var(--color-border)] px-6 py-4">
          <h3 className="text-base font-semibold text-[var(--color-text)]">
            {isEdit ? "Feed düzenle" : "Yeni feed ekle"}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-text)]"
            aria-label="Kapat"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
        <form
          id="feed-modal-form"
          onSubmit={handleSubmit}
          className="flex-1 overflow-y-auto px-6 py-5"
        >
          {isEdit && currencyDetection.isLoading ? (
            <div className="mb-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)]/40 px-4 py-3 text-xs text-[var(--color-text-muted)]">
              XML para birimi taranıyor…
            </div>
          ) : isEdit && detect?.hasPerProductCurrency ? (
            <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800">
              <div className="font-semibold">
                ✅ XML'de para birimi verisi var — kur oradan okunuyor.
              </div>
              <div className="mt-1">
                {Object.entries(detect.currencies)
                  .sort((a, b) => b[1] - a[1])
                  .map(([cur, n]) => `${cur} ×${n.toLocaleString("tr-TR")}`)
                  .join(" · ")}
              </div>
              <div className="mt-1.5 leading-relaxed">
                Her ürün <strong>kendi para biriminden</strong> işlenir.{" "}
                <strong>TL ürünler çevrilmez.</strong>{" "}
                {detect.foreignCurrencies.length > 0
                  ? `Yalnızca ${detect.foreignCurrencies.join(
                      ", ",
                    )} ürünler için aşağıdaki kuru belirleyin.`
                  : "Tüm ürünler TL — kur ayarı gerekmez."}
              </div>
            </div>
          ) : isEdit && detect && !detect.hasPerProductCurrency && !detect.error ? (
            <div className="mb-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)]/40 px-4 py-3 text-xs text-[var(--color-text-muted)]">
              XML'de ürün-bazlı para birimi etiketi bulunamadı — aşağıda seçtiğiniz
              feed para birimi tüm ürünlere uygulanır.
            </div>
          ) : null}
          <FeedFields state={state} errors={errors} update={update} showActive={isEdit} />
        </form>
        <div className="flex flex-shrink-0 items-center justify-end gap-2 border-t border-[var(--color-border)] px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[var(--color-border)] bg-white px-4 py-2 text-sm hover:bg-[var(--color-surface-muted)]"
          >
            İptal
          </button>
          <button
            type="submit"
            form="feed-modal-form"
            disabled={submitting}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-brand-blue)] px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[var(--color-brand-navy)] disabled:opacity-60"
          >
            {submitting ? "Kaydediliyor…" : "Kaydet"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Feeds panel (edit mode) ──────────────────────────────────────────────────

interface FeedsPanelProps {
  supplierId: string;
}

function SupplierFeedsPanel({ supplierId }: FeedsPanelProps): React.ReactElement {
  const queryClient = useQueryClient();
  const toast = useToast();
  const queryKey = ["supplier-feeds", supplierId] as const;

  const feedsQuery = useQuery({
    queryKey,
    queryFn: () => fetchSupplierFeeds(supplierId),
  });

  const [modalMode, setModalMode] = useState<"new" | SupplierFeed | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<SupplierFeed | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);

  const deleteMutation = useMutation({
    mutationFn: (feedId: string) => deleteSupplierFeed(supplierId, feedId),
    onSuccess: () => {
      toast.push("success", "Feed silindi");
      void queryClient.invalidateQueries({ queryKey });
      void queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      void queryClient.invalidateQueries({ queryKey: ["supplier", supplierId] });
    },
    onError: (err) =>
      toast.push("error", err instanceof Error ? err.message : "Silme başarısız"),
  });

  const handleSync = async (feed: SupplierFeed): Promise<void> => {
    setSyncingId(feed.id);
    try {
      await syncSupplierFeed(supplierId, feed.id);
      toast.push("success", `${feed.name || "Feed"} senkronizasyonu başlatıldı`);
    } catch (err) {
      toast.push("error", err instanceof Error ? err.message : "Senkron başarısız");
    } finally {
      setSyncingId(null);
    }
  };

  const handleSaved = (): void => {
    setModalMode(null);
    void queryClient.invalidateQueries({ queryKey });
    void queryClient.invalidateQueries({ queryKey: ["suppliers"] });
    void queryClient.invalidateQueries({ queryKey: ["supplier", supplierId] });
  };

  const feeds = feedsQuery.data ?? [];

  return (
    <>
      <SectionCard
        title="Feed'ler"
        description="Bu tedarikçinin XML feed kaynakları. Her feed bağımsız olarak senkronize edilir."
        action={
          <button
            type="button"
            onClick={() => setModalMode("new")}
            className="flex-shrink-0 rounded-lg border border-[var(--color-brand-blue)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--color-brand-blue)] shadow-sm transition hover:bg-[var(--color-brand-blue)]/5"
          >
            + Yeni feed ekle
          </button>
        }
      >
        {feedsQuery.isLoading ? (
          <p className="text-sm text-[var(--color-text-muted)]">Yükleniyor…</p>
        ) : feedsQuery.isError ? (
          <p className="text-sm text-red-600">
            {feedsQuery.error instanceof Error ? feedsQuery.error.message : "Feed'ler alınamadı"}
          </p>
        ) : feeds.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[var(--color-border)] py-10 text-center text-sm text-[var(--color-text-muted)]">
            Henüz feed yok.{" "}
            <button
              type="button"
              onClick={() => setModalMode("new")}
              className="text-[var(--color-brand-blue)] underline"
            >
              İlk feed'i ekle
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
            <table className="w-full text-sm">
              <thead className="bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]">
                <tr>
                  <th className="px-3 py-2 text-left">Ad / URL</th>
                  <th className="px-3 py-2 text-center">Para Birimi</th>
                  <th className="px-3 py-2 text-center">Durum</th>
                  <th className="px-3 py-2 text-left">Son senkron</th>
                  <th className="px-3 py-2 text-right">İşlem</th>
                </tr>
              </thead>
              <tbody>
                {feeds.map((f) => (
                  <tr
                    key={f.id}
                    className="border-t border-[var(--color-border)] hover:bg-[var(--color-surface-muted)]"
                  >
                    <td className="px-3 py-2">
                      <div className="font-medium text-[var(--color-text)]">
                        {f.name || <span className="text-[var(--color-text-muted)]">—</span>}
                      </div>
                      <div className="mt-0.5 max-w-[280px] truncate font-mono text-[11px] text-[var(--color-text-muted)]">
                        {f.feedUrl}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className="inline-flex items-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2 py-0.5 text-xs tabular-nums">
                        {f.feedCurrency}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                          f.active
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                            : "bg-gray-100 text-gray-600 border border-gray-200"
                        }`}
                      >
                        {f.active ? "Aktif" : "Pasif"}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-[var(--color-text-muted)]">
                      {f.lastSyncError ? (
                        <span
                          className="text-red-600 cursor-help"
                          title={f.lastSyncError}
                        >
                          Hata ·{" "}
                          <span className="text-[var(--color-text-muted)]">
                            {formatRelativeTime(f.lastSyncedAt)}
                          </span>
                        </span>
                      ) : (
                        formatRelativeTime(f.lastSyncedAt)
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => setModalMode(f)}
                          className="rounded-md border border-[var(--color-border)] bg-white px-2.5 py-1 text-xs hover:bg-[var(--color-surface-muted)]"
                        >
                          Düzenle
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleSync(f)}
                          disabled={syncingId === f.id}
                          className="rounded-md border border-[var(--color-border)] bg-white px-2.5 py-1 text-xs hover:bg-[var(--color-surface-muted)] disabled:opacity-50"
                        >
                          {syncingId === f.id ? "Senkron…" : "Senkron"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDelete(f)}
                          className="rounded-md border border-red-200 bg-white px-2.5 py-1 text-xs text-red-700 hover:bg-red-50"
                        >
                          Sil
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {modalMode !== null ? (
        <FeedModal
          supplierId={supplierId}
          feed={modalMode === "new" ? undefined : modalMode}
          onClose={() => setModalMode(null)}
          onSaved={handleSaved}
        />
      ) : null}

      {confirmDelete ? (
        <ConfirmDialog
          title="Feed sil"
          message={`"${confirmDelete.name || confirmDelete.feedUrl}" feed'i silinecek. Devam edilsin mi?`}
          confirmLabel="Sil"
          destructive
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => {
            const feedId = confirmDelete.id;
            setConfirmDelete(null);
            deleteMutation.mutate(feedId);
          }}
        />
      ) : null}
    </>
  );
}

// ─── Categories panel ─────────────────────────────────────────────────────────

interface CategoriesPanelProps {
  supplierId: string;
  /** Tedarikçinin global kâr marjı (%) — kategori modalında override boşken gösterilir. */
  globalMargin: number;
  /** Tedarikçinin global ek kârı (TL) — kategori modalında override boşken gösterilir. */
  globalExtra: number;
}

function SupplierCategoriesPanel({
  supplierId,
  globalMargin,
  globalExtra,
}: CategoriesPanelProps): React.ReactElement {
  const queryClient = useQueryClient();
  const toast = useToast();
  const queryKey = ["supplier-categories", supplierId] as const;
  const autoSyncedRef = useRef(false);
  // Tıklanan kategori → ürünleri + özel fiyatlandırma modalını açar.
  const [selectedCategory, setSelectedCategory] = useState<SupplierCategory | null>(
    null,
  );

  const categoriesQuery = useQuery({
    queryKey,
    queryFn: () => fetchSupplierCategories(supplierId),
  });

  const syncMutation = useMutation({
    mutationFn: () => syncSupplierCategories(supplierId),
    onSuccess: () => {
      toast.push("success", "Kategoriler tedarikçiden çekildi");
      void queryClient.invalidateQueries({ queryKey });
    },
    onError: (err) =>
      toast.push("error", err instanceof Error ? err.message : "Kategori senkronu başlatılamadı"),
  });

  useEffect(() => {
    if (autoSyncedRef.current) return;
    if (categoriesQuery.isSuccess && (categoriesQuery.data?.length ?? 0) === 0) {
      autoSyncedRef.current = true;
      syncMutation.mutate();
    }
  }, [categoriesQuery.isSuccess, categoriesQuery.data, syncMutation]);

  const categories = categoriesQuery.data ?? [];
  const activeCount = categories.filter((c) => c.isActive).length;
  const totalCount = categories.length;

  return (
    <>
    <SectionCard
      title="Kategoriler"
      description="Karta tıklayarak o kategorinin ürünlerini görür, kategori bazlı özel satış fiyatı (kâr marjı + ek kâr) ayarlar ve aktif/pasif yaparsınız. Yeşil = aktif (listeleniyor)."
    >
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        {totalCount > 0 ? (
          <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              {activeCount} aktif
            </span>
            <span className="text-xs">/ {totalCount} toplam</span>
          </div>
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={() => syncMutation.mutate()}
          disabled={syncMutation.isPending}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--color-text)] shadow-sm transition hover:border-[var(--color-brand-blue)]/40 hover:bg-[var(--color-surface-muted)] disabled:opacity-60"
        >
          {syncMutation.isPending ? "Yenileniyor…" : "Tedarikçiden yenile"}
        </button>
      </div>

      {categoriesQuery.isLoading ||
      (categoriesQuery.isSuccess && totalCount === 0 && syncMutation.isPending) ? (
        <p className="text-sm text-[var(--color-text-muted)]">Kategoriler yükleniyor…</p>
      ) : categoriesQuery.isError ? (
        <p className="text-sm text-red-600">
          {categoriesQuery.error instanceof Error ? categoriesQuery.error.message : "Kategoriler alınamadı"}
        </p>
      ) : totalCount === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)]">
          Henüz kategori yok. "Tedarikçiden yenile" düğmesi ile feed'den çekebilirsiniz.
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {categories.map((c) => {
            const active = c.isActive;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => setSelectedCategory(c)}
                  aria-haspopup="dialog"
                  title="Ürünleri gör + kategori bazlı özel fiyat ayarla"
                  className={`group flex w-full flex-col items-start gap-1 rounded-lg border px-3 py-2.5 text-left transition-all hover:-translate-y-px hover:shadow-sm ${
                    active
                      ? "border-emerald-300 bg-emerald-50 text-emerald-900 hover:border-emerald-400 hover:bg-emerald-100"
                      : "border-gray-300 bg-gray-100 text-gray-500 hover:bg-gray-200"
                  }`}
                >
                  <div className="flex w-full items-center gap-2">
                    <span
                      className={`inline-block h-2 w-2 flex-shrink-0 rounded-full ${active ? "bg-emerald-500" : "bg-gray-400"}`}
                      aria-hidden
                    />
                    <span className="flex-1 truncate text-sm font-medium">{c.name || "—"}</span>
                  </div>
                  <div className="flex w-full items-center justify-between gap-2 pl-4 text-xs">
                    <span className={`truncate ${active ? "text-emerald-700" : "text-gray-500"}`}>
                      {active ? "Aktif" : "Pasif"}
                    </span>
                    {typeof c.productCount === "number" ? (
                      <span className="tabular-nums opacity-70">
                        {c.productCount.toLocaleString("tr-TR")} ürün
                      </span>
                    ) : null}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
      <CanonicalCategoriesPanel supplierId={supplierId} />
      {selectedCategory ? (
        <SupplierCategoryDetailModal
          supplierId={supplierId}
          category={selectedCategory}
          globalMargin={globalMargin}
          globalExtra={globalExtra}
          onClose={() => setSelectedCategory(null)}
        />
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// CanonicalCategoriesPanel — V3 DOĞRU (Trendyol tabanlı) kategori görünümü.
// Salt-okunur: tedarikçinin ürünleri doğru kategorilere göre gruplu. Karta
// tıklayınca o kategorideki ürünler açılır. /canonical-categories endpoint'i.
// ---------------------------------------------------------------------------

function CanonicalCategoriesPanel({
  supplierId,
}: {
  supplierId: string;
}): React.ReactElement {
  const [expanded, setExpanded] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["supplier-canonical-categories", supplierId],
    queryFn: () => fetchSupplierCanonicalCategories(supplierId),
  });
  const productsQuery = useQuery({
    queryKey: ["supplier-canonical-products", supplierId, expanded],
    queryFn: () =>
      fetchSupplierCanonicalCategoryProducts(supplierId, expanded as string),
    enabled: !!expanded,
  });
  const data = query.data;

  return (
    <SectionCard
      title="Doğru Kategoriler (Vitrin)"
      description="Bu tedarikçinin ürünlerinin DOĞRU (kanonik) kategori dağılımı. Karta tıklayınca o kategorideki ürünleri görürsünüz. Salt-okunur."
    >
      {query.isLoading ? (
        <p className="text-sm text-slate-500">Yükleniyor…</p>
      ) : !data || data.categories.length === 0 ? (
        <p className="text-sm text-slate-500">
          Henüz doğru-kategori eşlemesi yok (seed/sync sonrası dolar).
        </p>
      ) : (
        <div className="space-y-2">
          {data.unmapped > 0 ? (
            <p className="text-xs font-semibold text-amber-600">
              {data.unmapped} ürün henüz eşlenmedi.
            </p>
          ) : null}
          <ul className="space-y-1.5">
            {data.categories.map((c) => (
              <li
                key={c.path}
                className="overflow-hidden rounded-lg border border-slate-200 bg-white"
              >
                <button
                  type="button"
                  onClick={() =>
                    setExpanded(expanded === c.path ? null : c.path)
                  }
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50"
                >
                  <span className="min-w-0 flex-1 truncate font-medium text-slate-700">
                    {c.path}
                  </span>
                  <span className="shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">
                    {c.productCount}
                  </span>
                </button>
                {expanded === c.path ? (
                  <div className="border-t border-slate-200 px-3 py-2">
                    {productsQuery.isLoading ? (
                      <p className="text-xs text-slate-500">
                        Ürünler yükleniyor…
                      </p>
                    ) : (productsQuery.data?.length ?? 0) === 0 ? (
                      <p className="text-xs text-slate-500">Ürün yok.</p>
                    ) : (
                      <ul className="space-y-1">
                        {productsQuery.data!.map((p) => (
                          <li
                            key={p.id}
                            className="flex items-center justify-between gap-2 text-xs"
                          >
                            <span className="min-w-0 flex-1 truncate text-slate-700">
                              {p.name}
                            </span>
                            <span className="shrink-0 text-slate-400">
                              stok {p.stock}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}
    </SectionCard>
  );
}

interface TextRulesPanelProps {
  supplierId: string;
}

function emptyTextRule(): SupplierTextRule {
  return {
    search: "",
    replacement: "",
    applyToName: true,
    applyToDescription: true,
    caseInsensitive: true,
    wholeWord: false,
    enabled: true,
  };
}

function SupplierTextRulesPanel({ supplierId }: TextRulesPanelProps): React.ReactElement {
  const queryClient = useQueryClient();
  const toast = useToast();
  const queryKey = ["supplier-text-rules", supplierId] as const;

  const rulesQuery = useQuery({
    queryKey,
    queryFn: () => fetchSupplierTextRules(supplierId),
  });

  const [rules, setRules] = useState<SupplierTextRule[]>([]);
  const [dirty, setDirty] = useState(false);

  // Sunucudan veri geldiğinde, kullanıcı henüz düzenleme yapmadıysa lokal
  // taslağı senkronize et. Düzenleme başladıysa (dirty) ezme.
  useEffect(() => {
    if (rulesQuery.data && !dirty) {
      setRules(rulesQuery.data);
    }
  }, [rulesQuery.data, dirty]);

  const saveMutation = useMutation({
    mutationFn: () => saveSupplierTextRules(supplierId, rules),
    onSuccess: (saved) => {
      setRules(saved);
      setDirty(false);
      queryClient.setQueryData(queryKey, saved);
      toast.push(
        "success",
        "Metin kuralları kaydedildi. Mevcut ürünler arka planda güncelleniyor.",
      );
    },
    onError: (err) =>
      toast.push("error", err instanceof Error ? err.message : "Metin kuralları kaydedilemedi"),
  });

  const updateRule = (index: number, patch: Partial<SupplierTextRule>): void => {
    setDirty(true);
    setRules((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const addRule = (): void => {
    setDirty(true);
    setRules((prev) => [...prev, emptyTextRule()]);
  };

  const removeRule = (index: number): void => {
    setDirty(true);
    setRules((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <SectionCard
      title="Metin Kuralları"
      description="Ürün adı ve açıklamasından metin silin veya değiştirin. Kurallar tüm ürünlere (yeni + mevcut) uygulanır; hem mağazada hem giden XML feed'inde geçerlidir."
      action={
        <button
          type="button"
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending || rulesQuery.isLoading}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-brand-blue)] px-4 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-[var(--color-brand-navy)] disabled:opacity-60"
        >
          {saveMutation.isPending ? "Kaydediliyor…" : "Kuralları kaydet"}
        </button>
      }
    >
      {rulesQuery.isLoading ? (
        <p className="text-sm text-[var(--color-text-muted)]">Kurallar yükleniyor…</p>
      ) : rulesQuery.isError ? (
        <p className="text-sm text-red-600">
          {rulesQuery.error instanceof Error ? rulesQuery.error.message : "Kurallar alınamadı"}
        </p>
      ) : (
        <div className="space-y-3">
          {rules.length === 0 ? (
            <p className="rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-surface-muted)]/40 px-4 py-6 text-center text-sm text-[var(--color-text-muted)]">
              Henüz kural yok. "Kural ekle" ile yeni bir sil/değiştir kuralı oluşturun.
            </p>
          ) : (
            <ul className="space-y-3">
              {rules.map((rule, index) => (
                <li
                  key={index}
                  className={`rounded-xl border p-4 transition ${
                    rule.enabled
                      ? "border-[var(--color-border)] bg-white"
                      : "border-gray-200 bg-gray-50 opacity-75"
                  }`}
                >
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field label="Aranan metin" required>
                      <input
                        type="text"
                        value={rule.search}
                        onChange={(e) => updateRule(index, { search: e.target.value })}
                        placeholder="örn. Marka Adı"
                        className={inputClass}
                      />
                    </Field>
                    <Field label="Yeni metin" hint="Boş bırakırsanız eşleşen metin silinir.">
                      <input
                        type="text"
                        value={rule.replacement}
                        onChange={(e) => updateRule(index, { replacement: e.target.value })}
                        placeholder="boş = sil"
                        className={inputClass}
                      />
                    </Field>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-[var(--color-text)]">
                    <label className="inline-flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={rule.applyToName}
                        onChange={(e) => updateRule(index, { applyToName: e.target.checked })}
                        className="h-4 w-4 cursor-pointer accent-[var(--color-brand-blue)]"
                      />
                      Ürün adı
                    </label>
                    <label className="inline-flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={rule.applyToDescription}
                        onChange={(e) => updateRule(index, { applyToDescription: e.target.checked })}
                        className="h-4 w-4 cursor-pointer accent-[var(--color-brand-blue)]"
                      />
                      Açıklama
                    </label>
                    <label className="inline-flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={rule.caseInsensitive}
                        onChange={(e) => updateRule(index, { caseInsensitive: e.target.checked })}
                        className="h-4 w-4 cursor-pointer accent-[var(--color-brand-blue)]"
                      />
                      Büyük/küçük harf duyarsız
                    </label>
                    <label className="inline-flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={rule.wholeWord}
                        onChange={(e) => updateRule(index, { wholeWord: e.target.checked })}
                        className="h-4 w-4 cursor-pointer accent-[var(--color-brand-blue)]"
                      />
                      Tam kelime
                    </label>
                    <label className="inline-flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={rule.enabled}
                        onChange={(e) => updateRule(index, { enabled: e.target.checked })}
                        className="h-4 w-4 cursor-pointer accent-[var(--color-brand-blue)]"
                      />
                      Aktif
                    </label>
                    <button
                      type="button"
                      onClick={() => removeRule(index)}
                      className="ml-auto inline-flex items-center gap-1 rounded-lg border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-600 transition hover:bg-red-50"
                    >
                      Sil
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <button
            type="button"
            onClick={addRule}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--color-text)] shadow-sm transition hover:border-[var(--color-brand-blue)]/40 hover:bg-[var(--color-surface-muted)]"
          >
            + Kural ekle
          </button>
        </div>
      )}
    </SectionCard>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function SupplierFormPage(): React.ReactElement | null {
  const { id } = useParams<{ id: string }>();
  useDocumentTitle(id ? "Tedarikçi Düzenle" : "Yeni Tedarikçi");
  const authed = useRequireAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const isEdit = Boolean(id);

  const [state, setState] = useState<FormState>(DEFAULT_STATE);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [feedState, setFeedState] = useState<FeedFormState>(DEFAULT_FEED_STATE);
  const [feedErrors, setFeedErrors] = useState<FeedFieldErrors>({});
  const [deleteStep, setDeleteStep] = useState<"idle" | "warning" | "typing">("idle");
  const [deleteConfirmName, setDeleteConfirmName] = useState<string>("");
  const [submitting, setSubmitting] = useState<boolean>(false);

  const supplierQuery = useQuery({
    queryKey: ["supplier", id],
    queryFn: () => (id ? fetchSupplier(id) : Promise.reject(new Error("missing id"))),
    enabled: authed && isEdit,
  });

  useEffect(() => {
    const s = supplierQuery.data;
    if (!s) return;
    setState({
      name: s.name,
      marginPercent: String(s.marginPercent ?? 20),
      profitType: s.profitType === "tiered" ? "tiered" : "fixed",
      profitTiers: Array.isArray(s.profitTiers) ? s.profitTiers : [],
      extraCostTry:
        s.extraCostTry !== null && s.extraCostTry !== undefined ? String(s.extraCostTry) : "0",
      stockThreshold: String(s.stockThreshold ?? 0),
      hideBelowThreshold: Boolean(s.hideBelowThreshold),
      priceIncludesVat: Boolean(s.priceIncludesVat ?? false),
      purchaseVatRate: String(s.purchaseVatRate ?? 20),
      minPrice:
        s.minPrice !== null && s.minPrice !== undefined ? String(s.minPrice) : "1",
      purchaseDiscountInclVatPct: String(s.purchaseDiscountInclVatPct ?? 0),
      purchaseDiscountTl: String(s.purchaseDiscountTl ?? 0),
      purchaseExtraCostTl: String(s.purchaseExtraCostTl ?? 0),
      mandatoryCarriers: Array.isArray(s.mandatoryCarriers) ? [...s.mandatoryCarriers] : [],
      requiresPdf: Boolean(s.requiresPdf),
      pttavmEnabled: Boolean(s.pttavmEnabled),
      leadTimeDays:
        s.leadTimeDays !== null && s.leadTimeDays !== undefined ? String(s.leadTimeDays) : "",
    });
  }, [supplierQuery.data]);

  const createMutation = useMutation({
    mutationFn: (input: SupplierInput) => createSupplier(input),
    onSuccess: () => {
      toast.push("success", "Tedarikçi oluşturuldu");
      void queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      // Fiyatlandırma backend'de ürün fiyatlarını etkiler → Ürünler cache'ini tazele.
      void queryClient.invalidateQueries({ queryKey: ["products"] });
      navigate("/suppliers");
    },
    onError: (err) =>
      toast.push("error", err instanceof Error ? err.message : "Kayıt başarısız"),
  });

  const updateMutation = useMutation({
    mutationFn: ({ sid, input }: { sid: string; input: Omit<SupplierInput, "initialFeed"> }) =>
      updateSupplier(sid, input),
    onSuccess: () => {
      toast.push("success", "Tedarikçi güncellendi");
      void queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      void queryClient.invalidateQueries({ queryKey: ["supplier", id] });
      // Marj/indirim/ek maliyet değişimi backend'de TÜM ürün fiyatlarını yeniden
      // hesaplar → Ürünler listesi cache'ini tazele ki güncel fiyat hemen görünsün.
      void queryClient.invalidateQueries({ queryKey: ["products"] });
      navigate("/suppliers");
    },
    onError: (err) =>
      toast.push("error", err instanceof Error ? err.message : "Güncelleme başarısız"),
  });

  const deleteMutation = useMutation({
    mutationFn: (sid: string) => deleteSupplier(sid),
    onSuccess: () => {
      toast.push("success", "Tedarikçi silindi");
      void queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      navigate("/suppliers");
    },
    onError: (err) =>
      toast.push("error", err instanceof Error ? err.message : "Silme başarısız"),
  });

  const isLoading = useMemo(() => isEdit && supplierQuery.isLoading, [isEdit, supplierQuery.isLoading]);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]): void =>
    setState((prev) => ({ ...prev, [key]: value }));

  const updateFeed = <K extends keyof FeedFormState>(key: K, value: FeedFormState[K]): void =>
    setFeedState((prev) => ({ ...prev, [key]: value }));

  const formId = "supplier-form";

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const v = validate(state);
    setErrors(v);

    let fv: FeedFieldErrors = {};
    if (!isEdit) {
      fv = validateFeed(feedState);
      setFeedErrors(fv);
    }

    if (Object.keys(v).length > 0 || Object.keys(fv).length > 0) {
      toast.push("error", "Lütfen formdaki hataları düzeltin");
      return;
    }
    setSubmitting(true);
    const base = toSupplierInput(state);
    const promise = isEdit && id
      ? updateMutation.mutateAsync({ sid: id, input: base })
      : createMutation.mutateAsync({ ...base, initialFeed: toFeedInput(feedState) });
    promise.finally(() => setSubmitting(false));
  };

  if (isLoading) {
    return <p className="text-sm text-[var(--color-text-muted)]">Yükleniyor…</p>;
  }

  if (isEdit && supplierQuery.isError) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Tedarikçi yüklenemedi.{" "}
        <Link to="/suppliers" className="underline">
          Listeye dön
        </Link>
      </div>
    );
  }

  const headerTitle = isEdit
    ? state.name.trim() || "Tedarikçiyi düzenle"
    : "Yeni tedarikçi";

  return (
    <div className="mx-auto max-w-5xl pb-12">
      {/* Sticky header */}
      <div className="sticky top-0 z-30 -mx-4 mb-6 border-b border-[var(--color-border)] bg-[var(--color-surface-muted)]/80 px-4 py-4 backdrop-blur supports-[backdrop-filter]:bg-[var(--color-surface-muted)]/60 sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
              <Link to="/suppliers" className="hover:text-[var(--color-brand-blue)]">
                Tedarikçiler
              </Link>
              <span aria-hidden>/</span>
              <span>{isEdit ? "Düzenle" : "Yeni"}</span>
            </div>
            <h1 className="mt-1 truncate text-2xl font-semibold tracking-tight text-[var(--color-text)]">
              {headerTitle}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <Link
              to="/suppliers"
              className="rounded-lg border border-[var(--color-border)] bg-white px-4 py-2 text-sm font-medium text-[var(--color-text)] shadow-sm transition hover:bg-[var(--color-surface-muted)]"
            >
              İptal
            </Link>
            <button
              type="submit"
              form={formId}
              disabled={submitting}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-brand-blue)] px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[var(--color-brand-navy)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? "Kaydediliyor…" : "Kaydet"}
            </button>
          </div>
        </div>
      </div>

      <form id={formId} onSubmit={handleSubmit} className="space-y-6">
        {/* Genel */}
        <SectionCard title="Genel" description="Tedarikçi kimliği ve temel ayarlar.">
          <Field label="Tedarikçi adı" required error={errors.name}>
            <input
              type="text"
              value={state.name}
              onChange={(e) => update("name", e.target.value)}
              className={inputClass}
              autoComplete="off"
              placeholder="Örn. Teknodayım"
            />
          </Field>
        </SectionCard>

        {/* Alış Fiyatlandırma — TEK KAYNAK maliyet */}
        <SectionCard
          title="Alış Fiyatlandırma"
          description="Gerçek alış maliyeti buradan hesaplanır → Maliyet = XML fiyatı → (indirim % ve TL) → (KDV dahilse KDV oranıyla düşülür). Tüm satış / bakiye / kâr hesapları bu maliyete dayanır."
        >
          <div className="mb-5">
            <ToggleRow
              checked={state.priceIncludesVat}
              onChange={(next) => update("priceIncludesVat", next)}
              title="XML fiyatları KDV dahil mi?"
              description="Tedarikçi XML'inde fiyatlar KDV dahil geliyorsa işaretleyin (maliyetten KDV düşülür)."
            />
          </div>
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            <Field
              label="KDV oranı (%)"
              hint="KDV düşme + cüzdan/kâr hesabı bu oranla yapılır."
            >
              <select
                value={state.purchaseVatRate}
                onChange={(e) => update("purchaseVatRate", e.target.value)}
                className={inputClass}
              >
                <option value="10">%10</option>
                <option value="20">%20</option>
              </select>
            </Field>
            <Field
              label="Alış indirimi (%)"
              hint="XML fiyatına uygulanır (ör. %20). Maliyet bu indirimle düşer."
            >
              <input
                type="number"
                min={0}
                max={100}
                step="0.01"
                value={state.purchaseDiscountInclVatPct}
                onChange={(e) => update("purchaseDiscountInclVatPct", e.target.value)}
                className={inputClass}
                placeholder="0"
              />
            </Field>
            <Field
              label="Alış indirimi (₺)"
              hint="XML fiyatına uygulanan sabit TL indirim (yüzdeyle birlikte)."
            >
              <input
                type="number"
                min={0}
                step="0.01"
                value={state.purchaseDiscountTl}
                onChange={(e) => update("purchaseDiscountTl", e.target.value)}
                className={inputClass}
                placeholder="0"
              />
            </Field>
            <Field
              label="Alış ek maliyeti (₺)"
              hint="Birim başına maliyete EKLENİR (kargo/komisyon/hizmet). Satış/cüzdan/kâr bu maliyete göre hesaplanır."
            >
              <input
                type="number"
                min={0}
                step="0.01"
                value={state.purchaseExtraCostTl}
                onChange={(e) => update("purchaseExtraCostTl", e.target.value)}
                className={inputClass}
                placeholder="0"
              />
            </Field>
          </div>
        </SectionCard>

        {/* Satış Fiyatlandırma */}
        <SectionCard
          title="Satış Fiyatlandırma"
          description={
            state.profitType === "tiered"
              ? "Fiyata göre kademeli kâr: ürünün alış maliyetine göre barem seçilir."
              : "Satış fiyatı = alış maliyeti × (1 + kâr marjı/100) + ek kâr."
          }
        >
          {/* Kâr Tipi toggle */}
          <div className="mb-4 flex items-center gap-3">
            <span className="text-sm font-medium text-[var(--color-text)]">
              Kâr Tipi
            </span>
            <div className="inline-flex rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-0.5">
              <button
                type="button"
                onClick={() => update("profitType", "fixed")}
                className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${
                  state.profitType === "fixed"
                    ? "bg-white text-[var(--color-text)] shadow-sm"
                    : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                }`}
              >
                Sabit Kâr
              </button>
              <button
                type="button"
                onClick={() => update("profitType", "tiered")}
                className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${
                  state.profitType === "tiered"
                    ? "bg-amber-500 text-white shadow-sm"
                    : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                }`}
              >
                Fiyata Göre Kademeli Kâr
              </button>
            </div>
          </div>

          {state.profitType === "tiered" ? (
            <KademeliKarEditor
              initialTiers={state.profitTiers}
              onChange={(tiers) => update("profitTiers", tiers)}
            />
          ) : (
            <div className="grid gap-5 md:grid-cols-2">
              <Field label="Kâr marjı (%)" required error={errors.marginPercent}>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={state.marginPercent}
                  onChange={(e) => update("marginPercent", e.target.value)}
                  className={inputClass}
                />
              </Field>
              <Field label="Ek kâr (₺)" error={errors.extraCostTry} hint="Marj sonrası satış fiyatına eklenir.">
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={state.extraCostTry}
                  onChange={(e) => update("extraCostTry", e.target.value)}
                  className={inputClass}
                  placeholder="0"
                />
              </Field>
            </div>
          )}
        </SectionCard>

        {/* Stok */}
        <SectionCard
          title="Stok"
          description="Min. fiyat, stok eşiği ve düşük stoklu ürünlerin listelenme davranışı."
        >
          <div className="grid gap-5 md:grid-cols-2">
            <Field label="Stok eşiği (min stok)" required error={errors.stockThreshold}>
              <input
                type="number"
                min={0}
                value={state.stockThreshold}
                onChange={(e) => update("stockThreshold", e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field
              label="Min. fiyat (₺)"
              required
              error={errors.minPrice}
              hint="Bu maliyetin altındaki ürünler listelenmez."
            >
              <input
                type="number"
                min={0}
                step="0.01"
                value={state.minPrice}
                onChange={(e) => update("minPrice", e.target.value)}
                className={inputClass}
                placeholder="1"
              />
            </Field>
          </div>
          <div className="mt-5">
            <ToggleRow
              checked={state.hideBelowThreshold}
              onChange={(next) => update("hideBelowThreshold", next)}
              title="Eşiğin altındaysa satışa kapat"
              description="Stok eşiğinin altındaki ürünler aktif feedlere ve vitrine düşmez."
            />
          </div>
        </SectionCard>

        {/* Operasyon */}
        <SectionCard title="Operasyon" description="Sipariş ve kargo kuralları.">
          <div className="space-y-5">
            <Field
              label="Zorunlu / desteklenen kargo firmaları"
              hint="Hiçbiri seçilmezse tedarikçi serbesttir."
            >
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {MANDATORY_CARRIERS.map((c) => {
                  const checked = state.mandatoryCarriers.includes(c);
                  return (
                    <label
                      key={c}
                      className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2.5 text-sm transition ${
                        checked
                          ? "border-[var(--color-brand-blue)] bg-[var(--color-brand-blue)]/5 text-[var(--color-text)]"
                          : "border-[var(--color-border)] bg-white text-[var(--color-text)] hover:border-[var(--color-brand-blue)]/40 hover:bg-[var(--color-surface-muted)]"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          const next = e.target.checked
                            ? [...state.mandatoryCarriers, c]
                            : state.mandatoryCarriers.filter((x) => x !== c);
                          update("mandatoryCarriers", next);
                        }}
                        className="h-4 w-4 cursor-pointer accent-[var(--color-brand-blue)]"
                      />
                      <span className="truncate">{MANDATORY_CARRIER_LABELS[c]}</span>
                    </label>
                  );
                })}
              </div>
            </Field>

            <div className="grid gap-5 md:grid-cols-2">
              <Field
                label="Kargoya teslim süresi (gün)"
                error={errors.leadTimeDays}
                hint="Sadece 1 veya 2 gün."
              >
                <select
                  value={state.leadTimeDays}
                  onChange={(e) => update("leadTimeDays", e.target.value)}
                  className={inputClass}
                >
                  <option value="">—</option>
                  <option value="1">1 gün</option>
                  <option value="2">2 gün</option>
                </select>
              </Field>
              <ToggleRow
                checked={state.requiresPdf}
                onChange={(next) => update("requiresPdf", next)}
                title="Kargo PDF zorunlu"
                description="Sipariş için tedarikçi tarafında kargo belgesi gerekir."
              />
            </div>
          </div>
        </SectionCard>

        {/* İlk feed — only shown in create mode */}
        {!isEdit ? (
          <SectionCard
            title="İlk Feed"
            description="Tedarikçinin XML feed kaynağı. Kayıt sonrası ek feedler ekleyebilirsiniz."
          >
            <FeedFields state={feedState} errors={feedErrors} update={updateFeed} />
          </SectionCard>
        ) : null}

        {/* Danger zone — only in edit mode */}
        {isEdit ? (
          <SectionCard
            title="Tehlikeli Bölge"
            description="Geri alınamaz işlemler. Dikkatli kullanın."
            tone="danger"
          >
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-red-200 bg-white p-4">
              <div>
                <h3 className="text-sm font-semibold text-[var(--color-text)]">Tedarikçiyi sil</h3>
                <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                  Tüm ürünler, stok kayıtları ve kategori eşleşmeleri silinir.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDeleteStep("warning")}
                className="rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-700 shadow-sm transition hover:bg-red-50"
              >
                Tedarikçiyi sil
              </button>
            </div>
          </SectionCard>
        ) : null}
      </form>

      {/* Feed panel, categories panel and text-rules panel — only in edit mode */}
      {isEdit && id ? (
        <div className="mt-6 space-y-6">
          <SupplierFeedsPanel supplierId={id} />
          <SupplierCategoriesPanel
            supplierId={id}
            globalMargin={Number(state.marginPercent) || 0}
            globalExtra={Number(state.extraCostTry) || 0}
          />
          <SupplierTextRulesPanel supplierId={id} />
        </div>
      ) : null}

      {/* Delete confirmation step 1 — warning */}
      {deleteStep === "warning" && id ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="supplier-delete-warning-title"
        >
          <div className="w-full max-w-md rounded-xl border border-[var(--color-border)] bg-white p-6 shadow-xl">
            <h3 id="supplier-delete-warning-title" className="text-lg font-semibold text-red-700">
              Tedarikçi kalıcı olarak silinecek
            </h3>
            <p className="mt-2 text-sm text-[var(--color-text)]">
              <strong>"{state.name}"</strong> tedarikçisini siliyorsunuz. Bu işlem geri alınamaz.
            </p>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-[var(--color-text-muted)]">
              <li>Tedarikçinin tüm feed'leri silinecek.</li>
              <li>Tüm ürünler ve stok kayıtları silinecek.</li>
              <li>Geçmiş siparişlerdeki ürün satırları korunur.</li>
            </ul>
            <div className="mt-6 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => { setDeleteStep("idle"); setDeleteConfirmName(""); }}
                className="rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-sm hover:bg-[var(--color-surface-muted)]"
              >
                İptal
              </button>
              <button
                type="button"
                onClick={() => setDeleteStep("typing")}
                className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-100"
              >
                Devam et
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Delete confirmation step 2 — type name */}
      {deleteStep === "typing" && id ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="supplier-delete-typing-title"
        >
          <div className="w-full max-w-md rounded-xl border border-[var(--color-border)] bg-white p-6 shadow-xl">
            <h3 id="supplier-delete-typing-title" className="text-lg font-semibold text-red-700">
              Silmek için tedarikçi adını yazın
            </h3>
            <p className="mt-2 text-sm text-[var(--color-text)]">
              Onaylamak için aşağıya tedarikçi adını birebir yazın:
            </p>
            <p className="mt-2 rounded-lg bg-[var(--color-surface-muted)] px-3 py-2 font-mono text-sm">
              {state.name}
            </p>
            <input
              type="text"
              value={deleteConfirmName}
              onChange={(e) => setDeleteConfirmName(e.target.value)}
              placeholder="Tedarikçi adını yazın"
              autoFocus
              className={`${inputClass} mt-3`}
              autoComplete="off"
            />
            <div className="mt-6 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => { setDeleteStep("idle"); setDeleteConfirmName(""); }}
                className="rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-sm hover:bg-[var(--color-surface-muted)]"
              >
                İptal
              </button>
              <button
                type="button"
                disabled={
                  deleteConfirmName.trim() !== state.name.trim() || deleteMutation.isPending
                }
                onClick={() => {
                  setDeleteStep("idle");
                  setDeleteConfirmName("");
                  deleteMutation.mutate(id);
                }}
                className="rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {deleteMutation.isPending ? "Siliniyor…" : "Kalıcı olarak sil"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

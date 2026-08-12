import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff } from "lucide-react";
import { useRequireAuth } from "../lib/auth";
import {
  activatePosProvider,
  deactivatePosProvider,
  fetchPosDetail,
  formatPosAmount,
  createPosTestPayment,
  paytrPaymentReport,
  paytrStatusQuery,
  paytrTransactionReport,
  toslaStatusQuery,
  updatePosProvider,
  type PosDetail,
  type PosProviderUpdateInput,
  type PosTestPayment,
} from "../lib/pos";
import { updateSecret } from "../lib/secrets";
import { getCurrentPermissions } from "../lib/permissions";
import { useToast } from "../components/Toast";
import ConfirmDialog from "../components/ConfirmDialog";
import { useDocumentTitle } from "../lib/useDocumentTitle";

// ─── Yardımcılar ──────────────────────────────────────────────────────────────

function formatDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("tr-TR", { dateStyle: "medium", timeStyle: "short" });
}

/** datetime-local "YYYY-MM-DDTHH:mm[:ss]" → PayTR "YYYY-MM-DD HH:mm:ss" */
function toDateTimeParam(value: string): string {
  const s = value.replace("T", " ");
  return s.length === 16 ? `${s}:00` : s;
}

const MAX_INSTALLMENT_OPTIONS = [0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

// ─── Anlaşma / işlem ayarları formu state'i ───────────────────────────────────

interface SettingsFormState {
  commissionRate: string;
  customerCommissionRate: string;
  valorDays: string;
  testMode: boolean;
  noInstallment: boolean;
  maxInstallment: string;
  description: string;
}

const EMPTY_SETTINGS: SettingsFormState = {
  commissionRate: "",
  customerCommissionRate: "",
  valorDays: "",
  testMode: false,
  noInstallment: false,
  maxInstallment: "0",
  description: "",
};

// ─── Sağlayıcıya özel API bilgileri alan tanımları ────────────────────────────

type CredField =
  | "merchantId"
  | "merchantKey"
  | "merchantSalt"
  | "clientId"
  | "apiUser"
  | "apiPass";

type CredDef = { field: CredField; secretKey: string; label: string };

const PAYTR_CRED_FIELDS: CredDef[] = [
  { field: "merchantId", secretKey: "paytr.merchantId", label: "Mağaza No (merchant_id)" },
  { field: "merchantKey", secretKey: "paytr.merchantKey", label: "Mağaza Parola (merchant_key)" },
  { field: "merchantSalt", secretKey: "paytr.merchantSalt", label: "Gizli Anahtar (merchant_salt)" },
];

const TOSLA_CRED_FIELDS: CredDef[] = [
  { field: "clientId", secretKey: "tosla.clientId", label: "Client ID (clientId)" },
  { field: "apiUser", secretKey: "tosla.apiUser", label: "API Kullanıcı (apiUser)" },
  { field: "apiPass", secretKey: "tosla.apiPass", label: "API Parola (apiPass)" },
];

// ─── İstatistik kartı ─────────────────────────────────────────────────────────

interface StatCardProps {
  label: string;
  value: React.ReactNode;
  hint?: string;
  action?: React.ReactNode;
}

function StatCard({ label, value, hint, action }: StatCardProps): React.ReactElement {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          {label}
        </p>
        {action}
      </div>
      <p className="mt-1 text-lg font-bold text-slate-900">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-slate-400">{hint}</p> : null}
    </div>
  );
}

// ─── Sayfa ────────────────────────────────────────────────────────────────────

export default function PosDetailPage(): React.ReactElement {
  const authed = useRequireAuth();
  const { key = "" } = useParams<{ key: string }>();
  const toast = useToast();
  const queryClient = useQueryClient();
  // Kredensiyel YAZMA (PUT /admin/secrets/:key) backend'de @Roles('OWNER') —
  // OWNER değilse yazma alanını hiç göstermiyoruz; maskeli okuma kalır.
  const isOwner = getCurrentPermissions().role === "OWNER";

  const [showTotal, setShowTotal] = useState(false);
  const [activating, setActivating] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [settings, setSettings] = useState<SettingsFormState>(EMPTY_SETTINGS);
  const [credValues, setCredValues] = useState<Record<CredField, string>>({
    merchantId: "",
    merchantKey: "",
    merchantSalt: "",
    clientId: "",
    apiUser: "",
    apiPass: "",
  });

  // PayTR rapor araçları state'leri
  const [statusOid, setStatusOid] = useState("");
  const [statusResult, setStatusResult] = useState<unknown>(null);
  const [toslaOid, setToslaOid] = useState("");
  const [toslaResult, setToslaResult] = useState<unknown>(null);
  const [testAmount, setTestAmount] = useState("1");
  const [testResult, setTestResult] = useState<PosTestPayment | null>(null);
  const [txStart, setTxStart] = useState("");
  const [txEnd, setTxEnd] = useState("");
  const [txResult, setTxResult] = useState<unknown>(null);
  const [payStart, setPayStart] = useState("");
  const [payEnd, setPayEnd] = useState("");
  const [payResult, setPayResult] = useState<unknown>(null);

  const detailQuery = useQuery<PosDetail>({
    queryKey: ["pos-detail", key],
    queryFn: () => fetchPosDetail(key),
    enabled: authed && key.length > 0,
  });

  const detail = detailQuery.data ?? null;
  const provider = detail?.provider ?? null;

  useDocumentTitle(provider ? `POS — ${provider.name}` : "POS Detayı");

  // Form, sağlayıcı verisi (yeniden) yüklendiğinde sunucu değerleriyle dolar.
  useEffect(() => {
    if (!provider) return;
    setSettings({
      commissionRate: provider.commissionRate ?? "",
      customerCommissionRate: provider.customerCommissionRate ?? "",
      valorDays: provider.valorDays === null ? "" : String(provider.valorDays),
      testMode: provider.testMode,
      noInstallment: provider.noInstallment,
      maxInstallment: String(provider.maxInstallment),
      description: provider.description ?? "",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider?.id, provider?.updatedAt]);

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ["pos-detail", key] });
    void queryClient.invalidateQueries({ queryKey: ["pos-providers"] });
  };

  const updateMutation = useMutation({
    mutationFn: (input: PosProviderUpdateInput) => updatePosProvider(key, input),
    onSuccess: () => {
      invalidate();
      toast.push("success", "Ayarlar kaydedildi");
    },
    onError: (err: unknown) => {
      toast.push("error", err instanceof Error ? err.message : "Ayarlar kaydedilemedi");
    },
  });

  const activateMutation = useMutation({
    mutationFn: () => activatePosProvider(key),
    onSuccess: (p) => {
      invalidate();
      setActivating(false);
      toast.push("success", `Aktif POS artık: ${p.name}`);
    },
    onError: (err: unknown) => {
      setActivating(false);
      toast.push("error", err instanceof Error ? err.message : "Sağlayıcı aktifleştirilemedi");
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: () => deactivatePosProvider(key),
    onSuccess: (p) => {
      invalidate();
      setDeactivating(false);
      toast.push("success", `Kartlı ödeme kapatıldı: ${p.name} devre dışı`);
    },
    onError: (err: unknown) => {
      setDeactivating(false);
      toast.push("error", err instanceof Error ? err.message : "Sağlayıcı devre dışı bırakılamadı");
    },
  });

  const secretMutation = useMutation({
    mutationFn: ({ secretKey, value }: { secretKey: string; field: CredField; value: string }) =>
      updateSecret(secretKey, value),
    onSuccess: (_data, variables) => {
      invalidate();
      setCredValues((prev) => ({ ...prev, [variables.field]: "" }));
      toast.push("success", "API bilgisi güncellendi");
    },
    onError: (err: unknown) => {
      toast.push("error", err instanceof Error ? err.message : "API bilgisi kaydedilemedi");
    },
  });

  const statusMutation = useMutation({
    mutationFn: (oid: string) => paytrStatusQuery(oid),
    onSuccess: (data) => setStatusResult(data),
    onError: (err: unknown) => {
      toast.push("error", err instanceof Error ? err.message : "Durum sorgusu başarısız");
    },
  });

  const toslaStatusMutation = useMutation({
    mutationFn: (oid: string) => toslaStatusQuery(oid),
    onSuccess: (data) => setToslaResult(data),
    onError: (err: unknown) => {
      toast.push("error", err instanceof Error ? err.message : "Durum sorgusu başarısız");
    },
  });

  const testPaymentMutation = useMutation({
    mutationFn: ({ key, amount }: { key: string; amount: number }) =>
      createPosTestPayment(key, amount),
    onSuccess: (data) => setTestResult(data),
    onError: (err: unknown) => {
      toast.push(
        "error",
        err instanceof Error ? err.message : "Test çekimi başlatılamadı",
      );
    },
  });

  const txReportMutation = useMutation({
    mutationFn: ({ start, end }: { start: string; end: string }) =>
      paytrTransactionReport(start, end),
    onSuccess: (data) => setTxResult(data),
    onError: (err: unknown) => {
      toast.push("error", err instanceof Error ? err.message : "İşlem dökümü alınamadı");
    },
  });

  const payReportMutation = useMutation({
    mutationFn: ({ start, end }: { start: string; end: string }) =>
      paytrPaymentReport(start, end),
    onSuccess: (data) => setPayResult(data),
    onError: (err: unknown) => {
      toast.push("error", err instanceof Error ? err.message : "Ödeme dökümü alınamadı");
    },
  });

  const handleSettingsSave = (e: React.FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    // "2,49" / "2.49" → 2.49 — boş bırakılırsa null (oran tanımsız).
    // Geçersiz değerde label ile hata basar, kaydetmeyi durdurur.
    const parseRate = (value: string, label: string): number | null | false => {
      const rateStr = value.trim().replace(",", ".");
      if (rateStr.length === 0) return null;
      const num = Number(rateStr);
      if (!Number.isFinite(num) || num < 0 || num > 100) {
        toast.push("error", `${label} 0 ile 100 arasında olmalı`);
        return false;
      }
      return Math.round(num * 100) / 100;
    };
    const commissionRate = parseRate(settings.commissionRate, "Gerçek kart komisyonu");
    if (commissionRate === false) return;
    const customerCommissionRate = parseRate(
      settings.customerCommissionRate,
      "Sitede uygulanan kart komisyonu",
    );
    if (customerCommissionRate === false) return;
    let valorDays: number | null = null;
    const valorStr = settings.valorDays.trim();
    if (valorStr.length > 0) {
      const num = Number(valorStr);
      if (!Number.isInteger(num) || num < 0 || num > 365) {
        toast.push("error", "Valör 0 ile 365 gün arasında tam sayı olmalı");
        return;
      }
      valorDays = num;
    }
    updateMutation.mutate({
      commissionRate,
      customerCommissionRate,
      valorDays,
      testMode: settings.testMode,
      noInstallment: settings.noInstallment,
      maxInstallment: Number(settings.maxInstallment),
      description: settings.description,
    });
  };

  const handleSecretSave = (field: CredField, secretKey: string): void => {
    const value = credValues[field].trim();
    if (value.length === 0) {
      toast.push("error", "Yeni değer boş olamaz");
      return;
    }
    secretMutation.mutate({ secretKey, field, value });
  };

  const handleStatusQuery = (e: React.FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const oid = statusOid.trim();
    if (oid.length < 2) {
      toast.push("error", "merchant_oid girin");
      return;
    }
    setStatusResult(null);
    statusMutation.mutate(oid);
  };

  const handleToslaStatusQuery = (e: React.FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const oid = toslaOid.trim();
    if (oid.length < 2) {
      toast.push("error", "merchantOid (sipariş referansı) girin");
      return;
    }
    setToslaResult(null);
    toslaStatusMutation.mutate(oid);
  };

  const handleTestPayment = (e: React.FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    if (!provider) return;
    const amount = Number(testAmount.replace(",", "."));
    if (!Number.isFinite(amount) || amount < 1 || amount > 1000) {
      toast.push("error", "Test tutarı 1–1000 TL arası olmalı");
      return;
    }
    setTestResult(null);
    testPaymentMutation.mutate({ key: provider.key, amount });
  };

  const handleTxReport = (e: React.FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    if (!txStart || !txEnd) {
      toast.push("error", "Başlangıç ve bitiş zamanı girin");
      return;
    }
    setTxResult(null);
    txReportMutation.mutate({
      start: toDateTimeParam(txStart),
      end: toDateTimeParam(txEnd),
    });
  };

  const handlePayReport = (e: React.FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    if (!payStart || !payEnd) {
      toast.push("error", "Başlangıç ve bitiş tarihi girin");
      return;
    }
    setPayResult(null);
    payReportMutation.mutate({ start: payStart, end: payEnd });
  };

  if (detailQuery.isLoading) {
    return <p className="text-sm text-slate-500">Yükleniyor…</p>;
  }

  if (detailQuery.isError || !detail || !provider) {
    return (
      <div className="space-y-3">
        <Link to="/pos" className="text-sm font-semibold text-blue-600 hover:underline">
          ← POS
        </Link>
        <p className="text-sm text-red-600">Sağlayıcı detayı yüklenemedi.</p>
      </div>
    );
  }

  const stats = detail.stats;
  const isPaytr = provider.key === "paytr";
  const isTosla = provider.key === "tosla";
  const credFields: CredDef[] = isPaytr
    ? PAYTR_CRED_FIELDS
    : isTosla
      ? TOSLA_CRED_FIELDS
      : [];
  const apiTitle = isPaytr ? "PayTR API Bilgileri" : "TOSLA API Bilgileri";
  const callbackPath = isPaytr
    ? "https://toptanbudur.com/api/payments/paytr/callback"
    : "https://toptanbudur.com/api/payments/tosla/callback";
  const inputClass =
    "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";
  const labelClass = "block text-sm font-medium text-slate-700 mb-1";
  const preClass =
    "mt-3 max-h-72 overflow-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100";

  return (
    <div className="space-y-6">
      {/* Başlık */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link to="/pos" className="text-sm font-semibold text-blue-600 hover:underline">
            ← POS
          </Link>
          <div className="mt-1 flex items-center gap-3">
            <h1 className="text-xl font-bold text-slate-900">{provider.name}</h1>
            {provider.active ? (
              <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                Aktif
              </span>
            ) : (
              <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-500">
                Pasif
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-slate-400">{provider.key}</p>
        </div>
        {!provider.active ? (
          <button
            type="button"
            onClick={() => setActivating(true)}
            className="rounded-lg border border-emerald-300 px-4 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-50"
          >
            Aktif Yap
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setDeactivating(true)}
            className="rounded-lg border border-amber-300 px-4 py-2 text-sm font-semibold text-amber-700 hover:bg-amber-50"
          >
            Devre Dışı Bırak
          </button>
        )}
      </div>

      {/* İstatistik kartları */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Toplam Çekim"
          value={
            showTotal ? (
              formatPosAmount(stats.totalAmount)
            ) : (
              <span className="text-slate-400 select-none">••••••</span>
            )
          }
          action={
            <button
              type="button"
              onClick={() => setShowTotal((v) => !v)}
              title={showTotal ? "Tutarı gizle" : "Tutarı göster"}
              aria-label={showTotal ? "Tutarı gizle" : "Tutarı göster"}
              className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              {showTotal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          }
        />
        <StatCard
          label="Bu Ay Çekim"
          value={formatPosAmount(stats.monthTotalAmount)}
          hint={`${stats.monthOrderCount} işlem`}
        />
        <StatCard label="İşlem Sayısı" value={stats.orderCount} />
        <StatCard label="Son İşlem" value={formatDate(stats.lastPaymentAt)} />
      </div>

      {/* Anlaşma ve işlem ayarları */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="text-base font-bold text-slate-900">Anlaşma ve İşlem Ayarları</h2>
        <form onSubmit={handleSettingsSave} className="mt-4 space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className={labelClass}>Gerçek Kart Komisyonu (%)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                max="100"
                value={settings.commissionRate}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, commissionRate: e.target.value }))
                }
                placeholder="örn: 2.49"
                className={inputClass}
              />
              <p className="mt-1 text-xs text-slate-400">
                POS’un bizden kestiği — kâr hesapları için.
              </p>
            </div>
            <div>
              <label className={labelClass}>Sitede Uygulanan Kart Komisyonu (%)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                max="100"
                value={settings.customerCommissionRate}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    customerCommissionRate: e.target.value,
                  }))
                }
                placeholder="örn: 3"
                className={inputClass}
              />
              <p className="mt-1 text-xs text-slate-400">
                Müşteriye yansıtılan — sepet ve kartla cari yükleme bununla
                hesaplanır.
              </p>
            </div>
            <div>
              <label className={labelClass}>Valör (gün)</label>
              <input
                type="number"
                step="1"
                min="0"
                max="365"
                value={settings.valorDays}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, valorDays: e.target.value }))
                }
                placeholder="örn: 1"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>En Fazla Taksit</label>
              <select
                value={settings.maxInstallment}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, maxInstallment: e.target.value }))
                }
                className={inputClass}
              >
                {MAX_INSTALLMENT_OPTIONS.map((n) => (
                  <option key={n} value={String(n)}>
                    {n === 0 ? "Varsayılan (yürürlükteki azami)" : `${n} taksit`}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-6">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={settings.testMode}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, testMode: e.target.checked }))
                }
                className="h-4 w-4 rounded border-slate-300"
              />
              Test Modu
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={settings.noInstallment}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, noInstallment: e.target.checked }))
                }
                className="h-4 w-4 rounded border-slate-300"
              />
              Taksit Kapalı
            </label>
          </div>
          <div>
            <label className={labelClass}>Açıklama / not</label>
            <textarea
              value={settings.description}
              onChange={(e) =>
                setSettings((s) => ({ ...s, description: e.target.value }))
              }
              rows={3}
              placeholder="örn: anlaşma tarihi, özel koşullar"
              className={inputClass}
            />
          </div>
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={updateMutation.isPending}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {updateMutation.isPending ? "Kaydediliyor…" : "Kaydet"}
            </button>
          </div>
        </form>
      </div>

      {/* Sağlayıcı API bilgileri (PayTR / TOSLA) */}
      {isPaytr || isTosla ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-base font-bold text-slate-900">{apiTitle}</h2>
          <p className="mt-1 text-sm text-slate-500">
            {isOwner
              ? "Değerler mühürlü saklanır, asla düz gösterilmez. Yeni değer girip kaydettiğinde eskisinin üzerine yazılır."
              : "Değerler mühürlü saklanır. Yalnızca işletme sahibi değiştirebilir."}
          </p>
          <div className="mt-4 space-y-4">
            {credFields.map(({ field, secretKey, label }) => {
              const masked = detail.credentials?.[field] ?? null;
              return (
                <div key={field}>
                  <label className={labelClass}>{label}</label>
                  <p className="mb-1.5 text-xs text-slate-400">
                    {masked ? `Tanımlı: ${masked}` : "Tanımlı değil"}
                  </p>
                  {isOwner ? (
                    <div className="flex gap-2">
                      <input
                        type="password"
                        autoComplete="off"
                        value={credValues[field]}
                        onChange={(e) =>
                          setCredValues((prev) => ({ ...prev, [field]: e.target.value }))
                        }
                        placeholder="Yeni değer"
                        className={inputClass}
                      />
                      <button
                        type="button"
                        disabled={secretMutation.isPending}
                        onClick={() => handleSecretSave(field, secretKey)}
                        className="shrink-0 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                      >
                        Kaydet
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
          <p className="mt-4 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
            Not: {isPaytr ? "PayTR" : "TOSLA"} üye işyeri panelinde Bildirim/Callback URL’nin{" "}
            <code className="font-mono">{callbackPath}</code>{" "}
            olarak tanımlanması gerekir; aksi halde ödeme onayları düşmez.
            {isTosla
              ? " TOSLA test ortamında doğrulayıp, sorun yoksa Test Modu’nu kapatıp üretim bilgilerini girin."
              : ""}
          </p>
        </div>
      ) : null}

      {/* Son ödemeler */}
      <div className="rounded-2xl border border-slate-200 bg-white">
        <div className="px-5 pt-5">
          <h2 className="text-base font-bold text-slate-900">Son Ödemeler</h2>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">Sipariş No</th>
                <th className="px-4 py-3">Müşteri</th>
                <th className="px-4 py-3">merchant_oid</th>
                <th className="px-4 py-3">Durum</th>
                <th className="px-4 py-3 text-right">Tutar</th>
                <th className="px-4 py-3">Test</th>
                <th className="px-4 py-3">Tarih</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {detail.recentTransactions.map((t) => (
                <tr key={t.id}>
                  <td className="px-4 py-3 font-semibold text-slate-900">
                    {t.order?.humanOrderNo ??
                      (t.topup?.humanTopupNo
                        ? `Cari: ${t.topup.humanTopupNo}`
                        : t.topup
                          ? "Cari Yükleme"
                          : "—")}
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {t.order?.customerName ?? t.topup?.customerName ?? "—"}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">
                    {t.merchantOid}
                  </td>
                  <td className="px-4 py-3">
                    {t.status === "success" ? (
                      <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                        Başarılı
                      </span>
                    ) : t.status === "failed" ? (
                      <span
                        title={t.failedReasonMsg ?? undefined}
                        className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700"
                      >
                        Başarısız
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-500">
                        {t.status || "—"}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-900">
                    {formatPosAmount(t.totalAmount ?? t.amount)}
                  </td>
                  <td className="px-4 py-3">
                    {t.testMode ? (
                      <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
                        Test
                      </span>
                    ) : (
                      <span className="text-xs text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-700">{formatDate(t.callbackAt)}</td>
                </tr>
              ))}
              {detail.recentTransactions.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-400">
                    Bu sağlayıcı üzerinden henüz işlem geçmedi.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {/* PayTR raporları */}
      {isPaytr ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-base font-bold text-slate-900">PayTR Raporları</h2>
          <p className="mt-1 text-sm text-slate-500">
            Veriler doğrudan PayTR’dan çekilir, yalnızca görüntülemedir.
          </p>

          <div className="mt-4 space-y-6">
            {/* Durum sorgu */}
            <div>
              <h3 className="text-sm font-semibold text-slate-800">Durum Sorgu</h3>
              <form onSubmit={handleStatusQuery} className="mt-2 flex flex-wrap gap-2">
                <input
                  type="text"
                  value={statusOid}
                  onChange={(e) => setStatusOid(e.target.value)}
                  placeholder="merchant_oid"
                  className={`${inputClass} max-w-xs`}
                />
                <button
                  type="submit"
                  disabled={statusMutation.isPending}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {statusMutation.isPending ? "Sorgulanıyor…" : "Sorgula"}
                </button>
              </form>
              {statusResult !== null ? (
                <pre className={preClass}>{JSON.stringify(statusResult, null, 2)}</pre>
              ) : null}
            </div>

            {/* İşlem dökümü */}
            <div>
              <h3 className="text-sm font-semibold text-slate-800">İşlem Dökümü</h3>
              <p className="mt-0.5 text-xs text-slate-400">
                PayTR en fazla 3 günlük aralık kabul eder.
              </p>
              <form onSubmit={handleTxReport} className="mt-2 flex flex-wrap items-end gap-2">
                <div>
                  <label className={labelClass}>Başlangıç</label>
                  <input
                    type="datetime-local"
                    value={txStart}
                    onChange={(e) => setTxStart(e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Bitiş</label>
                  <input
                    type="datetime-local"
                    value={txEnd}
                    onChange={(e) => setTxEnd(e.target.value)}
                    className={inputClass}
                  />
                </div>
                <button
                  type="submit"
                  disabled={txReportMutation.isPending}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {txReportMutation.isPending ? "Alınıyor…" : "Dökümü Al"}
                </button>
              </form>
              {txResult !== null ? (
                <pre className={preClass}>{JSON.stringify(txResult, null, 2)}</pre>
              ) : null}
            </div>

            {/* Ödeme dökümü */}
            <div>
              <h3 className="text-sm font-semibold text-slate-800">Ödeme Dökümü</h3>
              <p className="mt-0.5 text-xs text-slate-400">
                Hesaba geçen/geçecek tutarlar (valör takibi) — en fazla 31 günlük aralık.
              </p>
              <form onSubmit={handlePayReport} className="mt-2 flex flex-wrap items-end gap-2">
                <div>
                  <label className={labelClass}>Başlangıç</label>
                  <input
                    type="date"
                    value={payStart}
                    onChange={(e) => setPayStart(e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Bitiş</label>
                  <input
                    type="date"
                    value={payEnd}
                    onChange={(e) => setPayEnd(e.target.value)}
                    className={inputClass}
                  />
                </div>
                <button
                  type="submit"
                  disabled={payReportMutation.isPending}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {payReportMutation.isPending ? "Alınıyor…" : "Dökümü Al"}
                </button>
              </form>
              {payResult !== null ? (
                <pre className={preClass}>{JSON.stringify(payResult, null, 2)}</pre>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {/* TOSLA araçları — yalnızca Durum Sorgu (salt-okuma). İade/iptal YOK:
          iade her zaman cari bakiyeye yapılır, karta değil. */}
      {isTosla ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-base font-bold text-slate-900">TOSLA Araçları</h2>
          <p className="mt-1 text-sm text-slate-500">
            Durum Sorgu, işlemi doğrudan TOSLA’dan çeker (salt-okuma). Para
            çekilmiş ama onay düşmemiş işlemleri (mutabakat) doğrulamak için
            kullanın. İade/iptal yoktur — iade her zaman cari bakiyeye yapılır.
          </p>

          <div className="mt-4">
            <h3 className="text-sm font-semibold text-slate-800">Durum Sorgu</h3>
            <p className="mt-0.5 text-xs text-slate-400">
              merchantOid = siparişin TOSLA referansı (örn. AB61000123T1).
            </p>
            <form onSubmit={handleToslaStatusQuery} className="mt-2 flex flex-wrap gap-2">
              <input
                type="text"
                value={toslaOid}
                onChange={(e) => setToslaOid(e.target.value)}
                placeholder="merchantOid"
                className={`${inputClass} max-w-xs`}
              />
              <button
                type="submit"
                disabled={toslaStatusMutation.isPending}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {toslaStatusMutation.isPending ? "Sorgulanıyor…" : "Sorgula"}
              </button>
            </form>
            {toslaResult !== null ? (
              <pre className={preClass}>{JSON.stringify(toslaResult, null, 2)}</pre>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Test Çekimi — müşterinin gördüğü ödeme ekranının aynısı, gerçek
          sipariş/işlem yaratmadan. Her kart sağlayıcısının detayında bulunur. */}
      {isPaytr || isTosla ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-base font-bold text-slate-900">Test Çekimi</h2>
          <p className="mt-1 text-sm text-slate-500">
            Müşterinin gördüğü ödeme ekranının <strong>aynısını</strong> açar —
            gerçek sipariş oluşturmadan, müşteri akışına dokunmadan. Aşağıdaki
            ekran birebir müşterinin gördüğüdür.
          </p>
          <form onSubmit={handleTestPayment} className="mt-3 flex flex-wrap items-end gap-2">
            <div>
              <label className={labelClass}>Tutar (TL)</label>
              <input
                type="number"
                min={1}
                max={1000}
                step="1"
                value={testAmount}
                onChange={(e) => setTestAmount(e.target.value)}
                className={`${inputClass} max-w-[8rem]`}
              />
            </div>
            <button
              type="submit"
              disabled={testPaymentMutation.isPending}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {testPaymentMutation.isPending ? "Hazırlanıyor…" : "Test Çekimi Yap"}
            </button>
          </form>
          {provider.testMode ? (
            <p className="mt-2 text-xs text-slate-400">
              Sağlayıcı TEST modunda — sanal karttır, gerçek para çekilmez.
            </p>
          ) : (
            <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Uyarı: Sağlayıcı <strong>CANLI</strong> modda. Bu test GERÇEK bir
              tahsilattır; girdiğiniz karttan tutar kadar çekilir. Küçük tutun
              (örn. 1 TL); gerekirse sağlayıcı panelinden iade edin.
            </p>
          )}
          {testResult ? (
            <div className="mt-3">
              <p className="mb-2 text-xs text-slate-500">
                merchantOid:{" "}
                <code className="font-mono">{testResult.merchantOid}</code> ·{" "}
                {testResult.amount} TL · {testResult.testMode ? "TEST" : "CANLI"}
              </p>
              <div className="overflow-hidden rounded-lg border border-slate-200">
                <iframe
                  src={testResult.iframeUrl}
                  title="POS test ödeme ekranı"
                  className="w-full"
                  style={{ height: 640, border: "none" }}
                />
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {activating ? (
        <ConfirmDialog
          title="Aktif POS değiştir"
          message={`"${provider.name}" aktif POS yapılacak. Bundan sonraki tüm kartlı tahsilatlar bu sağlayıcı üzerinden çekilir. Devam edilsin mi?`}
          confirmLabel="Aktif Yap"
          onCancel={() => setActivating(false)}
          onConfirm={() => activateMutation.mutate()}
        />
      ) : null}

      {deactivating ? (
        <ConfirmDialog
          title="Kartlı ödemeyi kapat"
          message={`"${provider.name}" devre dışı bırakılacak. Sitede kartlı ödeme tamamen kapanır (sepet ve bakiyem'de kart seçeneği "DEVRE DIŞI" görünür, kart siparişi alınmaz). Cari bakiyeyle ödeme etkilenmez. Tekrar "Aktif Yap" ile açabilirsin. Devam edilsin mi?`}
          confirmLabel="Devre Dışı Bırak"
          onCancel={() => setDeactivating(false)}
          onConfirm={() => deactivateMutation.mutate()}
        />
      ) : null}
    </div>
  );
}

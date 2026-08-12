import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff } from "lucide-react";
import { useRequireAuth } from "../lib/auth";
import {
  activatePosProvider,
  deactivatePosProvider,
  createPosProvider,
  deletePosProvider,
  fetchPosProviders,
  formatCommission,
  formatPosAmount,
  formatValor,
  type PosProvider,
  type PosProviderInput,
} from "../lib/pos";
import { useToast } from "../components/Toast";
import ConfirmDialog from "../components/ConfirmDialog";
import { useDocumentTitle } from "../lib/useDocumentTitle";

interface PosFormState {
  key: string;
  name: string;
  description: string;
}

const EMPTY_FORM: PosFormState = { key: "", name: "", description: "" };

function validateForm(form: PosFormState): string | null {
  if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(form.key.trim().toLowerCase())) {
    return "Key küçük harf/rakam/tire olmalı (2-40 karakter), örn: paytr";
  }
  if (form.name.trim().length < 2) return "Sağlayıcı adı gerekli";
  return null;
}

interface PosFormProps {
  busy: boolean;
  onSubmit: (payload: PosProviderInput) => void;
  onCancel: () => void;
}

function PosForm({ busy, onSubmit, onCancel }: PosFormProps): React.ReactElement {
  const [form, setForm] = useState<PosFormState>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const validation = validateForm(form);
    if (validation) {
      setError(validation);
      return;
    }
    setError(null);
    onSubmit({
      key: form.key.trim().toLowerCase(),
      name: form.name.trim(),
      description: form.description.trim() || undefined,
    });
  };

  return (
    <div
      className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center p-4"
      onClick={() => {
        if (!busy) onCancel();
      }}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold text-slate-900 mb-4">Yeni POS sağlayıcı</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Key (makine adı)
            </label>
            <input
              type="text"
              value={form.key}
              onChange={(e) => setForm((f) => ({ ...f, key: e.target.value }))}
              placeholder="örn: garanti-bbva, param"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Sağlayıcı adı
            </label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="örn: Garanti BBVA"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Açıklama / not (opsiyonel)
            </label>
            <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="örn: komisyon oranı, anlaşma tarihi"
              rows={3}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              disabled={busy}
              onClick={onCancel}
              className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50"
            >
              Vazgeç
            </button>
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {busy ? "Kaydediliyor…" : "Ekle"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("tr-TR", { dateStyle: "medium", timeStyle: "short" });
}

export default function PosPage(): React.ReactElement {
  const authed = useRequireAuth();
  useDocumentTitle("POS Yönetimi");
  const toast = useToast();
  const queryClient = useQueryClient();

  const [showForm, setShowForm] = useState(false);
  const [showAmounts, setShowAmounts] = useState(false);
  const [activating, setActivating] = useState<PosProvider | null>(null);
  const [deactivating, setDeactivating] = useState<PosProvider | null>(null);
  const [deleting, setDeleting] = useState<PosProvider | null>(null);

  const providersQuery = useQuery<PosProvider[]>({
    queryKey: ["pos-providers"],
    queryFn: fetchPosProviders,
    enabled: authed,
  });

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ["pos-providers"] });
  };

  const createMutation = useMutation({
    mutationFn: createPosProvider,
    onSuccess: () => {
      invalidate();
      setShowForm(false);
      toast.push("success", "POS sağlayıcı eklendi");
    },
    onError: (err: unknown) => {
      toast.push("error", err instanceof Error ? err.message : "Sağlayıcı eklenemedi");
    },
  });

  const activateMutation = useMutation({
    mutationFn: activatePosProvider,
    onSuccess: (provider) => {
      invalidate();
      setActivating(null);
      toast.push("success", `Aktif POS artık: ${provider.name}`);
    },
    onError: (err: unknown) => {
      setActivating(null);
      toast.push("error", err instanceof Error ? err.message : "Sağlayıcı aktifleştirilemedi");
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: deactivatePosProvider,
    onSuccess: (provider) => {
      invalidate();
      setDeactivating(null);
      toast.push("success", `Kartlı ödeme kapatıldı: ${provider.name} devre dışı`);
    },
    onError: (err: unknown) => {
      setDeactivating(null);
      toast.push("error", err instanceof Error ? err.message : "Sağlayıcı devre dışı bırakılamadı");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deletePosProvider,
    onSuccess: () => {
      invalidate();
      setDeleting(null);
      toast.push("success", "POS sağlayıcı silindi");
    },
    onError: (err: unknown) => {
      setDeleting(null);
      toast.push("error", err instanceof Error ? err.message : "Sağlayıcı silinemedi");
    },
  });

  const providers = providersQuery.data ?? [];
  const activeProvider = providers.find((p) => p.active) ?? null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">POS Yönetimi</h1>
          <p className="text-sm text-slate-500 mt-1">
            Kartlı tahsilatın hangi sanal POS üzerinden çekileceğini buradan seçersin.
            Müşteri tarafında sağlayıcı adı görünmez — yalnızca kart logoları gösterilir.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
        >
          + Yeni Sağlayıcı
        </button>
      </div>

      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">
          Aktif POS
        </p>
        <p className="mt-1 text-lg font-bold text-emerald-900">
          {activeProvider ? activeProvider.name : "Seçili sağlayıcı yok"}
        </p>
        {activeProvider?.description ? (
          <p className="mt-0.5 text-sm text-emerald-800">{activeProvider.description}</p>
        ) : null}
      </div>

      {providersQuery.isLoading ? (
        <p className="text-sm text-slate-500">Yükleniyor…</p>
      ) : providersQuery.isError ? (
        <p className="text-sm text-red-600">Sağlayıcılar yüklenemedi.</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">Sağlayıcı</th>
                <th className="px-4 py-3">Durum</th>
                <th className="px-4 py-3 text-right">
                  <span title="Gerçek (POS kesintisi) / Sitede uygulanan">
                    Komisyon (Gerçek / Site)
                  </span>
                </th>
                <th className="px-4 py-3 text-right">Valör</th>
                <th className="px-4 py-3 text-right">
                  <span className="inline-flex items-center gap-1.5">
                    Toplam Çekim
                    <button
                      type="button"
                      onClick={() => setShowAmounts((v) => !v)}
                      title={showAmounts ? "Tutarları gizle" : "Tutarları göster"}
                      aria-label={showAmounts ? "Tutarları gizle" : "Tutarları göster"}
                      className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                    >
                      {showAmounts ? (
                        <EyeOff className="h-3.5 w-3.5" />
                      ) : (
                        <Eye className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </span>
                </th>
                <th className="px-4 py-3 text-right">İşlem Sayısı</th>
                <th className="px-4 py-3">Son İşlem</th>
                <th className="px-4 py-3 text-right">Aksiyon</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {providers.map((p) => (
                <tr key={p.id} className={p.active ? "bg-emerald-50/40" : undefined}>
                  <td className="px-4 py-3">
                    <Link
                      to={`/pos/${encodeURIComponent(p.key)}`}
                      className="font-semibold text-slate-900 hover:text-blue-700 hover:underline"
                    >
                      {p.name}
                    </Link>
                    <div className="text-xs text-slate-400">
                      {p.key}
                      {p.description ? ` · ${p.description}` : ""}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {p.active ? (
                      <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                        Aktif
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-500">
                        Pasif
                      </span>
                    )}
                  </td>
                  <td
                    className="px-4 py-3 text-right text-slate-700"
                    title="Gerçek (POS kesintisi) / Sitede uygulanan"
                  >
                    {formatCommission(p.commissionRate)}
                    {" / "}
                    {formatCommission(p.customerCommissionRate)}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-700">
                    {formatValor(p.valorDays)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {showAmounts ? (
                      <span className="font-semibold text-slate-900">
                        {formatPosAmount(p.stats.totalAmount)}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400 select-none">••••••</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-700">
                    {p.stats.orderCount}
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {formatDate(p.stats.lastPaymentAt)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      <Link
                        to={`/pos/${encodeURIComponent(p.key)}`}
                        className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        Detay
                      </Link>
                      {!p.active ? (
                        <button
                          type="button"
                          onClick={() => setActivating(p)}
                          className="rounded-lg border border-emerald-300 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50"
                        >
                          Aktif Yap
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setDeactivating(p)}
                          className="rounded-lg border border-amber-300 px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-50"
                        >
                          Devre Dışı Bırak
                        </button>
                      )}
                      {!p.active ? (
                        <button
                          type="button"
                          onClick={() => setDeleting(p)}
                          className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50"
                        >
                          Sil
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
              {providers.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-sm text-slate-400">
                    Kayıtlı POS sağlayıcı yok. &quot;Yeni Sağlayıcı&quot; ile ekleyin.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-slate-400">
        Not: Çekim istatistikleri kartla ödenen siparişlerden hesaplanır. Entegrasyon
        tamamlanıp ilk kartlı tahsilat alındığında bu tablo dolmaya başlar.
      </p>

      {showForm ? (
        <PosForm
          busy={createMutation.isPending}
          onSubmit={(payload) => createMutation.mutate(payload)}
          onCancel={() => setShowForm(false)}
        />
      ) : null}

      {activating ? (
        <ConfirmDialog
          title="Aktif POS değiştir"
          message={`"${activating.name}" aktif POS yapılacak. Bundan sonraki tüm kartlı tahsilatlar bu sağlayıcı üzerinden çekilir. Devam edilsin mi?`}
          confirmLabel="Aktif Yap"
          onCancel={() => setActivating(null)}
          onConfirm={() => activateMutation.mutate(activating.key)}
        />
      ) : null}

      {deactivating ? (
        <ConfirmDialog
          title="Kartlı ödemeyi kapat"
          message={`"${deactivating.name}" devre dışı bırakılacak. Sitede kartlı ödeme tamamen kapanır (sepet ve bakiyem'de kart seçeneği "DEVRE DIŞI" görünür, kart siparişi alınmaz). Cari bakiyeyle ödeme etkilenmez. Tekrar "Aktif Yap" ile açabilirsin. Devam edilsin mi?`}
          confirmLabel="Devre Dışı Bırak"
          onCancel={() => setDeactivating(null)}
          onConfirm={() => deactivateMutation.mutate(deactivating.key)}
        />
      ) : null}

      {deleting ? (
        <ConfirmDialog
          title="POS sağlayıcıyı sil"
          message={`"${deleting.name}" silinecek. Geçmiş sipariş kayıtları etkilenmez. Devam edilsin mi?`}
          confirmLabel="Sil"
          destructive
          onCancel={() => setDeleting(null)}
          onConfirm={() => deleteMutation.mutate(deleting.key)}
        />
      ) : null}
    </div>
  );
}

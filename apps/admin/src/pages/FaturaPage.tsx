import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRequireAuth } from "../lib/auth";
import {
  clearSecret,
  listSecrets,
  updateSecret,
  type SecretSummary,
} from "../lib/secrets";
import { useToast } from "../components/Toast";
import ConfirmDialog from "../components/ConfirmDialog";
import { useDocumentTitle } from "../lib/useDocumentTitle";
import InvoiceSettingsCard from "../components/invoices/InvoiceSettingsCard";
import InvoiceConsolidationPanel from "../components/invoices/InvoiceConsolidationPanel";

const BIRFATURA_KEY = "birfatura.apiToken";

/**
 * BirFatura özel entegrasyonunun gerçek 5 endpoint'i (birfatura.md §6).
 * Tümü POST — resmi BirFatura swagger'ına birebir uyumlu; her istek `token`
 * header'ı ile doğrulanır (BirfaturaTokenGuard). Bkz.
 * apps/backend/src/birfatura/birfatura.controller.ts
 */
const BIRFATURA_ENDPOINTS: ReadonlyArray<{ method: string; path: string; desc: string }> = [
  {
    method: "POST",
    path: "/api/orderStatus/",
    desc: "Sipariş durum sözlüğü — BirFatura statü eşlemesi (sabit)",
  },
  {
    method: "POST",
    path: "/api/paymentMethods/",
    desc: "Ödeme tipleri — Kredi Kartı (1), Cari Bakiye (2)",
  },
  {
    method: "POST",
    path: "/api/orders/",
    desc: "Konsolide siparişleri çekme — dondurulmuş kesimler (push kapalıyken boş döner)",
  },
  {
    method: "POST",
    path: "/api/orderCargoUpdate/",
    desc: "Kargo bilgisi güncelleme — konsolide batch'te no-op (denetim kaydı)",
  },
  {
    method: "POST",
    path: "/api/invoiceLinkUpdate/",
    desc: "Fatura linki/no yazımı — batch faturalanır, üye siparişlere yayılır",
  },
];

function formatDate(value: string | null): string {
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

export default function FaturaPage(): React.ReactElement | null {
  useDocumentTitle("Fatura");
  const authed = useRequireAuth();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [tokenInput, setTokenInput] = useState("");
  const [showInput, setShowInput] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const secretsQuery = useQuery<SecretSummary[]>({
    queryKey: ["admin-secrets"],
    queryFn: listSecrets,
    enabled: authed,
  });

  const birfatura: SecretSummary | undefined = secretsQuery.data?.find(
    (s) => s.key === BIRFATURA_KEY,
  );

  const updateMutation = useMutation({
    mutationFn: (value: string) => updateSecret(BIRFATURA_KEY, value),
    onSuccess: () => {
      toast.push("success", "BirFatura token kaydedildi. Hem DB hem .env güncellendi.");
      setTokenInput("");
      setShowInput(false);
      void queryClient.invalidateQueries({ queryKey: ["admin-secrets"] });
    },
    onError: (err: unknown) => {
      toast.push("error", err instanceof Error ? err.message : "Token kaydedilemedi");
    },
  });

  const clearMutation = useMutation({
    mutationFn: () => clearSecret(BIRFATURA_KEY),
    onSuccess: () => {
      toast.push("success", "BirFatura token kaldırıldı.");
      setConfirmClear(false);
      void queryClient.invalidateQueries({ queryKey: ["admin-secrets"] });
    },
    onError: (err: unknown) => {
      toast.push("error", err instanceof Error ? err.message : "Token kaldırılamadı");
      setConfirmClear(false);
    },
  });

  useEffect(() => {
    if (!birfatura?.configured) {
      setShowInput(true);
    }
  }, [birfatura?.configured]);

  if (!authed) return null;

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const value = tokenInput.trim();
    if (value.length < 8) {
      toast.push("error", "Token en az 8 karakter olmalı");
      return;
    }
    updateMutation.mutate(value);
  };

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--color-text)]">
            Fatura Entegrasyonu
          </h1>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            Aylık konsolide e-faturalar: her bayi (+ ödeme tipi) için kesim
            gününde tek fatura dondurulur, BirFatura panelinden çekilip kesilir.
            Aşağıdan kesimleri yönet, kuralları ayarla ve BirFatura bağlantısını
            yapılandır.
          </p>
        </div>
      </header>

      {/* Birincil yüzey: konsolide kesim yönetimi (kendi sorgularıyla) */}
      <InvoiceConsolidationPanel />

      {/* Kesim kuralları: cutoffDay, packagingUnitFee, anahtarlar */}
      <InvoiceSettingsCard />

      {secretsQuery.isLoading ? (
        <p className="text-sm text-[var(--color-text-muted)]">Yükleniyor…</p>
      ) : secretsQuery.isError ? (
        <p className="text-sm text-red-600">
          {secretsQuery.error instanceof Error
            ? secretsQuery.error.message
            : "Token bilgisi yüklenemedi"}
        </p>
      ) : (
        <>
          <div className="pt-2">
            <h2 className="text-base font-semibold text-[var(--color-text)]">
              BirFatura Bağlantısı
            </h2>
            <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
              API token AES-256-GCM ile mühürlenip veritabanına yazılır ve aynı
              anda{" "}
              <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">
                apps/backend/.env
              </code>{" "}
              içindeki{" "}
              <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">
                BIRFATURA_API_TOKEN
              </code>{" "}
              güncellenir.
            </p>
          </div>

          <StatusCard
            secret={birfatura ?? null}
            onEdit={() => setShowInput(true)}
            onClear={() => setConfirmClear(true)}
            clearBusy={clearMutation.isPending}
          />

          {showInput ? (
            <section className="rounded-2xl border border-[var(--color-border)] bg-white p-6 shadow-sm">
              <header className="mb-4">
                <h2 className="text-lg font-semibold text-[var(--color-text)]">
                  {birfatura?.configured ? "Token Güncelle" : "Token Ekle"}
                </h2>
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                  BirFatura panelinde <strong>Ayarlar &gt; API Bilgileri &gt; API Şifresi</strong>{" "}
                  alanından kopyaladığın değeri buraya yapıştır.
                </p>
              </header>
              <form onSubmit={handleSubmit} className="space-y-4">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">
                    API Şifresi (Token)
                  </span>
                  <input
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={tokenInput}
                    onChange={(e) => setTokenInput(e.target.value)}
                    placeholder="ör. 5f3c8b2a-9e4d-4c7a-b1e2-..."
                    className="w-full rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 font-mono text-sm focus:border-[var(--color-brand-blue)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-blue)]/20"
                    disabled={updateMutation.isPending}
                  />
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="submit"
                    disabled={updateMutation.isPending || tokenInput.trim().length === 0}
                    className="rounded-lg bg-[var(--color-brand-blue)] px-4 py-2 text-sm font-medium text-white transition hover:bg-[var(--color-brand-navy)] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {updateMutation.isPending ? "Kaydediliyor…" : "Token'ı Kaydet"}
                  </button>
                  {birfatura?.configured ? (
                    <button
                      type="button"
                      onClick={() => {
                        setShowInput(false);
                        setTokenInput("");
                      }}
                      className="rounded-lg border border-[var(--color-border)] bg-white px-4 py-2 text-sm font-medium text-[var(--color-text)] transition hover:bg-slate-50"
                      disabled={updateMutation.isPending}
                    >
                      İptal
                    </button>
                  ) : null}
                </div>
                <p className="text-xs text-[var(--color-text-muted)]">
                  Token kaydedildikten sonra aşağıdaki BirFatura endpoint'leri
                  otomatik olarak yetkilendirilir. Yeniden başlatmaya gerek
                  yoktur — değişiklik anında etkinleşir.
                </p>
              </form>
            </section>
          ) : null}

          <EndpointsCard configured={birfatura?.configured ?? false} />

          <HelpCard />
        </>
      )}

      {confirmClear ? (
        <ConfirmDialog
          title="Token'ı kaldır"
          message="BirFatura entegrasyonu devre dışı kalacak. Devam etmek istiyor musun?"
          confirmLabel={clearMutation.isPending ? "Kaldırılıyor…" : "Evet, kaldır"}
          cancelLabel="Vazgeç"
          destructive
          onConfirm={() => clearMutation.mutate()}
          onCancel={() => setConfirmClear(false)}
        />
      ) : null}
    </div>
  );
}

function StatusCard({
  secret,
  onEdit,
  onClear,
  clearBusy,
}: {
  secret: SecretSummary | null;
  onEdit: () => void;
  onClear: () => void;
  clearBusy: boolean;
}): React.ReactElement {
  const configured = secret?.configured ?? false;

  return (
    <section className="rounded-2xl border border-[var(--color-border)] bg-gradient-to-br from-white to-slate-50 p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <div
            className={`flex h-12 w-12 items-center justify-center rounded-xl ${
              configured
                ? "bg-emerald-50 text-emerald-600"
                : "bg-amber-50 text-amber-600"
            }`}
          >
            {configured ? (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            ) : (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-[var(--color-text)]">
                BirFatura API Token
              </h2>
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                  configured
                    ? "bg-emerald-100 text-emerald-700"
                    : "bg-amber-100 text-amber-700"
                }`}
              >
                {configured ? "Yapılandırıldı" : "Yapılandırılmadı"}
              </span>
            </div>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              {secret?.description ??
                "BirFatura panelindeki API şifresi. AES-256-GCM ile mühürlü."}
            </p>
          </div>
        </div>
        {configured ? (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onEdit}
              className="rounded-lg border border-[var(--color-border)] bg-white px-3 py-1.5 text-sm font-medium text-[var(--color-text)] transition hover:bg-slate-50"
            >
              Değiştir
            </button>
            <button
              type="button"
              onClick={onClear}
              disabled={clearBusy}
              className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {clearBusy ? "Kaldırılıyor…" : "Kaldır"}
            </button>
          </div>
        ) : null}
      </div>

      <dl className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-[var(--color-border)] bg-white p-3">
          <dt className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
            Mevcut Değer
          </dt>
          <dd className="mt-1 font-mono text-sm text-[var(--color-text)]">
            {secret?.masked ?? "—"}
          </dd>
        </div>
        <div className="rounded-lg border border-[var(--color-border)] bg-white p-3">
          <dt className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
            Son Güncelleme
          </dt>
          <dd className="mt-1 text-sm text-[var(--color-text)]">
            {formatDate(secret?.updatedAt ?? null)}
          </dd>
        </div>
        <div className="rounded-lg border border-[var(--color-border)] bg-white p-3">
          <dt className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
            .env Anahtarı
          </dt>
          <dd className="mt-1 font-mono text-xs text-[var(--color-text)]">
            {secret?.envKey ?? "BIRFATURA_API_TOKEN"}
          </dd>
        </div>
      </dl>
    </section>
  );
}

function EndpointsCard({ configured }: { configured: boolean }): React.ReactElement {
  return (
    <section className="rounded-2xl border border-[var(--color-border)] bg-white p-6 shadow-sm">
      <header className="mb-4">
        <h2 className="text-lg font-semibold text-[var(--color-text)]">
          Etkinleştirilen Endpoint'ler
        </h2>
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">
          Token yapılandırıldığında BirFatura panelinin aşağıdaki endpoint'lere
          erişimi açılır. Her istek
          <code className="mx-1 rounded bg-slate-100 px-1 py-0.5 text-xs">token</code>
          header'ı ile doğrulanır.
        </p>
      </header>
      <ul className="divide-y divide-[var(--color-border)]">
        {BIRFATURA_ENDPOINTS.map((ep) => (
          <li
            key={`${ep.method}-${ep.path}`}
            className="flex flex-wrap items-center gap-3 py-3"
          >
            <span
              className={`inline-flex h-6 min-w-[3rem] items-center justify-center rounded px-2 font-mono text-xs font-semibold ${
                ep.method === "GET"
                  ? "bg-sky-100 text-sky-700"
                  : "bg-emerald-100 text-emerald-700"
              }`}
            >
              {ep.method}
            </span>
            <code className="font-mono text-sm text-[var(--color-text)]">
              {ep.path}
            </code>
            <span className="text-xs text-[var(--color-text-muted)]">
              {ep.desc}
            </span>
            <span
              className={`ml-auto inline-flex items-center gap-1 text-xs font-medium ${
                configured ? "text-emerald-600" : "text-slate-400"
              }`}
            >
              <span
                className={`inline-block h-2 w-2 rounded-full ${
                  configured ? "bg-emerald-500" : "bg-slate-300"
                }`}
              />
              {configured ? "Aktif" : "Pasif"}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function HelpCard(): React.ReactElement {
  return (
    <section className="rounded-2xl border border-sky-200 bg-sky-50 p-6">
      <header className="mb-3 flex items-start gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-100 text-sky-700">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4M12 8h.01" />
          </svg>
        </div>
        <div>
          <h2 className="text-sm font-semibold text-sky-900">
            Token'ı nereden alırım?
          </h2>
        </div>
      </header>
      <ol className="ml-4 list-decimal space-y-1 text-sm text-sky-900">
        <li>
          <a
            href="https://panel.birfatura.com"
            target="_blank"
            rel="noreferrer"
            className="font-medium underline hover:no-underline"
          >
            panel.birfatura.com
          </a>{" "}
          adresine giriş yap.
        </li>
        <li>
          Sol menüden <strong>Ayarlar &gt; API Bilgileri</strong> sayfasını aç.
        </li>
        <li>
          <strong>API Şifresi</strong> alanındaki GUID'i kopyala (yoksa
          "Yeni Şifre Oluştur"a tıkla).
        </li>
        <li>Bu sayfadaki alana yapıştır ve "Kaydet" butonuna bas.</li>
      </ol>
      <p className="mt-3 text-xs text-sky-800">
        Token kaydedildiğinde sistem hem veritabanına şifreli olarak yazar hem
        de <code className="rounded bg-sky-100 px-1">.env</code> dosyasındaki
        değeri günceller. Yeniden başlatma gerekmez — değişiklik anında
        etkinleşir.
      </p>
    </section>
  );
}

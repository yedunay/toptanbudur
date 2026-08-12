import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRequireAuth } from "../lib/auth";
import {
  DEALER_STATUS_LABELS,
  approveDealerApplication,
  fetchDealerApplications,
  preRegisterDealerApplication,
  rejectDealerApplication,
  type ApproveDealerApplicationResult,
  type DealerApplication,
  type DealerApplicationStatus,
  type DealerApplicationsResponse,
  type PreRegisterDealerApplicationResult,
} from "../lib/dealerApplications";
import { formatDateTime } from "../lib/orders";
import { useToast } from "../components/Toast";
import ConfirmDialog from "../components/ConfirmDialog";
import DealerApprovalModal from "../components/DealerApprovalModal";
import { useDocumentTitle } from "../lib/useDocumentTitle";
import { cleanNote } from "../lib/notes";

function statusColor(status: DealerApplicationStatus): string {
  switch (status) {
    case "approved":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "rejected":
      return "bg-red-50 text-red-700 border-red-200";
    case "pre_registered":
      return "bg-blue-50 text-blue-700 border-blue-200";
    default:
      return "bg-amber-50 text-amber-700 border-amber-200";
  }
}

function dash(value?: string | null): string {
  const v = value?.trim();
  return v && v.length > 0 ? v : "—";
}

function DetailField({
  label,
  value,
  fullWidth = false,
}: {
  label: string;
  value?: React.ReactNode;
  fullWidth?: boolean;
}): React.ReactElement {
  return (
    <div
      className={`rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2 ${
        fullWidth ? "sm:col-span-2" : ""
      }`}
    >
      <div className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
        {label}
      </div>
      <div className="mt-1 text-sm text-[var(--color-text)] break-words whitespace-pre-wrap">
        {value}
      </div>
    </div>
  );
}

export default function DealerApplicationsPage(): React.ReactElement | null {
  useDocumentTitle("Bayi Başvuruları (eski)");
  const authed = useRequireAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [statusFilter, setStatusFilter] = useState<DealerApplicationStatus | "">("");
  const [confirmReject, setConfirmReject] = useState<DealerApplication | null>(null);
  const [detailApp, setDetailApp] = useState<DealerApplication | null>(null);
  const [approvalResult, setApprovalResult] =
    useState<ApproveDealerApplicationResult | null>(null);
  const [preRegisterResult, setPreRegisterResult] =
    useState<PreRegisterDealerApplicationResult | null>(null);

  const applicationsQuery = useQuery<DealerApplicationsResponse>({
    queryKey: ["dealer-applications", statusFilter],
    queryFn: () => fetchDealerApplications(statusFilter || undefined),
    enabled: authed,
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => approveDealerApplication(id),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["dealer-applications"] });
      void queryClient.invalidateQueries({ queryKey: ["customers"] });
      // Tek kullanımlık parolayı modal ile göster — toast yetersiz kalır.
      setApprovalResult(result);
      if (!result.oneTimePassword && !result.alreadyApproved) {
        // Beklenmeyen durum: ilk onay olduğu halde parola dönmedi.
        toast.push(
          "info",
          "Onay tamamlandı ancak geçici parola dönmedi. Lütfen logları kontrol edin.",
        );
      }
    },
    onError: (err) => {
      toast.push("error", err instanceof Error ? err.message : "Onaylama başarısız");
    },
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) => rejectDealerApplication(id),
    onSuccess: () => {
      toast.push("success", "Başvuru reddedildi");
      void queryClient.invalidateQueries({ queryKey: ["dealer-applications"] });
      void queryClient.invalidateQueries({ queryKey: ["customers"] });
    },
    onError: (err) => {
      toast.push("error", err instanceof Error ? err.message : "İşlem başarısız");
    },
  });

  const preRegisterMutation = useMutation({
    mutationFn: (id: string) => preRegisterDealerApplication(id),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["dealer-applications"] });
      setPreRegisterResult(result);
    },
    onError: (err) => {
      toast.push("error", err instanceof Error ? err.message : "Ön kayıt başarısız");
    },
  });

  const data = applicationsQuery.data;
  const apps = data?.data ?? [];

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-[var(--color-text)]">Bayi Başvuruları</h1>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          {data ? `${apps.length} başvuru` : "Yükleniyor…"}
        </p>
      </header>

      <div className="mb-4">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as DealerApplicationStatus | "")}
          className="rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm"
        >
          <option value="">Tüm durumlar</option>
          <option value="pending">Bekleyen</option>
          <option value="pre_registered">Ön Kayıtlı</option>
          <option value="approved">Onaylı</option>
          <option value="rejected">Reddedilen</option>
        </select>
      </div>

      {applicationsQuery.isError ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {applicationsQuery.error instanceof Error
            ? applicationsQuery.error.message
            : "Veri alınamadı"}
        </div>
      ) : (
        <div className="rounded-xl border border-[var(--color-border)] bg-white overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]">
                <tr>
                  <th className="px-3 py-2 text-left">Ad</th>
                  <th className="px-3 py-2 text-left">Şirket</th>
                  <th className="px-3 py-2 text-left">Telefon</th>
                  <th className="px-3 py-2 text-left">E-posta</th>
                  <th className="px-3 py-2 text-center">Durum</th>
                  <th className="px-3 py-2 text-left">Başvuru tarihi</th>
                  <th className="px-3 py-2 text-right">İşlem</th>
                </tr>
              </thead>
              <tbody>
                {applicationsQuery.isLoading ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-[var(--color-text-muted)]">
                      Yükleniyor…
                    </td>
                  </tr>
                ) : apps.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-[var(--color-text-muted)]">
                      Başvuru bulunamadı
                    </td>
                  </tr>
                ) : (
                  apps.map((a) => (
                    <tr
                      key={a.id}
                      onClick={() => setDetailApp(a)}
                      className="cursor-pointer border-t border-[var(--color-border)] hover:bg-[var(--color-surface-muted)]"
                    >
                      <td className="px-3 py-2 font-medium">{a.fullName}</td>
                      <td className="px-3 py-2 text-[var(--color-text-muted)]">
                        {a.companyName ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-[var(--color-text-muted)]">
                        {a.phone ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-[var(--color-text-muted)]">{a.email}</td>
                      <td className="px-3 py-2 text-center">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium border ${statusColor(a.status)}`}
                        >
                          {DEALER_STATUS_LABELS[a.status]}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-[var(--color-text-muted)]">
                        {formatDateTime(a.createdAt)}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDetailApp(a);
                            }}
                            className="rounded-md border border-[var(--color-border)] bg-white px-2.5 py-1 text-xs text-[var(--color-text)] hover:bg-[var(--color-surface-muted)]"
                          >
                            Detay
                          </button>
                          {a.status === "pending" ? (
                            <>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  preRegisterMutation.mutate(a.id);
                                }}
                                disabled={preRegisterMutation.isPending || approveMutation.isPending}
                                className="rounded-md bg-blue-600 px-2.5 py-1 text-xs text-white hover:bg-blue-700 disabled:opacity-60"
                              >
                                Ön Kayıt
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  approveMutation.mutate(a.id);
                                }}
                                disabled={approveMutation.isPending || preRegisterMutation.isPending}
                                className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs text-white hover:bg-emerald-700 disabled:opacity-60"
                              >
                                Onayla
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setConfirmReject(a);
                                }}
                                disabled={rejectMutation.isPending}
                                className="rounded-md border border-red-200 bg-white px-2.5 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-60"
                              >
                                Reddet
                              </button>
                            </>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {confirmReject ? (
        <ConfirmDialog
          title="Başvuruyu reddet"
          message={`"${confirmReject.fullName}" başvurusu reddedilecek. Devam edilsin mi?`}
          confirmLabel="Reddet"
          destructive
          onCancel={() => setConfirmReject(null)}
          onConfirm={() => {
            const id = confirmReject.id;
            setConfirmReject(null);
            rejectMutation.mutate(id);
          }}
        />
      ) : null}

      {approvalResult ? (
        <DealerApprovalModal
          customer={approvalResult.customer}
          oneTimePassword={approvalResult.oneTimePassword ?? null}
          alreadyApproved={approvalResult.alreadyApproved}
          onClose={() => setApprovalResult(null)}
        />
      ) : null}

      {detailApp ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setDetailApp(null)}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="dealer-detail-title"
            className="w-full max-w-2xl rounded-xl border border-[var(--color-border)] bg-white shadow-xl max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-3">
              <h2
                id="dealer-detail-title"
                className="text-base font-semibold text-[var(--color-text)]"
              >
                Başvuru Detayı
              </h2>
              <button
                type="button"
                onClick={() => setDetailApp(null)}
                className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                aria-label="Kapat"
              >
                ✕
              </button>
            </header>
            <div className="overflow-y-auto px-5 py-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <DetailField label="Ad Soyad" value={dash(detailApp.fullName)} />
                <DetailField label="E-posta" value={dash(detailApp.email)} />
                <DetailField label="Telefon" value={dash(detailApp.phone)} />
                <DetailField
                  label="Firma"
                  value={dash(detailApp.company ?? detailApp.companyName)}
                />
                <DetailField label="Vergi No" value={dash(detailApp.vergiNo)} />
                <DetailField label="Vergi Dairesi" value={dash(detailApp.vergiDairesi)} />
                <DetailField label="Paket" value={dash(detailApp.package)} />
                <DetailField
                  label="Entegrasyon var mı?"
                  value={dash(detailApp.hasIntegration)}
                />
                <DetailField
                  label="Entegrasyon Yazılımı"
                  value={dash(detailApp.integrationSoftware)}
                />
                <DetailField
                  label="Başvuru Notu"
                  fullWidth
                  value={dash(cleanNote(detailApp.message ?? detailApp.notes))}
                />
                <DetailField
                  label="Durum"
                  value={
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium border ${statusColor(
                        detailApp.status,
                      )}`}
                    >
                      {DEALER_STATUS_LABELS[detailApp.status]}
                    </span>
                  }
                />
                <DetailField
                  label="Başvuru Tarihi"
                  value={dash(formatDateTime(detailApp.createdAt))}
                />
              </div>
            </div>
            <footer className="flex justify-end gap-2 border-t border-[var(--color-border)] px-5 py-3">
              {detailApp.status === "pending" ? (
                <button
                  type="button"
                  onClick={() => {
                    const id = detailApp.id;
                    setDetailApp(null);
                    approveMutation.mutate(id);
                  }}
                  disabled={approveMutation.isPending || preRegisterMutation.isPending}
                  className="rounded-md bg-emerald-600 px-4 py-1.5 text-sm text-white hover:bg-emerald-700 disabled:opacity-60"
                >
                  Onayla
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setDetailApp(null)}
                className="rounded-md border border-[var(--color-border)] bg-white px-4 py-1.5 text-sm text-[var(--color-text)] hover:bg-[var(--color-surface-muted)]"
              >
                Kapat
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {preRegisterResult ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setPreRegisterResult(null)}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="pre-reg-title"
            className="w-full max-w-sm rounded-xl border border-[var(--color-border)] bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-3">
              <h2 id="pre-reg-title" className="text-base font-semibold text-[var(--color-text)]">
                Ön Kayıt Tamamlandı
              </h2>
              <button
                type="button"
                onClick={() => setPreRegisterResult(null)}
                className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                aria-label="Kapat"
              >
                ✕
              </button>
            </header>
            <div className="px-5 py-4 space-y-3">
              {preRegisterResult.alreadyPreRegistered ? (
                <p className="text-sm text-[var(--color-text-muted)]">
                  Bu başvuru zaten ön kayıtlı durumda.
                </p>
              ) : (
                <p className="text-sm text-[var(--color-text)]">
                  <strong>{preRegisterResult.customer?.name}</strong> için müşteri kaydı
                  oluşturuldu. Hesap pasif durumda — e-posta henüz gönderilmedi.
                  Ayarları yaptıktan sonra müşteri kartından <strong>Aktive Et</strong>'e tıklayın.
                </p>
              )}
              <div className="rounded-md bg-blue-50 border border-blue-200 px-3 py-2 text-xs text-blue-700">
                Müşteri <strong>Müşteriler</strong> sayfasından bulunabilir ve ayarlar
                orada yapılabilir.
              </div>
            </div>
            <footer className="flex justify-end border-t border-[var(--color-border)] px-5 py-3">
              <button
                type="button"
                onClick={() => setPreRegisterResult(null)}
                className="rounded-md bg-[var(--color-primary)] px-4 py-1.5 text-sm text-white hover:opacity-90"
              >
                Tamam
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </div>
  );
}

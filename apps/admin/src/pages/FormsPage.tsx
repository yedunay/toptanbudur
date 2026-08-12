import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRequireAuth } from "../lib/auth";
import {
  FORM_STATUS_LABELS,
  deleteForm,
  fetchForms,
  markFormHandled,
  whatsappLink,
  type FormStatus,
  type FormSubmission,
  type FormsResponse,
  type FormTypeFilter,
} from "../lib/forms";
import { formatDateTime } from "../lib/orders";
import { useToast } from "../components/Toast";
import ConfirmDialog from "../components/ConfirmDialog";
import { useDocumentTitle } from "../lib/useDocumentTitle";

function statusColor(status: FormStatus): string {
  return status === "HANDLED"
    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
    : "bg-amber-50 text-amber-700 border-amber-200";
}

const TYPE_TABS: ReadonlyArray<{ value: FormTypeFilter; label: string }> = [
  { value: "APPLICATION", label: "Bayilik Başvuruları" },
  { value: "CONTACT", label: "İletişim Mesajları" },
  { value: "", label: "Tümü" },
];

function normalizeTypeParam(raw: string | null): FormTypeFilter {
  if (raw === "APPLICATION" || raw === "CONTACT") return raw;
  return "";
}

function typeBadge(type: string, subject?: string | null): string {
  if (type === "APPLICATION") {
    if (subject?.toLowerCase().includes("entegrasyon")) return "Entegrasyon Başvurusu";
    return "Bayilik Başvurusu";
  }
  if (type === "CONTACT") return "İletişim Mesajı";
  if (type === "INTEGRATION") return "Entegrasyon Başvurusu";
  return type;
}

export default function FormsPage(): React.ReactElement | null {
  useDocumentTitle("Formlar (eski)");
  const authed = useRequireAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const typeFilter = normalizeTypeParam(searchParams.get("type"));
  const [statusFilter, setStatusFilter] = useState<FormStatus | "">("");
  const [selected, setSelected] = useState<FormSubmission | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<FormSubmission | null>(null);

  const setTypeFilter = (next: FormTypeFilter): void => {
    const params = new URLSearchParams(searchParams);
    if (next) {
      params.set("type", next);
    } else {
      params.delete("type");
    }
    setSearchParams(params, { replace: true });
  };

  const formsQuery = useQuery<FormsResponse>({
    queryKey: ["forms", statusFilter, typeFilter],
    queryFn: () => fetchForms(statusFilter || undefined, typeFilter || undefined),
    enabled: authed,
  });

  const heading = useMemo(() => {
    if (typeFilter === "APPLICATION") return "Bayilik Başvuruları";
    if (typeFilter === "CONTACT") return "İletişim Mesajları";
    return "Formlar";
  }, [typeFilter]);

  const handledMutation = useMutation({
    mutationFn: (id: string) => markFormHandled(id),
    onSuccess: () => {
      toast.push("success", "İşlendi olarak işaretlendi");
      void queryClient.invalidateQueries({ queryKey: ["forms"] });
      setSelected(null);
    },
    onError: (err) => {
      toast.push("error", err instanceof Error ? err.message : "İşlem başarısız");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteForm(id),
    onSuccess: () => {
      toast.push("success", "Form silindi");
      void queryClient.invalidateQueries({ queryKey: ["forms"] });
      setSelected(null);
    },
    onError: (err) => {
      toast.push("error", err instanceof Error ? err.message : "Silme başarısız");
    },
  });

  const data = formsQuery.data;
  const forms = data?.data ?? [];

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-[var(--color-text)]">{heading}</h1>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          {data ? `${forms.length} form` : "Yükleniyor…"}
        </p>
      </header>

      <div
        role="tablist"
        aria-label="Form türü"
        className="mb-4 inline-flex items-center gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-1"
      >
        {TYPE_TABS.map((tab) => {
          const active = tab.value === typeFilter;
          return (
            <button
              key={tab.value || "all"}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTypeFilter(tab.value)}
              className={
                "px-3 py-1.5 text-sm rounded-md transition-colors " +
                (active
                  ? "bg-white text-[var(--color-text)] shadow-sm border border-[var(--color-border)]"
                  : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]")
              }
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="mb-4 flex items-center gap-3">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as FormStatus | "")}
          className="rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm"
        >
          <option value="">Tüm durumlar</option>
          <option value="NEW">Yeni</option>
          <option value="HANDLED">İşlendi</option>
        </select>
      </div>

      {formsQuery.isError ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {formsQuery.error instanceof Error ? formsQuery.error.message : "Veri alınamadı"}
        </div>
      ) : (
        <div className="rounded-xl border border-[var(--color-border)] bg-white overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]">
                <tr>
                  <th className="px-3 py-2 text-left">Tip</th>
                  <th className="px-3 py-2 text-left">Ad</th>
                  <th className="px-3 py-2 text-left">E-posta</th>
                  <th className="px-3 py-2 text-left">Telefon</th>
                  <th className="px-3 py-2 text-center">Durum</th>
                  <th className="px-3 py-2 text-left">Tarih</th>
                  <th className="px-3 py-2 text-right">İşlem</th>
                </tr>
              </thead>
              <tbody>
                {formsQuery.isLoading ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-[var(--color-text-muted)]">
                      Yükleniyor…
                    </td>
                  </tr>
                ) : forms.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-[var(--color-text-muted)]">
                      Form bulunamadı
                    </td>
                  </tr>
                ) : (
                  forms.map((f) => {
                    const wa = whatsappLink(f.phone, f.name, f.type);
                    return (
                      <tr
                        key={f.id}
                        className="border-t border-[var(--color-border)] hover:bg-[var(--color-surface-muted)] cursor-pointer"
                        onClick={() => setSelected(f)}
                      >
                        <td className="px-3 py-2 text-[var(--color-text-muted)]">{typeBadge(f.type, f.subject)}</td>
                        <td className="px-3 py-2 font-medium">{f.name}</td>
                        <td className="px-3 py-2 text-[var(--color-text-muted)]">
                          {f.email ?? "—"}
                        </td>
                        <td className="px-3 py-2 text-[var(--color-text-muted)]">
                          {f.phone ?? "—"}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium border ${statusColor(f.status)}`}
                          >
                            {FORM_STATUS_LABELS[f.status]}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-[var(--color-text-muted)]">
                          {formatDateTime(f.createdAt)}
                        </td>
                        <td
                          className="px-3 py-2 text-right"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex items-center justify-end gap-1">
                            {wa ? (
                              <a
                                href={wa}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs text-white hover:bg-emerald-700"
                              >
                                WhatsApp
                              </a>
                            ) : null}
                            {f.status !== "HANDLED" ? (
                              <button
                                type="button"
                                onClick={() => handledMutation.mutate(f.id)}
                                disabled={handledMutation.isPending}
                                className="rounded-md border border-[var(--color-border)] bg-white px-2.5 py-1 text-xs hover:bg-[var(--color-surface-muted)]"
                              >
                                İşlendi
                              </button>
                            ) : null}
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
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {selected ? (
        <div
          className="fixed inset-0 z-40 bg-black/40 flex justify-end"
          onClick={() => setSelected(null)}
        >
          <aside
            className="w-full max-w-md h-full bg-white shadow-xl p-6 overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold">{selected.name}</h2>
                <p className="text-xs text-[var(--color-text-muted)]">
                  {selected.type} · {formatDateTime(selected.createdAt)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
              >
                ✕
              </button>
            </div>
            <dl className="space-y-3 text-sm">
              {selected.subject ? (
                <div>
                  <dt className="text-xs uppercase text-[var(--color-text-muted)]">Konu</dt>
                  <dd className="font-medium">{selected.subject}</dd>
                </div>
              ) : null}
              {selected.email ? (
                <div>
                  <dt className="text-xs uppercase text-[var(--color-text-muted)]">E-posta</dt>
                  <dd>{selected.email}</dd>
                </div>
              ) : null}
              {selected.phone ? (
                <div>
                  <dt className="text-xs uppercase text-[var(--color-text-muted)]">Telefon</dt>
                  <dd>{selected.phone}</dd>
                </div>
              ) : null}
              {selected.integrationSoftware ? (
                <div>
                  <dt className="text-xs uppercase text-[var(--color-text-muted)]">
                    Entegrasyon yazılımı
                  </dt>
                  <dd>{selected.integrationSoftware}</dd>
                </div>
              ) : null}
              {selected.package ? (
                <div>
                  <dt className="text-xs uppercase text-[var(--color-text-muted)]">Paket</dt>
                  <dd>{selected.package}</dd>
                </div>
              ) : null}
              {selected.message ? (
                <div>
                  <dt className="text-xs uppercase text-[var(--color-text-muted)]">Mesaj</dt>
                  <dd className="whitespace-pre-wrap">{selected.message}</dd>
                </div>
              ) : null}
            </dl>
            <div className="mt-6 flex flex-wrap gap-2">
              {whatsappLink(selected.phone, selected.name, selected.type) ? (
                <a
                  href={whatsappLink(selected.phone, selected.name, selected.type) ?? "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-700"
                >
                  WhatsApp ile yaz
                </a>
              ) : null}
              {selected.status !== "HANDLED" ? (
                <button
                  type="button"
                  onClick={() => handledMutation.mutate(selected.id)}
                  disabled={handledMutation.isPending}
                  className="rounded-md border border-[var(--color-border)] bg-white px-3 py-1.5 text-sm hover:bg-[var(--color-surface-muted)]"
                >
                  İşlendi olarak işaretle
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setConfirmDelete(selected)}
                className="rounded-md border border-red-200 bg-white px-3 py-1.5 text-sm text-red-700 hover:bg-red-50"
              >
                Sil
              </button>
            </div>
          </aside>
        </div>
      ) : null}

      {confirmDelete ? (
        <ConfirmDialog
          title="Formu sil"
          message={`"${confirmDelete.name}" formu silinecek. Devam edilsin mi?`}
          confirmLabel="Sil"
          destructive
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => {
            const id = confirmDelete.id;
            setConfirmDelete(null);
            deleteMutation.mutate(id);
          }}
        />
      ) : null}
    </div>
  );
}

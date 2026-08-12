import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRequireAuth } from "../lib/auth";
import {
  createBankAccount,
  deleteBankAccount,
  fetchBankAccounts,
  formatIban,
  updateBankAccount,
  type BankAccount,
  type BankAccountInput,
  type BankAccountUpdateInput,
} from "../lib/bank-accounts";
import { useToast } from "../components/Toast";
import ConfirmDialog from "../components/ConfirmDialog";
import { useDocumentTitle } from "../lib/useDocumentTitle";

interface BankAccountFormState {
  bankName: string;
  accountName: string;
  iban: string;
  branchCode: string;
  accountNo: string;
  active: boolean;
  position: string;
  note: string;
}

const EMPTY_FORM: BankAccountFormState = {
  bankName: "",
  accountName: "",
  iban: "",
  branchCode: "",
  accountNo: "",
  active: true,
  position: "0",
  note: "",
};

function fromBankAccount(account: BankAccount): BankAccountFormState {
  return {
    bankName: account.bankName,
    accountName: account.accountName,
    iban: account.iban,
    branchCode: account.branchCode ?? "",
    accountNo: account.accountNo ?? "",
    active: account.active,
    position: String(account.position),
    note: account.note ?? "",
  };
}

function validateForm(form: BankAccountFormState): string | null {
  if (!form.bankName.trim()) return "Banka adı gerekli";
  if (!form.accountName.trim()) return "Hesap sahibi gerekli";
  const ibanClean = form.iban.replace(/\s+/g, "").toUpperCase();
  if (ibanClean.length < 15 || ibanClean.length > 34) {
    return "IBAN 15-34 karakter olmalı";
  }
  if (form.position.trim() !== "" && Number.isNaN(Number(form.position))) {
    return "Sıra numarası geçersiz";
  }
  return null;
}

function buildPayload(form: BankAccountFormState): BankAccountInput {
  const positionNum = form.position.trim() === "" ? 0 : Number(form.position);
  return {
    bankName: form.bankName,
    accountName: form.accountName,
    iban: form.iban,
    branchCode: form.branchCode || undefined,
    accountNo: form.accountNo || undefined,
    active: form.active,
    position: Number.isFinite(positionNum) ? positionNum : 0,
    note: form.note || undefined,
  };
}

interface BankAccountFormProps {
  initial: BankAccount | null;
  busy: boolean;
  onSubmit: (payload: BankAccountInput | BankAccountUpdateInput) => void;
  onCancel: () => void;
}

function BankAccountForm({
  initial,
  busy,
  onSubmit,
  onCancel,
}: BankAccountFormProps): React.ReactElement {
  const [form, setForm] = useState<BankAccountFormState>(
    initial ? fromBankAccount(initial) : EMPTY_FORM,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setForm(initial ? fromBankAccount(initial) : EMPTY_FORM);
    setError(null);
  }, [initial]);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const validation = validateForm(form);
    if (validation) {
      setError(validation);
      return;
    }
    setError(null);
    onSubmit(buildPayload(form));
  };

  const title = initial ? "Banka hesabını düzenle" : "Yeni banka hesabı";

  return (
    <div
      className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center p-4"
      onClick={() => {
        if (!busy) onCancel();
      }}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="bank-form-title"
        className="w-full max-w-xl rounded-xl bg-white shadow-lg border border-[var(--color-border)] max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-[var(--color-border)]">
          <h2
            id="bank-form-title"
            className="text-lg font-semibold text-[var(--color-text)]"
          >
            {title}
          </h2>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="px-5 py-4 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs font-medium text-[var(--color-text-muted)]">
                  Banka adı *
                </span>
                <input
                  type="text"
                  value={form.bankName}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, bankName: e.target.value }))
                  }
                  required
                  maxLength={120}
                  className="mt-1 block w-full rounded-md border border-[var(--color-border)] px-3 py-2 text-sm focus:border-[var(--color-brand-blue)] focus:outline-none focus:ring-1 focus:ring-[var(--color-brand-blue)]"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-[var(--color-text-muted)]">
                  Hesap sahibi *
                </span>
                <input
                  type="text"
                  value={form.accountName}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, accountName: e.target.value }))
                  }
                  required
                  maxLength={200}
                  className="mt-1 block w-full rounded-md border border-[var(--color-border)] px-3 py-2 text-sm focus:border-[var(--color-brand-blue)] focus:outline-none focus:ring-1 focus:ring-[var(--color-brand-blue)]"
                />
              </label>
            </div>
            <label className="block">
              <span className="text-xs font-medium text-[var(--color-text-muted)]">
                IBAN *
              </span>
              <input
                type="text"
                value={form.iban}
                onChange={(e) =>
                  setForm((p) => ({ ...p, iban: e.target.value.toUpperCase() }))
                }
                required
                placeholder="TR00 0000 0000 0000 0000 0000 00"
                className="mt-1 block w-full rounded-md border border-[var(--color-border)] px-3 py-2 text-sm font-mono focus:border-[var(--color-brand-blue)] focus:outline-none focus:ring-1 focus:ring-[var(--color-brand-blue)]"
              />
              <span className="mt-1 block text-xs text-[var(--color-text-muted)]">
                Boşluklar otomatik temizlenir.
              </span>
            </label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs font-medium text-[var(--color-text-muted)]">
                  Şube kodu
                </span>
                <input
                  type="text"
                  value={form.branchCode}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, branchCode: e.target.value }))
                  }
                  maxLength={20}
                  className="mt-1 block w-full rounded-md border border-[var(--color-border)] px-3 py-2 text-sm focus:border-[var(--color-brand-blue)] focus:outline-none focus:ring-1 focus:ring-[var(--color-brand-blue)]"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-[var(--color-text-muted)]">
                  Hesap no
                </span>
                <input
                  type="text"
                  value={form.accountNo}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, accountNo: e.target.value }))
                  }
                  maxLength={64}
                  className="mt-1 block w-full rounded-md border border-[var(--color-border)] px-3 py-2 text-sm focus:border-[var(--color-brand-blue)] focus:outline-none focus:ring-1 focus:ring-[var(--color-brand-blue)]"
                />
              </label>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs font-medium text-[var(--color-text-muted)]">
                  Sıra
                </span>
                <input
                  type="number"
                  value={form.position}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, position: e.target.value }))
                  }
                  className="mt-1 block w-full rounded-md border border-[var(--color-border)] px-3 py-2 text-sm focus:border-[var(--color-brand-blue)] focus:outline-none focus:ring-1 focus:ring-[var(--color-brand-blue)]"
                />
                <span className="mt-1 block text-xs text-[var(--color-text-muted)]">
                  Düşük sayı önce gösterilir.
                </span>
              </label>
              <label className="flex items-center gap-2 mt-5">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, active: e.target.checked }))
                  }
                  className="h-4 w-4 rounded border-[var(--color-border)]"
                />
                <span className="text-sm text-[var(--color-text)]">
                  Aktif (müşteri seçim listesinde görünsün)
                </span>
              </label>
            </div>
            <label className="block">
              <span className="text-xs font-medium text-[var(--color-text-muted)]">
                Not (opsiyonel — müşteriye görünmez)
              </span>
              <textarea
                value={form.note}
                onChange={(e) =>
                  setForm((p) => ({ ...p, note: e.target.value }))
                }
                rows={2}
                maxLength={500}
                className="mt-1 block w-full rounded-md border border-[var(--color-border)] px-3 py-2 text-sm focus:border-[var(--color-brand-blue)] focus:outline-none focus:ring-1 focus:ring-[var(--color-brand-blue)]"
              />
            </label>
            {error ? (
              <div className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700">
                {error}
              </div>
            ) : null}
          </div>
          <div className="px-5 py-3 border-t border-[var(--color-border)] flex items-center justify-end gap-2 bg-[var(--color-surface-muted)] rounded-b-xl">
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="rounded-md border border-[var(--color-border)] bg-white px-3 py-1.5 text-sm hover:bg-[var(--color-surface-muted)] disabled:opacity-60"
            >
              İptal
            </button>
            <button
              type="submit"
              disabled={busy}
              className="rounded-md bg-[var(--color-brand-blue)] px-3 py-1.5 text-sm text-white hover:opacity-90 disabled:opacity-60"
            >
              {busy ? "Kaydediliyor…" : initial ? "Kaydet" : "Oluştur"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function BankaBilgileriPage(): React.ReactElement | null {
  useDocumentTitle("Banka Bilgileri");
  const authed = useRequireAuth();
  const queryClient = useQueryClient();
  const toast = useToast();

  const [formOpen, setFormOpen] = useState<boolean>(false);
  const [editing, setEditing] = useState<BankAccount | null>(null);
  const [deleting, setDeleting] = useState<BankAccount | null>(null);

  const banksQuery = useQuery<BankAccount[]>({
    queryKey: ["admin-bank-accounts"],
    queryFn: fetchBankAccounts,
    enabled: authed,
  });

  const createMutation = useMutation({
    mutationFn: (input: BankAccountInput) => createBankAccount(input),
    onSuccess: () => {
      toast.push("success", "Banka hesabı eklendi");
      setFormOpen(false);
      setEditing(null);
      void queryClient.invalidateQueries({ queryKey: ["admin-bank-accounts"] });
    },
    onError: (err) => {
      toast.push(
        "error",
        err instanceof Error ? err.message : "Banka hesabı eklenemedi",
      );
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: BankAccountUpdateInput;
    }) => updateBankAccount(id, input),
    onSuccess: () => {
      toast.push("success", "Banka hesabı güncellendi");
      setFormOpen(false);
      setEditing(null);
      void queryClient.invalidateQueries({ queryKey: ["admin-bank-accounts"] });
    },
    onError: (err) => {
      toast.push(
        "error",
        err instanceof Error ? err.message : "Banka hesabı güncellenemedi",
      );
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteBankAccount(id),
    onSuccess: (data) => {
      toast.push(
        "success",
        data.softDeleted
          ? "Banka hesabı pasifleştirildi (geçmiş yüklemeler korundu)"
          : "Banka hesabı silindi",
      );
      setDeleting(null);
      void queryClient.invalidateQueries({ queryKey: ["admin-bank-accounts"] });
    },
    onError: (err) => {
      toast.push(
        "error",
        err instanceof Error ? err.message : "Banka hesabı silinemedi",
      );
    },
  });

  const banks = useMemo(() => banksQuery.data ?? [], [banksQuery.data]);
  const busy = createMutation.isPending || updateMutation.isPending;

  if (!authed) return null;

  const openCreate = (): void => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (account: BankAccount): void => {
    setEditing(account);
    setFormOpen(true);
  };

  const closeForm = (): void => {
    setFormOpen(false);
    setEditing(null);
  };

  const submitForm = (
    payload: BankAccountInput | BankAccountUpdateInput,
  ): void => {
    if (editing) {
      updateMutation.mutate({ id: editing.id, input: payload });
    } else {
      createMutation.mutate(payload as BankAccountInput);
    }
  };

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--color-text)]">
            Banka Bilgileri
          </h1>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            Müşterilerin bakiye yüklemesi için EFT/havale yapacağı IBAN listesi.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="rounded-md bg-[var(--color-brand-blue)] px-3 py-1.5 text-sm text-white hover:opacity-90"
        >
          + Yeni hesap ekle
        </button>
      </header>

      {banksQuery.isError ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {banksQuery.error instanceof Error
            ? banksQuery.error.message
            : "Veri alınamadı"}
        </div>
      ) : (
        <div className="rounded-xl border border-[var(--color-border)] bg-white overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]">
                <tr>
                  <th className="px-3 py-2 text-left">Banka</th>
                  <th className="px-3 py-2 text-left">Hesap sahibi</th>
                  <th className="px-3 py-2 text-left">IBAN</th>
                  <th className="px-3 py-2 text-left">Şube / Hesap no</th>
                  <th className="px-3 py-2 text-center">Sıra</th>
                  <th className="px-3 py-2 text-center">Durum</th>
                  <th className="px-3 py-2 text-right">Aksiyonlar</th>
                </tr>
              </thead>
              <tbody>
                {banksQuery.isLoading ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-3 py-8 text-center text-[var(--color-text-muted)]"
                    >
                      Yükleniyor…
                    </td>
                  </tr>
                ) : banks.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-3 py-8 text-center text-[var(--color-text-muted)]"
                    >
                      Henüz banka hesabı eklenmemiş.
                    </td>
                  </tr>
                ) : (
                  banks.map((b) => (
                    <tr
                      key={b.id}
                      className="border-t border-[var(--color-border)] hover:bg-[var(--color-surface-muted)] align-top"
                    >
                      <td className="px-3 py-2 font-medium">{b.bankName}</td>
                      <td className="px-3 py-2 text-[var(--color-text-muted)]">
                        {b.accountName}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {formatIban(b.iban)}
                      </td>
                      <td className="px-3 py-2 text-xs text-[var(--color-text-muted)]">
                        <div className="flex flex-col">
                          {b.branchCode ? (
                            <span>Şube: {b.branchCode}</span>
                          ) : null}
                          {b.accountNo ? (
                            <span>Hesap: {b.accountNo}</span>
                          ) : null}
                          {!b.branchCode && !b.accountNo ? "—" : null}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-center tabular-nums">
                        {b.position}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {b.active ? (
                          <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium border bg-emerald-50 text-emerald-700 border-emerald-200">
                            Aktif
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium border bg-gray-50 text-gray-600 border-gray-200">
                            Pasif
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => openEdit(b)}
                            className="rounded-md border border-[var(--color-border)] bg-white px-2.5 py-1 text-xs text-[var(--color-text)] hover:bg-[var(--color-surface-muted)]"
                          >
                            Düzenle
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleting(b)}
                            className="rounded-md border border-red-200 bg-white px-2.5 py-1 text-xs text-red-700 hover:bg-red-50"
                          >
                            Sil
                          </button>
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

      {formOpen ? (
        <BankAccountForm
          initial={editing}
          busy={busy}
          onSubmit={submitForm}
          onCancel={closeForm}
        />
      ) : null}

      {deleting ? (
        <ConfirmDialog
          title="Banka hesabını sil"
          message={`"${deleting.bankName} - ${formatIban(deleting.iban)}" silinecek. Daha önce yüklemelerde kullanıldıysa kayıt korunmak için pasifleştirilir, aksi halde tamamen silinir. Devam edilsin mi?`}
          confirmLabel="Sil"
          destructive
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            const id = deleting.id;
            deleteMutation.mutate(id);
          }}
        />
      ) : null}
    </div>
  );
}

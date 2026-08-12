"use client";

import { useEffect, useState } from "react";
import { apiCustomer, ApiError } from "@/lib/auth";
import { useAuth } from "@/components/AuthProvider";
import { Toast, makeToast, type ToastState } from "@/components/account-shared/Toast";
import type { AddressInput, CustomerAddress } from "@/lib/customer-types";
import { AddressForm } from "@/components/account-addresses/AddressForm";

type Mode =
  | { kind: "list" }
  | { kind: "create" }
  | { kind: "edit"; address: CustomerAddress };

function isAddressArray(value: unknown): value is CustomerAddress[] {
  return Array.isArray(value);
}

function extractList(value: unknown): CustomerAddress[] {
  if (isAddressArray(value)) return value;
  if (
    value &&
    typeof value === "object" &&
    "data" in value &&
    isAddressArray((value as { data?: unknown }).data)
  ) {
    return (value as { data: CustomerAddress[] }).data;
  }
  if (
    value &&
    typeof value === "object" &&
    "addresses" in value &&
    isAddressArray((value as { addresses?: unknown }).addresses)
  ) {
    return (value as { addresses: CustomerAddress[] }).addresses;
  }
  return [];
}

export function AdreslerimClient() {
  const { customer } = useAuth();
  const [addresses, setAddresses] = useState<CustomerAddress[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: "list" });
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);

  async function load() {
    setLoadError(null);
    try {
      const data = await apiCustomer<unknown>("/me/addresses", {
        method: "GET",
        general: true,
      });
      setAddresses(extractList(data));
    } catch (err: unknown) {
      const msg =
        err instanceof ApiError ? err.message : "Adresler yüklenemedi";
      setLoadError(msg);
      setAddresses([]);
    }
  }

  useEffect(() => {
    if (!customer) return;
    void load();
  }, [customer]);

  async function handleCreate(input: AddressInput) {
    setSubmitting(true);
    try {
      await apiCustomer<unknown>("/me/addresses", {
        method: "POST",
        general: true,
        body: JSON.stringify(input),
      });
      setToast(makeToast("success", "Adres eklendi"));
      setMode({ kind: "list" });
      await load();
    } catch (err: unknown) {
      const msg = err instanceof ApiError ? err.message : "Adres eklenemedi";
      setToast(makeToast("error", msg));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpdate(id: string, input: AddressInput) {
    setSubmitting(true);
    try {
      await apiCustomer<unknown>(`/me/addresses/${encodeURIComponent(id)}`, {
        method: "PATCH",
        general: true,
        body: JSON.stringify(input),
      });
      setToast(makeToast("success", "Adres güncellendi"));
      setMode({ kind: "list" });
      await load();
    } catch (err: unknown) {
      const msg =
        err instanceof ApiError ? err.message : "Adres güncellenemedi";
      setToast(makeToast("error", msg));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Bu adresi silmek istediğinize emin misiniz?")) return;
    setBusyId(id);
    try {
      await apiCustomer<unknown>(`/me/addresses/${encodeURIComponent(id)}`, {
        method: "DELETE",
        general: true,
      });
      setToast(makeToast("success", "Adres silindi"));
      await load();
    } catch (err: unknown) {
      const msg = err instanceof ApiError ? err.message : "Adres silinemedi";
      setToast(makeToast("error", msg));
    } finally {
      setBusyId(null);
    }
  }

  async function handleSetDefault(id: string) {
    setBusyId(id);
    try {
      await apiCustomer<unknown>(`/me/addresses/${encodeURIComponent(id)}`, {
        method: "PATCH",
        general: true,
        body: JSON.stringify({ isDefault: true }),
      });
      setToast(makeToast("success", "Varsayılan adres ayarlandı"));
      await load();
    } catch (err: unknown) {
      const msg =
        err instanceof ApiError ? err.message : "İşlem gerçekleştirilemedi";
      setToast(makeToast("error", msg));
    } finally {
      setBusyId(null);
    }
  }

  if (!customer) {
    return (
      <div className="space-y-3">
        <div className="h-9 w-48 animate-pulse rounded-md bg-[var(--surface-muted)]" />
        <div className="h-40 animate-pulse rounded-md bg-[var(--surface-muted)]" />
      </div>
    );
  }

  return (
    <>
      <Toast toast={toast} onDismiss={() => setToast(null)} />
      <div className="rounded-md border border-[var(--border)] bg-white p-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-[var(--brand-navy)]">
              Adreslerim
            </h2>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              Teslimat ve fatura adreslerinizi yönetin.
            </p>
          </div>
          {mode.kind === "list" && (
            <button
              type="button"
              onClick={() => setMode({ kind: "create" })}
              className="rounded-md bg-[var(--brand-blue)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--brand-navy)]"
            >
              + Yeni adres ekle
            </button>
          )}
        </div>

        {loadError && (
          <div
            role="alert"
            className="mb-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700"
          >
            {loadError}
          </div>
        )}

        {mode.kind === "create" && (
          <div className="mb-6 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-5">
            <h3 className="mb-4 text-base font-semibold text-[var(--brand-navy)]">
              Yeni adres
            </h3>
            <AddressForm
              submitting={submitting}
              onCancel={() => setMode({ kind: "list" })}
              onSubmit={handleCreate}
            />
          </div>
        )}

        {mode.kind === "edit" && (
          <div className="mb-6 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-5">
            <h3 className="mb-4 text-base font-semibold text-[var(--brand-navy)]">
              Adresi düzenle
            </h3>
            <AddressForm
              initial={mode.address}
              submitting={submitting}
              onCancel={() => setMode({ kind: "list" })}
              onSubmit={(input) => handleUpdate(mode.address.id, input)}
            />
          </div>
        )}

        {addresses === null && (
          <div className="space-y-3">
            <div className="h-32 animate-pulse rounded-md bg-[var(--surface-muted)]" />
            <div className="h-32 animate-pulse rounded-md bg-[var(--surface-muted)]" />
          </div>
        )}

        {addresses && addresses.length === 0 && mode.kind === "list" && (
          <div className="rounded-md border border-dashed border-[var(--border)] bg-[var(--surface-muted)] p-8 text-center">
            <p className="text-sm text-[var(--text-muted)]">
              Kayıtlı adresiniz bulunmuyor.
            </p>
            <button
              type="button"
              onClick={() => setMode({ kind: "create" })}
              className="mt-4 inline-flex rounded-md bg-[var(--brand-blue)] px-5 py-2 text-sm font-semibold text-white transition hover:bg-[var(--brand-navy)]"
            >
              İlk adresinizi ekleyin
            </button>
          </div>
        )}

        {addresses && addresses.length > 0 && (
          <ul className="grid gap-4 sm:grid-cols-2">
            {addresses.map((addr) => {
              const isDefault =
                addr.isDefault ||
                addr.isDefaultShipping ||
                addr.isDefaultBilling;
              return (
                <li
                  key={addr.id}
                  className={`relative rounded-md border bg-white p-4 transition ${
                    isDefault
                      ? "border-[var(--brand-blue)]"
                      : "border-[var(--border)]"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="text-sm font-semibold text-[var(--brand-navy)]">
                        {addr.title}
                      </span>
                      {isDefault && (
                        <span className="ml-2 inline-flex items-center rounded-full bg-[var(--brand-blue)]/10 px-2 py-0.5 text-xs font-medium text-[var(--brand-blue)]">
                          Varsayılan
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="mt-3 space-y-1 text-sm text-[var(--text)]">
                    <p className="font-medium">{addr.fullName}</p>
                    <p className="text-[var(--text-muted)]">{addr.phone}</p>
                    <p>{addr.line1}</p>
                    {addr.line2 && <p>{addr.line2}</p>}
                    <p className="text-[var(--text-muted)]">
                      {addr.district} / {addr.city} {addr.postalCode}
                    </p>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2 border-t border-[var(--border)] pt-3 text-xs">
                    <button
                      type="button"
                      onClick={() => setMode({ kind: "edit", address: addr })}
                      disabled={busyId === addr.id}
                      className="rounded-md border border-[var(--border)] bg-white px-3 py-1.5 font-medium text-[var(--text)] transition hover:border-[var(--brand-blue)] hover:text-[var(--brand-blue)] disabled:opacity-60"
                    >
                      Düzenle
                    </button>
                    {!isDefault && (
                      <button
                        type="button"
                        onClick={() => handleSetDefault(addr.id)}
                        disabled={busyId === addr.id}
                        className="rounded-md border border-[var(--border)] bg-white px-3 py-1.5 font-medium text-[var(--text)] transition hover:border-[var(--brand-blue)] hover:text-[var(--brand-blue)] disabled:opacity-60"
                      >
                        Varsayılan yap
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleDelete(addr.id)}
                      disabled={busyId === addr.id}
                      className="ml-auto rounded-md border border-red-200 bg-white px-3 py-1.5 font-medium text-red-600 transition hover:border-red-400 disabled:opacity-60"
                    >
                      {busyId === addr.id ? "İşleniyor…" : "Sil"}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, FileText, MapPin, Save, Truck } from "lucide-react";
import { ApiError, apiCustomer } from "@/lib/auth";
import { useAuth } from "@/components/AuthProvider";
import { normalizeTrPhone } from "@/lib/forms";
import {
  Toast,
  makeToast,
  type ToastState,
} from "@/components/account-shared/Toast";

/**
 * Fatura ve Kargo adres yönetimi — `/hesabim/ayarlar#billing` sekmesi.
 *
 * Veri modeli (CustomerAddress üzerinde konvansiyon):
 *   - title="Fatura Adresi" → fatura adresi (her zaman var, sipariş kayıtlarında kullanılır)
 *   - title="Kargo Adresi"  → ayrı kargo adresi (yalnızca "ayrı" işaretliyse var)
 *   - sipariş için isDefault=true: ayrı kargo varsa "Kargo Adresi", yoksa "Fatura Adresi"
 *
 * Bu tasarım sayesinde sepet/odeme sayfaları /me/addresses üzerinden default
 * adresi okumaya devam eder; ayrı dataşamadan sonsuz adres listesi yerine
 * ikisini de bir formdan kullanıcı tek noktadan yönetir.
 */

const BILLING_TITLE = "Fatura Adresi";
const SHIPPING_TITLE = "Kargo Adresi";

interface AddressRow {
  id: string;
  title: string;
  fullName: string;
  phone?: string | null;
  line1: string;
  line2?: string | null;
  city: string;
  district?: string | null;
  postalCode?: string | null;
  country?: string | null;
  isDefault?: boolean;
}

interface AddressForm {
  fullName: string;
  phone: string;
  line1: string;
  city: string;
  district: string;
  postalCode: string;
}

const EMPTY_FORM: AddressForm = {
  fullName: "",
  phone: "",
  line1: "",
  city: "",
  district: "",
  postalCode: "",
};

function isAddressArray(value: unknown): value is AddressRow[] {
  return (
    Array.isArray(value) &&
    value.every(
      (v) =>
        v !== null &&
        typeof v === "object" &&
        typeof (v as { id?: unknown }).id === "string",
    )
  );
}

function extractAddresses(payload: unknown): AddressRow[] {
  if (isAddressArray(payload)) return payload;
  if (
    payload &&
    typeof payload === "object" &&
    "data" in payload &&
    isAddressArray((payload as { data?: unknown }).data)
  ) {
    return (payload as { data: AddressRow[] }).data;
  }
  return [];
}

function rowToForm(row: AddressRow | null): AddressForm {
  if (!row) return { ...EMPTY_FORM };
  return {
    fullName: row.fullName ?? "",
    phone: row.phone ?? "",
    line1: row.line1 ?? "",
    city: row.city ?? "",
    district: row.district ?? "",
    postalCode: row.postalCode ?? "",
  };
}

function validateForm(form: AddressForm, label: string): string | null {
  if (!form.fullName.trim()) return `${label}: Ad/Firma zorunlu`;
  if (form.fullName.trim().length < 2) return `${label}: Ad en az 2 karakter`;
  if (!form.line1.trim()) return `${label}: Adres zorunlu`;
  if (!form.city.trim()) return `${label}: Şehir zorunlu`;
  if (!form.postalCode.trim()) return `${label}: Posta kodu zorunlu`;
  if (form.postalCode.trim().length < 2) {
    return `${label}: Posta kodu en az 2 karakter`;
  }
  return null;
}

export function BillingAddressTab() {
  const auth = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [billingRow, setBillingRow] = useState<AddressRow | null>(null);
  const [shippingRow, setShippingRow] = useState<AddressRow | null>(null);
  const [billingForm, setBillingForm] = useState<AddressForm>({ ...EMPTY_FORM });
  const [shippingForm, setShippingForm] = useState<AddressForm>({
    ...EMPTY_FORM,
  });
  const [sameAsBilling, setSameAsBilling] = useState<boolean>(true);

  const loadAddresses = useCallback(async () => {
    try {
      const raw = await apiCustomer<unknown>("/me/addresses", {
        method: "GET",
        general: true,
      });
      const list = extractAddresses(raw);
      const billing =
        list.find((a) => a.title === BILLING_TITLE) ??
        // Yeni kullanıcılar için: Fatura adı yoksa default olanı veya ilkini kullan.
        list.find((a) => a.isDefault === true) ??
        list[0] ??
        null;
      const shipping = list.find((a) => a.title === SHIPPING_TITLE) ?? null;
      setBillingRow(billing);
      setShippingRow(shipping);
      setBillingForm(rowToForm(billing));
      setShippingForm(rowToForm(shipping));
      setSameAsBilling(!shipping);
    } catch {
      setBillingRow(null);
      setShippingRow(null);
      setBillingForm({ ...EMPTY_FORM });
      setShippingForm({ ...EMPTY_FORM });
      setSameAsBilling(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAddresses();
  }, [loadAddresses]);

  function buildAddressBody(
    title: string,
    form: AddressForm,
    isDefault: boolean,
  ) {
    return {
      title,
      fullName: form.fullName.trim(),
      phone: form.phone.trim() || undefined,
      line1: form.line1.trim(),
      city: form.city.trim(),
      district: form.district.trim() || undefined,
      postalCode: form.postalCode.trim(),
      country: "TR",
      isDefault,
    };
  }

  async function upsertAddress(
    existing: AddressRow | null,
    title: string,
    form: AddressForm,
    isDefault: boolean,
  ): Promise<AddressRow> {
    const body = buildAddressBody(title, form, isDefault);
    if (existing) {
      const raw = await apiCustomer<unknown>(`/me/addresses/${existing.id}`, {
        method: "PATCH",
        general: true,
        body: JSON.stringify(body),
      });
      const env =
        raw && typeof raw === "object" && "data" in raw
          ? (raw as { data: AddressRow }).data
          : (raw as AddressRow);
      return env;
    }
    const raw = await apiCustomer<unknown>("/me/addresses", {
      method: "POST",
      general: true,
      body: JSON.stringify(body),
    });
    const env =
      raw && typeof raw === "object" && "data" in raw
        ? (raw as { data: AddressRow }).data
        : (raw as AddressRow);
    return env;
  }

  async function deleteAddress(id: string): Promise<void> {
    await apiCustomer<unknown>(`/me/addresses/${id}`, {
      method: "DELETE",
      general: true,
    });
  }

  async function handleSave() {
    setToast(null);
    const billingErr = validateForm(billingForm, "Fatura Adresi");
    if (billingErr) {
      setToast(makeToast("error", billingErr));
      return;
    }
    if (!sameAsBilling) {
      const shippingErr = validateForm(shippingForm, "Kargo Adresi");
      if (shippingErr) {
        setToast(makeToast("error", shippingErr));
        return;
      }
    }

    setSaving(true);
    try {
      // Billing kaydı: ayrı kargo varsa isDefault=false, yoksa true.
      const newBilling = await upsertAddress(
        billingRow,
        BILLING_TITLE,
        billingForm,
        sameAsBilling, // ayni → fatura sipariş için kullanılır
      );
      setBillingRow(newBilling);
      setBillingForm(rowToForm(newBilling));

      if (sameAsBilling) {
        // Ayrı kargo adresi varsa sil — artık fatura adresi sipariş için kullanılır.
        if (shippingRow) {
          await deleteAddress(shippingRow.id);
          setShippingRow(null);
          setShippingForm({ ...EMPTY_FORM });
        }
      } else {
        const newShipping = await upsertAddress(
          shippingRow,
          SHIPPING_TITLE,
          shippingForm,
          true, // ayrı → kargo isDefault=true (sipariş bu adrese gider)
        );
        setShippingRow(newShipping);
        setShippingForm(rowToForm(newShipping));
      }

      // Sepet, "telefon eksik" kontrolünü Customer.phone üzerinden yapar
      // (CustomerAddress.phone sipariş validation'a bakmaz). Kullanıcı
      // adres formundan telefon girdiyse bunu hesap profiline de yansıt
      // — aksi halde kaydetmesine rağmen sipariş aşamasında hata alır.
      // Önce billing tercih edilir, yoksa ayrı kargo formundaki phone.
      const formPhone =
        billingForm.phone.trim() ||
        (sameAsBilling ? "" : shippingForm.phone.trim());
      if (formPhone) {
        const normalized = normalizeTrPhone(formPhone) ?? formPhone;
        const currentPhone = auth.customer?.phone?.trim() ?? "";
        if (normalized !== currentPhone) {
          try {
            const raw = await apiCustomer<unknown>("/me", {
              method: "PATCH",
              general: true,
              body: JSON.stringify({ phone: normalized }),
            });
            const updated =
              raw && typeof raw === "object" && "data" in raw
                ? (raw as { data: { phone?: string | null } }).data
                : (raw as { phone?: string | null });
            if (auth.customer) {
              auth.setCustomer({
                ...auth.customer,
                phone: updated?.phone ?? normalized,
              });
            }
          } catch (syncErr) {
            // Address save succeeded; phone sync failure is non-blocking.
            // Logged here so errors are visible without breaking the success toast.
            console.warn("[BillingAddressTab] phone sync failed:", syncErr);
          }
        }
      }

      setToast(makeToast("success", "Adres bilgileri kaydedildi."));
    } catch (err: unknown) {
      const msg =
        err instanceof ApiError ? err.message : "Adresler kaydedilemedi";
      setToast(makeToast("error", msg));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-32 animate-pulse rounded-3xl bg-slate-100" />
        <div className="h-64 animate-pulse rounded-3xl bg-slate-100" />
      </div>
    );
  }

  return (
    <>
      <Toast toast={toast} onDismiss={() => setToast(null)} />

      <div className="mx-auto max-w-3xl space-y-4">
        <AddressFormCard
          title="Fatura Adresi"
          icon={FileText}
          description="Faturalarınızda ve sipariş kayıtlarında kullanılır."
          form={billingForm}
          onChange={setBillingForm}
        />

        <section className="flex items-start gap-3 rounded-3xl border border-[var(--ab-border)] bg-white p-4 shadow-sm sm:p-5">
          <button
            type="button"
            role="switch"
            aria-checked={sameAsBilling}
            onClick={() => setSameAsBilling((v) => !v)}
            className={[
              "relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors",
              sameAsBilling ? "bg-[var(--ab-blue)]" : "bg-slate-300",
            ].join(" ")}
          >
            <span
              className={[
                "absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
                sameAsBilling ? "translate-x-5" : "translate-x-0",
              ].join(" ")}
            />
          </button>
          <div className="flex-1">
            <p className="text-sm font-black text-[var(--ab-text)]">
              Fatura adresim ile kargo adresim aynı
            </p>
            <p className="mt-0.5 text-xs text-slate-500">
              {sameAsBilling
                ? "Sipariş etiketleri ve kayıtlar fatura adresi üzerinden yapılır."
                : "Aşağıda ayrı bir kargo adresi tanımlayın."}
            </p>
          </div>
        </section>

        {sameAsBilling ? null : (
          <AddressFormCard
            title="Kargo Adresi"
            icon={Truck}
            description="Sipariş etiketleri bu adres üzerinden hazırlanır."
            form={shippingForm}
            onChange={setShippingForm}
          />
        )}

        <div className="flex items-center justify-between gap-3 rounded-3xl border border-blue-100 bg-blue-50 p-4 text-xs text-blue-900">
          <span className="flex items-center gap-2 font-semibold">
            <CheckCircle2 className="h-4 w-4" />
            Bu bilgiler sadece sizinle Toptan Budur arasında kullanılır;
            sipariş alıcısına yansımaz.
          </span>
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--ab-blue)] px-6 py-3 text-sm font-black text-white shadow-sm transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            <Save className="h-4 w-4" />
            {saving ? "Kaydediliyor…" : "Adresleri Kaydet"}
          </button>
        </div>
      </div>
    </>
  );
}

interface AddressFormCardProps {
  title: string;
  icon: typeof MapPin;
  description: string;
  form: AddressForm;
  onChange: (next: AddressForm) => void;
}

function AddressFormCard({
  title,
  icon: Icon,
  description,
  form,
  onChange,
}: AddressFormCardProps) {
  function patch<K extends keyof AddressForm>(key: K, value: AddressForm[K]) {
    onChange({ ...form, [key]: value });
  }

  const inputClass =
    "h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-[var(--ab-text)] outline-none transition focus:border-[var(--ab-blue)]";
  const labelClass = "mb-2 block text-sm font-black text-[var(--ab-text)]";

  return (
    <section className="rounded-3xl border border-[var(--ab-border)] bg-white p-4 shadow-sm sm:p-6">
      <header className="mb-4 flex items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-50 text-[var(--ab-blue)]">
          <Icon className="h-5 w-5" />
        </span>
        <div>
          <h3 className="text-lg font-black text-[var(--ab-text)] sm:text-xl">
            {title}
          </h3>
          <p className="mt-0.5 text-xs text-slate-500">{description}</p>
        </div>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="sm:col-span-2">
          <span className={labelClass}>
            Ad Soyad / Firma <span className="text-red-600">*</span>
          </span>
          <input
            type="text"
            maxLength={200}
            value={form.fullName}
            onChange={(e) => patch("fullName", e.target.value)}
            placeholder="Ad Soyad veya Firma Ünvanı"
            className={inputClass}
          />
        </label>

        <label>
          <span className={labelClass}>Telefon</span>
          <input
            type="tel"
            inputMode="numeric"
            maxLength={20}
            pattern="[0-9+\s()-]*"
            value={form.phone}
            onChange={(e) => patch("phone", e.target.value)}
            placeholder="+90 555 123 45 67"
            className={inputClass}
          />
        </label>

        <label>
          <span className={labelClass}>
            Posta kodu <span className="text-red-600">*</span>
          </span>
          <input
            type="text"
            inputMode="numeric"
            maxLength={10}
            pattern="[0-9]*"
            value={form.postalCode}
            onChange={(e) => patch("postalCode", e.target.value)}
            placeholder="34000"
            className={inputClass}
          />
        </label>

        <label className="sm:col-span-2">
          <span className={labelClass}>
            Adres <span className="text-red-600">*</span>
          </span>
          <input
            type="text"
            maxLength={300}
            value={form.line1}
            onChange={(e) => patch("line1", e.target.value)}
            placeholder="Mahalle, sokak, bina no, daire no"
            className={inputClass}
          />
        </label>

        <label>
          <span className={labelClass}>
            Şehir <span className="text-red-600">*</span>
          </span>
          <input
            type="text"
            maxLength={120}
            value={form.city}
            onChange={(e) => patch("city", e.target.value)}
            placeholder="İstanbul"
            className={inputClass}
          />
        </label>

        <label>
          <span className={labelClass}>İlçe</span>
          <input
            type="text"
            maxLength={120}
            value={form.district}
            onChange={(e) => patch("district", e.target.value)}
            placeholder="Kadıköy"
            className={inputClass}
          />
        </label>
      </div>
    </section>
  );
}

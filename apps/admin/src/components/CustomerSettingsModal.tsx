import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../lib/auth";
import {
  activateCustomer,
  deleteCustomer,
  fetchSupplierDiscounts,
  regenerateCustomerToken,
  resetCustomerPassword,
  updateCustomerProfile,
  updateSupplierDiscounts,
  type ActivateCustomerResult,
  type CustomerDetail,
  type CustomerSupplierDiscount,
} from "../lib/customers";
import { buildWelcomeWhatsAppUrl } from "../lib/dealerApplications";
import {
  canAccess,
  canSeeCostProfit,
  isPrivilegedAdmin,
} from "../lib/permissions";
import { useToast } from "./Toast";
import ConfirmDialog from "./ConfirmDialog";
import InvoiceBatchList from "./invoices/InvoiceBatchList";
import InvoiceBatchDetailModal from "./invoices/InvoiceBatchDetailModal";
import {
  fetchCustomerInvoiceBatches,
  type CustomerInvoiceBatchesResponse,
} from "../lib/invoices";

interface CustomerSettingsModalProps {
  customer: CustomerDetail;
  onClose: () => void;
  onDeleted: () => void;
}

interface FormState {
  name: string;
  email: string;
  phone: string;
  taxId: string;          // Vergi No / TC Kimlik No (tek alan; kaydederken ayrılır)
  vergiDairesi: string;
  companyTitle: string;
  mersisNumber: string;
  companyAddress: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  /** "Kâr İndirimi" (kardan) — global oran (string input). */
  profitDiscountPercent: string;
}

interface FormErrors {
  taxId?: string;
}

function endpointMissing(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 404 || err.status === 501);
}

function errorMessage(err: unknown, fallback: string): string {
  if (endpointMissing(err)) {
    return "Backend endpoint'i hazır değil. Lütfen backend ekibinden talep edin.";
  }
  return err instanceof Error ? err.message : fallback;
}

export default function CustomerSettingsModal({
  customer,
  onClose,
  onDeleted,
}: CustomerSettingsModalProps): React.ReactElement {
  const queryClient = useQueryClient();
  const toast = useToast();

  // Bu modaldaki yazma uçlarının tamamı (PATCH :id, token yenile, şifre
  // sıfırla, sil, tedarikçi indirimleri) backend'de OWNER/ADMIN. Çalışan
  // rolünde hepsi 403 döneceği için tetikleyicileri hiç göstermiyoruz.
  const canManageCustomer = isPrivilegedAdmin();
  // Kâr indirimi bölümleri "Maliyet & Kâr" yetkisine bağlı (matristen açılır).
  const canSeeProfit = canSeeCostProfit();

  const [form, setForm] = useState<FormState>({
    name: customer.name ?? "",
    email: customer.email ?? "",
    phone: customer.phone ?? "",
    taxId: customer.vergiNo ?? customer.tcKimlik ?? "",
    vergiDairesi: customer.vergiDairesi ?? "",
    companyTitle: customer.companyTitle ?? "",
    mersisNumber: customer.mersisNumber ?? "",
    companyAddress: customer.companyAddress ?? "",
    contactName: customer.contactName ?? "",
    contactPhone: customer.contactPhone ?? "",
    contactEmail: customer.contactEmail ?? "",
    profitDiscountPercent: String(customer.profitDiscountPercent ?? 0),
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [confirmDelete, setConfirmDelete] = useState<boolean>(false);
  const [confirmDeleteAgain, setConfirmDeleteAgain] = useState<boolean>(false);
  const [confirmReset, setConfirmReset] = useState<boolean>(false);
  const [confirmRegenerate, setConfirmRegenerate] = useState<boolean>(false);

  const supplierDiscountsQuery = useQuery<CustomerSupplierDiscount[]>({
    queryKey: ["customer-supplier-discounts", customer.id],
    queryFn: () => fetchSupplierDiscounts(customer.id),
    // GET :id/supplier-discounts "Maliyet & Kâr" yetkisine bağlı — yetkisizde
    // sorgu hiç atılmasın, modalda kalıcı "yüklenemedi" kutusu kalmasın.
    enabled: canSeeProfit,
  });

  const [supplierDiscountEdits, setSupplierDiscountEdits] = useState<
    Record<string, string>
  >({});
  // Tedarikçi-bazlı Admin İndirimi toggle'larının kaydedilmemiş yerel durumu.
  const [supplierAdminEdits, setSupplierAdminEdits] = useState<
    Record<string, boolean>
  >({});

  const supplierDiscountMutation = useMutation({
    mutationFn: () => {
      // Yalnızca dokunulan satırları gönder — dokunulmayan satırlar (eski liste
      // indirimi olanlar dâhil) backend'de korunur.
      const touched = new Set([
        ...Object.keys(supplierDiscountEdits),
        ...Object.keys(supplierAdminEdits),
      ]);
      const discounts = (supplierDiscountsQuery.data ?? [])
        .filter((d) => touched.has(d.supplierId))
        .map((d) => {
          const adminOn = supplierAdminEdits[d.supplierId] ?? d.adminDiscount;
          // Admin İndirimi açık → maliyet fiyatı; legacy off-list korunur.
          if (adminOn) {
            return { supplierId: d.supplierId, adminDiscount: true };
          }
          const raw = supplierDiscountEdits[d.supplierId];
          // raw "" (alanı boşalt) → override'ı tamamen kaldır (global'e dön).
          if (raw === "") {
            return { supplierId: d.supplierId, clearOverride: true };
          }
          // raw undefined (yalnız Admin kapatıldı) → Kâr İndirimi'ne DOKUNMA.
          if (raw === undefined) {
            return { supplierId: d.supplierId, adminDiscount: false };
          }
          const parsed = Number(raw);
          const value = Number.isFinite(parsed)
            ? Math.max(0, Math.min(100, Math.round(parsed)))
            : 0;
          return { supplierId: d.supplierId, profitDiscountPercent: value, adminDiscount: false };
        });
      return updateSupplierDiscounts(customer.id, discounts);
    },
    onSuccess: () => {
      toast.push("success", "Tedarikçi indirimleri kaydedildi");
      setSupplierDiscountEdits({});
      setSupplierAdminEdits({});
      void queryClient.invalidateQueries({
        queryKey: ["customer-supplier-discounts", customer.id],
      });
    },
    onError: (err) => {
      toast.push("error", errorMessage(err, "İndirimler kaydedilemedi"));
    },
  });

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const profileMutation = useMutation({
    mutationFn: () => {
      const profitDiscount = Math.max(
        0,
        Math.min(100, Math.round(Number(form.profitDiscountPercent) || 0)),
      );
      const t = form.taxId.trim();
      const isTc = /^\d{11}$/.test(t);
      return updateCustomerProfile(customer.id, {
        name: form.name.trim(),
        email: form.email.trim() || undefined,
        phone: form.phone.trim() || undefined,
        vergiNo: t === "" ? null : isTc ? null : t,
        tcKimlik: t === "" ? null : isTc ? t : null,
        vergiDairesi: form.vergiDairesi.trim() || null,
        companyTitle: form.companyTitle.trim() || null,
        mersisNumber: form.mersisNumber.trim() || null,
        companyAddress: form.companyAddress.trim() || null,
        contactName: form.contactName.trim() || null,
        contactPhone: form.contactPhone.trim() || null,
        contactEmail: form.contactEmail.trim() || null,
        profitDiscountPercent: profitDiscount,
      });
    },
    onSuccess: () => {
      toast.push("success", "Müşteri güncellendi");
      void queryClient.invalidateQueries({ queryKey: ["customer", customer.id] });
      void queryClient.invalidateQueries({ queryKey: ["customers"] });
    },
    onError: (err) => {
      toast.push("error", errorMessage(err, "Güncellenemedi"));
    },
  });

  // ── Faturalandırma toggle (birfatura.md §9) ───────────────────────────────
  // Anlık uygula: switch'e basınca optimistik çevir, hata olursa geri al.
  const [invoicingEnabled, setInvoicingEnabled] = useState<boolean>(
    customer.invoicingEnabled ?? true,
  );
  const [invoiceDetailBatchId, setInvoiceDetailBatchId] = useState<
    string | null
  >(null);

  const invoicingMutation = useMutation({
    mutationFn: (next: boolean) =>
      updateCustomerProfile(customer.id, { invoicingEnabled: next }),
    onSuccess: (_res, next) => {
      toast.push(
        "success",
        next
          ? "Faturalandırma açıldı — bu bayi konsolide kesimlere dahil edilir."
          : "Faturalandırma kapatıldı — bu bayinin siparişleri kesime girmez.",
      );
      void queryClient.invalidateQueries({ queryKey: ["customer", customer.id] });
      void queryClient.invalidateQueries({ queryKey: ["customers"] });
    },
    onError: (err, next) => {
      setInvoicingEnabled(!next); // optimistik değişikliği geri al
      toast.push("error", errorMessage(err, "Faturalandırma güncellenemedi"));
    },
  });

  function handleToggleInvoicing(): void {
    const next = !invoicingEnabled;
    setInvoicingEnabled(next);
    invoicingMutation.mutate(next);
  }

  // Fatura geçmişi 'ayarlar_fatura' sayfa iznine bağlı bir uçtan gelir;
  // izni olmayan (ör. çalışan) kullanıcıda sorguyu hiç atmıyoruz — aksi
  // halde modal içinde kalıcı "erişim yetkiniz yok" hatası duruyordu.
  const canSeeInvoices = canAccess("ayarlar_fatura");
  const customerInvoiceBatchesQuery = useQuery<CustomerInvoiceBatchesResponse>({
    queryKey: ["customer-invoice-batches", customer.id],
    queryFn: () => fetchCustomerInvoiceBatches(customer.id),
    enabled: canSeeInvoices,
  });

  function handleSaveProfile(): void {
    const next: FormErrors = {};
    const t = form.taxId.trim();
    if (t && !/^\d{10}$/.test(t) && !/^\d{11}$/.test(t)) {
      next.taxId = "10 haneli VKN ya da 11 haneli TC Kimlik No girin.";
    }
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    profileMutation.mutate();
  }

  const regenerateMutation = useMutation({
    mutationFn: () => regenerateCustomerToken(customer.id),
    onSuccess: (res) => {
      toast.push(
        "success",
        res.xmlToken
          ? `Yeni XML token üretildi: ${res.xmlToken.slice(0, 8)}…`
          : "XML token yenilendi",
      );
      void queryClient.invalidateQueries({ queryKey: ["customer", customer.id] });
      void queryClient.invalidateQueries({ queryKey: ["customers"] });
    },
    onError: (err) => {
      toast.push("error", errorMessage(err, "Token üretilemedi"));
    },
  });

  const resetPasswordMutation = useMutation({
    mutationFn: () => resetCustomerPassword(customer.id),
    onSuccess: (res) => {
      toast.push(
        "success",
        `Şifre sıfırlandı. Yeni şifre: ${res.password ?? "toptan1234"}`,
      );
    },
    onError: (err) => {
      toast.push("error", errorMessage(err, "Şifre sıfırlanamadı"));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteCustomer(customer.id),
    onSuccess: () => {
      toast.push("success", "Müşteri silindi");
      void queryClient.invalidateQueries({ queryKey: ["customers"] });
      onDeleted();
    },
    onError: (err) => {
      toast.push("error", errorMessage(err, "Silinemedi"));
    },
  });

  const [activateResult, setActivateResult] = useState<ActivateCustomerResult | null>(null);

  const activateMutation = useMutation({
    mutationFn: () => activateCustomer(customer.id),
    onSuccess: (result) => {
      setActivateResult(result);
      void queryClient.invalidateQueries({ queryKey: ["customer", customer.id] });
      void queryClient.invalidateQueries({ queryKey: ["customers"] });
      // Customers tarafından aktive etmek ilişkili DealerApplication + Form
      // kaydını da onaylar. Mesajlar sayfası bu cache key'lerden beslendiği
      // için onları da geçersiz kıl: drawer paneli "Onaylandı"ya döner ve
      // ilgili başvurunun bildirimi düşer.
      void queryClient.invalidateQueries({ queryKey: ["messages"] });
      void queryClient.invalidateQueries({ queryKey: ["forms", "count"] });
      void queryClient.invalidateQueries({ queryKey: ["dealer-applications"] });
    },
    onError: (err) => {
      toast.push("error", errorMessage(err, "Aktivasyon başarısız"));
    },
  });

  // Aktivasyon sonrası WhatsApp hoş geldin mesajı — bayi onay modalıyla aynı
  // içerik (giriş bilgileri + topluluk daveti). Telefon form'dan alınır;
  // geçersizse buton gizlenir.
  const activateWaUrl = activateResult
    ? buildWelcomeWhatsAppUrl(form.phone, {
        fullName: activateResult.customer.name,
        email: activateResult.customer.email,
        tempPassword: activateResult.oneTimePassword,
      })
    : null;

  return (
    <>
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="customer-settings-title"
        className="w-full max-w-xl rounded-xl border border-[var(--color-border)] bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-3">
          <h2
            id="customer-settings-title"
            className="text-lg font-semibold text-[var(--color-text)]"
          >
            Müşteri Ayarları
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            aria-label="Kapat"
          >
            ✕
          </button>
        </header>

        <div className="max-h-[75vh] space-y-5 overflow-y-auto px-5 py-4">
          {customer.isActive === false && !activateResult ? (
            <div className="flex items-center justify-between rounded-lg border border-orange-200 bg-orange-50 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-orange-800">Hesap pasif</p>
                <p className="text-xs text-orange-600 mt-0.5">
                  Müşteri henüz giriş yapamaz. Ayarları yapın, ardından aktive edin.
                </p>
              </div>
              <button
                type="button"
                onClick={() => activateMutation.mutate()}
                disabled={activateMutation.isPending}
                className="ml-4 shrink-0 rounded-md bg-orange-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-orange-700 disabled:opacity-60"
              >
                {activateMutation.isPending ? "Aktive ediliyor…" : "Aktive Et"}
              </button>
            </div>
          ) : null}

          {activateResult ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 space-y-1">
              <p className="text-sm font-medium text-emerald-800">Hesap aktive edildi!</p>
              <p className="text-xs text-emerald-700">
                Hoş geldin e-postası gönderildi. Geçici şifre:
              </p>
              <code className="block rounded bg-white border border-emerald-200 px-2 py-1 text-sm font-mono text-emerald-900 select-all">
                {activateResult.oneTimePassword}
              </code>
              <p className="text-xs text-emerald-600">
                Bu şifreyi şimdi kopyalayın — bir daha görüntülenemez.
              </p>
              {activateWaUrl ? (
                <button
                  type="button"
                  onClick={() =>
                    window.open(activateWaUrl, "_blank", "noopener,noreferrer")
                  }
                  className="mt-1 rounded-md bg-[#25D366] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1ebe57]"
                >
                  WhatsApp&apos;ta Aç ve Gönder
                </button>
              ) : (
                <p className="text-[11px] text-emerald-600">
                  Telefon numarası yok/geçersiz — WhatsApp mesajı açılamıyor.
                </p>
              )}
            </div>
          ) : null}

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase text-[var(--color-text-muted)]">
              Profil
            </h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block text-sm sm:col-span-2">
                <span className="mb-1 block text-xs text-[var(--color-text-muted)]">Ad Soyad</span>
                <input type="text" value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm" />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-xs text-[var(--color-text-muted)]">E-posta</span>
                <input type="email" value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="w-full rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm" />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-xs text-[var(--color-text-muted)]">Telefon</span>
                <input type="tel" value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  className="w-full rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm" />
              </label>

              <label className="block text-sm sm:col-span-2">
                <span className="mb-1 block text-xs text-[var(--color-text-muted)]">Firma Ünvanı</span>
                <input type="text" maxLength={200} placeholder="Örn. Yılmaz Ticaret Ltd. Şti." value={form.companyTitle}
                  onChange={(e) => setForm({ ...form, companyTitle: e.target.value })}
                  className="w-full rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm" />
              </label>

              <label className="block text-sm">
                <span className="mb-1 block text-xs text-[var(--color-text-muted)]">Vergi No / TC Kimlik No</span>
                <input type="text" inputMode="numeric" maxLength={11} placeholder="10 (VKN) veya 11 (TC) hane"
                  value={form.taxId}
                  onChange={(e) => {
                    setForm({ ...form, taxId: e.target.value.replace(/\D/g, "") });
                    if (errors.taxId) setErrors({ ...errors, taxId: undefined });
                  }}
                  aria-invalid={!!errors.taxId}
                  className={`w-full rounded-md border bg-white px-3 py-2 text-sm ${
                    errors.taxId ? "border-red-500 focus:border-red-500" : "border-[var(--color-border)]"
                  }`} />
                {errors.taxId ? (
                  <span className="mt-1 block text-xs text-red-600">{errors.taxId}</span>
                ) : null}
              </label>

              <label className="block text-sm">
                <span className="mb-1 block text-xs text-[var(--color-text-muted)]">Vergi Dairesi</span>
                <input type="text" maxLength={200} placeholder="Örn. Kadıköy V.D." value={form.vergiDairesi}
                  onChange={(e) => setForm({ ...form, vergiDairesi: e.target.value })}
                  className="w-full rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm" />
              </label>

              <label className="block text-sm">
                <span className="mb-1 block text-xs text-[var(--color-text-muted)]">Mersis No</span>
                <input type="text" maxLength={50} value={form.mersisNumber}
                  onChange={(e) => setForm({ ...form, mersisNumber: e.target.value })}
                  className="w-full rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm" />
              </label>

              <label className="block text-sm sm:col-span-2">
                <span className="mb-1 block text-xs text-[var(--color-text-muted)]">Firma Adresi</span>
                <textarea rows={2} maxLength={500} value={form.companyAddress}
                  onChange={(e) => setForm({ ...form, companyAddress: e.target.value })}
                  className="w-full rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm" />
                <span className="mt-1 block text-xs text-[var(--color-text-muted)]">
                  Opsiyonel kurumsal referans. Boş bırakılırsa müşterinin varsayılan
                  adres defteri kullanılır — adres "eksik" sayılmaz.
                </span>
              </label>

              <label className="block text-sm">
                <span className="mb-1 block text-xs text-[var(--color-text-muted)]">İletişim Kişisi</span>
                <input type="text" maxLength={200} value={form.contactName}
                  onChange={(e) => setForm({ ...form, contactName: e.target.value })}
                  className="w-full rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm" />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-xs text-[var(--color-text-muted)]">İletişim Telefon</span>
                <input type="tel" value={form.contactPhone}
                  onChange={(e) => setForm({ ...form, contactPhone: e.target.value })}
                  className="w-full rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm" />
              </label>
              <label className="block text-sm sm:col-span-2">
                <span className="mb-1 block text-xs text-[var(--color-text-muted)]">İletişim E-posta</span>
                <input type="email" value={form.contactEmail}
                  onChange={(e) => setForm({ ...form, contactEmail: e.target.value })}
                  className="w-full rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm" />
              </label>

              {canManageCustomer ? (
                <label className="block text-sm">
                  <span className="mb-1 block text-xs text-[var(--color-text-muted)]">
                    Kâr İndirimi (%)
                  </span>
                  <input type="number" min={0} max={100} step={1} value={form.profitDiscountPercent}
                    onChange={(e) => setForm({ ...form, profitDiscountPercent: e.target.value })}
                    title="Kârdan indirim — maliyetin altına inmez. %100 = maliyet + paketleme."
                    className="w-full rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm" />
                </label>
              ) : null}
            </div>
            {canManageCustomer ? (
              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  onClick={handleSaveProfile}
                  disabled={profileMutation.isPending}
                  className="rounded-md bg-[var(--color-brand-blue)] px-3 py-1.5 text-sm text-white hover:bg-[var(--color-brand-navy)] disabled:opacity-60"
                >
                  {profileMutation.isPending ? "Kaydediliyor…" : "Profili Kaydet"}
                </button>
              </div>
            ) : null}
          </section>

          {/* Faturalandırma toggle'ı PATCH :id ile yazar → OWNER/ADMIN. */}
          {canManageCustomer && (
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase text-[var(--color-text-muted)]">
              Faturalandırma
            </h3>
            <div className="flex items-center justify-between rounded-lg border border-[var(--color-border)] bg-white px-4 py-3">
              <div className="pr-4">
                <p className="text-sm font-medium text-[var(--color-text)]">
                  Konsolide fatura kesimi
                </p>
                <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                  {invoicingEnabled
                    ? "Açık — kargolanmış siparişler aylık konsolide e-faturaya dahil edilir."
                    : "Kapalı — bu bayinin siparişleri hiçbir kesime (freeze) girmez."}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={invoicingEnabled}
                aria-label="Konsolide fatura kesimi"
                onClick={handleToggleInvoicing}
                disabled={invoicingMutation.isPending}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-60 ${
                  invoicingEnabled
                    ? "bg-[var(--color-brand-blue)]"
                    : "bg-slate-300"
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                    invoicingEnabled ? "translate-x-5" : "translate-x-0.5"
                  }`}
                />
              </button>
            </div>
            <p className="mt-2 text-xs text-[var(--color-text-muted)]">
              E-fatura yukarıdaki <strong>Firma Ünvanı / Vergi No / Vergi
              Dairesi / Firma Adresi / E-posta</strong> alanlarından üretilir;
              eksik bilgi faturanın hatalı düşmesine yol açar.
            </p>
          </section>
          )}

          {canSeeInvoices && (
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase text-[var(--color-text-muted)]">
              Fatura Geçmişi
            </h3>
            {customerInvoiceBatchesQuery.isError ? (
              <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {customerInvoiceBatchesQuery.error instanceof Error
                  ? customerInvoiceBatchesQuery.error.message
                  : "Fatura geçmişi yüklenemedi"}
              </p>
            ) : (
              <InvoiceBatchList
                months={customerInvoiceBatchesQuery.data?.months ?? []}
                onSelect={setInvoiceDetailBatchId}
                isLoading={customerInvoiceBatchesQuery.isLoading}
              />
            )}
          </section>
          )}

          {canSeeProfit && (
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase text-[var(--color-text-muted)]">
              Tedarikçi Bazlı İndirim
            </h3>
            {supplierDiscountsQuery.isPending ? (
              <p className="text-xs text-[var(--color-text-muted)]">Yükleniyor…</p>
            ) : supplierDiscountsQuery.isError ? (
              <p className="text-xs text-red-600">Tedarikçi indirimleri yüklenemedi.</p>
            ) : (supplierDiscountsQuery.data ?? []).length === 0 ? (
              <p className="text-xs text-[var(--color-text-muted)]">
                Henüz tedarikçi tanımlı değil.
              </p>
            ) : (
              <div className="overflow-hidden rounded-md border border-[var(--color-border)]">
                <table className="w-full text-sm">
                  <thead className="bg-[var(--color-surface-muted)]">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-medium text-[var(--color-text-muted)]">
                        Tedarikçi
                      </th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-[var(--color-text-muted)]">
                        Kâr İndirimi (%)
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-border)]">
                    {(supplierDiscountsQuery.data ?? []).map((d) => {
                      const adminOn =
                        supplierAdminEdits[d.supplierId] ?? d.adminDiscount;
                      const editVal = supplierDiscountEdits[d.supplierId];
                      const displayVal =
                        editVal !== undefined
                          ? editVal
                          : d.profitDiscountPercent !== null
                            ? String(d.profitDiscountPercent)
                            : "";
                      return (
                        <tr key={d.supplierId} className="bg-white">
                          <td className="px-3 py-2 text-[var(--color-text)]">
                            {d.supplierName}
                            {d.discountPercent !== null && d.discountPercent > 0 ? (
                              <span className="mt-0.5 block text-[10px] text-amber-600">
                                Eski liste indirimi: %{d.discountPercent}
                              </span>
                            ) : null}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center justify-end gap-2">
                              {adminOn ? (
                                <span className="rounded-md bg-emerald-100 px-2 py-1 text-[11px] font-semibold text-emerald-700">
                                  Maliyet + paketleme
                                </span>
                              ) : (
                                <input
                                  type="number"
                                  min={0}
                                  max={100}
                                  step={1}
                                  placeholder={`Genel: ${form.profitDiscountPercent}%`}
                                  title="Kâr İndirimi % (kardan). %100 = maliyet. Boş = global."
                                  value={displayVal}
                                  onChange={(e) =>
                                    setSupplierDiscountEdits({
                                      ...supplierDiscountEdits,
                                      [d.supplierId]: e.target.value,
                                    })
                                  }
                                  className="w-24 rounded-md border border-[var(--color-border)] bg-white px-2 py-1 text-right text-sm"
                                />
                              )}
                              <button
                                type="button"
                                onClick={() =>
                                  setSupplierAdminEdits({
                                    ...supplierAdminEdits,
                                    [d.supplierId]: !adminOn,
                                  })
                                }
                                title="Admin İndirimi: ürünler maliyet + paketleme (4,80) fiyatından satılır"
                                className={`rounded-md border px-2 py-1 text-[11px] font-semibold ${
                                  adminOn
                                    ? "border-emerald-300 bg-emerald-600 text-white"
                                    : "border-[var(--color-border)] bg-white text-[var(--color-text-muted)] hover:border-emerald-300 hover:text-emerald-700"
                                }`}
                              >
                                Admin
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {(supplierDiscountsQuery.data ?? []).length > 0 ? (
              <div className="mt-2 flex items-center justify-between gap-2">
                <p className="text-xs text-[var(--color-text-muted)]">
                  Boş bırakılan satır global Kâr İndirimi (
                  <strong>{form.profitDiscountPercent}%</strong>) kullanır. %100 ⇒ maliyet.
                </p>
                <button
                  type="button"
                  onClick={() => supplierDiscountMutation.mutate()}
                  disabled={
                    supplierDiscountMutation.isPending ||
                    (Object.keys(supplierDiscountEdits).length === 0 &&
                      Object.keys(supplierAdminEdits).length === 0)
                  }
                  className="rounded-md bg-[var(--color-brand-blue)] px-3 py-1.5 text-sm text-white hover:bg-[var(--color-brand-navy)] disabled:opacity-60"
                >
                  {supplierDiscountMutation.isPending
                    ? "Kaydediliyor…"
                    : "İndirimleri Kaydet"}
                </button>
              </div>
            ) : null}
          </section>
          )}

          {/* Token yenile / şifre sıfırla uçları OWNER/ADMIN. */}
          {canManageCustomer && (
          <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3">
            <h3 className="mb-2 text-xs font-semibold uppercase text-[var(--color-text-muted)]">
              Güvenlik &amp; Erişim
            </h3>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setConfirmRegenerate(true)}
                disabled={regenerateMutation.isPending}
                className="rounded-md border border-[var(--color-border)] bg-white px-3 py-1.5 text-sm hover:bg-white/70 disabled:opacity-60"
              >
                {regenerateMutation.isPending
                  ? "Üretiliyor…"
                  : "XML Token Yenile"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmReset(true)}
                disabled={resetPasswordMutation.isPending}
                className="rounded-md border border-[var(--color-border)] bg-white px-3 py-1.5 text-sm hover:bg-white/70 disabled:opacity-60"
              >
                {resetPasswordMutation.isPending
                  ? "Sıfırlanıyor…"
                  : "Şifreyi Sıfırla (toptan1234)"}
              </button>
            </div>
            <p className="mt-2 text-xs text-[var(--color-text-muted)]">
              Token yenilendiğinde eski XML linki çalışmaz; müşteriye yeni link
              iletmeyi unutmayın. Şifre sıfırlamada yeni varsayılan parola
              <strong> toptan1234</strong> olur.
            </p>
          </section>
          )}

          {/* Silme (DELETE :id) OWNER/ADMIN — çalışanda blok hiç görünmez. */}
          {canManageCustomer && (
          <section className="rounded-lg border border-red-200 bg-red-50 p-3">
            <h3 className="mb-2 text-xs font-semibold uppercase text-red-800">
              Tehlikeli Bölge
            </h3>
            <p className="mb-3 text-xs text-red-700">
              Müşteriyi kalıcı olarak silmek geri alınamaz; ilgili siparişler
              müşteri kaydı olmadan kalır.
            </p>
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              disabled={deleteMutation.isPending}
              className="rounded-md bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700 disabled:opacity-60"
            >
              {deleteMutation.isPending ? "Siliniyor…" : "Müşteriyi Sil"}
            </button>
          </section>
          )}
        </div>
      </div>

      {confirmRegenerate ? (
        <ConfirmDialog
          title="XML token yenilensin mi?"
          message="Yeni token üretildiğinde eski XML feed adresi çalışmaz. Devam edilsin mi?"
          confirmLabel="Yenile"
          onCancel={() => setConfirmRegenerate(false)}
          onConfirm={() => {
            setConfirmRegenerate(false);
            regenerateMutation.mutate();
          }}
        />
      ) : null}

      {confirmReset ? (
        <ConfirmDialog
          title="Şifre sıfırlansın mı?"
          message="Müşterinin şifresi varsayılan değere (toptan1234) sıfırlanacak. Devam edilsin mi?"
          confirmLabel="Sıfırla"
          onCancel={() => setConfirmReset(false)}
          onConfirm={() => {
            setConfirmReset(false);
            resetPasswordMutation.mutate();
          }}
        />
      ) : null}

      {confirmDelete ? (
        <ConfirmDialog
          title="Müşteri silinsin mi?"
          message={`"${customer.name ?? customer.email ?? customer.id}" kalıcı olarak silinecek. Bu işlem geri alınamaz.`}
          confirmLabel="Devam et"
          destructive
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => {
            setConfirmDelete(false);
            setConfirmDeleteAgain(true);
          }}
        />
      ) : null}

      {confirmDeleteAgain ? (
        <ConfirmDialog
          title="EMİN MİSİNİZ?"
          message="Son onay: bu müşteri ve ilgili tüm bağlı veriler silinecek. Yine de devam etmek istiyor musunuz?"
          confirmLabel="Evet, sil"
          destructive
          onCancel={() => setConfirmDeleteAgain(false)}
          onConfirm={() => {
            setConfirmDeleteAgain(false);
            deleteMutation.mutate();
          }}
        />
      ) : null}
    </div>

    {/* Fatura detayı, ana modalın backdrop'unun DIŞINDA render edilir;
        aksi halde detay modalının backdrop click'i bubble olup
        Müşteri Ayarları modalını da kapatır. */}
    {invoiceDetailBatchId ? (
      <InvoiceBatchDetailModal
        batchId={invoiceDetailBatchId}
        onClose={() => setInvoiceDetailBatchId(null)}
      />
    ) : null}
    </>
  );
}

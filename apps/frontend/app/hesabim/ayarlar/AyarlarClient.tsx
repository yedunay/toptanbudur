"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiCustomer, ApiError } from "@/lib/auth";
import { useAuth } from "@/components/AuthProvider";
import { normalizeTrPhone, validateTrPhone } from "@/lib/forms";
import {
  Toast,
  makeToast,
  type ToastState,
} from "@/components/account-shared/Toast";
import type { CustomerProfile } from "@/lib/customer-types";
import { BillingAddressTab } from "./BillingAddressTab";
import {
  Bell,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CreditCard,
  Eye,
  EyeOff,
  FileText,
  Globe,
  Headphones,
  KeyRound,
  Languages,
  LockKeyhole,
  Mail,
  PackageX,
  PauseCircle,
  Phone,
  PlayCircle,
  RefreshCcw,
  Save,
  ShieldCheck,
  UserRound,
  UsersRound,
  XCircle,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type SettingsTabKey =
  | "profile"
  | "password"
  | "security"
  | "iade"
  | "notifications"
  | "users"
  | "billing";

interface SettingsTab {
  key: SettingsTabKey;
  label: string;
  icon: typeof UserRound;
}

const SETTINGS_TABS: SettingsTab[] = [
  { key: "profile", label: "Profil Bilgileri", icon: UserRound },
  { key: "password", label: "Şifre Değiştir", icon: LockKeyhole },
  { key: "security", label: "Güvenlik", icon: ShieldCheck },
  { key: "iade", label: "Tatil Modu", icon: PauseCircle },
  { key: "notifications", label: "Bildirim Tercihleri", icon: Bell },
  { key: "users", label: "Yetkili Kullanıcılar", icon: UsersRound },
  { key: "billing", label: "Fatura Bilgileri", icon: FileText },
];

interface ProfileFormState {
  fullName: string;
  email: string;
  phone: string;
  birthDate: string;
  language: string;
  timezone: string;
}

interface CompanyFormState {
  companyTitle: string;
  vergiNo: string;
  vergiDairesi: string;
  mersisNumber: string;
  companyAddress: string;
}

interface PasswordFormState {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HAS_LETTER = /[A-Za-zÇĞİÖŞÜçğıöşü]/;
const HAS_DIGIT = /\d/;

const LANGUAGES = [
  { value: "tr", label: "Türkçe" },
  { value: "en", label: "English" },
];

const TIMEZONES = [
  { value: "Europe/Istanbul", label: "(GMT+03:00) İstanbul" },
  { value: "Europe/London", label: "(GMT+00:00) Londra" },
  { value: "Europe/Berlin", label: "(GMT+01:00) Berlin" },
  { value: "America/New_York", label: "(GMT-05:00) New York" },
];

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export function AyarlarClient() {
  const router = useRouter();
  const { customer, setCustomer } = useAuth();
  const [tab, setTab] = useState<SettingsTabKey>("profile");
  const [toast, setToast] = useState<ToastState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Profile form
  const [profileForm, setProfileForm] = useState<ProfileFormState>({
    fullName: "",
    email: "",
    phone: "",
    birthDate: "",
    language: "tr",
    timezone: "Europe/Istanbul",
  });

  // Company form
  const [companyForm, setCompanyForm] = useState<CompanyFormState>({
    companyTitle: "",
    vergiNo: "",
    vergiDairesi: "",
    mersisNumber: "",
    companyAddress: "",
  });

  // Password form
  const [pwdForm, setPwdForm] = useState<PasswordFormState>({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [pwdErrors, setPwdErrors] = useState<Record<string, string>>({});
  const [pwdSubmitting, setPwdSubmitting] = useState(false);
  const [showCurrentPwd, setShowCurrentPwd] = useState(false);
  const [showNewPwd, setShowNewPwd] = useState(false);
  const [showConfirmPwd, setShowConfirmPwd] = useState(false);

  // Profile data for sidebar cards
  const [profileData, setProfileData] = useState<CustomerProfile | null>(null);

  // E-posta bildirim tercihleri (opsiyonel sipariş mailleri). İkisi de default açık.
  const [notif, setNotif] = useState({ confirm: true, status: true });
  const [notifBusy, setNotifBusy] = useState(false);

  const initials = useMemo(() => {
    const name = profileForm.fullName || customer?.name || "";
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "AB";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }, [profileForm.fullName, customer?.name]);

  // Load profile on mount
  useEffect(() => {
    if (!customer) return;
    let cancelled = false;
    apiCustomer<{ data: CustomerProfile } | CustomerProfile>("/me", {
      method: "GET",
      general: true,
    })
      .then((raw) => {
        if (cancelled) return;
        const p: CustomerProfile =
          raw && typeof raw === "object" && "data" in raw
            ? (raw as { data: CustomerProfile }).data
            : (raw as CustomerProfile);
        setProfileData(p);
        setProfileForm({
          fullName: p.name ?? "",
          email: p.email ?? "",
          phone: p.phone ? p.phone.replace(/^\+90/, "") : "",
          birthDate: p.birthDate ?? "",
          language: p.language ?? "tr",
          timezone: p.timezone ?? "Europe/Istanbul",
        });
        setCompanyForm({
          companyTitle: p.companyTitle ?? "",
          vergiNo: p.vergiNo ?? "",
          vergiDairesi: p.vergiDairesi ?? "",
          mersisNumber: p.mersisNumber ?? "",
          companyAddress: p.companyAddress ?? "",
        });
        setNotif({
          confirm: p.orderConfirmEmailEnabled ?? true,
          status: p.orderStatusEmailEnabled ?? true,
        });
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        // Fallback from auth context
        setProfileForm((prev) => ({
          ...prev,
          fullName: customer.name ?? "",
          email: customer.email ?? "",
          phone: customer.phone ? customer.phone.replace(/^\+90/, "") : "",
        }));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [customer]);

  // Read tab from URL hash on mount
  useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash.replace("#", "") as SettingsTabKey;
    if (SETTINGS_TABS.some((t) => t.key === hash)) {
      setTab(hash);
    }
  }, []);

  function selectTab(next: SettingsTabKey) {
    setTab(next);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.hash = next;
      window.history.replaceState({}, "", url.toString());
    }
  }

  /* ---------- Save All Profile/Company ---------- */
  const handleSaveAll = useCallback(
    async () => {
      // Required field validation
      if (!profileForm.fullName.trim()) {
        setToast(makeToast("error", "Ad Soyad alanı zorunludur"));
        return;
      }
      if (!EMAIL_RE.test(profileForm.email.trim())) {
        setToast(makeToast("error", "Geçerli bir e-posta adresi girin"));
        return;
      }
      if (profileForm.phone.trim()) {
        const phoneCheck = validateTrPhone(profileForm.phone, {
          required: false,
        });
        if (!phoneCheck.ok) {
          const msg: string = phoneCheck.reason ?? "Geçersiz telefon numarası";
          setToast(makeToast("error", msg));
          return;
        }
      }

      // Collect empty optional fields
      const emptyFields: string[] = [];
      if (!profileForm.phone.trim()) emptyFields.push("Telefon Numarası");
      if (!profileForm.birthDate.trim()) emptyFields.push("Doğum Tarihi");
      if (!companyForm.companyTitle.trim()) emptyFields.push("Firma Ünvanı");
      if (!companyForm.vergiNo.trim()) emptyFields.push("Vergi Numarası");
      if (!companyForm.vergiDairesi.trim()) emptyFields.push("Vergi Dairesi");
      if (!companyForm.mersisNumber.trim()) emptyFields.push("Mersis Numarası");
      if (!companyForm.companyAddress.trim()) emptyFields.push("Firma Adresi");

      setSaving(true);
      try {
        const phoneRaw = profileForm.phone.trim();
        const normalizedPhone = phoneRaw
          ? normalizeTrPhone(phoneRaw) ?? phoneRaw
          : null;

        const payload = {
          name: profileForm.fullName.trim(),
          email: profileForm.email.trim(),
          phone: normalizedPhone,
          birthDate: profileForm.birthDate.trim() || null,
          language: profileForm.language,
          timezone: profileForm.timezone,
          companyTitle: companyForm.companyTitle.trim() || null,
          vergiNo: companyForm.vergiNo.trim() || null,
          vergiDairesi: companyForm.vergiDairesi.trim() || null,
          mersisNumber: companyForm.mersisNumber.trim() || null,
          companyAddress: companyForm.companyAddress.trim() || null,
        };

        const raw = await apiCustomer<
          { data: CustomerProfile } | CustomerProfile
        >("/me", {
          method: "PATCH",
          general: true,
          body: JSON.stringify(payload),
        });

        const updated: CustomerProfile =
          raw && typeof raw === "object" && "data" in raw
            ? (raw as { data: CustomerProfile }).data
            : (raw as CustomerProfile);

        setProfileData(updated);
        // KRİTİK: PATCH /me yanıtı indirim/statü alanlarını (discountPercent,
        // supplierDiscounts, customerStatus, xmlToken, profileCompleted) içermez.
        // Bunları setCustomer ile ezdiğimizde katalog fiyatları sayfa yenilenene
        // kadar indirimsiz görünür. Çözüm: mevcut customer'ı koruyup yalnızca
        // backend'in döndürdüğü temel alanları üzerine yaz (merge), indirim/statü
        // alanlarını yanıt boş bıraktıysa eski değerleriyle muhafaza et.
        setCustomer({
          ...(customer ?? {}),
          id: updated.id,
          email: updated.email,
          name: updated.name,
          phone: updated.phone ?? null,
        });

        if (emptyFields.length > 0) {
          setToast(
            makeToast(
              "info",
              `Kaydedildi. Şu alanlar boş kaldı: ${emptyFields.join(", ")}`,
            ),
          );
        } else {
          setToast(makeToast("success", "Tüm bilgiler başarıyla kaydedildi"));
          setTimeout(() => router.push("/hesabim"), 1200);
        }
      } catch (err: unknown) {
        const msg =
          err instanceof ApiError ? err.message : "Profil güncellenemedi";
        setToast(makeToast("error", msg));
      } finally {
        setSaving(false);
      }
    },
    [profileForm, companyForm, customer, setCustomer, router],
  );

  /* ---------- Password Submit ---------- */
  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errors: Record<string, string> = {};
    if (!pwdForm.currentPassword)
      errors.currentPassword = "Mevcut şifrenizi girin";
    if (pwdForm.newPassword.length < 8) {
      errors.newPassword = "En az 8 karakter olmalı";
    } else if (
      !HAS_LETTER.test(pwdForm.newPassword) ||
      !HAS_DIGIT.test(pwdForm.newPassword)
    ) {
      errors.newPassword = "En az 1 harf ve 1 rakam içermeli";
    }
    if (pwdForm.confirmPassword !== pwdForm.newPassword) {
      errors.confirmPassword = "Şifreler eşleşmiyor";
    }
    setPwdErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setPwdSubmitting(true);
    try {
      await apiCustomer<unknown>("/me/password", {
        method: "PATCH",
        general: true,
        body: JSON.stringify({
          currentPassword: pwdForm.currentPassword,
          newPassword: pwdForm.newPassword,
        }),
      });
      setToast(makeToast("success", "Şifreniz başarıyla güncellendi"));
      setPwdForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        if (err.status === 400 || err.status === 401) {
          setPwdErrors({ currentPassword: err.message });
        } else {
          setToast(makeToast("error", err.message));
        }
      } else {
        setToast(makeToast("error", "Şifre güncellenemedi"));
      }
    } finally {
      setPwdSubmitting(false);
    }
  }

  // Bildirim tercihi toggle'ı — Tatil Modu gibi ANINDA kaydeder (ayrı buton yok).
  // Optimistik günceller; hata olursa eski değere geri döner.
  async function handleToggleNotif(key: "confirm" | "status", next: boolean) {
    if (notifBusy) return;
    const field =
      key === "confirm" ? "orderConfirmEmailEnabled" : "orderStatusEmailEnabled";
    setNotif((p) => ({ ...p, [key]: next }));
    setNotifBusy(true);
    try {
      await apiCustomer<unknown>("/me", {
        method: "PATCH",
        general: true,
        body: JSON.stringify({ [field]: next }),
      });
      setToast(makeToast("success", "Bildirim tercihiniz kaydedildi"));
    } catch {
      // geri al
      setNotif((p) => ({ ...p, [key]: !next }));
      setToast(makeToast("error", "Tercih kaydedilemedi, tekrar deneyin"));
    } finally {
      setNotifBusy(false);
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Render                                                             */
  /* ------------------------------------------------------------------ */

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-10 w-64 animate-pulse rounded-xl bg-slate-200" />
        <div className="h-80 animate-pulse rounded-3xl bg-slate-100" />
        <div className="h-60 animate-pulse rounded-3xl bg-slate-100" />
      </div>
    );
  }

  const languageLabel =
    LANGUAGES.find((l) => l.value === profileForm.language)?.label ?? "Türkçe";
  const timezoneLabel =
    TIMEZONES.find((t) => t.value === profileForm.timezone)?.label ??
    "(GMT+03:00) İstanbul";

  return (
    <>
      <Toast toast={toast} onDismiss={() => setToast(null)} />

      {/* Header with Save button */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-black tracking-tight text-[var(--ab-text)] sm:text-3xl">
            Hesap Ayarları
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Hesap bilgilerinizi görüntüleyebilir, düzenleyebilir ve güvenlik
            ayarlarınızı yönetebilirsiniz.
          </p>
        </div>
        {tab === "profile" && (
          <button
            type="button"
            onClick={handleSaveAll}
            disabled={saving}
            className="inline-flex items-center justify-center gap-2 self-start rounded-xl bg-[var(--ab-blue)] px-5 py-3 text-sm font-black text-white shadow-sm transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-slate-300 sm:self-auto"
          >
            <Save className="h-4 w-4" />
            {saving ? "Kaydediliyor…" : "Değişiklikleri Kaydet"}
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="-mx-4 overflow-x-auto border-b border-[var(--ab-border)] px-4 sm:mx-0 sm:px-0">
        <div className="flex min-w-max items-center gap-4 sm:gap-8">
          {SETTINGS_TABS.map((t) => {
            const Icon = t.icon;
            const isActive = t.key === tab;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => selectTab(t.key)}
                className={[
                  "inline-flex items-center gap-2 border-b-2 px-1 pb-3 pt-2 text-xs font-black transition sm:px-2 sm:pb-4 sm:text-sm",
                  isActive
                    ? "border-[var(--ab-blue)] text-[var(--ab-blue)]"
                    : "border-transparent text-slate-500 hover:text-[var(--ab-blue)]",
                ].join(" ")}
              >
                <Icon className="h-4 w-4" />
                <span className="hidden sm:inline">{t.label}</span>
                <span className="sm:hidden">
                  {t.label.split(" ")[0]}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab Content */}
      <div className="mt-6">
        {tab === "profile" && (
          <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
            {/* Left column - Forms */}
            <div className="space-y-4">
              {/* Kişisel Bilgiler */}
              <section className="rounded-3xl border border-[var(--ab-border)] bg-white p-4 shadow-sm sm:p-6">
                <h3 className="text-lg font-black text-[var(--ab-text)] sm:text-xl">
                  Kişisel Bilgiler
                </h3>
                <div className="mt-6 grid gap-6 lg:grid-cols-[200px_1fr]">
                  {/* Avatar — baş harf (initials) avatarı; fotoğraf yükleme
                      özelliği henüz yok, işlevsiz butonlar kaldırıldı. */}
                  <div className="flex flex-col items-center lg:items-start">
                    <p className="mb-3 text-sm font-black text-[var(--ab-text)]">
                      Profil Fotoğrafı
                    </p>
                    <div className="flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-blue-400 to-[var(--ab-blue)] text-3xl font-black text-white shadow-lg sm:h-28 sm:w-28 sm:text-4xl">
                      {initials}
                    </div>
                  </div>

                  {/* Form fields */}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField
                      label="Ad Soyad"
                      value={profileForm.fullName}
                      onChange={(v) =>
                        setProfileForm((p) => ({ ...p, fullName: v }))
                      }
                    />
                    <FormField
                      label="E-posta Adresi"
                      value={profileForm.email}
                      onChange={(v) =>
                        setProfileForm((p) => ({ ...p, email: v }))
                      }
                      type="email"
                      icon={Mail}
                    />
                    <PhoneField
                      label="Telefon Numarası"
                      value={profileForm.phone}
                      onChange={(v) =>
                        setProfileForm((p) => ({ ...p, phone: v }))
                      }
                    />
                    <FormField
                      label="Doğum Tarihi"
                      value={profileForm.birthDate}
                      onChange={(v) =>
                        setProfileForm((p) => ({ ...p, birthDate: v }))
                      }
                      type="date"
                      icon={CalendarDays}
                    />
                    <SelectField
                      label="Dil Tercihi"
                      value={profileForm.language}
                      displayValue={languageLabel}
                      options={LANGUAGES}
                      onChange={(v) =>
                        setProfileForm((p) => ({ ...p, language: v }))
                      }
                      icon={Languages}
                    />
                    <SelectField
                      label="Zaman Dilimi"
                      value={profileForm.timezone}
                      displayValue={timezoneLabel}
                      options={TIMEZONES}
                      onChange={(v) =>
                        setProfileForm((p) => ({ ...p, timezone: v }))
                      }
                      icon={Globe}
                    />
                  </div>
                </div>
              </section>

              {/* Firma Bilgileri */}
              <section className="rounded-3xl border border-[var(--ab-border)] bg-white p-4 shadow-sm sm:p-6">
                <h3 className="text-lg font-black text-[var(--ab-text)] sm:text-xl">
                  Firma Bilgileri
                </h3>
                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                  <FormField
                    label="Firma Ünvanı"
                    value={companyForm.companyTitle}
                    onChange={(v) =>
                      setCompanyForm((p) => ({ ...p, companyTitle: v }))
                    }
                  />
                  <FormField
                    label="Vergi No / TC Kimlik No"
                    value={companyForm.vergiNo}
                    placeholder="10 veya 11 hane"
                    hint="Şahıs şirketi ise 11 haneli TC Kimlik No, diğer şirketler için 10 haneli VKN giriniz"
                    maxLength={11}
                    inputMode="numeric"
                    onChange={(v) =>
                      setCompanyForm((p) => ({ ...p, vergiNo: v.replace(/\D/g, "") }))
                    }
                  />
                  <FormField
                    label="Vergi Dairesi"
                    value={companyForm.vergiDairesi}
                    onChange={(v) =>
                      setCompanyForm((p) => ({ ...p, vergiDairesi: v }))
                    }
                  />
                  <FormField
                    label="Mersis Numarası"
                    value={companyForm.mersisNumber}
                    onChange={(v) =>
                      setCompanyForm((p) => ({ ...p, mersisNumber: v }))
                    }
                  />
                  <div className="sm:col-span-2">
                    <label>
                      <span className="mb-2 block text-sm font-black text-[var(--ab-text)]">
                        Firma Adresi
                      </span>
                      <textarea
                        value={companyForm.companyAddress}
                        onChange={(e) =>
                          setCompanyForm((p) => ({
                            ...p,
                            companyAddress: e.target.value,
                          }))
                        }
                        rows={3}
                        className="w-full resize-none rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-[var(--ab-text)] outline-none transition focus:border-[var(--ab-blue)]"
                      />
                    </label>
                  </div>
                </div>
              </section>

              {/* Mobile: Save button at bottom */}
              <div className="sm:hidden">
                <button
                  type="button"
                  onClick={handleSaveAll}
                  disabled={saving}
                  className="w-full rounded-xl bg-[var(--ab-blue)] px-5 py-3 text-sm font-black text-white shadow-sm transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  <Save className="mr-2 inline-block h-4 w-4" />
                  {saving ? "Kaydediliyor…" : "Değişiklikleri Kaydet"}
                </button>
              </div>
            </div>

            {/* Right column - Cards */}
            <aside className="space-y-4">
              {/* Hesap Özeti */}
              <section className="rounded-3xl border border-[var(--ab-border)] bg-white p-5 shadow-sm sm:p-6">
                <h3 className="text-lg font-black text-[var(--ab-text)]">
                  Hesap Özeti
                </h3>
                <div className="mt-5 flex items-center gap-4">
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-3xl bg-green-50 text-green-600 sm:h-16 sm:w-16">
                    <ShieldCheck className="h-7 w-7 sm:h-8 sm:w-8" />
                  </div>
                  <div>
                    <p className="text-sm font-black text-[var(--ab-text)] sm:text-base">
                      Hesabınız güvende!
                    </p>
                    <p className="mt-1 text-xs text-slate-500 sm:text-sm">
                      Son giriş:{" "}
                      {new Date().toLocaleDateString("tr-TR", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                      })}{" "}
                      {new Date().toLocaleTimeString("tr-TR", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                </div>
              </section>

              {/* Hesap Doğrulama */}
              <section className="rounded-3xl border border-[var(--ab-border)] bg-white p-5 shadow-sm sm:p-6">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-lg font-black text-[var(--ab-text)]">
                    Hesap Doğrulama
                  </h3>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-3 py-1 text-xs font-black text-green-700">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Doğrulanmış
                  </span>
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-500">
                  Hesabınız e-posta ve telefon ile doğrulanmıştır.
                </p>
                <div className="mt-5 space-y-4">
                  <VerificationRow
                    label="E-posta Doğrulama"
                    value={profileForm.email}
                    verified
                    icon={Mail}
                  />
                  <VerificationRow
                    label="Telefon Doğrulama"
                    value={
                      profileForm.phone
                        ? `+90 ${profileForm.phone}`
                        : "Belirtilmemiş"
                    }
                    verified={!!profileForm.phone}
                    icon={Phone}
                  />
                </div>
              </section>

              {/* Hızlı İşlemler */}
              <section className="rounded-3xl border border-[var(--ab-border)] bg-white p-5 shadow-sm sm:p-6">
                <h3 className="text-lg font-black text-[var(--ab-text)]">
                  Hızlı İşlemler
                </h3>
                <div className="mt-4 space-y-2">
                  <QuickActionButton
                    icon={KeyRound}
                    label="Şifremi Değiştir"
                    tone="blue"
                    onClick={() => selectTab("password")}
                  />
                  <QuickActionButton
                    icon={LockKeyhole}
                    label="İki Adımlı Doğrulama"
                    tone="green"
                    onClick={() => selectTab("security")}
                  />
                  <QuickActionButton
                    icon={RefreshCcw}
                    label="Oturum Geçmişi"
                    tone="orange"
                    onClick={() => selectTab("security")}
                  />
                  <QuickActionButton
                    icon={XCircle}
                    label="Hesabımı Kapat"
                    tone="red"
                    onClick={() =>
                      setToast(
                        makeToast(
                          "info",
                          "Hesap kapatma için destek ile iletişime geçin",
                        ),
                      )
                    }
                  />
                </div>
              </section>

              {/* Yardım & Destek */}
              <section className="rounded-3xl border border-[var(--ab-border)] bg-white p-5 shadow-sm sm:p-6">
                <h3 className="text-lg font-black text-[var(--ab-text)]">
                  Yardım & Destek
                </h3>
                <p className="mt-3 text-sm leading-6 text-slate-500">
                  Hesap ayarları ile ilgili yardıma mı ihtiyacınız var?
                </p>
                <a
                  href="/hesabim/destek"
                  className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-blue-100 bg-white px-4 py-3 text-sm font-black text-[var(--ab-blue)] transition hover:bg-blue-50"
                >
                  <Headphones className="h-4 w-4" />
                  Destek Merkezi
                </a>
              </section>
            </aside>
          </div>
        )}

        {/* Password Tab */}
        {tab === "password" && (
          <div className="mx-auto max-w-lg">
            <section className="rounded-3xl border border-[var(--ab-border)] bg-white p-4 shadow-sm sm:p-6">
              <h3 className="text-xl font-black text-[var(--ab-text)]">
                Şifre Değiştir
              </h3>
              <p className="mt-2 text-sm text-slate-500">
                Güvenliğiniz için güçlü bir şifre belirleyin.
              </p>
              <form
                onSubmit={handlePasswordSubmit}
                noValidate
                className="mt-6 space-y-5"
              >
                <div>
                  <label
                    htmlFor="currentPassword"
                    className="mb-2 block text-sm font-black text-[var(--ab-text)]"
                  >
                    Mevcut Şifre
                  </label>
                  <div className="relative">
                    <input
                      id="currentPassword"
                      type={showCurrentPwd ? "text" : "password"}
                      autoComplete="current-password"
                      maxLength={120}
                      value={pwdForm.currentPassword}
                      onChange={(e) =>
                        setPwdForm((p) => ({
                          ...p,
                          currentPassword: e.target.value,
                        }))
                      }
                      className={[
                        "h-12 w-full rounded-xl border bg-white px-4 pr-12 text-sm font-semibold text-[var(--ab-text)] outline-none transition focus:border-[var(--ab-blue)]",
                        pwdErrors.currentPassword
                          ? "border-red-400"
                          : "border-slate-200",
                      ].join(" ")}
                    />
                    <button
                      type="button"
                      onClick={() => setShowCurrentPwd((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                      aria-label={
                        showCurrentPwd ? "Şifreyi gizle" : "Şifreyi göster"
                      }
                    >
                      {showCurrentPwd ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                  {pwdErrors.currentPassword && (
                    <p className="mt-1 text-xs text-red-600">
                      {pwdErrors.currentPassword}
                    </p>
                  )}
                </div>

                <div>
                  <label
                    htmlFor="newPassword"
                    className="mb-2 block text-sm font-black text-[var(--ab-text)]"
                  >
                    Yeni Şifre
                  </label>
                  <div className="relative">
                    <input
                      id="newPassword"
                      type={showNewPwd ? "text" : "password"}
                      autoComplete="new-password"
                      maxLength={120}
                      value={pwdForm.newPassword}
                      onChange={(e) =>
                        setPwdForm((p) => ({
                          ...p,
                          newPassword: e.target.value,
                        }))
                      }
                      className={[
                        "h-12 w-full rounded-xl border bg-white px-4 pr-12 text-sm font-semibold text-[var(--ab-text)] outline-none transition focus:border-[var(--ab-blue)]",
                        pwdErrors.newPassword
                          ? "border-red-400"
                          : "border-slate-200",
                      ].join(" ")}
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPwd((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                      aria-label={
                        showNewPwd ? "Şifreyi gizle" : "Şifreyi göster"
                      }
                    >
                      {showNewPwd ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                  {pwdErrors.newPassword && (
                    <p className="mt-1 text-xs text-red-600">
                      {pwdErrors.newPassword}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-slate-500">
                    En az 8 karakter, 1 harf ve 1 rakam içermelidir.
                  </p>
                </div>

                <div>
                  <label
                    htmlFor="confirmPassword"
                    className="mb-2 block text-sm font-black text-[var(--ab-text)]"
                  >
                    Yeni Şifre (Tekrar)
                  </label>
                  <div className="relative">
                    <input
                      id="confirmPassword"
                      type={showConfirmPwd ? "text" : "password"}
                      autoComplete="new-password"
                      maxLength={120}
                      value={pwdForm.confirmPassword}
                      onChange={(e) =>
                        setPwdForm((p) => ({
                          ...p,
                          confirmPassword: e.target.value,
                        }))
                      }
                      className={[
                        "h-12 w-full rounded-xl border bg-white px-4 pr-12 text-sm font-semibold text-[var(--ab-text)] outline-none transition focus:border-[var(--ab-blue)]",
                        pwdErrors.confirmPassword
                          ? "border-red-400"
                          : "border-slate-200",
                      ].join(" ")}
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPwd((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                      aria-label={
                        showConfirmPwd ? "Şifreyi gizle" : "Şifreyi göster"
                      }
                    >
                      {showConfirmPwd ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                  {pwdErrors.confirmPassword && (
                    <p className="mt-1 text-xs text-red-600">
                      {pwdErrors.confirmPassword}
                    </p>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={pwdSubmitting}
                  className="w-full rounded-xl bg-[var(--ab-blue)] px-6 py-3 text-sm font-black text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {pwdSubmitting ? "Kaydediliyor…" : "Şifreyi Güncelle"}
                </button>
              </form>
            </section>
          </div>
        )}

        {/* Security Tab */}
        {tab === "security" && (
          <div className="mx-auto max-w-2xl">
            <section className="rounded-3xl border border-[var(--ab-border)] bg-white p-4 shadow-sm sm:p-6">
              <h3 className="text-xl font-black text-[var(--ab-text)]">
                Güvenlik Ayarları
              </h3>
              <p className="mt-2 text-sm text-slate-500">
                İki adımlı doğrulama ve oturum yönetimi.
              </p>
              <div className="mt-6 space-y-4">
                <div className="flex items-center justify-between rounded-2xl border border-[var(--ab-border)] p-4">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-green-50 text-green-600">
                      <LockKeyhole className="h-5 w-5" />
                    </span>
                    <div>
                      <p className="text-sm font-black text-[var(--ab-text)]">
                        İki Adımlı Doğrulama
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        Hesabınıza ekstra güvenlik katmanı ekleyin
                      </p>
                    </div>
                  </div>
                  <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-black text-amber-700">
                    Yakında
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-2xl border border-[var(--ab-border)] p-4">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-50 text-orange-600">
                      <RefreshCcw className="h-5 w-5" />
                    </span>
                    <div>
                      <p className="text-sm font-black text-[var(--ab-text)]">
                        Oturum Geçmişi
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        Son giriş yapılan cihaz ve konumları görüntüleyin
                      </p>
                    </div>
                  </div>
                  <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-black text-amber-700">
                    Yakında
                  </span>
                </div>
              </div>
            </section>
          </div>
        )}

        {/* Tatil Modu Tab */}
        {tab === "iade" && (
          <div className="mx-auto max-w-2xl">
            <IadeSystemTab
              profile={profileData}
              onProfileUpdate={(next) => setProfileData(next)}
              onToast={(t) => setToast(t)}
            />
          </div>
        )}

        {/* Notifications Tab */}
        {tab === "notifications" && (
          <div className="mx-auto max-w-2xl space-y-6">
            {/* Opsiyonel — müşteri kapatabilir, anında kaydedilir */}
            <section className="rounded-3xl border border-[var(--ab-border)] bg-white p-4 shadow-sm sm:p-6">
              <h3 className="text-xl font-black text-[var(--ab-text)]">
                E-posta Bildirim Tercihleri
              </h3>
              <p className="mt-2 text-sm text-slate-500">
                Aşağıdaki sipariş bilgilendirme e-postalarını dilediğiniz zaman
                açıp kapatabilirsiniz. Değişiklik anında kaydedilir.
              </p>
              <div className="mt-6 space-y-4">
                <NotificationToggle
                  label="Sipariş onayı (Siparişiniz alındı)"
                  description="Yeni siparişiniz oluşturulduğunda gönderilen onay e-postası."
                  checked={notif.confirm}
                  disabled={notifBusy}
                  onChange={(v) => handleToggleNotif("confirm", v)}
                />
                <NotificationToggle
                  label="Sipariş durumu güncellemeleri"
                  description="Siparişiniz hazırlanıyor / kargoya verildi gibi durum e-postaları."
                  checked={notif.status}
                  disabled={notifBusy}
                  onChange={(v) => handleToggleNotif("status", v)}
                />
              </div>
            </section>

            {/* Zorunlu — kapatılamaz */}
            <section className="rounded-3xl border border-[var(--ab-border)] bg-white p-4 shadow-sm sm:p-6">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-[var(--ab-blue)]" />
                <h3 className="text-xl font-black text-[var(--ab-text)]">
                  Zorunlu Bildirimler
                </h3>
              </div>
              <p className="mt-2 text-sm text-slate-500">
                Bu e-postalar hesap güvenliğiniz ve siparişlerinizin takibi için
                gereklidir; kapatılamaz ve her durumda gönderilir.
              </p>
              <div className="mt-6 space-y-4">
                <NotificationToggle
                  locked
                  checked
                  label="Sipariş iptali ve iade"
                  description="Siparişiniz iptal edildiğinde veya bedeli cari hesabınıza iade edildiğinde."
                />
                <NotificationToggle
                  locked
                  checked
                  label="Destek talepleri"
                  description="Destek talebiniz alındığında ve yanıtlandığında."
                />
                <NotificationToggle
                  locked
                  checked
                  label="Mesaj ve iade mesajları"
                  description="Talepleriniz ve iade sürecinizle ilgili mesaj bildirimleri."
                />
                <NotificationToggle
                  locked
                  checked
                  label="Şifre değişikliği"
                  description="Hesap şifreniz değiştirildiğinde gönderilen güvenlik bildirimi."
                />
                <NotificationToggle
                  locked
                  checked
                  label="Cari ve ödeme işlemleri"
                  description="Cari yükleme/ödeme talepleriniz ve onay/ret sonuçları."
                />
                <NotificationToggle
                  locked
                  checked
                  label="Bayilik işlemleri"
                  description="Bayilik başvurunuz ve onay bilgileriniz."
                />
              </div>
            </section>
          </div>
        )}

        {/* Users Tab */}
        {tab === "users" && (
          <div className="mx-auto max-w-2xl">
            <section className="rounded-3xl border border-[var(--ab-border)] bg-white p-4 shadow-sm sm:p-6">
              <h3 className="text-xl font-black text-[var(--ab-text)]">
                Yetkili Kullanıcılar
              </h3>
              <p className="mt-2 text-sm text-slate-500">
                Hesabınıza erişim yetkisi olan kullanıcıları yönetin.
              </p>
              <div className="mt-6 rounded-2xl border border-dashed border-[var(--ab-border)] bg-slate-50 p-8 text-center">
                <UsersRound className="mx-auto h-10 w-10 text-slate-400" />
                <p className="mt-3 text-sm font-bold text-[var(--ab-text)]">
                  Bu özellik çok yakında aktif olacak
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Alt kullanıcı ekleme ve yetki yönetimi üzerinde çalışıyoruz.
                </p>
              </div>
            </section>
          </div>
        )}

        {/* Billing Tab — Fatura + Kargo Adresi yönetimi */}
        {tab === "billing" && <BillingAddressTab />}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

interface FormFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  icon?: typeof Mail;
  placeholder?: string;
  hint?: string;
  maxLength?: number;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
}

function FormField({
  label,
  value,
  onChange,
  type = "text",
  icon: Icon,
  placeholder,
  hint,
  maxLength,
  inputMode,
}: FormFieldProps) {
  return (
    <label>
      <span className="mb-2 block text-sm font-black text-[var(--ab-text)]">
        {label}
      </span>
      <div className="relative">
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          maxLength={maxLength}
          inputMode={inputMode}
          className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-[var(--ab-text)] outline-none transition focus:border-[var(--ab-blue)]"
        />
        {Icon ? (
          <Icon className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        ) : null}
      </div>
      {hint ? (
        <p className="mt-1.5 text-xs font-semibold text-slate-500">{hint}</p>
      ) : null}
    </label>
  );
}

interface PhoneFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
}

function PhoneField({ label, value, onChange }: PhoneFieldProps) {
  return (
    <label>
      <span className="mb-2 block text-sm font-black text-[var(--ab-text)]">
        {label}
      </span>
      <div className="grid h-12 grid-cols-[100px_1fr] overflow-hidden rounded-xl border border-slate-200 bg-white focus-within:border-[var(--ab-blue)]">
        <div className="inline-flex items-center justify-center gap-1.5 border-r border-slate-200 bg-slate-50 text-sm font-bold text-[var(--ab-text)]">
          <span className="text-base">🇹🇷</span>
          +90
          <ChevronDown className="h-3 w-3 text-slate-400" />
        </div>
        <input
          type="tel"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="555 123 45 67"
          className="h-full min-w-0 px-3 text-sm font-semibold text-[var(--ab-text)] outline-none"
        />
      </div>
    </label>
  );
}

interface SelectFieldProps {
  label: string;
  value: string;
  displayValue: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  icon?: typeof Languages;
}

function SelectField({
  label,
  value,
  options,
  onChange,
  icon: Icon,
}: SelectFieldProps) {
  return (
    <label>
      <span className="mb-2 block text-sm font-black text-[var(--ab-text)]">
        {label}
      </span>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-12 w-full appearance-none rounded-xl border border-slate-200 bg-white px-4 pr-10 text-sm font-semibold text-[var(--ab-text)] outline-none transition focus:border-[var(--ab-blue)]"
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {Icon ? (
          <Icon className="pointer-events-none absolute left-4 top-1/2 hidden h-4 w-4 -translate-y-1/2 text-slate-400 sm:block" />
        ) : null}
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      </div>
    </label>
  );
}

interface VerificationRowProps {
  label: string;
  value: string;
  verified: boolean;
  icon: typeof Mail;
}

function VerificationRow({
  label,
  value,
  verified,
  icon: Icon,
}: VerificationRowProps) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-[var(--ab-blue)]">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-black text-[var(--ab-text)]">{label}</p>
          <p className="mt-0.5 truncate text-xs text-slate-500">{value}</p>
        </div>
      </div>
      {verified ? (
        <CheckCircle2 className="h-5 w-5 shrink-0 text-green-600" />
      ) : (
        <XCircle className="h-5 w-5 shrink-0 text-red-500" />
      )}
    </div>
  );
}

interface QuickActionButtonProps {
  icon: typeof KeyRound;
  label: string;
  tone: "blue" | "green" | "orange" | "red";
  onClick: () => void;
}

const TONE_ICON_CLASSES = {
  blue: "text-[var(--ab-blue)]",
  green: "text-green-600",
  orange: "text-orange-500",
  red: "text-red-500",
} as const;

function QuickActionButton({
  icon: Icon,
  label,
  tone,
  onClick,
}: QuickActionButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between rounded-2xl px-3 py-3 text-left transition hover:bg-blue-50"
    >
      <span className="flex items-center gap-3">
        <span
          className={[
            "flex h-10 w-10 items-center justify-center rounded-xl bg-slate-50",
            TONE_ICON_CLASSES[tone],
          ].join(" ")}
        >
          <Icon className="h-4 w-4" />
        </span>
        <span
          className={[
            "text-sm font-black",
            tone === "red" ? "text-red-600" : "text-[var(--ab-text)]",
          ].join(" ")}
        >
          {label}
        </span>
      </span>
      <ChevronRight className="h-4 w-4 text-slate-400" />
    </button>
  );
}

interface NotificationToggleProps {
  label: string;
  description: string;
  /** Kontrollü değer. `locked` true ise yok sayılır (her zaman açık görünür). */
  checked: boolean;
  onChange?: (next: boolean) => void;
  /** Geçici devre dışı (kaydederken). */
  disabled?: boolean;
  /** Zorunlu bildirim — kapatılamaz; kilit + "Zorunlu" rozeti gösterir. */
  locked?: boolean;
}

function NotificationToggle({
  label,
  description,
  checked,
  onChange,
  disabled,
  locked,
}: NotificationToggleProps) {
  const isOn = locked ? true : checked;
  const interactive = !locked && !disabled && !!onChange;
  return (
    <div
      className={[
        "flex items-center justify-between gap-3 rounded-2xl border border-[var(--ab-border)] p-4",
        locked ? "bg-slate-50" : "",
      ].join(" ")}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-black text-[var(--ab-text)]">{label}</p>
          {locked && (
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-slate-600">
              <LockKeyhole className="h-3 w-3" />
              Zorunlu
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-slate-500">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={isOn}
        aria-label={label}
        disabled={!interactive}
        onClick={interactive ? () => onChange?.(!checked) : undefined}
        className={[
          "relative h-6 w-11 shrink-0 rounded-full transition-colors",
          isOn ? "bg-[var(--ab-blue)]" : "bg-slate-300",
          interactive ? "" : "cursor-not-allowed",
          disabled && !locked ? "opacity-50" : "",
          locked ? "opacity-70" : "",
        ].join(" ")}
      >
        <span
          className={[
            "absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
            isOn ? "translate-x-5" : "translate-x-0",
          ].join(" ")}
        />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tatil Modu Tab                                                     */
/* ------------------------------------------------------------------ */

interface IadeSystemTabProps {
  profile: CustomerProfile | null;
  onProfileUpdate: (next: CustomerProfile) => void;
  onToast: (t: ToastState) => void;
}

function formatTrDate(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("tr-TR", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

function IadeSystemTab({
  profile,
  onProfileUpdate,
  onToast,
}: IadeSystemTabProps) {
  const [busy, setBusy] = useState(false);

  if (!profile) {
    return (
      <section className="rounded-3xl border border-[var(--ab-border)] bg-white p-6 shadow-sm">
        <div className="h-5 w-40 animate-pulse rounded bg-slate-200" />
        <div className="mt-2 h-4 w-72 animate-pulse rounded bg-slate-100" />
        <div className="mt-6 h-24 animate-pulse rounded-2xl bg-slate-100" />
      </section>
    );
  }

  const vacation = profile.vacationMode ?? false;
  const vacationDate = formatTrDate(profile.vacationStartedAt);

  async function handleToggleVacation(next: boolean) {
    setBusy(true);
    try {
      const raw = await apiCustomer<
        | {
            data: {
              id: string;
              vacationMode: boolean;
              vacationStartedAt: string | null;
              changed?: boolean;
            };
          }
        | {
            id: string;
            vacationMode: boolean;
            vacationStartedAt: string | null;
            changed?: boolean;
          }
      >("/me/vacation", {
        method: "PATCH",
        general: true,
        body: JSON.stringify({ enabled: next }),
      });

      const payload =
        raw && typeof raw === "object" && "data" in raw
          ? (raw as {
              data: {
                vacationMode: boolean;
                vacationStartedAt: string | null;
              };
            }).data
          : (raw as {
              vacationMode: boolean;
              vacationStartedAt: string | null;
            });

      const updated: CustomerProfile = {
        ...profile,
        vacationMode: payload.vacationMode,
        vacationStartedAt: payload.vacationStartedAt,
      } as CustomerProfile;
      onProfileUpdate(updated);

      onToast(
        makeToast(
          "success",
          next ? "Tatil modu açıldı." : "Tatil modu kapatıldı.",
        ),
      );
    } catch (err: unknown) {
      const msg =
        err instanceof ApiError
          ? err.message
          : "Tatil modu güncellenemedi";
      onToast(makeToast("error", msg));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-3xl border border-[var(--ab-border)] bg-white p-4 shadow-sm sm:p-6">
      <h3 className="text-xl font-black text-[var(--ab-text)]">
        Tatil Modu
      </h3>
      <p className="mt-2 text-sm text-slate-500">
        Tatil modu ile mağazanızın geçici olarak siparişe kapalı olduğunu
        işaretleyebilirsiniz.
      </p>

      <div className="mt-6 space-y-4">
        <div
          className={[
            "rounded-2xl border p-4",
            vacation
              ? "border-amber-200 bg-amber-50"
              : "border-[var(--ab-border)] bg-white",
          ].join(" ")}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3">
              <span
                className={[
                  "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
                  vacation
                    ? "bg-amber-100 text-amber-700"
                    : "bg-emerald-50 text-emerald-600",
                ].join(" ")}
              >
                {vacation ? (
                  <PauseCircle className="h-5 w-5" />
                ) : (
                  <PlayCircle className="h-5 w-5" />
                )}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-black text-[var(--ab-text)]">
                  Tatil Modu
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {vacation
                    ? "Tatil modu açık."
                    : "Tatil modu kapalı."}
                </p>
                {vacation && vacationDate && (
                  <p className="mt-1 text-[11px] font-semibold text-amber-700">
                    Başlangıç: {vacationDate}
                  </p>
                )}
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={vacation}
              disabled={busy}
              onClick={() => handleToggleVacation(!vacation)}
              className={[
                "relative h-6 w-11 shrink-0 rounded-full transition-colors",
                vacation ? "bg-amber-500" : "bg-slate-300",
                busy ? "cursor-not-allowed opacity-50" : "",
              ].join(" ")}
            >
              <span
                className={[
                  "absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
                  vacation ? "translate-x-5" : "translate-x-0",
                ].join(" ")}
              />
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--ab-border)] bg-slate-50 p-4">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-200 text-slate-600">
              <PackageX className="h-5 w-5" />
            </span>
            <div>
              <p className="text-sm font-black text-[var(--ab-text)]">
                Tatil modu nasıl çalışır?
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-slate-600">
                <li>
                  Açıkken mağazanız geçici olarak siparişe kapalı işaretlenir.
                </li>
                <li>
                  Devam eden siparişleriniz etkilenmez.
                </li>
                <li>
                  Kapatıldığında normal akış anında geri döner.
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

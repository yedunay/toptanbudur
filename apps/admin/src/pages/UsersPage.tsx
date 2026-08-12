import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRequireAuth } from "../lib/auth";
import {
  createUser,
  deleteUser,
  deleteUserPhoto,
  forceUserPasswordReset,
  listUserSessions,
  listUsers,
  OTP_MODE_DESCRIPTIONS,
  OTP_MODE_LABELS,
  revokeUserSessions,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  updateUser,
  uploadUserPhoto,
  type AdminUserDto,
  type AdminUserRole,
  type AdminUserSession,
  type CreateUserInput,
  type ListUsersResult,
  type OtpMode,
  type UpdateUserInput,
} from "../lib/admin-users";
import { useToast } from "../components/Toast";
import Avatar from "../components/Avatar";
import PermissionMatrix from "../components/PermissionMatrix";
import { useDocumentTitle } from "../lib/useDocumentTitle";
import { getCurrentUserId } from "../lib/permissions";

const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
const ROLES: AdminUserRole[] = ["OWNER", "ADMIN", "MEMBER"];

type TabKey = "profile" | "permissions" | "security" | "activity";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "profile", label: "Profil" },
  { key: "permissions", label: "Yetki Matrisi" },
  { key: "security", label: "Güvenlik" },
  { key: "activity", label: "Aktivite" },
];

export default function UsersPage(): React.ReactElement | null {
  useDocumentTitle("Ayarlar · Kullanıcılar");
  const authed = useRequireAuth();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("profile");
  const [search, setSearch] = useState("");

  const usersQuery = useQuery<ListUsersResult>({
    queryKey: ["admin-users"],
    queryFn: listUsers,
    enabled: authed,
  });

  const users = usersQuery.data?.users ?? [];
  const otpMode: OtpMode = usersQuery.data?.otpMode ?? "required";

  const ownerCount = useMemo(
    () => users.filter((u) => u.role === "OWNER").length,
    [users],
  );

  // İlk yüklemede ilk kullanıcıyı seç (desktop için). Mobile'da liste
  // göster — kullanıcı kendisi seçecek.
  useEffect(() => {
    if (!selectedId && users.length > 0 && window.innerWidth >= 1024) {
      setSelectedId(users[0].id);
    }
  }, [users, selectedId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        (u.name ?? "").toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q),
    );
  }, [users, search]);

  const selected = useMemo(
    () => users.find((u) => u.id === selectedId) ?? null,
    [users, selectedId],
  );

  // Kullanıcı silindikten sonra detay panelini temizle.
  useEffect(() => {
    if (selectedId && !users.some((u) => u.id === selectedId)) {
      setSelectedId(null);
    }
  }, [users, selectedId]);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteUser(id),
    onSuccess: () => {
      toast.push("success", "Kullanıcı silindi");
      void queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      setSelectedId(null);
    },
    onError: (err) =>
      toast.push("error", err instanceof Error ? err.message : "Silinemedi"),
  });

  if (!authed) return null;

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--color-text)]">
            Kullanıcılar
          </h1>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            Admin paneline erişebilecek kişiler. Rol şablonu + sayfa-bazlı
            override = kullanıcının gerçek yetkisi.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="rounded-md bg-[var(--color-brand-navy)] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          + Yeni Kullanıcı
        </button>
      </header>

      <div className="mb-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-muted)]/60 px-4 py-3">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium">2FA (OTP) politikası:</span>
          <span
            className={
              "inline-flex rounded-md px-2 py-0.5 text-xs font-medium " +
              (otpMode === "required"
                ? "bg-emerald-100 text-emerald-800"
                : otpMode === "optional"
                  ? "bg-amber-100 text-amber-800"
                  : "bg-rose-100 text-rose-800")
            }
          >
            {OTP_MODE_LABELS[otpMode]}
          </span>
        </div>
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">
          {OTP_MODE_DESCRIPTIONS[otpMode]}
        </p>
      </div>

      {usersQuery.isLoading ? (
        <p className="text-sm text-[var(--color-text-muted)]">Yükleniyor…</p>
      ) : usersQuery.isError ? (
        <p className="text-sm text-red-600">
          {usersQuery.error instanceof Error
            ? usersQuery.error.message
            : "Yüklenemedi"}
        </p>
      ) : (
        <div className="lg:grid lg:grid-cols-[340px_1fr] lg:gap-6">
          {/* ---------- List (sol) ---------- */}
          <aside
            className={
              "lg:block " + (selected ? "hidden" : "block")
            }
          >
            <div className="lg:sticky lg:top-4 space-y-3">
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Ad ya da e-posta ile ara…"
                className="w-full rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm"
              />

              <ul className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-white divide-y divide-[var(--color-border)]">
                {filtered.length === 0 && (
                  <li className="px-4 py-6 text-center text-sm text-[var(--color-text-muted)]">
                    Eşleşen kullanıcı yok.
                  </li>
                )}
                {filtered.map((u) => {
                  const isActive = u.id === selectedId;
                  return (
                    <li key={u.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedId(u.id);
                          setActiveTab("profile");
                        }}
                        className={
                          "flex w-full items-center gap-3 px-3 py-2.5 text-left transition " +
                          (isActive
                            ? "bg-[var(--color-brand-navy)]/5 ring-1 ring-inset ring-[var(--color-brand-navy)]/20"
                            : "hover:bg-[var(--color-surface-muted)]/60")
                        }
                      >
                        <Avatar
                          src={u.profilePhotoUrl}
                          name={u.name}
                          email={u.email}
                          size="sm"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">
                            {u.name ?? "—"}
                          </p>
                          <p className="truncate font-mono text-[11px] text-[var(--color-text-muted)]">
                            {u.email}
                          </p>
                        </div>
                        <span className="shrink-0 rounded bg-[var(--color-surface-muted)] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
                          {ROLE_LABELS[u.role]}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>

              <p className="text-xs text-[var(--color-text-muted)]">
                {users.length} kullanıcı · {ownerCount} OWNER
              </p>
            </div>
          </aside>

          {/* ---------- Detail (sağ) ---------- */}
          <section
            className={
              "lg:block " + (selected ? "block" : "hidden")
            }
          >
            {selected ? (
              <UserDetailPanel
                key={selected.id}
                user={selected}
                ownerCount={ownerCount}
                otpMode={otpMode}
                activeTab={activeTab}
                onTabChange={setActiveTab}
                onBack={() => setSelectedId(null)}
                onDelete={() => deleteMutation.mutate(selected.id)}
                deleting={deleteMutation.isPending}
              />
            ) : (
              <div className="hidden h-full items-center justify-center rounded-xl border border-dashed border-[var(--color-border)] bg-white/50 px-8 py-16 text-center text-sm text-[var(--color-text-muted)] lg:flex">
                Detayı görmek için soldan bir kullanıcı seçin.
              </div>
            )}
          </section>
        </div>
      )}

      {createOpen && (
        <CreateUserDialog
          onClose={() => setCreateOpen(false)}
          onCreated={(id) => {
            toast.push("success", "Kullanıcı eklendi");
            void queryClient.invalidateQueries({ queryKey: ["admin-users"] });
            setCreateOpen(false);
            setSelectedId(id);
            setActiveTab("profile");
          }}
          onError={(msg) => toast.push("error", msg)}
        />
      )}
    </div>
  );
}

// ====================================================================
// Detail panel
// ====================================================================

function UserDetailPanel({
  user,
  ownerCount,
  otpMode,
  activeTab,
  onTabChange,
  onBack,
  onDelete,
  deleting,
}: {
  user: AdminUserDto;
  ownerCount: number;
  otpMode: OtpMode;
  activeTab: TabKey;
  onTabChange: (tab: TabKey) => void;
  onBack: () => void;
  onDelete: () => void;
  deleting: boolean;
}): React.ReactElement {
  const toast = useToast();
  const queryClient = useQueryClient();
  const isSelf = getCurrentUserId() === user.id;
  const isLastOwner = user.role === "OWNER" && ownerCount <= 1;
  const canDelete = !isLastOwner && !isSelf;

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [menuOpen]);

  const revokeMutation = useMutation({
    mutationFn: () => revokeUserSessions(user.id),
    onSuccess: (data) => {
      toast.push(
        "success",
        `${data.revokedCount} oturum kapatıldı`,
      );
      void queryClient.invalidateQueries({
        queryKey: ["admin-user-sessions", user.id],
      });
    },
    onError: (err) =>
      toast.push(
        "error",
        err instanceof Error ? err.message : "Oturumlar kapatılamadı",
      ),
  });

  const forceResetMutation = useMutation({
    mutationFn: () => forceUserPasswordReset(user.id),
    onSuccess: (data) => {
      toast.push(
        "success",
        `Şifre sıfırlama zorlandı (${data.revokedCount} oturum kapatıldı)`,
      );
      void queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      void queryClient.invalidateQueries({
        queryKey: ["admin-user-sessions", user.id],
      });
    },
    onError: (err) =>
      toast.push(
        "error",
        err instanceof Error ? err.message : "İşlem başarısız",
      ),
  });

  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-white">
      {/* Header bar */}
      <div className="flex items-center gap-3 border-b border-[var(--color-border)] px-4 py-3">
        <button
          type="button"
          onClick={onBack}
          className="rounded-md border border-[var(--color-border)] bg-white px-2 py-1 text-xs lg:hidden"
          aria-label="Listeye dön"
        >
          ← Geri
        </button>
        <Avatar
          src={user.profilePhotoUrl}
          name={user.name}
          email={user.email}
          size="md"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold">
            {user.name ?? "—"}{" "}
            {isSelf && (
              <span className="ml-1 rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-800">
                SEN
              </span>
            )}
          </p>
          <p className="truncate font-mono text-xs text-[var(--color-text-muted)]">
            {user.email}
          </p>
        </div>
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className="rounded-md border border-[var(--color-border)] bg-white px-2 py-1 text-sm hover:bg-[var(--color-surface-muted)]"
            title="Daha fazla"
          >
            ⋯
          </button>
          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 z-10 mt-1 w-64 overflow-hidden rounded-md border border-[var(--color-border)] bg-white shadow-lg"
            >
              <button
                type="button"
                role="menuitem"
                disabled={revokeMutation.isPending}
                onClick={() => {
                  setMenuOpen(false);
                  if (
                    confirm(
                      `${user.name ?? user.email} kullanıcısının tüm oturumlarını kapat?`,
                    )
                  ) {
                    revokeMutation.mutate();
                  }
                }}
                className="block w-full px-3 py-2 text-left text-xs hover:bg-[var(--color-surface-muted)] disabled:opacity-40"
              >
                Tüm oturumları kapat
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={isSelf || forceResetMutation.isPending}
                onClick={() => {
                  setMenuOpen(false);
                  if (
                    confirm(
                      `${user.name ?? user.email} kullanıcısını bir sonraki girişte şifre değiştirmeye zorla? Mevcut tüm oturumları da kapatılacak.`,
                    )
                  ) {
                    forceResetMutation.mutate();
                  }
                }}
                title={isSelf ? "Kendi hesabın için kullanılamaz" : undefined}
                className="block w-full px-3 py-2 text-left text-xs hover:bg-[var(--color-surface-muted)] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Şifre sıfırlamayı zorla
              </button>
              <div className="border-t border-[var(--color-border)]" />
              <button
                type="button"
                role="menuitem"
                disabled={!canDelete || deleting}
                onClick={() => {
                  setMenuOpen(false);
                  if (
                    confirm(
                      `${user.name ?? user.email} kullanıcısı silinsin mi? Bu işlem geri alınamaz.`,
                    )
                  ) {
                    onDelete();
                  }
                }}
                title={
                  isSelf
                    ? "Kendi hesabını silemezsin"
                    : isLastOwner
                      ? "Son OWNER silinemez"
                      : undefined
                }
                className="block w-full px-3 py-2 text-left text-xs text-red-700 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Kullanıcıyı sil
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div
        role="tablist"
        aria-label="Kullanıcı detay sekmeleri"
        className="flex overflow-x-auto border-b border-[var(--color-border)] px-2"
      >
        {TABS.map((t) => {
          const active = t.key === activeTab;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onTabChange(t.key)}
              className={
                "border-b-2 px-3 py-2.5 text-sm font-medium transition " +
                (active
                  ? "border-[var(--color-brand-navy)] text-[var(--color-brand-navy)]"
                  : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]")
              }
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="p-4 sm:p-5">
        {activeTab === "profile" && (
          <ProfileTab
            user={user}
            ownerCount={ownerCount}
            otpMode={otpMode}
          />
        )}
        {activeTab === "permissions" && (
          <PermissionMatrix userId={user.id} userRole={user.role} />
        )}
        {activeTab === "security" && (
          <SecurityTab user={user} isSelf={isSelf} />
        )}
        {activeTab === "activity" && <ActivityTab user={user} />}
      </div>
    </div>
  );
}

// ====================================================================
// Profile tab
// ====================================================================

function ProfileTab({
  user,
  ownerCount,
  otpMode,
}: {
  user: AdminUserDto;
  ownerCount: number;
  otpMode: OtpMode;
}): React.ReactElement {
  const toast = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [form, setForm] = useState<UpdateUserInput>({
    name: user.name ?? "",
    role: user.role,
    otpEnabled: user.otpEnabled,
  });
  const [resetPassword, setResetPassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");

  // Kullanıcı listede güncellenince formu resync et — başka bir kullanıcı
  // detayı açıldığında stale state taşımaması için.
  useEffect(() => {
    setForm({
      name: user.name ?? "",
      role: user.role,
      otpEnabled: user.otpEnabled,
    });
    setResetPassword(false);
    setNewPassword("");
  }, [user.id, user.name, user.role, user.otpEnabled]);

  const isLastOwner = user.role === "OWNER" && ownerCount <= 1;
  const passwordValid =
    !resetPassword ||
    (newPassword.length >= 12 &&
      /[A-Za-z]/.test(newPassword) &&
      /[0-9]/.test(newPassword));

  const photoUploadMutation = useMutation({
    mutationFn: (file: File) => uploadUserPhoto(user.id, file),
    onSuccess: () => {
      toast.push("success", "Fotoğraf güncellendi");
      void queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      void queryClient.invalidateQueries({ queryKey: ["auth-me"] });
    },
    onError: (err) =>
      toast.push(
        "error",
        err instanceof Error ? err.message : "Fotoğraf yüklenemedi",
      ),
  });

  const photoDeleteMutation = useMutation({
    mutationFn: () => deleteUserPhoto(user.id),
    onSuccess: () => {
      toast.push("success", "Fotoğraf kaldırıldı");
      void queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      void queryClient.invalidateQueries({ queryKey: ["auth-me"] });
    },
    onError: (err) =>
      toast.push(
        "error",
        err instanceof Error ? err.message : "Fotoğraf silinemedi",
      ),
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.push("error", "Sadece görsel dosyaları yüklenebilir");
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      toast.push("error", "Dosya 2 MB'tan büyük olamaz");
      return;
    }
    photoUploadMutation.mutate(file);
  };

  const photoBusy =
    photoUploadMutation.isPending || photoDeleteMutation.isPending;

  const mutation = useMutation({
    mutationFn: () => {
      const payload: UpdateUserInput = {};
      if (form.name !== undefined && form.name !== (user.name ?? "")) {
        payload.name = form.name;
      }
      if (form.role !== user.role) {
        payload.role = form.role;
      }
      if (resetPassword && newPassword) {
        payload.password = newPassword;
      }
      if (
        otpMode === "optional" &&
        form.otpEnabled !== undefined &&
        form.otpEnabled !== user.otpEnabled
      ) {
        payload.otpEnabled = form.otpEnabled;
      }
      return updateUser(user.id, payload);
    },
    onSuccess: () => {
      toast.push("success", "Kullanıcı güncellendi");
      void queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      setResetPassword(false);
      setNewPassword("");
    },
    onError: (err) =>
      toast.push(
        "error",
        err instanceof Error ? err.message : "Güncellenemedi",
      ),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (passwordValid) mutation.mutate();
      }}
      className="space-y-5"
    >
      <Field label="Profil fotoğrafı">
        <div className="flex items-center gap-4">
          <Avatar
            src={user.profilePhotoUrl}
            name={user.name}
            email={user.email}
            size="lg"
          />
          <div className="flex flex-wrap gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileSelect}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={photoBusy}
              className="rounded-md border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs hover:bg-[var(--color-surface-muted)] disabled:opacity-40"
            >
              {photoUploadMutation.isPending
                ? "Yükleniyor…"
                : user.profilePhotoUrl
                  ? "Fotoğrafı Değiştir"
                  : "Fotoğraf Yükle"}
            </button>
            {user.profilePhotoUrl && (
              <button
                type="button"
                onClick={() => {
                  if (confirm("Profil fotoğrafı silinsin mi?")) {
                    photoDeleteMutation.mutate();
                  }
                }}
                disabled={photoBusy}
                className="rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs text-red-700 hover:bg-red-50 disabled:opacity-40"
              >
                {photoDeleteMutation.isPending ? "Siliniyor…" : "Kaldır"}
              </button>
            )}
          </div>
        </div>
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">
          JPG/PNG/WebP, en fazla 2 MB. Değişiklik anında kaydedilir.
        </p>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Ad soyad">
          <input
            type="text"
            value={form.name ?? ""}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            minLength={2}
            className={inputCls}
          />
        </Field>

        <Field label="E-posta">
          <input
            type="email"
            value={user.email}
            disabled
            className={`${inputCls} bg-[var(--color-surface-muted)] cursor-not-allowed`}
          />
        </Field>
      </div>

      <Field label="Rol">
        <select
          value={form.role}
          onChange={(e) =>
            setForm({ ...form, role: e.target.value as AdminUserRole })
          }
          disabled={isLastOwner}
          className={`${inputCls} ${isLastOwner ? "cursor-not-allowed opacity-60" : ""}`}
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
        {isLastOwner ? (
          <p className="mt-1 text-xs text-amber-600">
            Bu son OWNER kullanıcı — rolü değiştirilemez.
          </p>
        ) : (
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            {ROLE_DESCRIPTIONS[form.role!]} — sayfa-bazlı kısıtlamalar için
            "Yetki Matrisi" sekmesini kullanın.
          </p>
        )}
      </Field>

      <Field label="Şifre">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={resetPassword}
            onChange={(e) => setResetPassword(e.target.checked)}
          />
          Yeni geçici şifre ata
        </label>
        {resetPassword && (
          <>
            <input
              type="text"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="En az 12 karakter, harf + rakam"
              className={`${inputCls} mt-2`}
            />
            {newPassword && !passwordValid && (
              <p className="mt-1 text-xs text-red-600">
                Şifre 12+ karakter olmalı ve harf + rakam içermeli
              </p>
            )}
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              Kullanıcı bir sonraki girişte değiştirmek zorunda olacak.
            </p>
          </>
        )}
      </Field>

      <Field label="2FA (E-posta OTP)">
        {otpMode === "optional" ? (
          <>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={!!form.otpEnabled}
                onChange={(e) =>
                  setForm({ ...form, otpEnabled: e.target.checked })
                }
              />
              Bu kullanıcı için 2FA açık olsun
            </label>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              Kapatıldığında bu kullanıcı yalnızca e-posta + şifre ile giriş
              yapabilir. Kullanıcının kendisi de "Hesabım" sayfasından
              değiştirebilir.
            </p>
          </>
        ) : (
          <p className="text-xs text-[var(--color-text-muted)]">
            {otpMode === "required"
              ? "Sistem ayarı 2FA'yı herkes için zorunlu kılıyor — kullanıcı bazında değiştirilemez."
              : "Sistem ayarı 2FA'yı tamamen kapatmış — kullanıcı bazında değiştirilemez."}
          </p>
        )}
      </Field>

      <div className="flex justify-end gap-2 pt-2">
        <button
          type="submit"
          disabled={mutation.isPending || !passwordValid}
          className="rounded-md bg-[var(--color-brand-navy)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
        >
          {mutation.isPending ? "Kaydediliyor…" : "Değişiklikleri Kaydet"}
        </button>
      </div>
    </form>
  );
}

// ====================================================================
// Security tab
// ====================================================================

function SecurityTab({
  user,
  isSelf,
}: {
  user: AdminUserDto;
  isSelf: boolean;
}): React.ReactElement {
  const toast = useToast();
  const queryClient = useQueryClient();

  const sessionsQuery = useQuery<AdminUserSession[]>({
    queryKey: ["admin-user-sessions", user.id],
    queryFn: () => listUserSessions(user.id),
  });

  const revokeMutation = useMutation({
    mutationFn: () => revokeUserSessions(user.id),
    onSuccess: (data) => {
      toast.push("success", `${data.revokedCount} oturum kapatıldı`);
      void queryClient.invalidateQueries({
        queryKey: ["admin-user-sessions", user.id],
      });
    },
    onError: (err) =>
      toast.push(
        "error",
        err instanceof Error ? err.message : "Oturumlar kapatılamadı",
      ),
  });

  const sessions = sessionsQuery.data ?? [];

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-muted)]/40 px-4 py-3">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="font-medium">Şifre durumu:</span>
          {user.mustChangePassword ? (
            <span className="inline-flex rounded-md bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
              İlk girişte değişim bekliyor
            </span>
          ) : (
            <span className="inline-flex rounded-md bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
              Aktif
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">
          Şifre sıfırlamayı zorlamak için sağ üstteki "⋯" menüsünü kullan —
          mevcut tüm oturumları kapatır ve sonraki girişte değişim ister.
        </p>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold">Aktif Oturumlar</h3>
            <p className="text-xs text-[var(--color-text-muted)]">
              Geçerli (iptal edilmemiş, süresi dolmamış) refresh token'lar.
            </p>
          </div>
          <button
            type="button"
            disabled={
              isSelf || sessions.length === 0 || revokeMutation.isPending
            }
            onClick={() => {
              if (
                confirm(
                  `${user.name ?? user.email} kullanıcısının tüm oturumları kapatılsın mı?`,
                )
              ) {
                revokeMutation.mutate();
              }
            }}
            title={
              isSelf
                ? "Kendi oturumlarını bu menüden kapatamazsın"
                : undefined
            }
            className="rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs text-red-700 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {revokeMutation.isPending
              ? "Kapatılıyor…"
              : "Tüm oturumları kapat"}
          </button>
        </div>

        {sessionsQuery.isLoading ? (
          <p className="text-sm text-[var(--color-text-muted)]">Yükleniyor…</p>
        ) : sessionsQuery.isError ? (
          <p className="text-sm text-red-600">
            {sessionsQuery.error instanceof Error
              ? sessionsQuery.error.message
              : "Oturumlar yüklenemedi"}
          </p>
        ) : sessions.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[var(--color-border)] bg-white px-4 py-6 text-center text-sm text-[var(--color-text-muted)]">
            Aktif oturum yok.
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-white">
            <table className="w-full text-sm">
              <thead className="bg-[var(--color-surface-muted)] text-left">
                <tr>
                  <th className="px-3 py-2 font-medium">Token</th>
                  <th className="px-3 py-2 font-medium">Tarayıcı / IP</th>
                  <th className="px-3 py-2 font-medium">Açıldı</th>
                  <th className="px-3 py-2 font-medium">Bitiş</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {sessions.map((s) => (
                  <tr key={s.id}>
                    <td className="px-3 py-2 font-mono text-[11px]">
                      …{s.jtiSuffix}
                    </td>
                    <td className="px-3 py-2">
                      <p
                        className="max-w-[280px] truncate text-xs"
                        title={s.userAgent ?? undefined}
                      >
                        {s.userAgent ?? "—"}
                      </p>
                      <p className="font-mono text-[11px] text-[var(--color-text-muted)]">
                        {s.ip ?? "—"}
                      </p>
                    </td>
                    <td className="px-3 py-2 text-xs text-[var(--color-text-muted)]">
                      {formatDateTime(s.createdAt)}
                    </td>
                    <td className="px-3 py-2 text-xs text-[var(--color-text-muted)]">
                      {formatDateTime(s.expiresAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ====================================================================
// Activity tab
// ====================================================================

function ActivityTab({ user }: { user: AdminUserDto }): React.ReactElement {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <StatCard label="Oluşturuldu" value={formatDateTime(user.createdAt)} />
        <StatCard
          label="Son güncelleme"
          value={formatDateTime(user.updatedAt)}
        />
      </div>
      <div className="rounded-xl border border-[var(--color-border)] bg-white p-4">
        <h3 className="text-sm font-semibold">Denetim Kayıtları</h3>
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">
          Bu kullanıcıya yapılan tüm yönetimsel işlemler (rol değişimi, yetki
          override, oturum kapatma, şifre sıfırlama) Loglar sayfasında
          tutulur.
        </p>
        <Link
          to={`/loglar?target=${encodeURIComponent(user.id)}`}
          className="mt-3 inline-flex rounded-md border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs hover:bg-[var(--color-surface-muted)]"
        >
          Loglar'da görüntüle →
        </Link>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
}: {
  label: string;
  value: string;
}): React.ReactElement {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-white px-4 py-3">
      <p className="text-xs text-[var(--color-text-muted)]">{label}</p>
      <p className="mt-1 text-sm font-medium">{value}</p>
    </div>
  );
}

// ====================================================================
// Create dialog (unchanged behaviour, returns id for autoselect)
// ====================================================================

function CreateUserDialog({
  onClose,
  onCreated,
  onError,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
  onError: (msg: string) => void;
}): React.ReactElement {
  // Varsayılan rol MEMBER (Çalışan): en dar yetkili güvenli başlangıç —
  // ADMIN default'u, patron rolü değiştirmeyi unutursa her sayfayı açıyordu.
  const [form, setForm] = useState<CreateUserInput>({
    email: "",
    name: "",
    password: "",
    role: "MEMBER",
  });

  const mutation = useMutation({
    mutationFn: () => createUser(form),
    onSuccess: (created) => onCreated(created.id),
    onError: (err) =>
      onError(err instanceof Error ? err.message : "Eklenemedi"),
  });

  const passwordValid =
    form.password.length >= 12 &&
    /[A-Za-z]/.test(form.password) &&
    /[0-9]/.test(form.password);
  const canSubmit =
    !!form.email.trim() && !!form.name.trim() && passwordValid;

  return (
    <DialogShell title="Yeni Kullanıcı" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) mutation.mutate();
        }}
        className="space-y-4"
      >
        <Field label="Ad soyad">
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
            minLength={2}
            className={inputCls}
          />
        </Field>
        <Field label="E-posta">
          <input
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            required
            className={inputCls}
          />
        </Field>
        <Field
          label="Geçici şifre"
          hint="En az 12 karakter, harf + rakam. Kullanıcı ilk girişte değiştirecek."
        >
          <input
            type="text"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            required
            className={inputCls}
            placeholder="Örn: Gecici-2026-Sifre"
          />
          {form.password && !passwordValid && (
            <p className="mt-1 text-xs text-red-600">
              Şifre 12+ karakter olmalı ve harf + rakam içermeli
            </p>
          )}
        </Field>
        <Field label="Rol">
          <select
            value={form.role}
            onChange={(e) =>
              setForm({ ...form, role: e.target.value as AdminUserRole })
            }
            className={inputCls}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            {ROLE_DESCRIPTIONS[form.role]}
          </p>
        </Field>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-[var(--color-border)] bg-white px-4 py-2 text-sm hover:bg-[var(--color-surface-muted)]"
          >
            İptal
          </button>
          <button
            type="submit"
            disabled={mutation.isPending || !canSubmit}
            className="rounded-md bg-[var(--color-brand-navy)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
          >
            {mutation.isPending ? "…" : "Ekle"}
          </button>
        </div>
      </form>
    </DialogShell>
  );
}

// ====================================================================
// Shared UI
// ====================================================================

const inputCls =
  "w-full rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      {children}
      {hint && (
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">{hint}</p>
      )}
    </label>
  );
}

function DialogShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-lg font-semibold">{title}</h2>
        {children}
      </div>
    </div>
  );
}

function formatDateTime(value: string | Date): string {
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toLocaleString("tr-TR", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

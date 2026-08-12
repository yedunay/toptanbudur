import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRequireAuth } from "../lib/auth";
import {
  changeOwnPassword,
  deleteOwnProfilePhoto,
  fetchMe,
  setOwnOtp,
  uploadOwnProfilePhoto,
  type MeDto,
} from "../lib/account";
import {
  OTP_MODE_DESCRIPTIONS,
  OTP_MODE_LABELS,
  ROLE_LABELS,
} from "../lib/admin-users";
import { useToast } from "../components/Toast";
import Avatar from "../components/Avatar";
import FinanceApiAccessCard from "../components/FinanceApiAccessCard";
import { useDocumentTitle } from "../lib/useDocumentTitle";

const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

export default function HesapPage(): React.ReactElement | null {
  useDocumentTitle("Hesabım");
  const authed = useRequireAuth();
  const toast = useToast();
  const queryClient = useQueryClient();

  const meQuery = useQuery<MeDto>({
    queryKey: ["auth-me"],
    queryFn: fetchMe,
    enabled: authed,
  });

  if (!authed) return null;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-[var(--color-text)]">
          Hesabım
        </h1>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Kişisel güvenlik ayarlarını buradan yönet.
        </p>
      </header>

      {meQuery.isLoading ? (
        <p className="text-sm text-[var(--color-text-muted)]">Yükleniyor…</p>
      ) : meQuery.isError || !meQuery.data ? (
        <p className="text-sm text-red-600">
          {meQuery.error instanceof Error
            ? meQuery.error.message
            : "Yüklenemedi"}
        </p>
      ) : (
        <>
          <ProfileCard
            me={meQuery.data}
            onChanged={() => {
              void queryClient.invalidateQueries({ queryKey: ["auth-me"] });
              void queryClient.invalidateQueries({ queryKey: ["admin-users"] });
            }}
            onError={(msg) => toast.push("error", msg)}
            onSuccess={(msg) => toast.push("success", msg)}
          />
          <OtpCard
            me={meQuery.data}
            onChanged={() => {
              void queryClient.invalidateQueries({ queryKey: ["auth-me"] });
              void queryClient.invalidateQueries({ queryKey: ["admin-users"] });
            }}
            onError={(msg) => toast.push("error", msg)}
            onSuccess={(msg) => toast.push("success", msg)}
          />
          <PasswordCard
            mustChangePassword={meQuery.data.mustChangePassword}
            onChanged={() => {
              toast.push("success", "Şifre güncellendi");
              void queryClient.invalidateQueries({ queryKey: ["auth-me"] });
            }}
            onError={(msg) => toast.push("error", msg)}
          />
          {/* Yalnız bir finans ortağına bağlı kullanıcıda görünür (self-hides). */}
          <FinanceApiAccessCard />
        </>
      )}
    </div>
  );
}

function ProfileCard({
  me,
  onChanged,
  onSuccess,
  onError,
}: {
  me: MeDto;
  onChanged: () => void;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}): React.ReactElement {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadOwnProfilePhoto(file),
    onSuccess: () => {
      onSuccess("Profil fotoğrafı güncellendi");
      onChanged();
    },
    onError: (err) =>
      onError(err instanceof Error ? err.message : "Yüklenemedi"),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteOwnProfilePhoto(),
    onSuccess: () => {
      onSuccess("Profil fotoğrafı kaldırıldı");
      onChanged();
    },
    onError: (err) =>
      onError(err instanceof Error ? err.message : "Kaldırılamadı"),
  });

  const handleFile = (file: File | undefined): void => {
    if (!file) return;
    if (!/^image\//.test(file.type)) {
      onError("Sadece JPEG / PNG / WebP yükleyebilirsiniz");
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      onError("Fotoğraf en fazla 2 MB olabilir");
      return;
    }
    uploadMutation.mutate(file);
  };

  const busy = uploadMutation.isPending || deleteMutation.isPending;

  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-white p-5">
      <h2 className="text-sm font-semibold">Profil</h2>
      <div className="mt-4 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
        <Avatar
          src={me.profilePhotoUrl}
          name={me.name}
          email={me.email}
          size="lg"
        />
        <div className="flex-1">
          <div className="flex flex-wrap gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                handleFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => fileInputRef.current?.click()}
              className="rounded-md bg-[var(--color-brand-navy)] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-40"
            >
              {uploadMutation.isPending
                ? "Yükleniyor…"
                : me.profilePhotoUrl
                  ? "Fotoğrafı Değiştir"
                  : "Fotoğraf Yükle"}
            </button>
            {me.profilePhotoUrl && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (confirm("Profil fotoğrafı kaldırılsın mı?")) {
                    deleteMutation.mutate();
                  }
                }}
                className="rounded-md border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs hover:bg-[var(--color-surface-muted)] disabled:opacity-40"
              >
                {deleteMutation.isPending ? "…" : "Kaldır"}
              </button>
            )}
          </div>
          <p className="mt-2 text-xs text-[var(--color-text-muted)]">
            JPEG / PNG / WebP, en fazla 2 MB. Kare oranı önerilir.
          </p>
        </div>
      </div>
      <dl className="mt-5 grid grid-cols-1 gap-x-6 gap-y-2 text-sm md:grid-cols-2">
        <div>
          <dt className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
            Ad
          </dt>
          <dd>{me.name ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
            E-posta
          </dt>
          <dd className="font-mono text-xs">{me.email}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
            Rol
          </dt>
          <dd>
            <span className="inline-flex rounded-md bg-[var(--color-surface-muted)] px-2 py-0.5 text-xs font-medium">
              {ROLE_LABELS[me.role]}
            </span>
          </dd>
        </div>
      </dl>
    </section>
  );
}

function OtpCard({
  me,
  onChanged,
  onSuccess,
  onError,
}: {
  me: MeDto;
  onChanged: () => void;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}): React.ReactElement {
  const mutation = useMutation({
    mutationFn: (enabled: boolean) => setOwnOtp(enabled),
    onSuccess: (res) => {
      onSuccess(
        res.otpEnabled
          ? "2FA hesabın için açıldı"
          : "2FA hesabın için kapatıldı",
      );
      onChanged();
    },
    onError: (err) =>
      onError(err instanceof Error ? err.message : "Güncellenemedi"),
  });

  const canToggle = me.otpMode === "optional";
  const effectivelyEnabled =
    me.otpMode === "required" ||
    (me.otpMode === "optional" && me.otpEnabled);

  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-white p-5">
      <h2 className="text-sm font-semibold">İki Aşamalı Doğrulama (2FA)</h2>
      <div className="mt-2 flex items-center gap-2 text-xs">
        <span className="text-[var(--color-text-muted)]">Sistem politikası:</span>
        <span
          className={
            "inline-flex rounded-md px-2 py-0.5 font-medium " +
            (me.otpMode === "required"
              ? "bg-emerald-100 text-emerald-800"
              : me.otpMode === "optional"
                ? "bg-amber-100 text-amber-800"
                : "bg-rose-100 text-rose-800")
          }
        >
          {OTP_MODE_LABELS[me.otpMode]}
        </span>
      </div>
      <p className="mt-2 text-xs text-[var(--color-text-muted)]">
        {OTP_MODE_DESCRIPTIONS[me.otpMode]}
      </p>

      <div className="mt-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)]/60 p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Senin için 2FA</p>
            <p className="text-xs text-[var(--color-text-muted)]">
              {effectivelyEnabled
                ? "Yeni cihazlardan girişte e-postana 4 haneli kod gönderilir."
                : "Sadece e-posta + şifre ile giriş yaparsın."}
            </p>
          </div>
          <Toggle
            checked={effectivelyEnabled}
            disabled={!canToggle || mutation.isPending}
            onChange={(v) => mutation.mutate(v)}
          />
        </div>
        {!canToggle && (
          <p className="mt-2 text-xs text-amber-700">
            {me.otpMode === "required"
              ? "Sistem yöneticisi 2FA'yı zorunlu kılmış — buradan değiştirilemez."
              : "Sistem yöneticisi 2FA'yı kapatmış — buradan değiştirilemez."}
          </p>
        )}
      </div>
    </section>
  );
}

function PasswordCard({
  mustChangePassword,
  onChanged,
  onError,
}: {
  mustChangePassword: boolean;
  onChanged: () => void;
  onError: (msg: string) => void;
}): React.ReactElement {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const valid =
    newPassword.length >= 12 &&
    /[A-Za-z]/.test(newPassword) &&
    /[0-9]/.test(newPassword) &&
    newPassword === confirmPassword &&
    (mustChangePassword || currentPassword.length > 0);

  const mutation = useMutation({
    mutationFn: () =>
      changeOwnPassword({
        currentPassword: mustChangePassword ? "" : currentPassword,
        newPassword,
      }),
    onSuccess: () => {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      onChanged();
    },
    onError: (err) =>
      onError(err instanceof Error ? err.message : "Güncellenemedi"),
  });

  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-white p-5">
      <h2 className="text-sm font-semibold">Şifreyi Sıfırla</h2>
      {mustChangePassword ? (
        <p className="mt-1 text-xs text-amber-700">
          Hesabın yöneticiden geçici şifreyle açıldı — devam etmek için yeni
          bir şifre belirle.
        </p>
      ) : (
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">
          Şifren en az 12 karakter olmalı ve en az bir harf ile bir rakam
          içermeli.
        </p>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) mutation.mutate();
        }}
        className="mt-4 space-y-3"
      >
        {!mustChangePassword && (
          <Field label="Mevcut şifre">
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
              className={inputCls}
              required
            />
          </Field>
        )}
        <Field label="Yeni şifre">
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
            className={inputCls}
            required
            minLength={12}
          />
          {newPassword &&
            (newPassword.length < 12 ||
              !/[A-Za-z]/.test(newPassword) ||
              !/[0-9]/.test(newPassword)) && (
              <p className="mt-1 text-xs text-red-600">
                Şifre 12+ karakter olmalı ve harf + rakam içermeli
              </p>
            )}
        </Field>
        <Field label="Yeni şifre (tekrar)">
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
            className={inputCls}
            required
          />
          {confirmPassword && confirmPassword !== newPassword && (
            <p className="mt-1 text-xs text-red-600">Şifreler eşleşmiyor</p>
          )}
        </Field>
        <div className="flex justify-end pt-1">
          <button
            type="submit"
            disabled={!valid || mutation.isPending}
            className="rounded-md bg-[var(--color-brand-navy)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
          >
            {mutation.isPending ? "…" : "Şifreyi Kaydet"}
          </button>
        </div>
      </form>
    </section>
  );
}

function Toggle({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={
        "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors " +
        (checked
          ? "bg-[var(--color-brand-navy)]"
          : "bg-zinc-300") +
        (disabled ? " cursor-not-allowed opacity-50" : "")
      }
    >
      <span
        className={
          "inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform " +
          (checked ? "translate-x-5" : "translate-x-0.5")
        }
      />
    </button>
  );
}

const inputCls =
  "w-full rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}

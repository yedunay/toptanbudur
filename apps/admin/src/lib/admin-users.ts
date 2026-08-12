import { apiFetch } from "./auth";

export type AdminUserRole = "OWNER" | "ADMIN" | "MEMBER";
export type OtpMode = "required" | "optional" | "disabled";

export interface AdminUserDto {
  id: string;
  email: string;
  name: string | null;
  role: AdminUserRole;
  mustChangePassword: boolean;
  otpEnabled: boolean;
  profilePhotoUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateUserInput {
  email: string;
  name: string;
  password: string;
  role: AdminUserRole;
}

export interface UpdateUserInput {
  name?: string;
  role?: AdminUserRole;
  password?: string;
  otpEnabled?: boolean;
}

export interface ListUsersResult {
  users: AdminUserDto[];
  otpMode: OtpMode;
}

export async function listUsers(): Promise<ListUsersResult> {
  const res = await apiFetch<{
    success: boolean;
    data: AdminUserDto[];
    otpMode: OtpMode;
  }>("/admin/users");
  return { users: res.data, otpMode: res.otpMode };
}

export async function createUser(input: CreateUserInput): Promise<AdminUserDto> {
  const res = await apiFetch<{ success: boolean; data: AdminUserDto }>(
    "/admin/users",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
  return res.data;
}

export async function updateUser(
  id: string,
  input: UpdateUserInput,
): Promise<AdminUserDto> {
  const res = await apiFetch<{ success: boolean; data: AdminUserDto }>(
    `/admin/users/${id}`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
  );
  return res.data;
}

export async function deleteUser(id: string): Promise<void> {
  await apiFetch(`/admin/users/${id}`, { method: "DELETE" });
}

export async function uploadUserPhoto(
  id: string,
  file: File,
): Promise<{ id: string; profilePhotoUrl: string }> {
  const fd = new FormData();
  fd.append("photo", file);
  const res = await apiFetch<{
    success: boolean;
    data: { id: string; profilePhotoUrl: string };
  }>(`/admin/users/${id}/photo`, {
    method: "POST",
    body: fd,
  });
  return res.data;
}

export async function deleteUserPhoto(id: string): Promise<void> {
  await apiFetch(`/admin/users/${id}/photo`, { method: "DELETE" });
}

export interface AdminUserSession {
  id: string;
  jtiSuffix: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  expiresAt: string;
}

export async function listUserSessions(id: string): Promise<AdminUserSession[]> {
  const res = await apiFetch<{ success: boolean; data: AdminUserSession[] }>(
    `/admin/users/${id}/sessions`,
  );
  return res.data;
}

export async function revokeUserSessions(
  id: string,
): Promise<{ revokedCount: number }> {
  const res = await apiFetch<{
    success: boolean;
    data: { revokedCount: number };
  }>(`/admin/users/${id}/sessions`, { method: "DELETE" });
  return res.data;
}

export async function forceUserPasswordReset(
  id: string,
): Promise<{ id: string; revokedCount: number }> {
  const res = await apiFetch<{
    success: boolean;
    data: { id: string; revokedCount: number };
  }>(`/admin/users/${id}/force-password-reset`, { method: "POST" });
  return res.data;
}

export const ROLE_LABELS: Record<AdminUserRole, string> = {
  OWNER: "Sahip",
  ADMIN: "Admin",
  MEMBER: "Çalışan",
};

export const ROLE_DESCRIPTIONS: Record<AdminUserRole, string> = {
  OWNER: "Tam yetki — kullanıcı yönetimi dahil her şey",
  ADMIN: "Tüm yönetim işlemleri (kullanıcı yönetimi dahil)",
  MEMBER:
    "Çalışan — varsayılan yalnız Hesabım; sayfalar Yetki Matrisi'nden tek tek açılır. Muhasebe/kâr ve ayar sayfaları bu role hiç açılamaz.",
};

export const OTP_MODE_LABELS: Record<OtpMode, string> = {
  required: "Zorunlu",
  optional: "Kullanıcı seçimi",
  disabled: "Kapalı",
};

export const OTP_MODE_DESCRIPTIONS: Record<OtpMode, string> = {
  required:
    "Tüm admin girişleri 2FA (e-posta kodu) ile doğrulanır. .env içinde OTP_MODE=required.",
  optional:
    "Her kullanıcı kendi 2FA tercihini kendi hesap ayarlarından yönetir; OWNER/ADMIN diğer kullanıcılarınkini de değiştirebilir. .env içinde OTP_MODE=optional.",
  disabled:
    "2FA tamamen kapalı — sadece e-posta + şifre. .env içinde OTP_MODE=disabled.",
};

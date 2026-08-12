import { apiFetch } from "./auth";
import type { OtpMode } from "./admin-users";

export interface MeDto {
  id: string;
  email: string;
  name: string | null;
  tenantId: string;
  role: "OWNER" | "ADMIN" | "MEMBER";
  mustChangePassword: boolean;
  otpEnabled: boolean;
  profilePhotoUrl: string | null;
  otpMode: OtpMode;
}

export async function fetchMe(): Promise<MeDto> {
  return apiFetch<MeDto>("/auth/me");
}

export async function setOwnOtp(enabled: boolean): Promise<{
  otpEnabled: boolean;
  otpMode: OtpMode;
}> {
  const res = await apiFetch<{
    success: boolean;
    data: { otpEnabled: boolean; otpMode: OtpMode };
  }>("/auth/me/otp", {
    method: "POST",
    body: JSON.stringify({ enabled }),
  });
  return res.data;
}

export async function changeOwnPassword(input: {
  currentPassword: string;
  newPassword: string;
}): Promise<void> {
  await apiFetch("/auth/change-password", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function uploadOwnProfilePhoto(file: File): Promise<{
  id: string;
  profilePhotoUrl: string;
}> {
  const fd = new FormData();
  fd.append("photo", file);
  const res = await apiFetch<{
    success: boolean;
    data: { id: string; profilePhotoUrl: string };
  }>("/admin/users/me/photo", {
    method: "POST",
    body: fd,
  });
  return res.data;
}

export async function deleteOwnProfilePhoto(): Promise<void> {
  await apiFetch("/admin/users/me/photo", { method: "DELETE" });
}

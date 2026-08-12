import { apiFetch } from "./auth";

/**
 * Bayilerin / müşterilerin EFT/havale yapacağı banka hesapları (IBAN listesi).
 * Müşteri cari bakiye yüklemek isterken bu listeden bir hesap seçer.
 */

export interface BankAccount {
  id: string;
  bankName: string;
  accountName: string;
  iban: string;
  branchCode: string | null;
  accountNo: string | null;
  active: boolean;
  position: number;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

interface RawBankAccount {
  id: string;
  bankName?: string | null;
  accountName?: string | null;
  iban?: string | null;
  branchCode?: string | null;
  accountNo?: string | null;
  active?: boolean | null;
  position?: number | null;
  note?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

interface RawListEnvelope {
  success?: boolean;
  data?: RawBankAccount[] | null;
}

interface RawSingleEnvelope {
  success?: boolean;
  data?: RawBankAccount | null;
}

interface RawDeleteEnvelope {
  success?: boolean;
  data?: { id: string; softDeleted?: boolean } | null;
}

export interface BankAccountInput {
  bankName: string;
  accountName: string;
  iban: string;
  branchCode?: string;
  accountNo?: string;
  active?: boolean;
  position?: number;
  note?: string;
}

export type BankAccountUpdateInput = Partial<BankAccountInput>;

export interface BankAccountDeleteResult {
  id: string;
  softDeleted: boolean;
}

function mapBankAccount(raw: RawBankAccount): BankAccount {
  return {
    id: raw.id,
    bankName: raw.bankName ?? "",
    accountName: raw.accountName ?? "",
    iban: raw.iban ?? "",
    branchCode: raw.branchCode ?? null,
    accountNo: raw.accountNo ?? null,
    active: raw.active ?? false,
    position: typeof raw.position === "number" ? raw.position : 0,
    note: raw.note ?? null,
    createdAt: raw.createdAt ?? new Date().toISOString(),
    updatedAt: raw.updatedAt ?? new Date().toISOString(),
  };
}

export async function fetchBankAccounts(): Promise<BankAccount[]> {
  const raw = await apiFetch<unknown>("/admin/bank-accounts");
  if (Array.isArray(raw)) {
    return (raw as RawBankAccount[]).map(mapBankAccount);
  }
  if (raw && typeof raw === "object" && "data" in (raw as object)) {
    const env = raw as RawListEnvelope;
    return Array.isArray(env.data) ? env.data.map(mapBankAccount) : [];
  }
  return [];
}

function buildPayload(input: BankAccountInput | BankAccountUpdateInput): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (input.bankName !== undefined) payload.bankName = input.bankName.trim();
  if (input.accountName !== undefined) payload.accountName = input.accountName.trim();
  if (input.iban !== undefined) payload.iban = input.iban.replace(/\s+/g, "").toUpperCase();
  if (input.branchCode !== undefined) {
    const v = input.branchCode.trim();
    payload.branchCode = v.length > 0 ? v : undefined;
  }
  if (input.accountNo !== undefined) {
    const v = input.accountNo.trim();
    payload.accountNo = v.length > 0 ? v : undefined;
  }
  if (input.active !== undefined) payload.active = input.active;
  if (input.position !== undefined) payload.position = input.position;
  if (input.note !== undefined) {
    const v = input.note.trim();
    payload.note = v.length > 0 ? v : undefined;
  }
  return payload;
}

export async function createBankAccount(input: BankAccountInput): Promise<BankAccount> {
  const raw = await apiFetch<unknown>("/admin/bank-accounts", {
    method: "POST",
    body: JSON.stringify(buildPayload(input)),
  });
  if (raw && typeof raw === "object" && "data" in (raw as object)) {
    const env = raw as RawSingleEnvelope;
    if (env.data) return mapBankAccount(env.data);
  }
  return mapBankAccount(raw as RawBankAccount);
}

export async function updateBankAccount(
  id: string,
  input: BankAccountUpdateInput,
): Promise<BankAccount> {
  const raw = await apiFetch<unknown>(`/admin/bank-accounts/${id}`, {
    method: "PATCH",
    body: JSON.stringify(buildPayload(input)),
  });
  if (raw && typeof raw === "object" && "data" in (raw as object)) {
    const env = raw as RawSingleEnvelope;
    if (env.data) return mapBankAccount(env.data);
  }
  return mapBankAccount(raw as RawBankAccount);
}

export async function deleteBankAccount(id: string): Promise<BankAccountDeleteResult> {
  const raw = await apiFetch<unknown>(`/admin/bank-accounts/${id}`, {
    method: "DELETE",
  });
  if (raw && typeof raw === "object" && "data" in (raw as object)) {
    const env = raw as RawDeleteEnvelope;
    if (env.data) {
      return {
        id: env.data.id,
        softDeleted: !!env.data.softDeleted,
      };
    }
  }
  if (raw && typeof raw === "object") {
    const obj = raw as { id?: string; softDeleted?: boolean };
    return {
      id: obj.id ?? id,
      softDeleted: !!obj.softDeleted,
    };
  }
  return { id, softDeleted: false };
}

export function formatIban(value: string | null | undefined): string {
  if (!value) return "";
  const clean = value.replace(/\s+/g, "").toUpperCase();
  return clean.replace(/(.{4})/g, "$1 ").trim();
}

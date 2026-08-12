import type { ServerCustomer } from "@/lib/auth-server";
import type { AccountUser } from "../account-orders/types";

function deriveInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "AB";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function deriveAccountUser(customer: ServerCustomer): AccountUser {
  const name = customer.name?.trim() || customer.email.split("@")[0];
  return {
    initials: deriveInitials(name),
    name,
    companyName: name,
    verified: true,
  };
}

import type { ServerCustomer } from "@/lib/auth-server";
import { HeaderClient } from "./HeaderClient";

interface HeaderProps {
  customer: ServerCustomer | null;
}

export function Header({ customer }: HeaderProps) {
  return <HeaderClient initialCustomer={customer} />;
}

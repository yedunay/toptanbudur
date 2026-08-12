import { redirect } from "next/navigation";
import { getServerCustomer } from "@/lib/auth-server";

export default async function OdemeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const customer = await getServerCustomer();
  if (!customer) {
    redirect("/giris?next=/sepet/odeme");
  }
  return <>{children}</>;
}

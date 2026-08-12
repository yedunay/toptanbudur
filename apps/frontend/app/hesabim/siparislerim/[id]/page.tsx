import { redirect } from "next/navigation";
import { getServerCustomer } from "@/lib/auth-server";
import { AccountPlaceholderPage } from "@/components/account-shell/AccountPlaceholderPage";
import { deriveAccountUser } from "@/components/account-shell/derive-account-user";
import styles from "@/components/account-shell/account-shell.module.css";
import { SiparisDetayClient } from "./SiparisDetayClient";

export const dynamic = "force-dynamic";

export default async function SiparisDetayPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const customer = await getServerCustomer();
  if (!customer) {
    redirect(`/giris?next=/hesabim/siparislerim/${encodeURIComponent(id)}`);
  }

  const user = deriveAccountUser(customer);

  return (
    <main className={styles.accountPage}>
      <AccountPlaceholderPage
        user={user}
        title="Sipariş Detayı"
        description="Siparişinizin durumunu, kargo takibini ve ürünlerini görüntüleyin."
      >
        <SiparisDetayClient id={id} />
      </AccountPlaceholderPage>
    </main>
  );
}

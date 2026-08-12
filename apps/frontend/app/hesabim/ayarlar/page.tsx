import { redirect } from "next/navigation";
import { getServerCustomer } from "@/lib/auth-server";
import { AccountPlaceholderPage } from "@/components/account-shell/AccountPlaceholderPage";
import { deriveAccountUser } from "@/components/account-shell/derive-account-user";
import styles from "@/components/account-shell/account-shell.module.css";
import { AyarlarClient } from "./AyarlarClient";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const customer = await getServerCustomer();
  if (!customer) {
    redirect("/giris?next=/hesabim/ayarlar");
  }

  const user = deriveAccountUser(customer);

  return (
    <main className={styles.accountPage}>
      <AccountPlaceholderPage
        user={user}
        title=""
        description=""
      >
        <AyarlarClient />
      </AccountPlaceholderPage>
    </main>
  );
}

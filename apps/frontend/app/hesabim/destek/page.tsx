import { redirect } from "next/navigation";
import { getServerCustomer } from "@/lib/auth-server";
import { AccountPlaceholderPage } from "@/components/account-shell/AccountPlaceholderPage";
import { deriveAccountUser } from "@/components/account-shell/derive-account-user";
import { AccountSupportPage } from "@/components/account-support/AccountSupportPage";
import styles from "@/components/account-shell/account-shell.module.css";

export const dynamic = "force-dynamic";

export default async function SupportPage() {
  const customer = await getServerCustomer();
  if (!customer) {
    redirect("/giris?next=/hesabim/destek");
  }

  const user = deriveAccountUser(customer);

  return (
    <main className={styles.accountPage}>
      <AccountPlaceholderPage
        user={user}
        title="Destek Taleplerim"
        description="Sipariş ve diğer konulardaki destek taleplerinizi buradan yönetin."
      >
        <AccountSupportPage />
      </AccountPlaceholderPage>
    </main>
  );
}

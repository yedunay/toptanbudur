import { redirect } from "next/navigation";
import { getServerCustomer } from "@/lib/auth-server";
import { AccountPlaceholderPage } from "@/components/account-shell/AccountPlaceholderPage";
import { deriveAccountUser } from "@/components/account-shell/derive-account-user";
import styles from "@/components/account-shell/account-shell.module.css";
import { SifreForm } from "./SifreForm";

export const dynamic = "force-dynamic";

export default async function SifrePage() {
  const customer = await getServerCustomer();
  if (!customer) {
    redirect("/giris?next=/hesabim/profil/sifre");
  }

  const user = deriveAccountUser(customer);

  return (
    <main className={styles.accountPage}>
      <AccountPlaceholderPage
        user={user}
        title="Şifre Değiştir"
        description="Hesap güvenliğiniz için şifrenizi düzenli olarak güncelleyin."
      >
        <SifreForm />
      </AccountPlaceholderPage>
    </main>
  );
}

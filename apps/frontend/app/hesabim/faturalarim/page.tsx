import { redirect } from "next/navigation";
import { getServerCustomer } from "@/lib/auth-server";
import { deriveAccountUser } from "@/components/account-shell/derive-account-user";
import { AccountPlaceholderPage } from "@/components/account-shell/AccountPlaceholderPage";
import { InvoicesPage } from "@/components/account-invoices/InvoicesPage";
import { fetchMyInvoices } from "@/lib/customer-api";
import styles from "@/components/account-shell/account-shell.module.css";

export const dynamic = "force-dynamic";

export default async function Page() {
  const customer = await getServerCustomer();
  if (!customer) {
    redirect("/giris?next=/hesabim/faturalarim");
  }

  const user = deriveAccountUser(customer);

  const invoices = await fetchMyInvoices();
  const initialData = invoices?.success ? invoices.data : null;

  return (
    <main className={styles.accountPage}>
      <AccountPlaceholderPage
        user={user}
        title="Faturalarım"
        description="Siparişleriniz her ay sonunda ödeme tipine göre tek bir toplu e-faturada birleştirilir. Aylık faturalarınızı buradan görüntüleyin ve indirin."
      >
        <InvoicesPage initialData={initialData} />
      </AccountPlaceholderPage>
    </main>
  );
}

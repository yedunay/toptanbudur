import { redirect } from "next/navigation";
import { getServerCustomer } from "@/lib/auth-server";
import { deriveAccountUser } from "@/components/account-shell/derive-account-user";
import { AccountPlaceholderPage } from "@/components/account-shell/AccountPlaceholderPage";
import { CurrentAccountPage } from "@/components/account-current-account/CurrentAccountPage";
import {
  fetchBalance,
  fetchCariStatement,
  fetchCariStatementSummary,
} from "@/lib/customer-api";
import styles from "@/components/account-shell/account-shell.module.css";

export const dynamic = "force-dynamic";

export default async function Page() {
  const customer = await getServerCustomer();
  if (!customer) {
    redirect("/giris?next=/hesabim/cari");
  }

  const user = deriveAccountUser(customer);

  const [balance, summary, statement] = await Promise.all([
    fetchBalance(),
    fetchCariStatementSummary(),
    fetchCariStatement({ page: 1, pageSize: 50 }),
  ]);

  const initialBalance = balance?.success ? balance.data.balance : 0;
  const initialSummary = summary?.success ? summary.data : null;
  const initialStatement = statement?.success ? statement.data : [];
  const initialMeta = statement?.success
    ? statement.meta
    : { page: 1, pageSize: 50, total: 0, totalPages: 1 };

  return (
    <main className={styles.accountPage}>
      <AccountPlaceholderPage
        user={user}
        title="Cari Hesabım"
        description="Bakiye yüklemeleriniz, sipariş düşümleri ve düzeltmeler dahil tüm cari hareketlerinizi ekstre olarak görüntüleyin ve Excel olarak indirin."
      >
        <CurrentAccountPage
          initialBalance={initialBalance}
          initialSummary={initialSummary}
          initialStatement={initialStatement}
          initialMeta={initialMeta}
        />
      </AccountPlaceholderPage>
    </main>
  );
}

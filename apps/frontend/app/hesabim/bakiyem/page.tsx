import { redirect } from "next/navigation";
import { getServerCustomer } from "@/lib/auth-server";
import { AccountPlaceholderPage } from "@/components/account-shell/AccountPlaceholderPage";
import { deriveAccountUser } from "@/components/account-shell/derive-account-user";
import { AccountBalancePage } from "@/components/account-balance/AccountBalancePage";
import { mapBalance } from "@/components/account-balance/bakiyem-mapper";
import {
  fetchBalance,
  fetchBalanceLedger,
  fetchBalanceSummary,
  fetchBalanceTopups,
  fetchBankAccounts,
} from "@/lib/customer-api";
import styles from "@/components/account-shell/account-shell.module.css";

export const dynamic = "force-dynamic";

export default async function BalancePage() {
  const customer = await getServerCustomer();
  if (!customer) {
    redirect("/giris?next=/hesabim/bakiyem");
  }

  const user = deriveAccountUser(customer);

  const [balance, summary, ledger, topups, banks] = await Promise.all([
    fetchBalance(),
    fetchBalanceSummary(),
    fetchBalanceLedger({ page: 1, pageSize: 20 }),
    fetchBalanceTopups({ page: 1, pageSize: 20 }),
    fetchBankAccounts(),
  ]);

  const data = mapBalance({
    customerName: user.name,
    balance: balance?.success ? balance.data.balance : null,
    summary: summary?.success ? summary.data : null,
    ledger: ledger?.success ? ledger.data : [],
    topups: topups?.success ? topups.data : [],
    bankAccounts: banks?.success ? banks.data : [],
  });

  const rawBankAccounts = banks?.success ? banks.data : [];
  const initialLedgerMeta = ledger?.success
    ? ledger.meta
    : { total: 0, page: 1, limit: 20, totalPages: 1 };

  return (
    <main className={styles.accountPage}>
      <AccountPlaceholderPage
        user={user}
        title="Bakiyem"
        description="Cari bakiyenizi, ödeme geçmişinizi ve yükleme yöntemlerinizi tek ekranda yönetin."
      >
        <AccountBalancePage
          data={data}
          rawBankAccounts={rawBankAccounts}
          initialLedgerMeta={initialLedgerMeta}
        />
      </AccountPlaceholderPage>
    </main>
  );
}

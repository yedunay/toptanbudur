import { redirect } from "next/navigation";
import { getServerCustomer } from "@/lib/auth-server";
import { AccountOverviewPage } from "@/components/account-overview/AccountOverviewPage";
import {
  buildOverviewFallback,
  mapOverview,
} from "@/components/account-overview/overview-mapper";
import { fetchOverview } from "@/lib/customer-api";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const customer = await getServerCustomer();
  if (!customer) {
    redirect("/giris?next=/hesabim");
  }

  const response = await fetchOverview();
  const data =
    response && response.success
      ? mapOverview(response, customer)
      : buildOverviewFallback(customer);

  return (
    <main className={styles.accountPage}>
      <AccountOverviewPage data={data} />
    </main>
  );
}

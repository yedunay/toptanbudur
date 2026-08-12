import { redirect } from "next/navigation";
import { getServerCustomer } from "@/lib/auth-server";
import { AccountOrdersPage } from "@/components/account-orders/AccountOrdersPage";
import {
  buildOrdersFallback,
  mapOrders,
} from "@/components/account-orders/orders-mapper";
import {
  fetchOrdersDashboard,
  fetchOrdersList,
  fetchOrdersSummary,
  type ListOrdersQuery,
} from "@/lib/customer-api";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function getString(
  params: Record<string, string | string[] | undefined>,
  key: string,
): string | undefined {
  const v = params[key];
  return typeof v === "string" ? v : undefined;
}

function getPositiveInt(
  params: Record<string, string | string[] | undefined>,
  key: string,
  fallback: number,
): number {
  const v = getString(params, key);
  const n = v ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const pad = (n: number) => String(n).padStart(2, "0");
const toDateStr = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function resolveDatePreset(
  preset: string | undefined,
): { dateFrom?: string; dateTo?: string } {
  if (!preset) return {};
  const now = new Date();
  switch (preset) {
    case "today":
      return { dateFrom: toDateStr(now), dateTo: toDateStr(now) };
    case "7d": {
      const f = new Date(now);
      f.setDate(f.getDate() - 6);
      return { dateFrom: toDateStr(f), dateTo: toDateStr(now) };
    }
    case "30d": {
      const f = new Date(now);
      f.setDate(f.getDate() - 29);
      return { dateFrom: toDateStr(f), dateTo: toDateStr(now) };
    }
    case "thisMonth": {
      const f = new Date(now.getFullYear(), now.getMonth(), 1);
      return { dateFrom: toDateStr(f), dateTo: toDateStr(now) };
    }
    case "lastMonth": {
      const f = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const t = new Date(now.getFullYear(), now.getMonth(), 0);
      return { dateFrom: toDateStr(f), dateTo: toDateStr(t) };
    }
    default:
      return {};
  }
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const customer = await getServerCustomer();
  if (!customer) {
    redirect("/giris?next=/hesabim/siparislerim");
  }

  const params = await searchParams;

  const dateDates = resolveDatePreset(getString(params, "datePreset"));

  const query: ListOrdersQuery = {
    page: getPositiveInt(params, "page", 1),
    limit: getPositiveInt(params, "limit", 20),
    sort:
      (getString(params, "sort") as ListOrdersQuery["sort"]) ??
      "createdAt:desc",
    status: getString(params, "status"),
    search: getString(params, "search"),
    marketplace: getString(params, "marketplace"),
    cargoCompany: getString(params, "cargoCompany"),
    ...dateDates,
  };

  const [list, summary, dashboard] = await Promise.all([
    fetchOrdersList(query),
    fetchOrdersSummary(),
    fetchOrdersDashboard(),
  ]);

  const data =
    list?.success && summary?.success && dashboard?.success
      ? mapOrders(list, summary, dashboard, customer)
      : buildOrdersFallback(customer);

  return (
    <main className={styles.ordersPage}>
      <AccountOrdersPage data={data} />
    </main>
  );
}

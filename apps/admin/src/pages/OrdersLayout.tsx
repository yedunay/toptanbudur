import { NavLink, Outlet } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useRequireAuth } from "../lib/auth";
import { canAccess } from "../lib/permissions";
import { fetchPendingTicketsCount } from "../lib/support-tickets";

interface TabDef {
  to: string;
  label: string;
  end?: boolean;
}

export default function OrdersLayout(): React.ReactElement | null {
  const authed = useRequireAuth();

  // Sekme ve rozetler izne bağlı: "Siparişler" orders, "Sipariş Talepleri"
  // mesajlar iznine bağlıdır (App.tsx route guard'larıyla aynı eşleme).
  // İzinsiz kullanıcı sekmeyi ve bekleyen-talep SAYISINI dahi görmez.
  const canOrders = canAccess("orders");
  const canTalepler = canAccess("mesajlar");

  const ticketsCountQuery = useQuery({
    queryKey: ["support-tickets", "count", "PENDING"],
    queryFn: () => fetchPendingTicketsCount(),
    enabled: authed && canTalepler,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
  const ticketsCount = ticketsCountQuery.data ?? 0;

  if (!authed) return null;

  const tabs: ReadonlyArray<TabDef> = [
    ...(canOrders
      ? [{ to: "/orders", label: "Siparişler", end: true } as TabDef]
      : []),
    ...(canTalepler
      ? [{ to: "/orders/talepler", label: "Sipariş Talepleri" } as TabDef]
      : []),
  ];

  return (
    <div>
      {tabs.length > 0 && (
        <div className="mb-6 flex justify-end">
          <div
            role="tablist"
            aria-label="Sipariş görünüm seçici"
            className="inline-flex rounded-lg border border-[var(--color-border)] bg-white p-1 shadow-sm"
          >
            {tabs.map((tab) => (
              <NavLink
                key={tab.to}
                to={tab.to}
                end={tab.end}
                role="tab"
                className={({ isActive }) => {
                  const base =
                    "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition";
                  return isActive
                    ? `${base} bg-[var(--color-brand-blue)] text-white shadow-sm`
                    : `${base} text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-text)]`;
                }}
              >
                {tab.label}
                {tab.to === "/orders/talepler" && ticketsCount > 0 ? (
                  <span className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full bg-amber-400 text-[10px] font-bold text-amber-950 leading-none">
                    {ticketsCount > 99 ? "99+" : ticketsCount}
                  </span>
                ) : null}
              </NavLink>
            ))}
          </div>
        </div>
      )}

      <Outlet />
    </div>
  );
}

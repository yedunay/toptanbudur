"use client";

import { useCallback, useState, type ReactNode } from "react";
import { AccountSidebar } from "../account-orders/AccountSidebar";
import type { AccountUser } from "../account-orders/types";

interface AccountPlaceholderPageProps {
  user: AccountUser;
  title: string;
  description: string;
  badge?: string;
  children?: ReactNode;
}

export function AccountPlaceholderPage({
  user,
  title,
  description,
  badge,
  children,
}: AccountPlaceholderPageProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const closeMobileNav = useCallback(() => setMobileNavOpen(false), []);
  const openMobileNav = useCallback(() => setMobileNavOpen(true), []);

  return (
    <div className="flex w-full bg-[var(--surface)]">
      <AccountSidebar user={user} onNavigate={closeMobileNav} mobileOpen={mobileNavOpen} />

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-12 items-center px-4 sm:px-6 xl:hidden">
          <button
            type="button"
            onClick={openMobileNav}
            aria-label="Hesap menüsünü aç"
            aria-controls="account-sidebar"
            aria-expanded={mobileNavOpen}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ab-blue)]"
          >
            <span aria-hidden="true">☰</span>
            <span>Hesap Menüsü</span>
          </button>
        </div>

        <section className="mx-auto w-full max-w-[1500px] flex-1 px-4 pb-10 pt-3 sm:px-6 sm:pt-5">
          {title ? (
            <header className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h1 className="text-3xl font-black tracking-tight text-[var(--ab-text)]">{title}</h1>
                <p className="mt-1 text-sm text-slate-600">{description}</p>
              </div>
              {badge ? (
                <span className="inline-flex w-fit items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-bold text-amber-800">
                  <span aria-hidden="true" className="h-2 w-2 rounded-full bg-amber-500" />
                  {badge}
                </span>
              ) : null}
            </header>
          ) : null}

          {children ?? (
            <div className="rounded-3xl border border-dashed border-[var(--ab-border)] bg-white p-10 text-center shadow-sm">
              <p className="text-base font-bold text-[var(--ab-text)]">Bu sayfa çok yakında aktif olacak.</p>
              <p className="mx-auto mt-2 max-w-md text-sm text-slate-600">
                Toptan Budur ekibi içerik üzerinde çalışıyor. Geri dönüp diğer modülleri keşfedebilirsiniz.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

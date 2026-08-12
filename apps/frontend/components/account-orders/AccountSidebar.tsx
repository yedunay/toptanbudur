"use client";

import { useCallback } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  FileText,
  Headphones,
  Home,
  LogOut,
  PackageCheck,
  Receipt,
  Settings,
  ShieldCheck,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import type { AccountMenuKey, AccountUser } from "./types";

interface MenuItem {
  key: AccountMenuKey;
  label: string;
  icon: LucideIcon;
  href?: string;
}

const menuItems: MenuItem[] = [
  { key: "overview", label: "Genel Bakış", icon: Home, href: "/hesabim" },
  { key: "orders", label: "Siparişlerim", icon: PackageCheck, href: "/hesabim/siparislerim" },
  { key: "balance", label: "Bakiyem", icon: Wallet, href: "/hesabim/bakiyem" },
  { key: "current-account", label: "Cari Hesap", icon: FileText, href: "/hesabim/cari" },
  { key: "invoices", label: "Faturalarım", icon: Receipt, href: "/hesabim/faturalarim" },
  { key: "support", label: "Destek Taleplerim", icon: Headphones, href: "/hesabim/destek" },
  { key: "settings", label: "Hesap Ayarları", icon: Settings, href: "/hesabim/ayarlar" },
  { key: "logout", label: "Çıkış Yap", icon: LogOut },
];

interface AccountSidebarProps {
  user: AccountUser;
  mobileOpen: boolean;
  onNavigate: () => void;
}

export function AccountSidebar({ user, mobileOpen, onNavigate }: AccountSidebarProps) {
  const pathname = usePathname();
  const { logout } = useAuth();

  const handleLogout = useCallback(async () => {
    onNavigate();
    await logout();
  }, [logout, onNavigate]);

  return (
    <>
      {mobileOpen ? (
        <button
          type="button"
          onClick={onNavigate}
          aria-label="Menüyü kapat"
          className="fixed inset-0 z-30 bg-slate-950/50 xl:hidden"
        />
      ) : null}

      <aside
        id="account-sidebar"
        aria-label="Hesap navigasyonu"
        className={[
          "group/sidebar fixed inset-y-0 left-0 z-40 flex flex-col bg-[var(--ab-navy)] text-white shadow-2xl",
          "transition-[width,transform] duration-300 ease-out",
          "px-3 py-5",
          "w-72",
          "xl:sticky xl:top-0 xl:z-auto xl:h-screen xl:translate-x-0 xl:w-16 xl:hover:w-72 xl:focus-within:w-72",
          mobileOpen ? "translate-x-0" : "-translate-x-full xl:translate-x-0",
        ].join(" ")}
      >
        <div className="mb-6 flex items-center gap-2 px-1">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center" aria-hidden="true">
            <Image
              src="/toptanbudur-icon.png"
              alt="Toptan Budur"
              width={36}
              height={36}
              className="h-9 w-9 rounded-lg bg-white object-contain p-0.5"
            />
          </div>
          <span className="overflow-hidden whitespace-nowrap text-xl font-bold opacity-100 transition-opacity duration-200 xl:opacity-0 xl:group-hover/sidebar:opacity-100 xl:group-focus-within/sidebar:opacity-100">
            Toptan Budur
          </span>
        </div>

        <div className="mb-5 overflow-hidden rounded-3xl border border-white/10 bg-white/5 text-center transition-all duration-200 xl:mb-3 xl:max-h-0 xl:border-transparent xl:bg-transparent xl:p-0 xl:opacity-0 xl:group-hover/sidebar:max-h-72 xl:group-hover/sidebar:border-white/10 xl:group-hover/sidebar:bg-white/5 xl:group-hover/sidebar:p-5 xl:group-hover/sidebar:opacity-100 xl:group-focus-within/sidebar:max-h-72 xl:group-focus-within/sidebar:border-white/10 xl:group-focus-within/sidebar:bg-white/5 xl:group-focus-within/sidebar:p-5 xl:group-focus-within/sidebar:opacity-100 p-5">
          <div className="relative mx-auto mb-3 flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-blue-400 to-[var(--ab-blue)] text-2xl font-bold shadow-lg ring-4 ring-white/20">
            {user.initials}
            <span
              aria-hidden="true"
              className="absolute bottom-1 right-1 h-4 w-4 rounded-full border-2 border-[var(--ab-navy)] bg-green-400"
            />
          </div>

          <p className="font-semibold">{user.name}</p>
          <p className="mt-1 text-xs font-medium text-blue-100">{user.companyName}</p>

          {user.verified ? (
            <div className="mx-auto mt-3 inline-flex items-center gap-1.5 rounded-full bg-green-500/15 px-3 py-1 text-xs font-semibold text-green-200">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              Doğrulanmış Hesap
            </div>
          ) : null}
        </div>

        <nav aria-label="Hesap menüsü" className="space-y-1.5">
          {menuItems.map((item) => {
            const Icon = item.icon;

            if (item.key === "logout") {
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={handleLogout}
                  title={item.label}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-blue-50/90 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                >
                  <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
                  <span className="overflow-hidden whitespace-nowrap opacity-100 transition-opacity duration-200 xl:opacity-0 xl:group-hover/sidebar:opacity-100 xl:group-focus-within/sidebar:opacity-100">
                    {item.label}
                  </span>
                </button>
              );
            }

            const href = item.href ?? "/hesabim";
            const isActive = pathname === href;

            return (
              <Link
                key={item.key}
                href={href}
                onClick={onNavigate}
                title={item.label}
                aria-current={isActive ? "page" : undefined}
                className={[
                  "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60",
                  isActive
                    ? "bg-[var(--ab-blue)] text-white shadow-lg shadow-blue-950/20"
                    : "text-blue-50/90 hover:bg-white/10",
                ].join(" ")}
              >
                <span className="relative shrink-0">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <span className="overflow-hidden whitespace-nowrap opacity-100 transition-opacity duration-200 lg:opacity-0 lg:group-hover/sidebar:opacity-100 lg:group-focus-within/sidebar:opacity-100">
                  {item.label}
                </span>
              </Link>
            );
          })}
        </nav>

      </aside>
    </>
  );
}

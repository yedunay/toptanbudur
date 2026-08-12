"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Menu, X, User, ArrowRight, Search } from "lucide-react";
import { HeaderSearch } from "@/components/HeaderSearch";
import { CartLink } from "@/components/CartLink";
import type { ServerCustomer } from "@/lib/auth-server";
import { LANDING_URLS } from "@/lib/urls";

const BROADCAST_CHANNEL = "tb-auth";
const API_ROOT = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

interface NavLink {
  href: string;
  label: string;
  inverted?: boolean;
}

// Hepsi iç route — kurumsal sayfalar storefront'a taşındı (bkz. lib/urls.ts).
const NAV_LINKS: NavLink[] = [
  { href: LANDING_URLS.home, label: "Anasayfa" },
  { href: LANDING_URLS.about, label: "Hakkımızda" },
  { href: "/katalog", label: "Ürünler" },
  { href: LANDING_URLS.contact, label: "İletişim" },
];

function classes(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

function getDisplayName(name: string | null | undefined): string {
  if (!name) return "Hesabım";
  const trimmed = name.trim();
  if (!trimmed) return "Hesabım";
  return trimmed.split(" ")[0];
}

interface HeaderClientProps {
  initialCustomer: ServerCustomer | null;
}

export function HeaderClient({ initialCustomer }: HeaderClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement | null>(null);
  const [customer, setCustomer] = useState<ServerCustomer | null>(initialCustomer);

  // Rota değiştiğinde arama panelini ve mobil menüyü kapat. HeaderSearch artık
  // navigasyonu kendisi yapıyor; paneli burada reaktif kapatmak unmount/transition
  // yarışını ortadan kaldırır.
  useEffect(() => {
    setSearchOpen(false);
    setOpen(false);
  }, [pathname]);

  // Sync local state with the SSR prop. After login the AuthProvider triggers
  // router.refresh(); without this useState's initial value would stick and the
  // navbar would stay logged-out (keskin kural ihlali).
  useEffect(() => {
    setCustomer(initialCustomer);
  }, [initialCustomer]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("BroadcastChannel" in window)) return;
    const bc = new BroadcastChannel(BROADCAST_CHANNEL);
    bc.onmessage = (event) => {
      if (event.data === "logout") {
        setCustomer(null);
        router.refresh();
      } else if (event.data === "login") {
        router.refresh();
      }
    };
    return () => bc.close();
  }, [router]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (!searchOpen) return;
    function onDocClick(e: MouseEvent) {
      if (!searchRef.current) return;
      if (!searchRef.current.contains(e.target as Node)) setSearchOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setSearchOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [searchOpen]);

  const showLoggedInCtas = customer !== null;
  const showLoggedOutCtas = customer === null;
  const displayName = getDisplayName(customer?.name);

  return (
    <nav className="sticky top-0 z-30 bg-white/90 backdrop-blur-md border-b border-ab-border">
      <div className="ab-container h-navbar flex items-center justify-between">
        <Link
          href={LANDING_URLS.home}
          className="inline-flex items-center gap-3"
          aria-label="Toptan Budur anasayfa"
        >
          <Image
            src="/toptanbudur-logo.webp"
            alt="Toptan Budur"
            width={200}
            height={115}
            priority
            className="h-9 w-auto object-contain sm:h-10"
          />
        </Link>

        <div className="hidden lg:flex items-center gap-5 xl:gap-7">
          {NAV_LINKS.map((link) => {
            const baseClass = link.inverted
              ? "text-ab-base font-semibold bg-[var(--color-ab-blue)] !text-white px-4 py-1.5 rounded-ab-lg hover:bg-[var(--color-ab-blue-hover)] transition-colors"
              : "text-ab-base font-medium text-ab-text-secondary hover:text-ab-blue transition-colors";
            return (
              <Link key={link.href} href={link.href} className={baseClass}>
                {link.label}
              </Link>
            );
          })}
        </div>

        <div className="hidden lg:flex items-center gap-2 xl:gap-3 min-h-[40px]">
          <CartLink />
          <div className="relative" ref={searchRef}>
            <button
              type="button"
              aria-label={searchOpen ? "Aramayı kapat" : "Arama"}
              aria-expanded={searchOpen}
              aria-controls="header-search-panel"
              onClick={() => setSearchOpen((v) => !v)}
              className="inline-flex items-center justify-center w-10 h-10 rounded-ab-lg text-ab-navy hover:bg-ab-bg-page active:bg-ab-blue-50 transition-colors"
            >
              {searchOpen ? <X className="w-5 h-5" /> : <Search className="w-5 h-5" />}
            </button>
            {searchOpen && (
              <div
                id="header-search-panel"
                className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-ab-lg border border-ab-border bg-white shadow-ab-md p-3 z-40"
              >
                <HeaderSearch
                  variant="mobile"
                  onSubmitted={() => setSearchOpen(false)}
                />
              </div>
            )}
          </div>
          {showLoggedOutCtas && (
            <>
              <Link
                href="/giris"
                className="inline-flex items-center gap-1.5 h-10 px-3 rounded-ab-lg text-ab-base font-semibold text-ab-blue hover:bg-ab-blue-50 transition-colors"
              >
                <User className="w-4 h-4" />
                Giriş
              </Link>
              <Link
                href={LANDING_URLS.apply}
                className="inline-flex items-center gap-2 h-10 px-4 rounded-ab-lg bg-ab-blue text-white text-ab-base font-semibold hover:bg-ab-blue-hover transition-colors whitespace-nowrap focus:outline-none focus-visible:ring-3 focus-visible:ring-ab-blue/30"
              >
                Bayi Başvur
                <ArrowRight className="w-4 h-4" />
              </Link>
            </>
          )}

          {showLoggedInCtas && (
            <Link
              href="/hesabim"
              prefetch={false}
              aria-label={`Hesabım — ${displayName}`}
              className="inline-flex items-center gap-2 h-10 px-3.5 rounded-ab-lg border border-ab-border bg-white text-ab-base font-medium text-ab-navy hover:bg-ab-bg-page transition-colors focus:outline-none focus-visible:ring-3 focus-visible:ring-ab-blue/30"
            >
              <span className="w-7 h-7 rounded-full bg-ab-blue-50 text-ab-blue grid place-items-center" aria-hidden="true">
                <User className="w-4 h-4" />
              </span>
              <span className="max-w-[120px] truncate">{displayName}</span>
            </Link>
          )}
        </div>

        <div className="flex lg:hidden items-center gap-1.5">
          <CartLink />
          {!showLoggedInCtas ? (
            <Link
              href="/giris"
              aria-label="Giriş yap"
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-ab-lg text-ab-sm font-semibold text-ab-blue hover:bg-ab-blue-50 active:bg-ab-blue-50 transition-colors"
            >
              <User className="w-4 h-4" />
              Giriş
            </Link>
          ) : (
            <Link
              href="/hesabim"
              prefetch={false}
              aria-label={`Hesabım — ${displayName}`}
              className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-ab-blue-50 text-ab-blue hover:bg-ab-blue/10 transition-colors"
            >
              <User className="w-4 h-4" aria-hidden="true" />
            </Link>
          )}
          <button
            type="button"
            aria-label={open ? "Menüyü kapat" : "Menüyü aç"}
            aria-expanded={open}
            aria-controls="mobile-menu"
            onClick={() => setOpen((v) => !v)}
            className="inline-flex items-center justify-center w-10 h-10 rounded-ab-lg text-ab-navy hover:bg-ab-bg-page active:bg-ab-blue-50 transition-colors"
          >
            {open ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </div>

      <div
        id="mobile-menu"
        className={classes(
          "lg:hidden border-t border-ab-border bg-white",
          open ? "block" : "hidden",
        )}
      >
        <div className="ab-container py-4 flex flex-col gap-1">
          <div className="pb-3">
            <HeaderSearch
              variant="mobile"
              onSubmitted={() => setOpen(false)}
            />
          </div>
          {NAV_LINKS.map((link) => {
            const mobileClass = link.inverted
              ? "py-2.5 px-4 text-ab-md font-semibold bg-[var(--color-ab-blue)] !text-white rounded-ab-lg w-fit hover:bg-[var(--color-ab-blue-hover)]"
              : "py-2.5 text-ab-md font-medium text-ab-text-secondary hover:text-ab-blue";
            return (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className={mobileClass}
              >
                {link.label}
              </Link>
            );
          })}

          <div className="border-t border-ab-border mt-2 pt-3 flex flex-col gap-2">
            <div className="pb-1"><CartLink /></div>
            {showLoggedOutCtas && (
              <>
                <Link
                  href="/giris"
                  onClick={() => setOpen(false)}
                  className="py-2.5 text-ab-md font-medium text-ab-text-secondary hover:text-ab-blue"
                >
                  Giriş
                </Link>
                <Link
                  href={LANDING_URLS.apply}
                  onClick={() => setOpen(false)}
                  className="inline-flex items-center justify-center gap-2 w-full h-11 px-4 rounded-ab-lg bg-ab-blue text-white text-ab-base font-semibold hover:bg-ab-blue-hover transition-colors"
                >
                  Bayi Başvur
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </>
            )}

            {showLoggedInCtas && (
              <Link
                href="/hesabim"
                prefetch={false}
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 py-2.5 text-ab-md font-medium text-ab-navy hover:text-ab-blue"
              >
                <span className="w-7 h-7 rounded-full bg-ab-blue-50 text-ab-blue grid place-items-center" aria-hidden="true">
                  <User className="w-4 h-4" />
                </span>
                <span>Hesabım — <span className="font-semibold">{displayName}</span></span>
              </Link>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}

export { API_ROOT };

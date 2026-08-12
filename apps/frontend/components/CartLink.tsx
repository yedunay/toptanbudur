"use client";

import Link from "next/link";
import { useHydratedCart } from "@/lib/cart";
import { countDistinctSuppliers } from "@/lib/cart-split";

export function CartLink() {
  const count = useHydratedCart((s) => s.count());
  const items = useHydratedCart((s) => s.items);
  const hasMultipleSuppliers =
    Array.isArray(items) && countDistinctSuppliers(items) > 1;

  return (
    <Link
      href="/sepet"
      aria-label={
        hasMultipleSuppliers
          ? "Sepet — birden fazla pakete bölünmesi gerekiyor"
          : "Sepet"
      }
      className="relative inline-flex items-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 py-1.5 text-sm font-medium text-[var(--brand-navy)] transition hover:border-[var(--brand-blue)] hover:text-[var(--brand-blue)]"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-5 w-5"
        aria-hidden="true"
      >
        <circle cx="9" cy="21" r="1" />
        <circle cx="20" cy="21" r="1" />
        <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
      </svg>
      <span className="hidden sm:inline">Sepet</span>
      {typeof count === "number" && count > 0 && (
        <span
          aria-label={`Sepette ${count} ürün`}
          className="absolute -right-2 -top-2 inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-[var(--brand-blue)] px-1.5 py-0.5 text-xs font-semibold text-white"
        >
          {count}
        </span>
      )}
      {hasMultipleSuppliers && (
        <span
          aria-label="Sepetiniz birden fazla pakete bölünmek zorunda"
          title="Sepetiniz birden fazla pakete bölünmek zorunda"
          className="absolute -left-2 -top-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-500 text-[11px] font-black leading-none text-white ring-2 ring-white"
        >
          !
        </span>
      )}
    </Link>
  );
}

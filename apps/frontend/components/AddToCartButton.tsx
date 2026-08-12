"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Product } from "@/lib/api";
import { useCustomer } from "@/lib/auth";
import { useCartStore } from "@/lib/cart";

interface AddToCartButtonProps {
  product: Product;
  disabled?: boolean;
}

const MIN_QTY = 1;
const MAX_QTY = 99;

function clampQty(value: number, stockMax: number | null): number {
  if (!Number.isFinite(value)) return MIN_QTY;
  const upper = stockMax != null ? Math.min(MAX_QTY, Math.max(MIN_QTY, stockMax)) : MAX_QTY;
  return Math.max(MIN_QTY, Math.min(upper, Math.floor(value)));
}

interface AddedModalProps {
  open: boolean;
  onClose: () => void;
}

function AddedModal({ open, onClose }: AddedModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previouslyFocused = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      previouslyFocused?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cart-added-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="w-full max-w-sm rounded-lg bg-white p-6 shadow-xl outline-none"
      >
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
              <path
                fillRule="evenodd"
                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 111.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                clipRule="evenodd"
              />
            </svg>
          </span>
          <div className="min-w-0 flex-1">
            <h2
              id="cart-added-title"
              className="text-base font-semibold text-[var(--brand-navy)]"
            >
              Sepete Eklendi
            </h2>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              Ürün sepetinize başarıyla eklendi.
            </p>
          </div>
        </div>

        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Link
            href="/katalog"
            onClick={onClose}
            className="order-2 inline-flex items-center justify-center rounded-md border border-[var(--border)] bg-white px-4 py-2 text-sm font-medium text-[var(--text)] transition hover:border-[var(--brand-blue)] sm:order-1"
          >
            Alışverişe Devam Et
          </Link>
          <Link
            href="/sepet"
            onClick={onClose}
            className="order-1 inline-flex items-center justify-center rounded-md bg-[var(--brand-blue)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--brand-navy)] sm:order-2"
          >
            Sepete Git
          </Link>
        </div>
      </div>
    </div>
  );
}

interface QtyStepperProps {
  qty: number;
  onChange: (next: number) => void;
  stockMax: number | null;
  disabled?: boolean;
  label?: string;
}

function QtyStepper({ qty, onChange, stockMax, disabled, label }: QtyStepperProps) {
  const upper = stockMax != null ? Math.min(MAX_QTY, Math.max(MIN_QTY, stockMax)) : MAX_QTY;
  return (
    <div
      className="inline-flex items-center rounded-md border border-[var(--border)] bg-white"
      role="group"
      aria-label={label ?? "Adet seçici"}
    >
      <button
        type="button"
        onClick={() => onChange(clampQty(qty - 1, stockMax))}
        disabled={disabled || qty <= MIN_QTY}
        aria-label="Adet azalt"
        className="h-10 w-10 text-lg font-semibold text-[var(--brand-navy)] transition hover:bg-[var(--surface-muted)] disabled:cursor-not-allowed disabled:opacity-40"
      >
        −
      </button>
      <input
        type="number"
        inputMode="numeric"
        min={MIN_QTY}
        max={upper}
        value={qty}
        disabled={disabled}
        onChange={(e) => {
          const v = parseInt(e.target.value, 10);
          if (!Number.isFinite(v)) return;
          onChange(clampQty(v, stockMax));
        }}
        aria-label="Adet"
        className="h-10 w-14 border-x border-[var(--border)] bg-white text-center text-sm focus:outline-none disabled:bg-[var(--surface-muted)]"
      />
      <button
        type="button"
        onClick={() => onChange(clampQty(qty + 1, stockMax))}
        disabled={disabled || qty >= upper}
        aria-label="Adet arttır"
        className="h-10 w-10 text-lg font-semibold text-[var(--brand-navy)] transition hover:bg-[var(--surface-muted)] disabled:cursor-not-allowed disabled:opacity-40"
      >
        +
      </button>
    </div>
  );
}

export function AddToCartButton({ product, disabled }: AddToCartButtonProps) {
  const add = useCartStore((s) => s.add);
  const router = useRouter();
  const { customer, loading } = useCustomer();
  const pathname = usePathname();

  const stockMax =
    typeof product.stock === "number" && product.stock > 0 ? product.stock : null;

  const [qty, setQty] = useState<number>(MIN_QTY);
  const [modalOpen, setModalOpen] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!errorMsg) return;
    const t = setTimeout(() => setErrorMsg(null), 5000);
    return () => clearTimeout(t);
  }, [errorMsg]);

  const onAdd = useCallback(
    (navigateAfter: boolean) => {
      if (disabled) return;
      try {
        add(product, qty);
        if (navigateAfter) {
          router.push("/sepet");
          return;
        }
        setModalOpen(true);
      } catch {
        setErrorMsg("Ürün şu an alınamıyor, daha sonra tekrar deneyin.");
      }
    },
    [add, product, qty, disabled, router],
  );

  if (loading) {
    return (
      <div
        aria-hidden
        className="mt-6 h-12 w-44 animate-pulse rounded-md bg-[var(--surface-muted)]"
      />
    );
  }

  if (!customer) {
    const next = pathname && pathname.startsWith("/") ? pathname : "/katalog";
    return (
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <QtyStepper qty={qty} onChange={setQty} stockMax={stockMax} disabled label="Adet (giriş gerekli)" />
        <Link
          href={`/giris?next=${encodeURIComponent(next)}`}
          className="inline-flex items-center justify-center rounded-md bg-[var(--brand-blue)] px-6 py-3 text-base font-semibold text-white transition hover:bg-[var(--brand-navy)]"
        >
          Giriş yap
        </Link>
      </div>
    );
  }

  return (
    <>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <QtyStepper qty={qty} onChange={setQty} stockMax={stockMax} disabled={disabled} />
        <button
          type="button"
          onClick={() => onAdd(false)}
          disabled={disabled}
          className="inline-flex items-center justify-center rounded-md bg-[var(--brand-blue)] px-6 py-3 text-base font-semibold text-white transition hover:bg-[var(--brand-navy)] disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          Sepete Ekle
        </button>
        <button
          type="button"
          onClick={() => onAdd(true)}
          disabled={disabled}
          className="inline-flex items-center justify-center rounded-md border border-[var(--brand-blue)] bg-white px-6 py-3 text-base font-semibold text-[var(--brand-blue)] transition hover:bg-[var(--brand-blue)]/5 disabled:cursor-not-allowed disabled:border-gray-300 disabled:text-gray-400"
        >
          Hemen Al
        </button>
      </div>
      {errorMsg && (
        <p
          role="status"
          aria-live="polite"
          className="mt-2 text-sm font-medium text-red-700"
        >
          {errorMsg}
        </p>
      )}
      <AddedModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  );
}

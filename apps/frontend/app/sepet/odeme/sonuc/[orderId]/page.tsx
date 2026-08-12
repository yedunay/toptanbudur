"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { fetchOrder, formatOrderNo } from "@/lib/orders";
import { useCartStore } from "@/lib/cart";
import { useCheckoutStore } from "@/lib/checkout-state";

const POLL_INTERVAL_MS = 3_000;
/** ~60 sn — 3 sn aralıkla en fazla 20 deneme. */
const MAX_POLLS = 20;

/**
 * Ödeme alındıktan sonra sipariş ilerlemiş olabilir (hazırlanıyor, kargoda
 * vb.) — bunların hepsi "ödeme alındı" sayılır. Bu sayfa sipariş onayı
 * YAPMAZ; yalnızca backend'in callback ile yazdığı durumu okur.
 */
const PAID_OR_LATER = new Set([
  "paid",
  "preparing",
  "processing",
  "shipped",
  "delivered",
]);

type ViewState = "checking" | "paid" | "failed" | "timeout";

export default function OdemeSonucPage() {
  return (
    <Suspense fallback={<main className="mx-auto max-w-2xl px-6 py-16" />}>
      <OdemeSonucPageInner />
    </Suspense>
  );
}

function OdemeSonucPageInner() {
  const params = useParams<{ orderId: string }>();
  const searchParams = useSearchParams();
  const orderId = params.orderId;
  const t = searchParams.get("t");
  const failed = searchParams.get("fail") === "1";

  const [state, setState] = useState<ViewState>(
    failed ? "failed" : "checking",
  );
  // İnsan-okur sipariş numarası (61...) — polling ile gelen detaydan alınır,
  // müşteriye UUID yerine bu gösterilir.
  const [humanOrderNo, setHumanOrderNo] = useState<string | null>(null);
  const clearCart = useCartStore((s) => s.clear);
  const resetCheckout = useCheckoutStore((s) => s.reset);

  // PayTR ok/fail dönüşü iFrame İÇİNDE açılır — sonucu küçük çerçevede
  // bırakmamak için üst pencereye çık (frame breakout, aynı origin).
  useEffect(() => {
    if (typeof window !== "undefined" && window.top !== window.self) {
      try {
        window.top!.location.href = window.location.href;
      } catch {
        // üst pencereye erişilemezse çerçevede kal (beklenmez; aynı origin)
      }
    }
  }, []);

  // SEPET TEMİZLİĞİ ancak ödeme ONAYLANINCA yapılır (sipariş oluştururken
  // değil) — ödeme başarısız olur ya da müşteri vazgeçerse sepet aynen
  // kalır ve tekrar denenebilir. clear() idempotenttir.
  useEffect(() => {
    if (state === "paid") {
      clearCart();
      resetCheckout();
    }
  }, [state, clearCart, resetCheckout]);

  useEffect(() => {
    if (failed) return;
    if (!orderId || !t) {
      setState("timeout");
      return;
    }

    let cancelled = false;
    let polls = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll() {
      polls += 1;
      const detail = await fetchOrder(orderId, t!);
      if (cancelled) return;
      if (detail) {
        const no = detail.order.humanOrderNo ?? null;
        if (no) setHumanOrderNo(no);
        const status = detail.order.status?.toLowerCase() ?? "";
        if (PAID_OR_LATER.has(status)) {
          setState("paid");
          return;
        }
        if (status === "cancelled") {
          setState("failed");
          return;
        }
      }
      if (polls >= MAX_POLLS) {
        setState("timeout");
        return;
      }
      timer = setTimeout(() => void poll(), POLL_INTERVAL_MS);
    }

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [orderId, t, failed]);

  if (state === "checking") {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16">
        <div className="flex flex-col items-center gap-3 rounded-3xl border border-[var(--border)] bg-white p-10 text-center shadow-sm">
          <div
            className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--brand-blue)] border-t-transparent"
            aria-hidden="true"
          />
          <p className="text-sm font-semibold text-[var(--text-muted)]">
            Ödemeniz doğrulanıyor — bu birkaç saniye sürebilir…
          </p>
        </div>
      </main>
    );
  }

  if (state === "paid") {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16 text-center">
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-6 text-emerald-800">
          <h1 className="text-2xl font-bold">
            Ödemeniz alındı! Siparişiniz onaylandı.
          </h1>
          <p className="mt-2 text-sm">
            <span className="font-mono font-semibold">
              {formatOrderNo(humanOrderNo, orderId.slice(0, 8).toUpperCase())}
            </span>{" "}
            nolu siparişiniz alınmıştır.
          </p>
        </div>
        <div className="mt-8 flex flex-col items-center gap-3">
          <Link
            href={`/sepet/tesekkurler/${encodeURIComponent(orderId)}?t=${encodeURIComponent(t ?? "")}`}
            className="inline-block rounded-md bg-[var(--brand-blue)] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[var(--brand-navy)]"
          >
            Sipariş detayına git
          </Link>
        </div>
      </main>
    );
  }

  if (state === "failed") {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16 text-center">
        <div className="rounded-md border border-red-300 bg-red-50 p-6 text-red-700">
          <h1 className="text-2xl font-bold">Ödeme tamamlanamadı.</h1>
          <p className="mt-2 text-sm">
            Kartınızdan ücret tahsil edilmedi. Dilerseniz tekrar
            deneyebilirsiniz.
          </p>
        </div>
        <div className="mt-8 flex flex-col items-center gap-3">
          <Link
            href={`/sepet/odeme/kart/${encodeURIComponent(orderId)}${t ? `?t=${encodeURIComponent(t)}` : ""}`}
            className="inline-block rounded-md bg-[var(--brand-blue)] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[var(--brand-navy)]"
          >
            Tekrar dene
          </Link>
          <Link
            href="/katalog"
            className="text-sm text-[var(--text-muted)] hover:text-[var(--brand-navy)]"
          >
            Kataloğa dön
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-16 text-center">
      <div className="rounded-md border border-amber-200 bg-amber-50 p-6 text-amber-800">
        <h1 className="text-2xl font-bold">
          Sonuç doğrulaması uzun sürüyor
        </h1>
        <p className="mt-2 text-sm">
          Ödemeniz işleniyor olabilir — Siparişlerim sayfasından kontrol
          edebilirsiniz.
        </p>
      </div>
      <div className="mt-8 flex flex-col items-center gap-3">
        <Link
          href="/hesabim/siparislerim"
          className="inline-block rounded-md bg-[var(--brand-blue)] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[var(--brand-navy)]"
        >
          Siparişlerime git
        </Link>
        <Link
          href="/katalog"
          className="text-sm text-[var(--text-muted)] hover:text-[var(--brand-navy)]"
        >
          Kataloğa dön
        </Link>
      </div>
    </main>
  );
}

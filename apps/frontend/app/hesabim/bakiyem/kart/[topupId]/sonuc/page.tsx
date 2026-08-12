"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { apiCustomer } from "@/lib/auth";
import { formatTRY } from "@/components/account-balance/bakiyem-format";
import { ReceiptButton } from "@/components/receipts/ReceiptButton";

const POLL_INTERVAL_MS = 3_000;
/** ~60 sn — 3 sn aralıkla en fazla 20 deneme. */
const MAX_POLLS = 20;

interface TopupStatusData {
  id: string;
  humanTopupNo: string | null;
  amount: number;
  method: string | null;
  commissionAmount: number | null;
  chargedAmount: number | null;
  status: "PENDING" | "APPROVED" | "REJECTED" | string;
}

type ViewState =
  | { kind: "checking" }
  | { kind: "approved"; amount: number }
  | { kind: "failed" }
  | { kind: "rejected" }
  | { kind: "timeout" };

export default function BakiyeKartSonucPage() {
  return (
    <Suspense fallback={<main className="mx-auto max-w-2xl px-6 py-16" />}>
      <BakiyeKartSonucPageInner />
    </Suspense>
  );
}

function BakiyeKartSonucPageInner() {
  const params = useParams<{ topupId: string }>();
  const searchParams = useSearchParams();
  const topupId = params.topupId;
  const failed = searchParams.get("fail") === "1";

  const [state, setState] = useState<ViewState>(
    failed ? { kind: "failed" } : { kind: "checking" },
  );

  useEffect(() => {
    if (failed) return;
    if (!topupId) {
      setState({ kind: "timeout" });
      return;
    }

    let cancelled = false;
    let polls = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll() {
      polls += 1;
      let data: TopupStatusData | null = null;
      try {
        const res = await apiCustomer<{
          success?: boolean;
          data?: TopupStatusData;
        }>(`/me/cari-balance/topups/status?id=${encodeURIComponent(topupId)}`, {
          method: "GET",
          general: true,
          cache: "no-store",
        });
        if (res?.success && res.data) data = res.data;
      } catch {
        // geçici hata — polling devam eder
      }
      if (cancelled) return;
      if (data) {
        if (data.status === "APPROVED") {
          setState({ kind: "approved", amount: data.amount });
          return;
        }
        if (data.status === "REJECTED") {
          setState({ kind: "rejected" });
          return;
        }
      }
      if (polls >= MAX_POLLS) {
        setState({ kind: "timeout" });
        return;
      }
      timer = setTimeout(() => void poll(), POLL_INTERVAL_MS);
    }

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [topupId, failed]);

  if (state.kind === "checking") {
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

  if (state.kind === "approved") {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16 text-center">
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-6 text-emerald-800">
          <h1 className="text-2xl font-bold">
            Bakiyenize {formatTRY(state.amount)} eklendi!
          </h1>
          <p className="mt-2 text-sm">
            Yüklemeniz onaylandı — tutar cari bakiyenizde kullanıma hazır.
          </p>
        </div>
        <div className="mt-8 flex flex-col items-center gap-3">
          <Link
            href="/hesabim/bakiyem"
            className="inline-block rounded-md bg-[var(--brand-blue)] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[var(--brand-navy)]"
          >
            Bakiyem’e dön
          </Link>
          <ReceiptButton
            kind="topup"
            id={topupId}
            variant="button"
            label="Tahsilat makbuzunu görüntüle"
          />
        </div>
      </main>
    );
  }

  if (state.kind === "failed") {
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
            href={`/hesabim/bakiyem/kart/${encodeURIComponent(topupId)}`}
            className="inline-block rounded-md bg-[var(--brand-blue)] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[var(--brand-navy)]"
          >
            Tekrar dene
          </Link>
          <Link
            href="/hesabim/bakiyem"
            className="text-sm text-[var(--text-muted)] hover:text-[var(--brand-navy)]"
          >
            Vazgeç
          </Link>
        </div>
      </main>
    );
  }

  if (state.kind === "rejected") {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16 text-center">
        <div className="rounded-md border border-red-300 bg-red-50 p-6 text-red-700">
          <h1 className="text-2xl font-bold">Yükleme talebi kapatıldı.</h1>
          <p className="mt-2 text-sm">
            Bu yükleme talebi sonuçlandırılmadan kapatıldı. Dilerseniz yeni bir
            yükleme talebi oluşturabilirsiniz.
          </p>
        </div>
        <div className="mt-8 flex flex-col items-center gap-3">
          <Link
            href="/hesabim/bakiyem"
            className="inline-block rounded-md bg-[var(--brand-blue)] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[var(--brand-navy)]"
          >
            Bakiyem’e dön
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
          Ödemeniz işleniyor olabilir — Bakiyem sayfasından kontrol
          edebilirsiniz.
        </p>
      </div>
      <div className="mt-8 flex flex-col items-center gap-3">
        <Link
          href="/hesabim/bakiyem"
          className="inline-block rounded-md bg-[var(--brand-blue)] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[var(--brand-navy)]"
        >
          Bakiyem’e git
        </Link>
      </div>
    </main>
  );
}

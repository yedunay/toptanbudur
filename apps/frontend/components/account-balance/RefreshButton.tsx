"use client";

import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

interface RefreshButtonProps {
  updatedAt: string;
}

export function RefreshButton({ updatedAt }: RefreshButtonProps) {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={() => router.refresh()}
      className="inline-flex items-center gap-2 rounded-2xl border border-[var(--ab-border)] bg-white px-3 py-2 text-xs font-semibold text-slate-600 shadow-sm transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ab-blue)] sm:px-4 sm:text-sm"
      aria-label="Sayfayı yenile"
    >
      <span aria-hidden="true" className="h-2 w-2 rounded-full bg-green-500" />
      Son Güncelleme: {updatedAt}
      <RefreshCw className="h-4 w-4 text-slate-400" aria-hidden="true" />
    </button>
  );
}

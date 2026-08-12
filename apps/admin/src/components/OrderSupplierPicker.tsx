import { useEffect, useRef, useState, type ReactElement } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "./Toast";
import { formatTRY } from "../lib/products";
import {
  fetchOrderEligibleSuppliers,
  setOrderSupplier,
  type OrderEligibleSuppliersResponse,
} from "../lib/orders";
import { canSeeCostProfit } from "../lib/permissions";

/**
 * SİPARİŞ-SEVİYESİ tedarikçi seçici (kullanıcı kararı 2026-06-29).
 * Tetik = kalemin altındaki TEDARİKÇİ ADI (ör. "Toptan Budur"). Tıklanınca AŞAĞI
 * DOĞRU açılır (in-flow, kırpılmaz): siparişin TÜM kalemlerini karşılayan her
 * tedarikçi + (çok kalemliyse) HER ÜRÜNÜN o tedarikçideki alım maliyeti + toplam.
 * Bir tedarikçiye tıklayınca TÜM kalemler ona alınır (kalem-kalem değiştirme YOK).
 * Dışarı tıklayınca / Esc ile kapanır. Hem sipariş listesinde hem detayında.
 *
 * Uçlar (order-eligible-suppliers + order-supplier) OWNER/ADMIN'e kilitli ve
 * alım maliyeti taşıyor; çalışanda (MEMBER) seçici hiç açılmaz — tedarikçi adı
 * düz metin kalır, aksi halde tıklayınca "Yüklenemedi" kutusu çıkardı.
 */
export function OrderSupplierPicker({
  orderId,
  triggerLabel,
}: {
  orderId: string;
  /** Tetik butonunda gösterilen mevcut tedarikçi adı. */
  triggerLabel: string;
}): ReactElement {
  const canEdit = canSeeCostProfit();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const queryClient = useQueryClient();
  const toast = useToast();

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const eligibleQuery = useQuery<OrderEligibleSuppliersResponse>({
    queryKey: ["order", orderId, "order-eligible-suppliers"],
    queryFn: () => fetchOrderEligibleSuppliers(orderId),
    enabled: open && canEdit,
    staleTime: 30_000,
  });

  const mutation = useMutation({
    mutationFn: (supplierId: string) => setOrderSupplier(orderId, supplierId),
    onSuccess: () => {
      toast.push("success", "Siparişin TÜM kalemleri bu tedarikçiye alındı");
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["order", orderId] });
      void queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
    onError: (err) => {
      toast.push("error", err instanceof Error ? err.message : "Güncellenemedi");
    },
  });

  const current = eligibleQuery.data?.currentSupplierId ?? null;
  const multiItem = (eligibleQuery.data?.suppliers[0]?.items.length ?? 0) > 1;

  // Çalışan: sadece ad görünsün — tıklanacak bir şey yok, sorgu da atılmaz.
  if (!canEdit) {
    return (
      <span className="inline-flex items-center rounded-md bg-[var(--color-surface-muted)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--color-text-muted)]">
        {triggerLabel}
      </span>
    );
  }

  return (
    <span ref={ref} className="inline-block">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          setOpen((v) => !v);
        }}
        title="Tıkla → tüm siparişi tek tedarikçiye al (kalem-kalem değiştirilemez)"
        className="inline-flex items-center gap-1 rounded-md bg-[var(--color-surface-muted)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--color-text-muted)] hover:bg-[var(--color-border)] hover:text-[var(--color-text)] transition-colors"
      >
        {triggerLabel}
        <svg viewBox="0 0 12 12" className="h-2.5 w-2.5 opacity-70" aria-hidden="true">
          <path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open ? (
        <div
          onClick={(e) => e.stopPropagation()}
          className="mt-1 w-[260px] max-w-[88vw] overflow-hidden rounded-lg border border-[var(--color-border)] bg-white shadow-md"
        >
          <div className="border-b border-[var(--color-border)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--color-text-muted)]">
            Tüm siparişi şu tedarikçiden al:
          </div>
          {eligibleQuery.isLoading ? (
            <div className="px-2.5 py-2 text-[11px] text-[var(--color-text-muted)]">
              Yükleniyor…
            </div>
          ) : eligibleQuery.isError ? (
            <div className="px-2.5 py-2 text-[11px] text-red-700">Yüklenemedi</div>
          ) : eligibleQuery.data && eligibleQuery.data.suppliers.length > 0 ? (
            <div className="max-h-80 overflow-y-auto py-1">
              {eligibleQuery.data.suppliers.map((s) => {
                const isCurrent = s.id === current;
                return (
                  <button
                    key={s.id}
                    type="button"
                    disabled={mutation.isPending || isCurrent}
                    onClick={(e) => {
                      e.stopPropagation();
                      mutation.mutate(s.id);
                    }}
                    className={`block w-full border-b border-[var(--color-border)] px-2.5 py-1.5 text-left transition-colors last:border-b-0 hover:bg-[var(--color-surface-muted)] disabled:cursor-default ${
                      isCurrent ? "bg-[var(--color-surface-muted)]" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 text-[12px] font-semibold text-[var(--color-text)]">
                      <span className="flex items-center gap-1">
                        {isCurrent ? <span aria-hidden="true">✓</span> : null}
                        {s.name}
                        {isCurrent ? (
                          <span className="text-[10px] font-normal text-[var(--color-text-muted)]">
                            (şu an)
                          </span>
                        ) : null}
                      </span>
                      <span className="tabular-nums">{formatTRY(s.totalCost)}</span>
                    </div>
                    {multiItem ? (
                      <div className="mt-1 space-y-0.5">
                        {s.items.map((it, i) => (
                          <div
                            key={i}
                            className="flex items-center justify-between gap-2 text-[10px] text-[var(--color-text-muted)]"
                          >
                            <span className="truncate">
                              {it.qty > 1 ? `${it.qty}× ` : ""}
                              {it.productName}
                            </span>
                            <span className="tabular-nums whitespace-nowrap">
                              {formatTRY(it.cost)}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="px-2.5 py-2 text-[11px] text-[var(--color-text-muted)]">
              Tüm kalemleri stoklayan tek tedarikçi yok
            </div>
          )}
        </div>
      ) : null}
    </span>
  );
}

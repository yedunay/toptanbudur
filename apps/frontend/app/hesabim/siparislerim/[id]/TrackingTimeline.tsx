"use client";

import {
  deriveCustomerOrderView,
  type CustomerOrderStage,
} from "@/lib/order-customer-status";

// Müşteri (bayi) sipariş detayındaki sade, animasyonlu kargo çizelgesi.
//
// KESKİN KURAL: Burada tedarikçi adı / tedarikçi sipariş kodu / barkod /
// "otomatik ... (zamanlı)" gibi OTOMASYON ifadeleri ASLA gösterilmez. Ham
// OrderTrackingEvent.description (ör. "Go İthalat siparişi açıldı (TY-...)")
// hiç okunmaz — çizelge tamamen order.status + createdAt'ten TÜRETİLİR.
// Yalnızca 3 adım vardır: Sipariş Alındı → Hazırlanıyor → Kargoya Verildi.

interface Step {
  key: CustomerOrderStage;
  label: string;
}

const STEPS: Step[] = [
  { key: "received", label: "Sipariş Alındı" },
  { key: "preparing", label: "Hazırlanıyor" },
  { key: "shipped", label: "Kargoya Verildi" },
];

const STAGE_INDEX: Record<string, number> = {
  received: 0,
  preparing: 1,
  shipped: 2,
};

function formatDate(d: Date): string {
  try {
    return new Intl.DateTimeFormat("tr-TR", {
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  } catch {
    return "";
  }
}

type EntryState = "completed" | "current" | "pending" | "cancelled";

interface Entry {
  label: string;
  state: EntryState;
  occurredAt: Date | null;
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
      <path
        fillRule="evenodd"
        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 111.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function XIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
      <path
        fillRule="evenodd"
        d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function Timeline({ entries }: { entries: Entry[] }) {
  return (
    <ol className="relative ml-3 border-l-2 border-[var(--border)]">
      {entries.map((entry, idx) => {
        const dotClass =
          entry.state === "completed"
            ? "bg-emerald-500 text-white border-emerald-500"
            : entry.state === "current"
              ? "bg-[var(--brand-blue)] text-white border-[var(--brand-blue)] ring-4 ring-[var(--brand-blue)]/20 animate-pulse"
              : entry.state === "cancelled"
                ? "bg-red-500 text-white border-red-500"
                : "bg-white text-[var(--text-muted)] border-[var(--border)]";

        const labelClass =
          entry.state === "current"
            ? "text-[var(--brand-blue)] font-semibold"
            : entry.state === "cancelled"
              ? "text-red-600 font-semibold"
              : entry.state === "completed"
                ? "text-[var(--text)] font-medium"
                : "text-[var(--text-muted)]";

        return (
          <li key={idx} className="relative pb-6 pl-6 last:pb-0">
            <span
              className={`absolute -left-[13px] flex h-6 w-6 items-center justify-center rounded-full border-2 ${dotClass}`}
              aria-hidden
            >
              {entry.state === "completed" ? (
                <CheckIcon />
              ) : entry.state === "cancelled" ? (
                <XIcon />
              ) : (
                <span className="text-xs font-semibold">{idx + 1}</span>
              )}
            </span>

            <div className={`text-sm ${labelClass}`}>{entry.label}</div>
            {entry.occurredAt && (
              <div className="mt-0.5 text-xs text-[var(--text-muted)]">
                {formatDate(entry.occurredAt)}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

interface TrackingTimelineProps {
  status: string;
  createdAt: string | Date | null | undefined;
}

export function TrackingTimeline({ status, createdAt }: TrackingTimelineProps) {
  const view = deriveCustomerOrderView(status, createdAt);

  // İptal / İade — 3 adımlı akış yerine sade iki düğüm.
  if (view.stage === "cancelled" || view.stage === "refunded") {
    return (
      <Timeline
        entries={[
          {
            label: "Sipariş Alındı",
            state: "completed",
            occurredAt: view.createdAt,
          },
          {
            label: view.stage === "cancelled" ? "İptal Edildi" : "İade Edildi",
            state: "cancelled",
            occurredAt: null,
          },
        ]}
      />
    );
  }

  const reachedIdx = STAGE_INDEX[view.stage] ?? 0;
  // "Kargoya Verildi" müşteri modelinde terminal (bitti) statüdür — o aşamaya
  // gelindiğinde son adım "current" (mavi nabız) değil "completed" (yeşil ✓)
  // gösterilir; süreç bittiği hissi verir. Ara adımlar (alındı/hazırlanıyor)
  // ise bulunulan adımda nabız atarak animasyonlu ilerler.
  const isTerminal = view.stage === "shipped";
  const entries: Entry[] = STEPS.map((step, idx) => {
    const state: EntryState =
      idx < reachedIdx
        ? "completed"
        : idx === reachedIdx
          ? isTerminal
            ? "completed"
            : "current"
          : "pending";

    // SADECE "Sipariş Alındı" tarih gösterir. "Hazırlanıyor" ve "Kargoya
    // Verildi" altına ASLA tarih yazılmaz — müşteri ürünün ne zaman kargoya
    // verildiğini bilmemeli (biz daha erken/daha geç veriyoruz).
    const occurredAt: Date | null =
      step.key === "received" ? view.createdAt : null;

    return { label: step.label, state, occurredAt };
  });

  return <Timeline entries={entries} />;
}

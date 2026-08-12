"use client";

import { Check } from "lucide-react";

interface Step {
  key: string;
  number: number;
  title: string;
  description: string;
}

const STEPS: Step[] = [
  { key: "cart", number: 1, title: "Sepet", description: "Ürünlerinizi sepete eklediniz." },
  { key: "control", number: 2, title: "Kontrol", description: "Satış kanalı, kargo ve evrak bilgilerini kontrol edin." },
  { key: "payment", number: 3, title: "Ödeme", description: "Ödeme bilgilerinizi girerek siparişi tamamlayın." },
];

export function CheckoutSteps({ currentStep }: { currentStep: 1 | 2 | 3 }) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {STEPS.map((step) => {
        const isDone = step.number < currentStep;
        const isActive = step.number === currentStep;

        return (
          <article
            key={step.key}
            className={[
              "relative rounded-2xl border bg-white p-6 shadow-sm",
              isActive
                ? "border-[var(--brand-blue)] ring-2 ring-blue-100"
                : "border-[var(--border)]",
            ].join(" ")}
          >
            <div className="flex items-center gap-4">
              <span
                className={[
                  "flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-lg font-black",
                  isDone || isActive
                    ? "bg-[var(--brand-blue)] text-white"
                    : "bg-slate-100 text-slate-500",
                ].join(" ")}
              >
                {isDone ? <Check className="h-6 w-6" /> : step.number}
              </span>

              <div>
                <h2 className="text-xl font-black text-[var(--text)]">
                  {step.number}. {step.title}
                </h2>
                <p className="mt-1 text-sm font-medium text-[var(--text-muted)]">
                  {step.description}
                </p>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

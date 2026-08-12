"use client";

import { useEffect } from "react";

export type ToastTone = "success" | "error" | "info";

export interface ToastState {
  id: number;
  tone: ToastTone;
  message: string;
}

interface ToastProps {
  toast: ToastState | null;
  onDismiss: () => void;
  durationMs?: number;
}

const TONE_CLASS: Record<ToastTone, string> = {
  success: "border-emerald-300 bg-emerald-50 text-emerald-800",
  error: "border-red-300 bg-red-50 text-red-700",
  info: "border-blue-300 bg-blue-50 text-blue-700",
};

export function Toast({ toast, onDismiss, durationMs = 4000 }: ToastProps) {
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(onDismiss, durationMs);
    return () => clearTimeout(t);
  }, [toast, onDismiss, durationMs]);

  if (!toast) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-4 z-50 mx-auto flex justify-center px-4"
    >
      <div
        className={`pointer-events-auto max-w-md rounded-md border px-4 py-3 text-sm shadow-md ${TONE_CLASS[toast.tone]}`}
      >
        {toast.message}
      </div>
    </div>
  );
}

export function makeToast(tone: ToastTone, message: string): ToastState {
  return { id: Date.now() + Math.random(), tone, message };
}

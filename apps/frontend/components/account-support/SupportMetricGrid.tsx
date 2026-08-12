"use client";

import {
  Clock,
  FileText,
  MessageCircle,
  MessageSquare,
  Timer,
  type LucideIcon,
} from "lucide-react";
import type { MetricTone, SupportMetric } from "./types";

const TONE_BG: Record<MetricTone, string> = {
  blue: "bg-blue-50 border-blue-100",
  green: "bg-emerald-50 border-emerald-100",
  orange: "bg-amber-50 border-amber-100",
  purple: "bg-purple-50 border-purple-100",
};

const TONE_ICON: Record<MetricTone, string> = {
  blue: "text-blue-600",
  green: "text-emerald-600",
  orange: "text-amber-600",
  purple: "text-purple-600",
};

const TONE_VALUE: Record<MetricTone, string> = {
  blue: "text-blue-900",
  green: "text-emerald-900",
  orange: "text-amber-900",
  purple: "text-purple-900",
};

const METRIC_ICON: Record<string, LucideIcon> = {
  total: FileText,
  open: MessageCircle,
  replied: MessageSquare,
  avgResponse: Clock,
  avgResolve: Timer,
};

export function SupportMetricGrid({ metrics }: { metrics: SupportMetric[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {metrics.map((m) => {
        const Icon = METRIC_ICON[m.key] ?? FileText;
        return (
          <div
            key={m.key}
            className={`flex items-center gap-3 rounded-2xl border p-4 ${TONE_BG[m.tone]}`}
          >
            <Icon className={`h-8 w-8 shrink-0 ${TONE_ICON[m.tone]}`} />
            <div className="min-w-0">
              <p className={`text-2xl font-black ${TONE_VALUE[m.tone]}`}>
                {m.value}
              </p>
              <p className="truncate text-xs font-semibold text-slate-600">
                {m.description}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

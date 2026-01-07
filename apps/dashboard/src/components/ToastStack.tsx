"use client";

import { useEffect } from "react";

export type ToastItem = {
  id: string;
  title: string;
  body?: string;
  tone?: "info" | "warning" | "danger";
  ttlMs?: number;
};

const toneStyles: Record<NonNullable<ToastItem["tone"]>, string> = {
  info: "border-slate-800/70 bg-slate-950/95 text-white",
  warning: "border-amber-300/40 bg-amber-900/90 text-amber-50",
  danger: "border-rose-300/40 bg-rose-900/90 text-rose-50",
};

export function ToastStack({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}) {
  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts.map((t) =>
      setTimeout(() => onDismiss(t.id), t.ttlMs ?? 6000)
    );
    return () => timers.forEach(clearTimeout);
  }, [toasts, onDismiss]);

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed right-6 top-20 z-50 flex w-[320px] flex-col gap-3">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto animate-fade-up rounded-2xl border px-4 py-3 shadow-[0_14px_32px_rgba(4,10,24,0.55)] ${
            toneStyles[t.tone ?? "info"]
          }`}
        >
          <div className="text-sm font-semibold">{t.title}</div>
          {t.body ? <div className="mt-1 text-xs text-white/70">{t.body}</div> : null}
        </div>
      ))}
    </div>
  );
}

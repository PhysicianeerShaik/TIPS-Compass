import { RiskLevel } from "@/lib/types";

const styles: Record<RiskLevel, string> = {
  green: "bg-emerald-400/15 text-emerald-100 border-emerald-300/30 shadow-[0_0_0_1px_rgba(16,185,129,0.15)]",
  yellow: "bg-amber-400/15 text-amber-100 border-amber-300/30 shadow-[0_0_0_1px_rgba(251,191,36,0.15)]",
  red: "bg-rose-400/15 text-rose-100 border-rose-300/30 shadow-[0_0_0_1px_rgba(251,113,133,0.15)]",
};

export function RiskBadge({ level }: { level: RiskLevel }) {
  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] ${styles[level]}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {level.toUpperCase()}
    </span>
  );
}

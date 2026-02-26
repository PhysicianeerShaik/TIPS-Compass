import { RiskLevel } from "@/lib/types";

const styles: Record<RiskLevel, string> = {
  green: "bg-emerald-50 text-emerald-700 border-emerald-200 font-medium",
  yellow: "bg-amber-50 text-amber-800 border-amber-300 font-medium",
  red: "bg-rose-50 text-rose-800 border-rose-300 font-bold",
};

export function RiskBadge({ level }: { level: RiskLevel }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded border text-xs capitalize ${styles[level]}`}>
      <span className={`mr-1.5 h-2 w-2 rounded-full ${level === 'red' ? 'bg-rose-500' : level === 'yellow' ? 'bg-amber-500' : 'bg-emerald-500'}`} />
      {level}
    </span>
  );
}

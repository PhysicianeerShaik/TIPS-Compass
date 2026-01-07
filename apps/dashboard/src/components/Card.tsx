import { ReactNode } from "react";

export function Card({ children }: { children: ReactNode }) {
  return (
    <div className="glass-panel relative overflow-hidden rounded-3xl p-6">
      {children}
    </div>
  );
}

import { ReactNode } from "react";

export function Card({ children }: { children: ReactNode }) {
  return (
    <div className="glass-panel relative overflow-hidden rounded-lg p-4">
      {children}
    </div>
  );
}

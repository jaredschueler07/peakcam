"use client";
import { type ReactNode } from "react";

interface ChipProps {
  label: string;
  active?: boolean;
  onClick?: () => void;
  icon?: ReactNode;
}

// pc-chip — pill radius, ink border, cream paper bg. Active flips to ink/cream.
export function Chip({ label, active = false, onClick, icon }: ChipProps) {
  return (
    <button
      onClick={onClick}
      className={`
        inline-flex items-center gap-1.5 rounded-full px-3 py-1
        text-[12px] font-bold uppercase tracking-[0.08em]
        border-[1.5px] cursor-pointer select-none whitespace-nowrap
        transition-colors duration-150
        ${active
          ? "bg-ink text-cream-50 border-ink"
          : "bg-cream-50 text-ink border-bark hover:border-ink"}
      `}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
          active ? "bg-cream-50" : "bg-bark"
        }`}
      />
      {icon && <span>{icon}</span>}
      {label}
    </button>
  );
}

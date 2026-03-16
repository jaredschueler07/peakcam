"use client";
import { type ReactNode } from "react";

interface ChipProps {
  label: string;
  active?: boolean;
  onClick?: () => void;
  icon?: ReactNode;
}

export function Chip({ label, active = false, onClick, icon }: ChipProps) {
  return (
    <button
      onClick={onClick}
      className={`
        inline-flex items-center gap-1.5 rounded-full px-3 py-1
        text-xs font-semibold border cursor-pointer select-none
        transition-all duration-[220ms] whitespace-nowrap
        ${active
          ? "border-cyan/30 bg-cyan-dim text-cyan"
          : "border-border bg-surface2 text-text-muted hover:border-border-hi hover:text-text-subtle"}
      `}
    >
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${active ? "bg-cyan" : "bg-text-muted"}`} />
      {icon && <span>{icon}</span>}
      {label}
    </button>
  );
}

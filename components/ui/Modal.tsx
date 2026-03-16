"use client";
import { useEffect, type ReactNode } from "react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}

export function Modal({ open, onClose, title, children, footer }: ModalProps) {
  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6
        bg-black/88 backdrop-blur-sm animate-fadeIn"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      aria-modal="true"
      role="dialog"
    >
      <div className="w-full max-w-3xl bg-surface2 border border-border-hi
        rounded-xl overflow-hidden animate-slideUp">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2.5">
            <span className="text-[10px] font-bold px-2 py-0.5 rounded
              bg-red-950/40 text-red-400 border border-red-400/30 tracking-wide">
              ● LIVE
            </span>
            <span className="text-[15px] font-bold tracking-tight">{title}</span>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-7 h-7 flex items-center justify-center rounded-md
              bg-surface3 border border-border text-text-muted text-base
              hover:text-text-base hover:bg-border transition-colors duration-150"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div>{children}</div>

        {/* Footer */}
        {footer && (
          <div className="flex items-center justify-between px-5 py-3.5
            border-t border-border">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

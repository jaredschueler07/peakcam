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
        bg-ink/70 backdrop-blur-sm animate-fadeIn"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      aria-modal="true"
      role="dialog"
    >
      <div className="w-full max-w-3xl bg-cream-50 border-[1.5px] border-ink
        rounded-[18px] overflow-hidden animate-slideUp shadow-stamp-lg">

        {/* Header — ink bar, cream text, alpen LIVE stamp */}
        <div className="flex items-center justify-between px-5 py-4 bg-ink text-cream-50 border-b-[1.5px] border-ink">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-0.5 rounded-full
              bg-alpen text-cream-50 border-[1.5px] border-ink uppercase tracking-[0.14em] shadow-[2px_2px_0_#2a1f14]">
              <span className="w-1.5 h-1.5 rounded-full bg-cream-50 animate-pulse-live" />
              Live
            </span>
            <span className="font-display font-black text-[18px] tracking-[-0.01em]">{title}</span>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 flex items-center justify-center rounded-full
              bg-cream-50 text-ink border-[1.5px] border-ink text-lg font-bold
              hover:bg-alpen hover:text-cream-50 transition-colors duration-150
              shadow-[2px_2px_0_#2a1f14]"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="bg-cream-50">{children}</div>

        {/* Footer */}
        {footer && (
          <div className="flex items-center justify-between px-5 py-3.5
            bg-cream border-t-[1.5px] border-dashed border-bark">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

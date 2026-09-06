"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Native modality keeps background controls inert and contains keyboard focus. */
export function Modal({ open = true, onClose, label, title, footer, children, className = "m-auto w-[calc(100%_-_2rem)] max-w-3xl rounded-[18px]" }: {
  open?: boolean; onClose(): void; label?: string; title?: string; footer?: ReactNode; children: ReactNode; className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close();
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus();
    };
  }, [open]);
  if (typeof document === "undefined") return null;
  return createPortal(<dialog ref={ref} aria-label={label ?? title}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}
    className={`fixed max-h-[90dvh] overflow-y-auto overscroll-contain border-[1.5px] border-ink bg-cream-50 p-0 text-ink shadow-stamp-lg backdrop:bg-ink/70 ${className}`}>
    {title && <div className="flex items-center justify-between gap-3 border-b border-ink bg-ink px-5 py-4 text-cream-50">
      <h2 className="font-display text-xl font-bold">{title}</h2>
      <button type="button" aria-label="Close" onClick={onClose} className="h-11 w-11 shrink-0 rounded-full border border-cream-50 text-xl">×</button>
    </div>}
    {children}
    {footer && <div className="border-t border-bark bg-cream px-5 py-4">{footer}</div>}
  </dialog>, document.body);
}

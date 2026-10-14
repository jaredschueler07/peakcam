"use client";

import { useEffect, useRef, type CSSProperties, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

type Layout = "scroll" | "panel";

/* "scroll": the dialog box itself scrolls (default). "panel": a non-scrolling flex
   column whose height tracks the *visual* viewport, for consumers that split their
   content into a scrolling body and a pinned footer. `fixed` + `m-auto` centre
   against the layout viewport, which iOS/Android do not shrink for the on-screen
   keyboard or pinch zoom — so a centred, 90dvh-tall dialog can straddle the
   keyboard and its footer ends up off screen (GitHub #63). */
const LAYOUT_CLASS: Record<Layout, string> = {
  scroll: "max-h-[90dvh] overflow-y-auto overscroll-contain",
  panel: "flex flex-col overflow-hidden",
};
const PANEL_STYLE: CSSProperties = {
  maxHeight: "min(90dvh, calc(var(--pc-vv-h, 100dvh) - 1rem - var(--pc-safe-top, 0px) - var(--pc-safe-bottom, 0px)))",
  marginTop: "var(--pc-vv-top, auto)",
};

/** Native modality keeps background controls inert and contains keyboard focus. */
export function Modal({ open = true, onClose, label, title, footer, children, layout = "scroll", initialFocus, className = "m-auto w-[calc(100%_-_2rem)] max-w-3xl rounded-[18px]" }: {
  open?: boolean; onClose(): void; label?: string; title?: string; footer?: ReactNode; children: ReactNode; className?: string;
  layout?: Layout;
  /** Focused after `showModal()` instead of the first focusable control (often the × button). */
  initialFocus?: RefObject<HTMLElement | null>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    dialog.showModal();
    initialFocus?.current?.focus();
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close();
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus();
    };
  }, [open, initialFocus]);

  useEffect(() => {
    const dialog = ref.current;
    if (!open || layout !== "panel" || !dialog) return;
    const vv = window.visualViewport;
    let frame = 0;
    const sync = () => {
      frame = 0;
      const height = vv?.height ?? window.innerHeight;
      const offsetTop = vv?.offsetTop ?? 0;
      dialog.style.setProperty("--pc-vv-h", `${Math.round(height)}px`);
      // While the visual viewport is smaller than, or panned within, the layout
      // viewport, pin the dialog's top edge just inside it; otherwise leave the
      // margin at `auto` so the consumer's `m-auto` centring applies.
      const reduced = offsetTop > 0 || height < document.documentElement.clientHeight - 1;
      if (reduced) dialog.style.setProperty("--pc-vv-top", `calc(${Math.round(offsetTop)}px + 0.5rem + var(--pc-safe-top, 0px))`);
      else dialog.style.removeProperty("--pc-vv-top");
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(sync); };
    sync();
    vv?.addEventListener("resize", schedule);
    vv?.addEventListener("scroll", schedule);
    window.addEventListener("resize", schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      vv?.removeEventListener("resize", schedule);
      vv?.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      dialog.style.removeProperty("--pc-vv-h");
      dialog.style.removeProperty("--pc-vv-top");
    };
  }, [open, layout]);

  if (typeof document === "undefined") return null;
  return createPortal(<dialog ref={ref} aria-label={label ?? title}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}
    style={layout === "panel" ? PANEL_STYLE : undefined}
    className={`fixed ${LAYOUT_CLASS[layout]} border-[1.5px] border-ink bg-cream-50 p-0 text-ink shadow-stamp-lg backdrop:bg-ink/70 ${className}`}>
    {title && <div className="pc-on-ink flex shrink-0 items-center justify-between gap-3 border-b border-ink bg-ink px-5 py-4 text-cream-50">
      <h2 className="font-display text-xl font-bold">{title}</h2>
      <button type="button" aria-label="Close" onClick={onClose} className="h-11 w-11 shrink-0 rounded-full border border-cream-50 text-xl">×</button>
    </div>}
    {children}
    {footer && <div className="shrink-0 border-t border-bark bg-cream px-5 py-4">{footer}</div>}
  </dialog>, document.body);
}

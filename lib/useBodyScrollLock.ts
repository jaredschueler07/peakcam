"use client";
import { useEffect } from "react";

/**
 * Locks body scroll while `active` is true. iOS Safari ignores
 * `overflow: hidden` for touch scrolling, so the body is pinned with
 * `position: fixed` at its current scroll offset and scrolled back on unlock.
 * Restores the previous inline styles on cleanup, so nested locks (modal over
 * lightbox) unwind correctly.
 */
export function useBodyScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const { style } = document.body;
    const scrollY = window.scrollY;
    const previous = { position: style.position, top: style.top, left: style.left, right: style.right, width: style.width, overflow: style.overflow };
    style.position = "fixed";
    style.top = `-${scrollY}px`;
    style.left = "0";
    style.right = "0";
    style.width = "100%";
    style.overflow = "hidden";
    return () => {
      Object.assign(style, previous);
      // `html { scroll-behavior: smooth }` would otherwise animate the restore.
      window.scrollTo({ top: scrollY, behavior: "instant" });
    };
  }, [active]);
}

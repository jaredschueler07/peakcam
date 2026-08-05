"use client";
import { useEffect } from "react";

/**
 * Locks body scroll while `active` is true. Restores the previous overflow on
 * cleanup, so nested locks (modal over lightbox) unwind correctly.
 */
export function useBodyScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [active]);
}

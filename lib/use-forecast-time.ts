"use client";

import { useSyncExternalStore } from "react";

// One clock shared by all badges. Hide time-sensitive claims in cached HTML,
// then evaluate them against the browser clock after hydration and every 30s.
let nowMs = Date.now();
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) {
    nowMs = Date.now();
    timer = setInterval(() => {
      nowMs = Date.now();
      for (const notify of listeners) notify();
    }, 30_000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

const getSnapshot = () => nowMs;
const getServerSnapshot = () => null;

export function useForecastTime(): number | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

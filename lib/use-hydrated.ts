"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};
const getSnapshot = () => true;
const getServerSnapshot = () => false;

/**
 * `false` during SSR *and* during the hydration render (React uses
 * `getServerSnapshot` for both), `true` from the first post-hydration render
 * on. Use it to gate output that depends on the browser — timezone, locale
 * data, `Date.now()` — so the server HTML and the hydrating client agree
 * byte-for-byte, then upgrade to the local version. Prefer this over
 * `useEffect` + `useState` (an extra commit) and over
 * `suppressHydrationWarning` (which hides the bug instead of fixing it).
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

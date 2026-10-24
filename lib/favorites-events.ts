// ─────────────────────────────────────────────────────────────
// Favourites changed — one small notification seam.
//
// A save can happen outside the component that renders a heart: the global
// LineupIntentBridge finishes a guest selection after auth, and the dashboard
// may already be mounted. Consumers that hold favourite state therefore
// listen for this event and refetch. The same-tab CustomEvent covers the
// caller's own page; BroadcastChannel covers other tabs, where a CustomEvent
// would never arrive. Both are best-effort: if the browser blocks channels,
// the next mount still reads the truth from the database.
// ─────────────────────────────────────────────────────────────

export const FAVORITES_CHANGED_EVENT = "peakcam:favorites-changed";
const FAVORITES_CHANNEL = "peakcam:favorites";

function hasWindow(): boolean {
  return typeof window !== "undefined";
}

/**
 * Tell every mounted favourites consumer (same tab and, when available,
 * other tabs) to read the table again. Never throws: analytics/UI plumbing
 * must not break a save that already succeeded.
 */
export function notifyFavoritesChanged(): void {
  if (!hasWindow()) return;
  try {
    window.dispatchEvent(new Event(FAVORITES_CHANGED_EVENT));
  } catch {
    // ignored
  }
  try {
    if (typeof BroadcastChannel === "function") {
      const channel = new BroadcastChannel(FAVORITES_CHANNEL);
      channel.postMessage({ type: "changed" });
      channel.close();
    }
  } catch {
    // ignored — the local event already ran
  }
}

/** Subscribe to both the same-tab event and the cross-tab channel. Returns an unsubscribe. */
export function subscribeFavoritesChanged(listener: () => void): () => void {
  if (!hasWindow()) return () => {};
  const handler = () => listener();
  window.addEventListener(FAVORITES_CHANGED_EVENT, handler);

  let channel: BroadcastChannel | null = null;
  try {
    if (typeof BroadcastChannel === "function") {
      channel = new BroadcastChannel(FAVORITES_CHANNEL);
      channel.addEventListener("message", handler);
    }
  } catch {
    channel = null;
  }

  return () => {
    window.removeEventListener(FAVORITES_CHANGED_EVENT, handler);
    try {
      channel?.removeEventListener("message", handler);
      channel?.close();
    } catch {
      // ignored
    }
  };
}

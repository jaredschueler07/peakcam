// ─────────────────────────────────────────────────────────────
// Meta Pixel — custom event helpers
// Call these from client components to fire Pixel events.
// ─────────────────────────────────────────────────────────────

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
  }
}

function pixelTrack(event: string, params?: Record<string, unknown>) {
  if (typeof window !== "undefined" && window.fbq) {
    window.fbq("track", event, params);
  }
}

/** Fire when a user views a resort detail page. */
export function trackViewContent(resortName: string, resortSlug: string) {
  pixelTrack("ViewContent", {
    content_name: resortName,
    content_ids: [resortSlug],
    content_type: "resort",
  });
}

/** Fire when a user searches/filters on the browse page. */
export function trackSearch(query: string) {
  pixelTrack("Search", { search_string: query });
}

/** Fire when a user subscribes to powder alerts. */
export function trackLead(email: string) {
  pixelTrack("Lead", { content_name: "powder_alert_subscription" });
}

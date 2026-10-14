// ─────────────────────────────────────────────────────────────
// Meta Pixel — custom event helpers
// Call these from client components to fire Pixel events.
// ─────────────────────────────────────────────────────────────

import { fireMetaPixelEvent } from "./meta-pixel";

/** Fire when a user views a resort detail page. */
export function trackViewContent(resortName: string, resortSlug: string) {
  fireMetaPixelEvent("ViewContent", {
    content_name: resortName,
    content_ids: [resortSlug],
    content_type: "resort",
  });
}

/** Fire when a user searches/filters on the browse page. */
export function trackSearch(query: string) {
  fireMetaPixelEvent("Search", { search_string: query });
}

/** Fire when the powder-alert subscribe API accepts a sign-up (200). */
export function trackLead() {
  fireMetaPixelEvent("Lead", { content_name: "powder_alert_subscription" });
}

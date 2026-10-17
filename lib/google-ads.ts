/** Google Ads configuration and conversion queue, shared by the tag and events. */
export function googleAdsId(): string | undefined {
  const raw = process.env.NEXT_PUBLIC_GOOGLE_ADS_ID;
  return raw && /^AW-\d+$/.test(raw) ? raw : undefined;
}

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    peakcamGoogleAdsId?: string;
  }
}

/** Queue configuration before events, even when gtag.js has not loaded yet. */
export function initializeGoogleAds() {
  const id = googleAdsId();
  if (!id || typeof window === "undefined") return;
  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function () {
    // gtag's documented queue uses Arguments objects, not data-layer events.
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer!.push(arguments);
  };
  if (window.peakcamGoogleAdsId === id) return;
  window.peakcamGoogleAdsId = id;
  window.gtag("js", new Date());
  window.gtag("config", id);
}

/** The default remains the powder-alert conversion, separate from accounts. */
export function trackGoogleConversion(label = process.env.NEXT_PUBLIC_GOOGLE_ADS_ALERT_LABEL) {
  const id = googleAdsId();
  if (!id || !label || !/^[A-Za-z0-9_-]+$/.test(label) || typeof window === "undefined") return;
  initializeGoogleAds();
  window.gtag?.("event", "conversion", { send_to: `${id}/${label}` });
}

export function trackGoogleSignup() {
  const label = process.env.NEXT_PUBLIC_GOOGLE_ADS_SIGNUP_LABEL;
  // Do not fall back to the alert label when the account action is unset.
  if (label) trackGoogleConversion(label);
}

"use client";

import Script from "next/script";

// ─────────────────────────────────────────────────────────────
// Google Ads tag (gtag.js) — env-gated, no-op without NEXT_PUBLIC_GOOGLE_ADS_ID.
//
// Only the Ads conversion tag is wired here (an `AW-…` id); it is not a GA4
// property. The single conversion action we report is the powder-alert
// sign-up, identified by NEXT_PUBLIC_GOOGLE_ADS_ALERT_LABEL — the label half
// of the `send_to` string Google shows when you create the conversion action.
// ─────────────────────────────────────────────────────────────

// Both values are interpolated into an inline <script>, so anything that is
// not a well-formed Ads id / conversion label is rejected rather than trusted.
function readAdsId(): string | undefined {
  const raw = process.env.NEXT_PUBLIC_GOOGLE_ADS_ID;
  return raw && /^AW-[A-Za-z0-9]+$/.test(raw) ? raw : undefined;
}

function readAlertLabel(): string | undefined {
  const raw = process.env.NEXT_PUBLIC_GOOGLE_ADS_ALERT_LABEL;
  return raw && /^[A-Za-z0-9_-]+$/.test(raw) ? raw : undefined;
}

const ADS_ID = readAdsId();
const ALERT_LABEL = readAlertLabel();

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

/** Loads gtag.js and configures the Ads account. Renders nothing without the env var. */
export function GoogleTag() {
  if (!ADS_ID) return null;

  return (
    <>
      <Script
        id="google-tag-loader"
        strategy="afterInteractive"
        src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ADS_ID)}`}
      />
      <Script id="google-tag-init" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){ window.dataLayer.push(arguments); }
          window.gtag = window.gtag || gtag;
          window.gtag('js', new Date());
          window.gtag('config', '${ADS_ID}');
        `}
      </Script>
    </>
  );
}

/**
 * Reports a conversion to Google Ads. Defaults to the powder-alert action;
 * pass `label` to report a different conversion action under the same
 * account. No-op unless the tag is loaded AND a label is available.
 */
export function trackGoogleConversion(label: string | undefined = ALERT_LABEL) {
  if (!ADS_ID || !label) return;
  if (typeof window === "undefined" || typeof window.gtag !== "function") return;
  window.gtag("event", "conversion", { send_to: `${ADS_ID}/${label}` });
}

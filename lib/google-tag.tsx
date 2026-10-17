"use client";

import { useEffect } from "react";
import Script from "next/script";
import { googleAdsId, initializeGoogleAds } from "./google-ads";

// Preserve the existing powder-alert helper import.
export { trackGoogleConversion } from "./google-ads";

/** Loads the Ads tag; conversion calls can safely queue before it mounts. */
export function GoogleTag() {
  const id = googleAdsId();
  useEffect(() => { initializeGoogleAds(); }, []);
  if (!id) return null;

  return (
    <Script
      id="google-tag-loader"
      strategy="afterInteractive"
      src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`}
    />
  );
}

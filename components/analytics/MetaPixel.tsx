"use client";

import { useEffect } from "react";
import Script from "next/script";
import { usePathname } from "next/navigation";
import { META_PIXEL_ID, META_PIXEL_SNIPPET } from "@/lib/meta-pixel";

/**
 * Loads the Meta Pixel base snippet once and fires PageView on initial mount
 * and on every client-side route change (the snippet alone only fires on full
 * page loads). Mounted once in the root layout; renders nothing visible. The
 * <noscript> image covers visitors with JavaScript disabled.
 */
export function MetaPixel() {
  const pathname = usePathname();

  useEffect(() => {
    window.fbq?.("track", "PageView");
  }, [pathname]);

  return (
    <>
      <Script
        id="meta-pixel"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{ __html: META_PIXEL_SNIPPET }}
      />
      <noscript>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          height="1"
          width="1"
          style={{ display: "none" }}
          alt=""
          src={`https://www.facebook.com/tr?id=${META_PIXEL_ID}&ev=PageView&noscript=1`}
        />
      </noscript>
    </>
  );
}

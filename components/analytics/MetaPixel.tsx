"use client";

import { useEffect, useRef, useState } from "react";
import Script from "next/script";
import { usePathname } from "next/navigation";
import { META_PIXEL_ID, META_PIXEL_SNIPPET, fireMetaPixelEvent, flushMetaPixelEvents } from "@/lib/meta-pixel";

/**
 * Loads the Meta Pixel base snippet once and fires PageView on initial mount
 * and on every client-side route change (the snippet alone only fires on full
 * page loads). Mounted once in the root layout; renders nothing visible. The
 * <noscript> image covers visitors with JavaScript disabled.
 */
export function MetaPixel() {
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const lastPathname = useRef<string | null>(null);

  useEffect(() => {
    // afterInteractive can execute after this component's first effect. Wait
    // for its queueing stub, then report each pathname once (including under
    // Strict Mode). Query-only state changes are not new page views.
    if (!ready || pathname === null || lastPathname.current === pathname) return;
    lastPathname.current = pathname;
    fireMetaPixelEvent("PageView");
  }, [pathname, ready]);

  return (
    <>
      <Script
        id="meta-pixel"
        strategy="afterInteractive"
        onReady={() => {
          flushMetaPixelEvents();
          setReady(true);
        }}
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

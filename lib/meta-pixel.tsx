"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, Suspense } from "react";
import Script from "next/script";

const PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID;

function MetaPixelPageView() {
  const pathname = usePathname();
  const isFirstRun = useRef(true);

  useEffect(() => {
    if (!PIXEL_ID) return;
    // The inline snippet below already fires PageView for the initial load;
    // this effect also runs on mount, so skip that first run and only report
    // SPA navigations. Without the guard the landing page counts twice.
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }
    if (typeof window !== "undefined" && window.fbq) {
      window.fbq("track", "PageView");
    }
    // Keyed on the pathname only. Meta PageView is page-level — the query
    // string is not part of its semantics — and every query-only change here
    // is an in-page state sync rather than a navigation: SignupWelcomeTracker
    // stripping ?welcome=signup, AlertManagePage stripping the manage token,
    // BrowsePage mirroring the search box into ?q=. Each of those fired a
    // second PageView for the same page.
  }, [pathname]);

  return null;
}

export function MetaPixel() {
  if (!PIXEL_ID) return null;

  return (
    <>
      <Script id="meta-pixel" strategy="afterInteractive">
        {`
          !function(f,b,e,v,n,t,s)
          {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
          n.callMethod.apply(n,arguments):n.queue.push(arguments)};
          if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
          n.queue=[];t=b.createElement(e);t.async=!0;
          t.src=v;s=b.getElementsByTagName(e)[0];
          s.parentNode.insertBefore(t,s)}(window, document,'script',
          'https://connect.facebook.net/en_US/fbevents.js');
          fbq('init', '${PIXEL_ID}');
          fbq('track', 'PageView');
        `}
      </Script>
      <noscript>
        <img
          height="1"
          width="1"
          style={{ display: "none" }}
          src={`https://www.facebook.com/tr?id=${PIXEL_ID}&ev=PageView&noscript=1`}
          alt=""
        />
      </noscript>
      <Suspense>
        <MetaPixelPageView />
      </Suspense>
    </>
  );
}

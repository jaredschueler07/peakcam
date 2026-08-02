import type { NextConfig } from "next";

// ─────────────────────────────────────────────────────────────────────────────
// Content-Security-Policy — REPORT-ONLY for now.
//
// Shipped report-only deliberately: cam embeds are third-party URLs stored in
// the database (`cams.embed_url`, embed_type youtube/iframe/image), so the set
// of hosts the site frames and loads images from is open-ended and cannot be
// enumerated from source. A blocking policy that guesses wrong blanks a cam
// tile — the product's core feature — for every visitor. Report-only lets the
// violations surface first; flip the header name to `Content-Security-Policy`
// only after a reporting period comes back clean.
//
// `frame-src`/`img-src` are intentionally as broad as `https:` for the same
// reason. They still block `http:`, `data:` frames, and plugin content, which
// is the part that matters for an XSS-driven exfiltration path.
// ─────────────────────────────────────────────────────────────────────────────
const CSP_DIRECTIVES = [
  // Everything not covered by a more specific directive falls back to same-origin.
  "default-src 'self'",

  // 'unsafe-inline': Next.js emits inline bootstrap/flight scripts and the two
  //   application/ld+json blocks in app/layout.tsx. Removing it requires a
  //   nonce pipeline in proxy.ts, which is out of scope for this change.
  // 'unsafe-eval': MapLibre GL compiles style expressions at runtime.
  // posthog: posthog-js lazy-loads recorder/surveys bundles from its assets host.
  // vercel-scripts: @vercel/analytics + @vercel/speed-insights loaders.
  // connect.facebook.net: Meta Pixel (NEXT_PUBLIC_META_PIXEL_ID).
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://us.i.posthog.com https://us-assets.i.posthog.com https://va.vercel-scripts.com https://connect.facebook.net",

  // Tailwind/Next inject inline <style> tags; MapLibre sets inline styles on
  // its canvas container.
  "style-src 'self' 'unsafe-inline'",

  // next/font self-hosts the Google fonts at build time, so 'self' suffices;
  // data: covers icon fonts inlined by the CSS pipeline.
  "font-src 'self' data:",

  // Open-ended by necessity: cam tiles render operator-supplied still images
  // (embed_type 'image') plus YouTube thumbnails, and MapLibre pulls raster
  // tiles from MapTiler/Carto/RainViewer/NASA GIBS. blob: is MapLibre's
  // canvas-derived imagery.
  "img-src 'self' data: blob: https:",

  // XHR/fetch/WebSocket targets: Supabase (REST + auth + realtime), PostHog,
  // map tile + weather + radar APIs, and Vercel's analytics collectors.
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://us.i.posthog.com https://us-assets.i.posthog.com https://api.maptiler.com https://*.basemaps.cartocdn.com https://api.rainviewer.com https://api.weather.gov https://api.open-meteo.com https://gibs.earthdata.nasa.gov https://vitals.vercel-insights.com https://va.vercel-scripts.com",

  // Cam embeds (YouTube + arbitrary operator iframes) — see the note above.
  "frame-src https:",

  // MapLibre spawns its tile-decoding workers from a blob: URL.
  "worker-src 'self' blob:",

  // Nothing on the site uses <object>/<embed>; denying them removes a legacy
  // script-execution vector.
  "object-src 'none'",

  // Stops an injected <base> tag from re-pointing every relative URL on the page.
  "base-uri 'self'",

  // Forms may only post to peakcam.io — blocks an injected form that exfiltrates
  // credentials typed into /auth.
  "form-action 'self'",

  // Clickjacking control; the modern equivalent of X-Frame-Options, kept in
  // sync with the SAMEORIGIN header below.
  "frame-ancestors 'self'",
].join("; ");

const securityHeaders = [
  {
    key: "Content-Security-Policy-Report-Only",
    value: CSP_DIRECTIVES,
  },
  {
    // Clickjacking protection for /auth in particular: the sign-in form is
    // otherwise framable under an attacker-controlled overlay. SAMEORIGIN
    // rather than DENY so the app can frame its own pages. This constrains
    // *others* embedding PeakCam; the cam tiles are PeakCam embedding others,
    // which this header does not affect.
    key: "X-Frame-Options",
    value: "SAMEORIGIN",
  },
  {
    // Stops a user-supplied upload or API response from being re-interpreted
    // as script/HTML via MIME sniffing.
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    // Same as the browser default today, pinned so a future default change
    // cannot start leaking `/alerts/manage?token=…` in the Referer header to
    // third-party hosts (cam operators, tile CDNs).
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    // No code path calls getUserMedia or the Geolocation API (grepped: the only
    // hit is a comment in lib/map-utils.ts saying the season default is
    // deliberately not geolocation-based). Denying them site-wide also denies
    // them to every embedded cam iframe.
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  {
    // Vercel serves this site over HTTPS only. HSTS is the compensating control
    // for Supabase's auth cookies, which @supabase/ssr writes from JavaScript
    // and therefore without the Secure attribute — without HSTS a single
    // http:// request on a hostile network hands over a 400-day refresh token.
    // No `preload` directive: that submission is irreversible on a short
    // timescale and should be a deliberate, separate decision.
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  },
];

const nextConfig: NextConfig = {
  images: {
    domains: [],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "peakcam.vercel.app" }],
        destination: "https://peakcam.io/:path*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;

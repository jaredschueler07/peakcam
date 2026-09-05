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

  // XHR/fetch/WebSocket/sendBeacon targets: Supabase (REST + auth + realtime),
  // PostHog, map tile + weather + radar APIs, and Vercel's analytics
  // collectors. www.facebook.com is where the Meta Pixel POSTs its /tr beacons
  // — a different origin from connect.facebook.net, which only serves the
  // script and belongs in script-src.
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://us.i.posthog.com https://us-assets.i.posthog.com https://api.maptiler.com https://*.basemaps.cartocdn.com https://api.rainviewer.com https://api.weather.gov https://api.open-meteo.com https://gibs.earthdata.nasa.gov https://vitals.vercel-insights.com https://va.vercel-scripts.com https://www.facebook.com",

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
    // Camera and microphone are denied outright — nothing in the app calls
    // getUserMedia. Geolocation is `(self)`, NOT `()`: MapView.tsx:471 renders
    // MapLibre's <GeolocateControl> on both map surfaces, and a bare `()`
    // makes that button throw PositionError code 1 ("disabled by permissions
    // policy") in production. `(self)` keeps the "find me" button working
    // while still denying geolocation to every cross-origin cam iframe, which
    // is the part worth having.
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(self)",
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
  // The ranked validator opens the same committed packs as the browser.
  outputFileTracingIncludes: {
    "/api/drop-in/*": ["./public/game/terrain/*.height.u16.br", "./public/game/terrain/*.meta.json", "./public/game/terrain/*.trails.json", "./public/game/terrain/*.network.json"],
  },
  images: {
    domains: [],
  },
  experimental: {
    // Max attempts per page during the static export (default 1). The build
    // prerenders ~148 resort pages against live Supabase behind an 8s fetch
    // abort (lib/supabase.ts), and generateStaticParams deliberately fails
    // closed — so a single transient slow query kills the whole build. Three
    // failures on the same page still fail the build, keeping the fail-closed
    // behavior for real outages.
    staticGenerationRetryCount: 3,
  },
  async headers() {
    return [
      {
        // The Drop In iframe is deliberately not sandboxed. Keep CORS permissive
        // for the public static engine assets during the v2 strangler migration;
        // this header is removed with engine.html once the iframe is retired.
        source: "/drop-in/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          // Belt and braces with engine.html's own meta tag: the game is a
          // playable canvas, not a search result.
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
      {
        // These files are committed precompressed. The browser fetch stack
        // transparently decodes Brotli only when the response declares it;
        // client DecompressionStream support is not portable for Brotli.
        source: "/game/terrain/:slug.height.u16.br",
        headers: [
          { key: "Content-Encoding", value: "br" },
          { key: "Content-Type", value: "application/octet-stream" },
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
      {
        // Same deal for the baked far field (scripts/bake-far-field.ts).
        source: "/game/terrain/:slug.far.bin.br",
        headers: [
          { key: "Content-Encoding", value: "br" },
          { key: "Content-Type", value: "application/octet-stream" },
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
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
        destination: "https://www.peakcam.io/:path*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;

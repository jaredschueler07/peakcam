import type { NextConfig } from "next";

// ─────────────────────────────────────────────────────────────────────────────
// Content-Security-Policy — the full policy is REPORT-ONLY; a small slice that
// cannot break cam embeds (CSP_ENFORCED below) is enforced. Both report to
// /api/csp-report, which samples and forwards to PostHog as `csp_violation`.
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
  // googletagmanager.com / googleadservices.com: Google Ads tag (gtag.js) and
  //   its conversion helper script (NEXT_PUBLIC_GOOGLE_ADS_ID).
  // redditstatic.com: Reddit Pixel (NEXT_PUBLIC_REDDIT_PIXEL_ID).
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://us.i.posthog.com https://us-assets.i.posthog.com https://va.vercel-scripts.com https://connect.facebook.net https://www.googletagmanager.com https://www.googleadservices.com https://www.redditstatic.com",

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
  // script and belongs in script-src. The Google Ads tag beacons to
  // google-analytics.com / googletagmanager.com and pings conversions via
  // google.com, googleadservices.com and googleads.g.doubleclick.net; the
  // Reddit pixel fetches its config from pixel-config.reddit.com and beacons
  // to alb.reddit.com. Conversion <img> pixels are already covered by the
  // https: img-src above.
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://us.i.posthog.com https://us-assets.i.posthog.com https://api.maptiler.com https://*.basemaps.cartocdn.com https://api.rainviewer.com https://api.weather.gov https://api.open-meteo.com https://gibs.earthdata.nasa.gov https://vitals.vercel-insights.com https://va.vercel-scripts.com https://www.facebook.com https://www.google-analytics.com https://*.google-analytics.com https://www.googletagmanager.com https://www.googleadservices.com https://www.google.com https://googleads.g.doubleclick.net https://www.redditstatic.com https://alb.reddit.com https://pixel-config.reddit.com https://www.reddit.com",

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

  // Violation reports: `report-uri` for browsers that still POST
  // application/csp-report, `report-to` (Reporting API, declared by the
  // Reporting-Endpoints header below) for the rest. Same route either way.
  "report-uri /api/csp-report",
  "report-to csp-endpoint",
].join("; ");

// Enforced today. These four directives do not depend on which hosts the cam
// tiles load from, so they are safe to block on now: nothing on the site uses
// <object>/<embed>, no page sets <base>, every form is handled by an onSubmit
// (no cross-origin form posts; Supabase auth uses fetch and redirects), and
// X-Frame-Options already pins framing to SAMEORIGIN. Widen this list as the
// report-only policy's violation stream comes back clean per directive.
const CSP_ENFORCED = [
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
  "report-uri /api/csp-report",
  "report-to csp-endpoint",
].join("; ");

const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: CSP_ENFORCED,
  },
  {
    key: "Content-Security-Policy-Report-Only",
    value: CSP_DIRECTIVES,
  },
  {
    // Names the Reporting API endpoint that both policies' `report-to` use.
    key: "Reporting-Endpoints",
    value: 'csp-endpoint="/api/csp-report"',
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

// The `Link` header value shared by `/` and `/resorts/:slug` below:
// sitemap, the page's markdown alternate, the RFC 9727 API catalog and the
// OpenAPI description. Header values must be Latin-1; this is plain ASCII.
function discoveryLinkHeader(markdownPath: string): string {
  return [
    '</sitemap.xml>; rel="sitemap"',
    `<${markdownPath}>; rel="alternate"; type="text/markdown"`,
    '</.well-known/api-catalog>; rel="api-catalog"',
    '</api/v1/openapi.json>; rel="service-desc"; type="application/vnd.oai.openapi+json"',
  ].join(", ");
}

const nextConfig: NextConfig = {
  // No `x-powered-by: Next.js` on every response; it is framework
  // fingerprinting with no benefit to the site.
  poweredByHeader: false,
  env: {
    // Evaluated once per `next build`, so this is a per-deploy constant. The
    // sitemap uses it as lastModified for the evergreen pages (/about,
    // /methodology, /compare, …): the sitemap is ISR-regenerated hourly, and a
    // runtime `new Date()` there would advertise a lastModified that advances
    // every hour for pages whose content only changes on deploy — which is
    // exactly the always-the-crawl-date pattern crawlers learn to ignore.
    NEXT_PUBLIC_BUILD_TIME: new Date().toISOString(),
  },
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
      // Discovery links for agents and crawlers (execution plan Sprint 4):
      // RFC 8288 `Link` on the two page shapes an assistant lands on. Relative
      // URLs on purpose, so a preview deployment advertises its own alternates
      // rather than production's. `:slug` is substituted into the value by
      // Next's header compiler (path params are allowed in header values).
      // The `.md` routes carry their own `Link` (canonical + author/license),
      // so they are matched by neither entry: `:slug` is a single segment.
      {
        source: "/",
        headers: [{ key: "Link", value: discoveryLinkHeader("/index.md") }],
      },
      {
        source: "/resorts/:slug",
        headers: [{ key: "Link", value: discoveryLinkHeader("/resorts/:slug/index.md") }],
      },
      // The page family's subpages (lib/resort-pages.ts) advertise their own
      // markdown alternates the same way.
      {
        source: "/resorts/:slug/snow-report",
        headers: [{ key: "Link", value: discoveryLinkHeader("/resorts/:slug/snow-report/index.md") }],
      },
      {
        source: "/resorts/:slug/webcams",
        headers: [{ key: "Link", value: discoveryLinkHeader("/resorts/:slug/webcams/index.md") }],
      },
      // P5: the season history subpage advertises its own markdown alternate.
      {
        source: "/resorts/:slug/history",
        headers: [{ key: "Link", value: discoveryLinkHeader("/resorts/:slug/history/index.md") }],
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

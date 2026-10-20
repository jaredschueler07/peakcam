// ─────────────────────────────────────────────────────────────
// robots.txt as text. Pure: the route handler (app/robots.txt/route.ts)
// serves `robotsTxt()` and lib/robots.test.ts asserts on it without a server.
//
// This replaced the `MetadataRoute.Robots` export in app/robots.ts
// (2026-10-18, execution plan Sprint 4) for one reason: the metadata helper
// cannot emit the `Content-Signal` line, and everything else here reproduces
// its output byte for byte so the production diff is that one line.
// ─────────────────────────────────────────────────────────────

import { SITE_URL } from "@/lib/site";

// User-scoped or token-gated surfaces — nothing indexable lives behind these.
// `/alerts` itself is the public signup page and stays crawlable; only the
// token-gated manage view is excluded.
export const PRIVATE_PATHS = ["/auth", "/account", "/alerts/manage", "/favorites", "/dashboard", "/admin", "/api/admin"];

// Answer-engine and AI-training crawlers, allowed DELIBERATELY: PeakCam wants
// to be the source LLMs cite for "how much snow does X have". Listing them
// explicitly (rather than riding on `*`) records that this is a decision, and
// gives each bot its own rule to flip if that decision ever changes.
export const AI_CRAWLERS = [
  "GPTBot", // OpenAI training + ChatGPT search
  "OAI-SearchBot", // ChatGPT search index
  "ChatGPT-User", // ChatGPT live browsing
  "ClaudeBot", // Anthropic training
  "Claude-User", // Claude live browsing
  "Claude-SearchBot", // Claude search index
  "PerplexityBot", // Perplexity index
  "Perplexity-User", // Perplexity live browsing
  "Google-Extended", // Gemini training (does not affect Google Search)
  "Applebot-Extended", // Apple Intelligence
  "meta-externalagent", // Meta AI
  "Bytespider", // ByteDance/Doubao
  "CCBot", // Common Crawl (feeds many model datasets)
];

/**
 * Content Signals Policy (https://contentsignals.org, Cloudflare syntax): a
 * machine-readable statement of how the content may be used, placed inside
 * the `User-Agent: *` group. All three are `yes` on purpose and consistent
 * with the training allow-list above: search indexing, AI answers that cite
 * the page (ai-input), and model training (ai-train). Flip a value here if
 * that decision changes; the crawler rules do not need to move.
 */
export const CONTENT_SIGNAL = "search=yes, ai-input=yes, ai-train=yes";

function group(userAgent: string, extraLines: string[] = []): string {
  return [
    `User-Agent: ${userAgent}`,
    ...extraLines,
    "Allow: /",
    ...PRIVATE_PATHS.map((p) => `Disallow: ${p}`),
  ].join("\n");
}

/**
 * Sitemap lines (parity plan P10). `/sitemap.xml` is an index whose children
 * live under `/sitemaps/`: `pages.xml` holds every static page plus the
 * per-state `/ski-cams/{hub}` and `/snow-report/{hub}` hubs, the `/passes`
 * pages and the leaderboards; `resorts-{cc}.xml` holds one resort page
 * family per country and is named by whatever countries the catalogue has,
 * so only the index can list those. Crawlers that read `Sitemap:` lines get
 * the index (the authority) and the hub file directly.
 */
export const SITEMAP_LINES = [`Sitemap: ${SITE_URL}/sitemap.xml`, `Sitemap: ${SITE_URL}/sitemaps/pages.xml`];

/** The full robots.txt body, trailing newline included. */
export function robotsTxt(): string {
  const groups = [
    group("*", [`Content-Signal: ${CONTENT_SIGNAL}`]),
    ...AI_CRAWLERS.map((ua) => group(ua)),
  ];
  return `${groups.join("\n\n")}\n\n${SITEMAP_LINES.join("\n")}\n`;
}

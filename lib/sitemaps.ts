// ─────────────────────────────────────────────────────────────
// Sitemap index (parity plan P10): /sitemap.xml is an index of child files
// under /sitemaps/ — one for the site's pages and hubs, one per country for
// the resort page family — so Search Console reports each group on its own
// and a resort batch landing in one country does not churn the others.
// Pure: the builders take the catalogue rows and a clock, the renderers
// return XML strings, and the parser exists so tests (and an operator with
// curl) can check what the routes serve. No Next.js, no database.
// ─────────────────────────────────────────────────────────────

import { SITE_URL } from "./site";
import { HUB_BASE_PATH, hubPath, listHubs, type HubResortLike } from "./hubs";
import { LEADERBOARD_KINDS, leaderboardPath } from "./leaderboards";
import { RESORT_SUBPAGES, resortTabPath } from "./resort-pages";
import { snowHubPath } from "./snow-hubs";
import { PASS_BASE_PATH, passPath } from "./passes";
import { SEASON_PASSES } from "./resort-profile";

export const SITEMAP_INDEX_PATH = "/sitemap.xml";
export const SITEMAP_CHILD_BASE = "/sitemaps";

export type ChangeFrequency = "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";

export interface SitemapUrl {
  url: string;
  lastModified: Date;
  changeFrequency?: ChangeFrequency;
  priority?: number;
}

export interface SitemapFile {
  /** File stem: "pages", "resorts-us". Served at /sitemaps/{name}.xml. */
  name: string;
  urls: SitemapUrl[];
  /** The newest lastModified among the urls; the index's <lastmod> for this file. */
  lastModified: Date;
}

/** What the builder needs from each active resort: the sitemap entry row plus its country. */
export interface SitemapResortLike extends HubResortLike {
  country: string;
  /** updated_at of the latest snow report, null when a resort has none. */
  lastReportAt: string | null;
}

export interface SitemapInput {
  resorts: readonly SitemapResortLike[];
  /** updated_at of every resort_openings row (the /opening-dates clock). */
  openingUpdatedAt: readonly string[];
  /** Per-deploy constant (NEXT_PUBLIC_BUILD_TIME): the honest lastModified for pages that only change on deploy. */
  buildTime: Date;
  dropInEnabled: boolean;
  baseUrl?: string;
}

export function childSitemapPath(name: string): string {
  return `${SITEMAP_CHILD_BASE}/${name}.xml`;
}

const FILE_NAME = /^[a-z0-9][a-z0-9-]{0,40}$/;

/** "resorts-us.xml" → "resorts-us"; null when the segment is not a child file name. */
export function childSitemapName(segment: string): string | null {
  if (!segment.endsWith(".xml")) return null;
  const name = segment.slice(0, -4);
  return FILE_NAME.test(name) ? name : null;
}

function newestMs(stamps: Iterable<string | null | undefined>): number {
  let best = 0;
  for (const s of stamps) {
    if (!s) continue;
    const ms = new Date(s).getTime();
    if (ms > best) best = ms;
  }
  return best;
}

function newestDate(urls: readonly SitemapUrl[], fallback: Date): Date {
  let best: Date | null = null;
  for (const u of urls) if (!best || u.lastModified > best) best = u.lastModified;
  return best ?? fallback;
}

/** The resort page family for one country, every resort's five URLs on the resort's own report clock. */
function resortFile(country: string, resorts: readonly SitemapResortLike[], buildTime: Date, baseUrl: string): SitemapFile {
  const urls: SitemapUrl[] = resorts.flatMap((e) => {
    // Real freshness beats a blanket "now": the page's data-bearing content
    // changes when its snow report does, and crawlers downrank sitemaps whose
    // lastModified is always the crawl date. Resorts with no report yet fall
    // back to build time.
    const lastModified = e.lastReportAt ? new Date(e.lastReportAt) : buildTime;
    return [
      { url: `${baseUrl}${resortTabPath(e.slug, "overview")}`, lastModified, changeFrequency: "hourly" as const, priority: 0.8 },
      ...RESORT_SUBPAGES.map((tab) => ({ url: `${baseUrl}${resortTabPath(e.slug, tab.key)}`, lastModified, changeFrequency: "hourly" as const, priority: 0.6 })),
    ];
  });
  return { name: `resorts-${country.toLowerCase()}`, urls, lastModified: newestDate(urls, buildTime) };
}

/**
 * Every child file. Order: pages first, then one resort file per country in
 * alphabetical order of the code, so the index is stable between renders.
 */
export function buildSitemapFiles(input: SitemapInput): SitemapFile[] {
  const baseUrl = input.baseUrl ?? SITE_URL;
  const { buildTime } = input;
  const newestReportMs = newestMs(input.resorts.map((r) => r.lastReportAt));
  // The aggregate pages (/, /snow-report, the boards, the hubs) change exactly
  // when the newest snow report lands, so their lastModified is the max report
  // timestamp — not the moment this function happened to run.
  const dataModified = newestReportMs > 0 ? new Date(newestReportMs) : buildTime;
  // /opening-dates changes when its table does: `npm run seed-openings`
  // upserts resort_openings straight into the DB and the ISR page picks it
  // up within the hour with no deploy, so the newest updated_at is the honest
  // lastModified — build time only until the first seed lands.
  const newestOpeningMs = newestMs(input.openingUpdatedAt);
  const openingsModified = newestOpeningMs > 0 ? new Date(newestOpeningMs) : buildTime;

  // One URL per state/province/country and per region with enough resorts
  // under /ski-cams and under /snow-report — exactly the sets the two [hub]
  // pages' generateStaticParams emit (all three call listHubs on the active
  // resorts). A hub's content changes when any of its resorts' reports does.
  const { states, regions } = listHubs(input.resorts);
  const hubUrls: SitemapUrl[] = [...states, ...regions].flatMap((group) => {
    const ms = newestMs(group.resorts.map((r) => r.lastReportAt));
    const lastModified = ms > 0 ? new Date(ms) : buildTime;
    return [
      { url: `${baseUrl}${hubPath(group.hub)}`, lastModified, changeFrequency: "daily" as const, priority: 0.8 },
      { url: `${baseUrl}${snowHubPath(group.hub)}`, lastModified, changeFrequency: "daily" as const, priority: 0.7 },
    ];
  });

  const pageUrls: SitemapUrl[] = [
    { url: baseUrl, lastModified: dataModified, changeFrequency: "hourly", priority: 1.0 },
    { url: `${baseUrl}/snow-report`, lastModified: dataModified, changeFrequency: "hourly", priority: 0.9 },
    { url: `${baseUrl}/snow-report/percent-of-normal`, lastModified: dataModified, changeFrequency: "hourly", priority: 0.7 },
    ...LEADERBOARD_KINDS.map((kind) => ({ url: `${baseUrl}${leaderboardPath(kind)}`, lastModified: dataModified, changeFrequency: "daily" as const, priority: 0.7 })),
    // The leaderboards landing and the pass index list pages, not data; they
    // change when the catalogue does (a deploy).
    { url: `${baseUrl}/snow-report/leaderboards`, lastModified: buildTime, changeFrequency: "weekly", priority: 0.6 },
    { url: `${baseUrl}${PASS_BASE_PATH}`, lastModified: buildTime, changeFrequency: "weekly", priority: 0.6 },
    // A pass page ranks its resorts by today's report, so it moves with the data.
    ...SEASON_PASSES.map((pass) => ({ url: `${baseUrl}${passPath(pass)}`, lastModified: dataModified, changeFrequency: "daily" as const, priority: 0.7 })),
    { url: `${baseUrl}/map`, lastModified: dataModified, changeFrequency: "hourly", priority: 0.8 },
    { url: `${baseUrl}/compare`, lastModified: buildTime, changeFrequency: "weekly", priority: 0.6 },
    // Powder-alert sign-up landing page: the only dedicated conversion page.
    { url: `${baseUrl}/alerts`, lastModified: buildTime, changeFrequency: "monthly", priority: 0.7 },
    { url: `${baseUrl}/opening-dates`, lastModified: openingsModified, changeFrequency: "weekly", priority: 0.7 },
    // Hub index: its list of hubs only changes when the catalogue does.
    { url: `${baseUrl}${HUB_BASE_PATH}`, lastModified: buildTime, changeFrequency: "weekly", priority: 0.7 },
    // The Drop In hub only: the three playable routes are noindex on purpose.
    ...(input.dropInEnabled ? [{ url: `${baseUrl}/drop-in`, lastModified: buildTime, changeFrequency: "monthly" as const, priority: 0.5 }] : []),
    { url: `${baseUrl}/about`, lastModified: buildTime, changeFrequency: "monthly", priority: 0.4 },
    { url: `${baseUrl}/connect`, lastModified: buildTime, changeFrequency: "monthly", priority: 0.5 },
    { url: `${baseUrl}/methodology`, lastModified: buildTime, changeFrequency: "monthly", priority: 0.5 },
    ...hubUrls,
  ];
  const files: SitemapFile[] = [{ name: "pages", urls: pageUrls, lastModified: newestDate(pageUrls, buildTime) }];

  const byCountry = new Map<string, SitemapResortLike[]>();
  for (const r of input.resorts) {
    const code = (r.country || "xx").trim().toLowerCase();
    if (!byCountry.has(code)) byCountry.set(code, []);
    byCountry.get(code)!.push(r);
  }
  for (const code of [...byCountry.keys()].sort()) {
    files.push(resortFile(code, byCountry.get(code)!.sort((a, b) => a.slug.localeCompare(b.slug)), buildTime, baseUrl));
  }
  return files;
}

// ── XML ──────────────────────────────────────────────────────

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export function renderUrlSet(urls: readonly SitemapUrl[]): string {
  const body = urls
    .map((u) => {
      const parts = [`<loc>${escapeXml(u.url)}</loc>`, `<lastmod>${u.lastModified.toISOString()}</lastmod>`];
      if (u.changeFrequency) parts.push(`<changefreq>${u.changeFrequency}</changefreq>`);
      if (u.priority != null) parts.push(`<priority>${u.priority.toFixed(1)}</priority>`);
      return `<url>${parts.join("")}</url>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

export function renderSitemapIndex(files: readonly SitemapFile[], baseUrl: string = SITE_URL): string {
  const body = files.map((f) => `<sitemap><loc>${escapeXml(`${baseUrl}${childSitemapPath(f.name)}`)}</loc><lastmod>${f.lastModified.toISOString()}</lastmod></sitemap>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</sitemapindex>\n`;
}

export const SITEMAP_HEADERS: Record<string, string> = {
  "Content-Type": "application/xml; charset=utf-8",
  "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
};

// ── Parsing (tests and operators) ────────────────────────────

export interface ParsedSitemap {
  kind: "urlset" | "sitemapindex";
  entries: Array<{ loc: string; lastmod: string | null; changefreq: string | null; priority: string | null }>;
}

/**
 * A strict reader for the two shapes this module emits: the XML
 * declaration, the sitemaps.org namespace, balanced <url> or <sitemap>
 * elements each with exactly one <loc>, and no stray text. Throws on
 * anything else, so a test or a curl check fails loudly rather than
 * counting a broken file as empty.
 */
export function parseSitemapXml(xml: string): ParsedSitemap {
  if (!xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')) throw new Error("sitemap: missing XML declaration");
  const root = xml.match(/<(urlset|sitemapindex) xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">([\s\S]*)<\/\1>\s*$/);
  if (!root) throw new Error("sitemap: no urlset/sitemapindex root with the sitemaps.org namespace");
  const kind = root[1] as ParsedSitemap["kind"];
  const item = kind === "urlset" ? "url" : "sitemap";
  const inner = root[2].trim();
  const entries: ParsedSitemap["entries"] = [];
  const re = new RegExp(`<${item}>([\\s\\S]*?)</${item}>`, "g");
  let consumed = 0;
  for (const m of inner.matchAll(re)) {
    const between = inner.slice(consumed, m.index).trim();
    if (between) throw new Error(`sitemap: stray content outside <${item}>: ${between.slice(0, 40)}`);
    consumed = m.index! + m[0].length;
    const body = m[1];
    const locs = [...body.matchAll(/<loc>([^<]*)<\/loc>/g)];
    if (locs.length !== 1) throw new Error(`sitemap: an <${item}> must have exactly one <loc>`);
    const field = (name: string): string | null => body.match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1] ?? null;
    const lastmod = field("lastmod");
    if (lastmod && Number.isNaN(new Date(lastmod).getTime())) throw new Error(`sitemap: bad lastmod ${lastmod}`);
    entries.push({ loc: locs[0][1].replace(/&amp;/g, "&"), lastmod, changefreq: field("changefreq"), priority: field("priority") });
  }
  if (inner.slice(consumed).trim()) throw new Error("sitemap: trailing content after the last entry");
  return { kind, entries };
}

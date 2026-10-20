#!/usr/bin/env tsx

/**
 * indexnow-ping.ts
 * ────────────────
 * Tell IndexNow-participating search engines (Bing, Yandex, Seznam, Naver,
 * and the answer engines that read Bing's index) which resort pages just
 * changed, so a fresh snow report is re-crawled in minutes instead of on the
 * next scheduled visit. One POST per batch of up to 10,000 URLs to the shared
 * endpoint, which fans out to every participating engine.
 *
 * Protocol: https://www.indexnow.org/documentation. Ownership is proved by a
 * key file at https://www.peakcam.io/<key>.txt (public/<key>.txt, committed,
 * contents = the key). The key is not a secret: anyone can read the file, and
 * a submission only tells engines to look at a URL on this host.
 *
 * Called from scripts/snotel-sync.ts when INDEXNOW_ENABLED=1 with the
 * resorts whose report changed in that run (slug and state). Standalone,
 * with the state after a colon so the hub pages can be derived:
 *   npx tsx scripts/indexnow-ping.ts breckenridge:CO vail:CO
 *
 * What a changed report touches (parity plan P10): the resort's page family
 * (overview, snow report, forecast, webcams, history), its state hubs
 * (/ski-cams/{hub}, /snow-report/{hub}) and the aggregate pages whose
 * ranking moves with any report (home, /snow-report, percent-of-normal, the
 * four leaderboards). Markdown alternates are noindex and are not submitted.
 *
 * The payload builder and batching are pure and unit-tested
 * (scripts/indexnow-ping.test.ts); the network call is injectable and never
 * made in tests. Nothing here reads .env.local.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { SITE_URL } from "../lib/site.js";
import { stateHub, hubPath } from "../lib/hubs.js";
import { snowHubPath } from "../lib/snow-hubs.js";
import { RESORT_TABS, resortTabPath } from "../lib/resort-pages.js";
import { LEADERBOARD_KINDS, leaderboardPath } from "../lib/leaderboards.js";

/** Must match the file name under public/. Rotate both together. */
export const INDEXNOW_KEY = "551d48c377508655d288dd5b94130e22";
export const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
/** Protocol limit per POST. */
export const INDEXNOW_MAX_URLS = 10_000;

export interface IndexNowPayload {
  host: string;
  key: string;
  keyLocation: string;
  urlList: string[];
}

export interface IndexNowResult {
  batches: number;
  urls: number;
  /** HTTP status per batch, in order; 200 and 202 are success. */
  statuses: number[];
  ok: boolean;
}

export function indexNowHost(baseUrl: string = SITE_URL): string {
  return new URL(baseUrl).host;
}

export function indexNowKeyLocation(baseUrl: string = SITE_URL, key: string = INDEXNOW_KEY): string {
  return `${baseUrl}/${key}.txt`;
}

/** Canonical page URL for a resort slug; the sitemap and canonicals use the same form. */
export function resortPageUrl(slug: string, baseUrl: string = SITE_URL): string {
  return `${baseUrl}/resorts/${slug}`;
}

const SLUG = /^[a-z0-9][a-z0-9-]{0,99}$/;

/** A resort whose report changed: the slug, and the `resorts.state` value when the caller has it. */
export interface ChangedResort {
  slug: string;
  state?: string | null;
}

/** "breckenridge:CO" → { slug, state }; "vail" → { slug }. The CLI form. */
export function parseChangedResort(token: string): ChangedResort {
  const [slug, state] = token.split(":");
  return state ? { slug, state } : { slug };
}

/**
 * Slugs → overview page URLs, de-duplicated, in first-seen order, and
 * anything that is not a lowercase kebab-case slug dropped (a malformed slug
 * would otherwise submit a URL that 404s).
 */
export function resortUrlsForSlugs(slugs: Iterable<string>, baseUrl: string = SITE_URL): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const slug of slugs) {
    if (!SLUG.test(slug) || seen.has(slug)) continue;
    seen.add(slug);
    urls.push(resortPageUrl(slug, baseUrl));
  }
  return urls;
}

/** The aggregate pages whose content moves with any report, in a fixed order. */
export function aggregatePageUrls(baseUrl: string = SITE_URL): string[] {
  return [
    `${baseUrl}/`,
    `${baseUrl}/snow-report`,
    `${baseUrl}/snow-report/percent-of-normal`,
    ...LEADERBOARD_KINDS.map((kind) => `${baseUrl}${leaderboardPath(kind)}`),
  ];
}

/**
 * Every indexable page a changed report touches: the resort's page family
 * (every tab in lib/resort-pages.ts), its state's two hubs, and the
 * aggregate pages — de-duplicated, resorts in first-seen order, hubs and
 * aggregates after them. Resorts with a malformed slug are dropped;
 * a resort without a state contributes no hub. Empty input → no URLs, so a
 * run that changed nothing pings nothing.
 */
export function changedPageUrls(changes: Iterable<ChangedResort>, baseUrl: string = SITE_URL): string[] {
  const seen = new Set<string>();
  const resortUrls: string[] = [];
  const hubUrls: string[] = [];
  const push = (list: string[], url: string) => {
    if (seen.has(url)) return;
    seen.add(url);
    list.push(url);
  };
  for (const change of changes) {
    if (!SLUG.test(change.slug)) continue;
    for (const tab of RESORT_TABS) push(resortUrls, `${baseUrl}${resortTabPath(change.slug, tab.key)}`);
    const state = (change.state ?? "").trim();
    if (state) {
      const hub = stateHub(state);
      push(hubUrls, `${baseUrl}${hubPath(hub)}`);
      push(hubUrls, `${baseUrl}${snowHubPath(hub)}`);
    }
  }
  if (resortUrls.length === 0) return [];
  const aggregates: string[] = [];
  for (const url of aggregatePageUrls(baseUrl)) push(aggregates, url);
  return [...resortUrls, ...hubUrls, ...aggregates];
}

/** Split a URL list into protocol-sized batches, preserving order. Empty input → no batches. */
export function batchUrls(urls: readonly string[], size: number = INDEXNOW_MAX_URLS): string[][] {
  if (size < 1) throw new Error("batch size must be at least 1");
  const batches: string[][] = [];
  for (let i = 0; i < urls.length; i += size) batches.push(urls.slice(i, i + size));
  return batches;
}

export function buildIndexNowPayload(
  urlList: readonly string[],
  options: { baseUrl?: string; key?: string } = {},
): IndexNowPayload {
  const baseUrl = options.baseUrl ?? SITE_URL;
  const key = options.key ?? INDEXNOW_KEY;
  const host = indexNowHost(baseUrl);
  for (const url of urlList) {
    if (new URL(url).host !== host) throw new Error(`IndexNow: ${url} is not on ${host}; one submission covers one host`);
  }
  return { host, key, keyLocation: indexNowKeyLocation(baseUrl, key), urlList: [...urlList] };
}

export type FetchLike = (input: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ status: number; text(): Promise<string> }>;

export interface PingOptions {
  baseUrl?: string;
  key?: string;
  endpoint?: string;
  /** Injected in tests; defaults to global fetch. */
  fetch?: FetchLike;
  log?: (line: string) => void;
}

/**
 * POST every batch. A non-2xx batch is logged and counted in `ok: false` but
 * does not throw: the sync has already written its reports, and a failed ping
 * only delays a re-crawl. IndexNow answers 200 (ok), 202 (accepted, key not
 * yet verified), 400 (bad request), 403 (key mismatch), 422 (URLs off host),
 * 429 (too many requests).
 */
export async function pingIndexNow(changes: Iterable<string | ChangedResort>, options: PingOptions = {}): Promise<IndexNowResult> {
  const urls = changedPageUrls(
    Array.from(changes, (c) => (typeof c === "string" ? { slug: c } : c)),
    options.baseUrl,
  );
  const batches = batchUrls(urls);
  const doFetch = options.fetch ?? (globalThis.fetch as unknown as FetchLike);
  const log = options.log ?? ((line) => console.log(line));
  const statuses: number[] = [];
  for (const batch of batches) {
    const payload = buildIndexNowPayload(batch, { baseUrl: options.baseUrl, key: options.key });
    const res = await doFetch(options.endpoint ?? INDEXNOW_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(payload),
    });
    statuses.push(res.status);
    if (res.status === 200 || res.status === 202) {
      log(`[indexnow] ${batch.length} URL${batch.length === 1 ? "" : "s"} submitted (HTTP ${res.status})`);
    } else {
      const text = (await res.text().catch(() => "")).slice(0, 200);
      log(`[indexnow] batch of ${batch.length} rejected: HTTP ${res.status} ${text}`);
    }
  }
  if (batches.length === 0) log("[indexnow] nothing to submit");
  return { batches: batches.length, urls: urls.length, statuses, ok: statuses.every((s) => s === 200 || s === 202) };
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const tokens = process.argv.slice(2);
  if (tokens.length === 0) {
    console.error("usage: npx tsx scripts/indexnow-ping.ts <slug[:STATE]> [slug[:STATE] ...]   e.g. breckenridge:CO vail:CO");
    process.exit(2);
  }
  pingIndexNow(tokens.map(parseChangedResort)).then((result) => process.exit(result.ok ? 0 : 1));
}

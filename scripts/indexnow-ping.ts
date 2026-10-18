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
 * Called from scripts/snotel-sync.ts when INDEXNOW_ENABLED=1 with the slugs
 * whose report changed in that run. Standalone:
 *   npx tsx scripts/indexnow-ping.ts breckenridge vail
 *
 * The payload builder and batching are pure and unit-tested
 * (scripts/indexnow-ping.test.ts); the network call is injectable and never
 * made in tests. Nothing here reads .env.local.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { SITE_URL } from "../lib/site.js";

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

/**
 * Slugs → page URLs, de-duplicated, in first-seen order, and anything that is
 * not a lowercase kebab-case slug dropped (a malformed slug would otherwise
 * submit a URL that 404s). Resort pages only: the home page and hubs are
 * ISR'd from the same data and re-crawled on their own schedule.
 */
export function resortUrlsForSlugs(slugs: Iterable<string>, baseUrl: string = SITE_URL): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const slug of slugs) {
    if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(slug) || seen.has(slug)) continue;
    seen.add(slug);
    urls.push(resortPageUrl(slug, baseUrl));
  }
  return urls;
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
export async function pingIndexNow(slugs: Iterable<string>, options: PingOptions = {}): Promise<IndexNowResult> {
  const urls = resortUrlsForSlugs(slugs, options.baseUrl);
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
  const slugs = process.argv.slice(2);
  if (slugs.length === 0) {
    console.error("usage: npx tsx scripts/indexnow-ping.ts <slug> [slug ...]");
    process.exit(2);
  }
  pingIndexNow(slugs).then((result) => process.exit(result.ok ? 0 : 1));
}

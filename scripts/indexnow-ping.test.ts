import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  INDEXNOW_ENDPOINT,
  INDEXNOW_KEY,
  INDEXNOW_MAX_URLS,
  batchUrls,
  buildIndexNowPayload,
  indexNowKeyLocation,
  pingIndexNow,
  resortUrlsForSlugs,
  type FetchLike,
} from "./indexnow-ping";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("the key file under public/ exists, is named after the key, and contains exactly the key", () => {
  assert.match(INDEXNOW_KEY, /^[0-9a-f]{32}$/);
  const file = path.join(ROOT, "public", `${INDEXNOW_KEY}.txt`);
  assert.ok(fs.existsSync(file), `${file} missing`);
  assert.equal(fs.readFileSync(file, "utf8"), INDEXNOW_KEY);
  assert.equal(indexNowKeyLocation(), `https://www.peakcam.io/${INDEXNOW_KEY}.txt`);
});

test("resortUrlsForSlugs builds canonical page URLs, de-duplicates and drops malformed slugs", () => {
  assert.deepEqual(resortUrlsForSlugs(["breckenridge", "vail", "breckenridge", "Bad Slug", "", "../etc"]), [
    "https://www.peakcam.io/resorts/breckenridge",
    "https://www.peakcam.io/resorts/vail",
  ]);
  assert.deepEqual(resortUrlsForSlugs(["alta"], "https://preview.example"), ["https://preview.example/resorts/alta"]);
});

test("buildIndexNowPayload has the four protocol fields and refuses off-host URLs", () => {
  const payload = buildIndexNowPayload(["https://www.peakcam.io/resorts/alta"]);
  assert.deepEqual(payload, {
    host: "www.peakcam.io",
    key: INDEXNOW_KEY,
    keyLocation: `https://www.peakcam.io/${INDEXNOW_KEY}.txt`,
    urlList: ["https://www.peakcam.io/resorts/alta"],
  });
  assert.throws(() => buildIndexNowPayload(["https://peakcam.io/resorts/alta"]), /one submission covers one host/);
});

test("batchUrls splits at the protocol limit and preserves order", () => {
  const urls = Array.from({ length: INDEXNOW_MAX_URLS * 2 + 3 }, (_, i) => `https://www.peakcam.io/resorts/r${i}`);
  const batches = batchUrls(urls);
  assert.deepEqual(batches.map((b) => b.length), [INDEXNOW_MAX_URLS, INDEXNOW_MAX_URLS, 3]);
  assert.equal(batches[0][0], urls[0]);
  assert.equal(batches[2][2], urls[urls.length - 1]);
  assert.deepEqual(batchUrls([]), []);
  assert.deepEqual(batchUrls(["a", "b", "c"], 2), [["a", "b"], ["c"]]);
});

function fakeFetch(statuses: number[]) {
  const calls: Array<{ url: string; body: unknown; headers: Record<string, string> }> = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), headers: init.headers });
    const status = statuses[calls.length - 1] ?? 200;
    return { status, text: async () => (status >= 400 ? "nope" : "") };
  };
  return { fetch, calls };
}

test("pingIndexNow posts one JSON batch per 10,000 URLs to the shared endpoint", async () => {
  const slugs = Array.from({ length: 10_001 }, (_, i) => `resort-${i}`);
  const { fetch, calls } = fakeFetch([200, 202]);
  const logs: string[] = [];
  const result = await pingIndexNow(slugs, { fetch, log: (l) => logs.push(l) });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, INDEXNOW_ENDPOINT);
  assert.equal(calls[0].headers["Content-Type"], "application/json; charset=utf-8");
  const first = calls[0].body as { host: string; key: string; keyLocation: string; urlList: string[] };
  assert.equal(first.host, "www.peakcam.io");
  assert.equal(first.key, INDEXNOW_KEY);
  assert.equal(first.urlList.length, 10_000);
  assert.equal((calls[1].body as { urlList: string[] }).urlList.length, 1);
  assert.deepEqual(result, { batches: 2, urls: 10_001, statuses: [200, 202], ok: true });
  assert.match(logs[0], /10000 URLs submitted \(HTTP 200\)/);
});

test("pingIndexNow with no slugs makes no request", async () => {
  const { fetch, calls } = fakeFetch([]);
  const logs: string[] = [];
  const result = await pingIndexNow([], { fetch, log: (l) => logs.push(l) });
  assert.equal(calls.length, 0);
  assert.deepEqual(result, { batches: 0, urls: 0, statuses: [], ok: true });
  assert.deepEqual(logs, ["[indexnow] nothing to submit"]);
});

test("a rejected batch is reported, not thrown", async () => {
  const { fetch } = fakeFetch([403]);
  const logs: string[] = [];
  const result = await pingIndexNow(["alta"], { fetch, log: (l) => logs.push(l) });
  assert.equal(result.ok, false);
  assert.deepEqual(result.statuses, [403]);
  assert.match(logs[0], /rejected: HTTP 403 nope/);
});

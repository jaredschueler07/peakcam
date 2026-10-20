import { test } from "node:test";
import assert from "node:assert/strict";
import { RESORT_SUBPAGES } from "./resort-pages";
import { SEASON_PASSES } from "./resort-profile";
import { buildSitemapFiles, childSitemapName, childSitemapPath, parseSitemapXml, renderSitemapIndex, renderUrlSet, type SitemapResortLike } from "./sitemaps";

// The sitemap index and its child files, built from hand-made catalogue
// rows and checked by parsing the rendered XML back — no Supabase, no Next.

const BUILD = new Date("2026-10-01T00:00:00.000Z");
const NEWEST = "2026-12-20T13:00:00.000Z";

const RESORTS: SitemapResortLike[] = [
  { slug: "vail", name: "Vail", state: "CO", region: "Colorado Rockies", country: "US", lastReportAt: "2026-12-19T13:00:00.000Z" },
  { slug: "alta", name: "Alta", state: "UT", region: "Little Cottonwood Canyon", country: "US", lastReportAt: NEWEST },
  { slug: "whistler", name: "Whistler Blackcomb", state: "BC", region: "Coast Mountains", country: "CA", lastReportAt: null },
  { slug: "portillo", name: "Ski Portillo", state: "Chile", region: "Central Andes", country: "CL", lastReportAt: "2026-08-01T13:00:00.000Z" },
];

const input = { resorts: RESORTS, openingUpdatedAt: ["2026-11-02T10:00:00.000Z"], buildTime: BUILD, dropInEnabled: true };

test("one pages file plus one resort file per country, in a stable order", () => {
  const files = buildSitemapFiles(input);
  assert.deepEqual(files.map((f) => f.name), ["pages", "resorts-ca", "resorts-cl", "resorts-us"]);
  const us = files.find((f) => f.name === "resorts-us")!;
  // Five URLs per resort: the overview and the four subpages from the registry.
  assert.equal(us.urls.length, 2 * (1 + RESORT_SUBPAGES.length));
  assert.ok(us.urls.some((u) => u.url === "https://www.peakcam.io/resorts/alta/snow-forecast"));
  // Each resort's URLs carry its own report clock; the file carries the newest.
  assert.equal(us.urls.find((u) => u.url.endsWith("/resorts/alta"))!.lastModified.toISOString(), NEWEST);
  assert.equal(us.lastModified.toISOString(), NEWEST);
  // No report yet → build time, never the render time.
  const ca = files.find((f) => f.name === "resorts-ca")!;
  assert.equal(ca.urls[0].lastModified.toISOString(), BUILD.toISOString());
});

test("the pages file carries the hubs, boards, passes and honest clocks", () => {
  const pages = buildSitemapFiles(input).find((f) => f.name === "pages")!;
  const urls = new Map(pages.urls.map((u) => [u.url, u]));
  assert.equal(urls.get("https://www.peakcam.io")!.lastModified.toISOString(), NEWEST);
  assert.equal(urls.get("https://www.peakcam.io/opening-dates")!.lastModified.toISOString(), "2026-11-02T10:00:00.000Z");
  assert.equal(urls.get("https://www.peakcam.io/about")!.lastModified.toISOString(), BUILD.toISOString());
  for (const pass of SEASON_PASSES) assert.ok(urls.has(`https://www.peakcam.io/passes/${pass}`), pass);
  assert.ok(urls.has("https://www.peakcam.io/passes"));
  assert.ok(urls.has("https://www.peakcam.io/snow-report/leaderboards"));
  assert.ok(urls.has("https://www.peakcam.io/snow-report/deepest-base"));
  // Both hub families, on the hub's newest report.
  assert.ok(urls.has("https://www.peakcam.io/ski-cams/colorado"));
  assert.equal(urls.get("https://www.peakcam.io/snow-report/utah")!.lastModified.toISOString(), NEWEST);
  assert.equal(urls.get("https://www.peakcam.io/snow-report/british-columbia")!.lastModified.toISOString(), BUILD.toISOString());
  assert.ok(urls.has("https://www.peakcam.io/drop-in"));
  assert.ok(!buildSitemapFiles({ ...input, dropInEnabled: false }).find((f) => f.name === "pages")!.urls.some((u) => u.url.endsWith("/drop-in")));
  // No duplicates.
  assert.equal(urls.size, pages.urls.length);
});

test("the index and every child render as XML the parser accepts", () => {
  const files = buildSitemapFiles(input);
  const index = parseSitemapXml(renderSitemapIndex(files));
  assert.equal(index.kind, "sitemapindex");
  assert.deepEqual(index.entries.map((e) => e.loc), files.map((f) => `https://www.peakcam.io${childSitemapPath(f.name)}`));
  assert.equal(index.entries[0].lastmod, files[0].lastModified.toISOString());
  for (const file of files) {
    const parsed = parseSitemapXml(renderUrlSet(file.urls));
    assert.equal(parsed.kind, "urlset");
    assert.equal(parsed.entries.length, file.urls.length, file.name);
    assert.deepEqual(parsed.entries.map((e) => e.loc), file.urls.map((u) => u.url));
    for (const e of parsed.entries) assert.ok(e.lastmod && !Number.isNaN(new Date(e.lastmod).getTime()));
  }
});

test("the parser rejects malformed files instead of returning an empty list", () => {
  assert.throws(() => parseSitemapXml("<urlset></urlset>"), /XML declaration/);
  assert.throws(() => parseSitemapXml('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n<url><loc>a</loc><loc>b</loc></url>\n</urlset>\n'), /exactly one <loc>/);
  assert.throws(() => parseSitemapXml('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n<url><loc>a</loc></url>oops\n</urlset>\n'), /trailing/);
  const escaped = renderUrlSet([{ url: "https://www.peakcam.io/a?b=1&c=2", lastModified: BUILD }]);
  assert.match(escaped, /&amp;c=2/);
  assert.equal(parseSitemapXml(escaped).entries[0].loc, "https://www.peakcam.io/a?b=1&c=2");
});

test("child file names come only from {name}.xml segments", () => {
  assert.equal(childSitemapName("resorts-us.xml"), "resorts-us");
  assert.equal(childSitemapName("pages.xml"), "pages");
  assert.equal(childSitemapName("pages"), null);
  assert.equal(childSitemapName("../x.xml"), null);
  assert.equal(childSitemapName("Pages.xml"), null);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { AI_CRAWLERS, CONTENT_SIGNAL, PRIVATE_PATHS, SITEMAP_LINES, robotsTxt } from "./robots";

// The robots rules as the `MetadataRoute.Robots` export emitted them before
// 2026-10-18: one group per user agent, `Allow: /` then one Disallow per
// private path, groups separated by a blank line, Sitemap last. The route
// must stay byte-identical to that output apart from the Content-Signal
// line (the production diff in PR "agent discovery surface" shows one line).
function legacyGroup(userAgent: string): string {
  return [`User-Agent: ${userAgent}`, "Allow: /", ...PRIVATE_PATHS.map((p) => `Disallow: ${p}`)].join("\n");
}

const legacyBody = `${["*", ...AI_CRAWLERS].map(legacyGroup).join("\n\n")}\n\nSitemap: https://www.peakcam.io/sitemap.xml\n`;

test("robots.txt differs from the legacy output by exactly the Content-Signal line and the hub sitemap line", () => {
  const body = robotsTxt();
  const added = body.split("\n").filter((line) => !legacyBody.split("\n").includes(line));
  assert.deepEqual(added, [`Content-Signal: ${CONTENT_SIGNAL}`, "Sitemap: https://www.peakcam.io/sitemaps/pages.xml"]);
  assert.equal(
    body.replace(`Content-Signal: ${CONTENT_SIGNAL}\n`, "").replace("\nSitemap: https://www.peakcam.io/sitemaps/pages.xml", ""),
    legacyBody,
  );
});

test("the Content-Signal line sits inside the User-Agent: * group, directly under its User-Agent line", () => {
  const lines = robotsTxt().split("\n");
  assert.equal(lines[0], "User-Agent: *");
  assert.equal(lines[1], "Content-Signal: search=yes, ai-input=yes, ai-train=yes");
  assert.equal(lines[2], "Allow: /");
  assert.equal(lines.filter((l) => l.startsWith("Content-Signal:")).length, 1);
});

test("every AI crawler keeps its own explicit group with the same private paths", () => {
  const body = robotsTxt();
  assert.equal(AI_CRAWLERS.length, 13);
  for (const ua of AI_CRAWLERS) {
    assert.ok(body.includes(`\n\nUser-Agent: ${ua}\nAllow: /\n`), `missing group for ${ua}`);
  }
  assert.equal((body.match(/^User-Agent: /gm) ?? []).length, AI_CRAWLERS.length + 1);
  assert.equal((body.match(/^Disallow: /gm) ?? []).length, PRIVATE_PATHS.length * (AI_CRAWLERS.length + 1));
  assert.ok(body.includes("Disallow: /alerts/manage"));
  assert.ok(!body.includes("Disallow: /alerts\n"), "/alerts (public signup) must stay crawlable");
});

test("the sitemap lines are last: the index first, then the hub file, both on the www host", () => {
  assert.deepEqual(SITEMAP_LINES, ["Sitemap: https://www.peakcam.io/sitemap.xml", "Sitemap: https://www.peakcam.io/sitemaps/pages.xml"]);
  assert.ok(robotsTxt().endsWith("\n\nSitemap: https://www.peakcam.io/sitemap.xml\nSitemap: https://www.peakcam.io/sitemaps/pages.xml\n"));
  // No child file other than pages.xml is hard-coded: resorts-{cc}.xml names follow the catalogue and the index lists them.
  assert.equal(SITEMAP_LINES.filter((l) => l.includes("/sitemaps/")).length, 1);
});

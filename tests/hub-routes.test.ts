import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { SEASON_PASSES } from "@/lib/resort-profile";
import { PASS_BASE_PATH, passMarkdownPath, passPath } from "@/lib/passes";
import { RESERVED_SNOW_REPORT_SEGMENTS, snowHubMarkdownPath, snowHubPath } from "@/lib/snow-hubs";
import { LEADERBOARD_KINDS, leaderboardPath } from "@/lib/leaderboards";

// The P10 hub routes (passes, per-state snow-report hubs, the leaderboards
// landing) and every footer link must resolve to a page or route handler
// under app/ — pure filesystem, no server, same walker as the other route
// tests.

const ROOT = resolve(__dirname, "..");
const APP = join(ROOT, "app");

function matchChildren(dir: string, segment: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((entry) => statSync(join(dir, entry)).isDirectory())
    .filter((entry) => entry === segment || /^\[[^\]]+\]$/.test(entry))
    .map((entry) => join(dir, entry));
}

function routeFile(path: string, file: "page.tsx" | "route.ts"): boolean {
  const segments = path.split("/").filter(Boolean);
  let dirs = [APP];
  for (const segment of segments) dirs = dirs.flatMap((dir) => matchChildren(dir, segment));
  return dirs.some((dir) => existsSync(join(dir, file)));
}

test("every pass has a page and a markdown alternate, and the index exists", () => {
  assert.ok(routeFile(PASS_BASE_PATH, "page.tsx"));
  for (const pass of SEASON_PASSES) {
    assert.ok(routeFile(passPath(pass), "page.tsx"), `${passPath(pass)} needs a page`);
    assert.ok(routeFile(passMarkdownPath(pass), "route.ts"), `${passMarkdownPath(pass)} needs a route`);
  }
});

test("state snow-report hubs have a page and a markdown alternate beside the static boards", () => {
  const hub = { slug: "colorado" };
  assert.ok(routeFile(snowHubPath(hub), "page.tsx"));
  assert.ok(routeFile(snowHubMarkdownPath(hub), "route.ts"));
  assert.ok(routeFile("/snow-report/leaderboards", "page.tsx"));
  // Every reserved segment really is a static page, so the dynamic [hub]
  // segment can never be asked to render one of them.
  for (const segment of RESERVED_SNOW_REPORT_SEGMENTS) {
    const dir = join(APP, "snow-report", segment);
    assert.ok(existsSync(join(dir, "page.tsx")), `/snow-report/${segment} must be a static page`);
  }
  assert.deepEqual(LEADERBOARD_KINDS.map(leaderboardPath).every((p) => routeFile(p, "page.tsx")), true);
});

test("every internal footer link resolves to a route", () => {
  const source = readFileSync(join(ROOT, "components/home/PeakFooter.tsx"), "utf-8");
  const hrefs = [...source.matchAll(/href:\s*"(\/[^"]*)"/g)].map((m) => m[1].split("#")[0]);
  assert.ok(hrefs.includes("/passes"));
  assert.ok(hrefs.includes("/snow-report/leaderboards"));
  const missing = hrefs.filter((href) => !(routeFile(href, "page.tsx") || routeFile(href, "route.ts") || existsSync(join(ROOT, "public", href))));
  assert.deepEqual(missing, []);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { RESORT_SUBPAGES, RESORT_TABS, breadcrumbListLd, resortBreadcrumb, resortTabMarkdownPath, resortTabPath, snowReportTitle, webcamsTitle } from "@/lib/resort-pages";

// Every tab in the resort page family must resolve to a page under app/ and
// carry a markdown alternate route — pure filesystem, no server.

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

test("every resort tab has a page and a markdown alternate route", () => {
  for (const tab of RESORT_TABS) {
    const path = resortTabPath("alta", tab.key);
    assert.ok(routeFile(path, "page.tsx"), `${path} needs a page.tsx`);
    assert.ok(routeFile(resortTabMarkdownPath("alta", tab.key), "route.ts"), `${path}/index.md needs a route.ts`);
  }
  assert.deepEqual(RESORT_SUBPAGES.map((t) => t.key), ["snow-report", "webcams", "history"]);
});

test("paths and titles are templated from the registry", () => {
  assert.equal(resortTabPath("alta", "overview"), "/resorts/alta");
  assert.equal(resortTabPath("alta", "snow-report"), "/resorts/alta/snow-report");
  assert.equal(resortTabMarkdownPath("alta", "webcams"), "/resorts/alta/webcams/index.md");
  assert.equal(snowReportTitle("Alta Ski Area"), "Alta Ski Area Snow Report — Measured Conditions | PeakCam");
  assert.equal(webcamsTitle("Alta Ski Area", 4), "Alta Ski Area Webcams — 4 Live Cams | PeakCam");
  assert.equal(webcamsTitle("Alta Ski Area", 1), "Alta Ski Area Webcams — 1 Live Cam | PeakCam");
});

test("breadcrumbs: Home › state hub › resort › tab, and the JSON-LD mirrors the trail", () => {
  const trail = resortBreadcrumb({ name: "Alta Ski Area", slug: "alta", state: "UT" }, "snow-report");
  assert.deepEqual(trail, [
    { label: "Home", href: "/" },
    { label: "Utah", href: "/ski-cams/utah" },
    { label: "Alta Ski Area", href: "/resorts/alta" },
    { label: "Snow report", href: "/resorts/alta/snow-report" },
  ]);
  const ld = breadcrumbListLd(trail) as { itemListElement: Array<{ position: number; name: string; item: string }> };
  assert.equal(ld.itemListElement.length, 4);
  assert.deepEqual(ld.itemListElement[0], { "@type": "ListItem", position: 1, name: "Home", item: "https://www.peakcam.io" });
  assert.deepEqual(ld.itemListElement[3], { "@type": "ListItem", position: 4, name: "Snow report", item: "https://www.peakcam.io/resorts/alta/snow-report" });
  // No state → the hub index; overview has three crumbs.
  assert.equal(resortBreadcrumb({ name: "X", slug: "x", state: "" }).length, 3);
  assert.equal(resortBreadcrumb({ name: "X", slug: "x", state: "" })[1].href, "/ski-cams");
});

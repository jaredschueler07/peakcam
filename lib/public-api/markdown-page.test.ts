import { test } from "node:test";
import assert from "node:assert/strict";
import type { CamPublic, ResortListPublic, ResortPublic } from "./schema";
import { PUBLIC_API_ATTRIBUTION, PUBLIC_API_LICENSE_URL } from "./headers";
import {
  formatMountainTime,
  indexMarkdown,
  markdownPageHeaders,
  resortMarkdown,
  resortSummarySentence,
  sourceLabel,
  topMeasured24h,
} from "./markdown-page";

// ── Fixtures (wire shapes, built by hand) ────────────────────

const STATION = { id: "531:CO:SNTL", name: "Hoosier Pass", elevationFt: 11400 };
const AT = "2026-12-20T12:00:00.000Z"; // 05:00 MST

function m(value: number | null, unit: "in" | "percent" = "in", source: "snotel" | "open_meteo" | null = "snotel") {
  return { value, unit, source, measuredAt: AT, ...(source === "snotel" ? { station: STATION } : {}) };
}

function cam(over: Partial<CamPublic> = {}): CamPublic {
  return {
    id: "cam-1",
    name: "Summit",
    elevation: "11,000 ft",
    live: true,
    lastCheckedAt: "2026-12-20T11:00:00.000Z",
    stillUrl: "https://cams.example.com/summit.jpg",
    capturedAt: null,
    embedType: "image",
    pageUrl: "https://www.peakcam.io/resorts/breckenridge",
    sourceUrl: "https://cams.example.com/summit.jpg",
    ...over,
  };
}

function resort(over: Partial<ResortPublic> = {}): ResortPublic {
  return {
    slug: "breckenridge",
    name: "Breckenridge",
    canonicalUrl: "https://www.peakcam.io/resorts/breckenridge",
    apiUrl: "https://www.peakcam.io/api/v1/resorts/breckenridge",
    location: { state: "CO", region: "Summit County", country: "US", lat: 39.48, lon: -106.07, baseElevationFt: 9600 },
    snow: {
      baseDepth: m(42),
      newSnow24h: m(6),
      newSnow48h: m(11),
      swe: m(9.5),
      pctOfNormal: m(118, "percent"),
      trend7d: { value: "rising", source: "snotel", measuredAt: AT, station: STATION },
      outlook: "more_snow",
      rating: "great",
      tags: ["powder", "fresh"],
      narrative: "Expect clear skies today..",
      reportedAt: AT,
      source: "snotel",
    },
    season: {
      status: "open",
      openDate: "2026-11-10",
      openDateKind: "confirmed",
      closingDate: null,
      seasonLabel: "2026-27",
      hemisphere: "north",
      asOf: "2026-12-20",
      source: "resort_openings",
      sourceUrl: null,
    },
    cams: [
      cam(),
      cam({ id: "cam-2", name: "Peak 8 Base", elevation: null, live: false, stillUrl: "https://www.peakcam.io/stills/peak8.jpg", capturedAt: "2026-12-20T11:30:00.000Z", embedType: "youtube" }),
      cam({ id: "cam-3", name: "Village", elevation: null, live: null, stillUrl: null, embedType: "iframe" }),
    ],
    websiteUrl: "https://www.breckenridge.com",
    attribution: PUBLIC_API_ATTRIBUTION,
    license: PUBLIC_API_LICENSE_URL,
    updatedAt: AT,
    ...over,
  };
}

function light(slug: string, name: string, state: string, snow: { base: number | null; h24: number | null; h48: number | null; source: "snotel" | "open_meteo" } | null) {
  return {
    slug,
    name,
    canonicalUrl: `https://www.peakcam.io/resorts/${slug}`,
    apiUrl: `https://www.peakcam.io/api/v1/resorts/${slug}`,
    location: { state, region: "r", country: state === "Chile" ? "CL" : "US", lat: 40, lon: -105 },
    snow: snow ? { baseDepth: snow.base, newSnow24h: snow.h24, newSnow48h: snow.h48, unit: "in" as const, source: snow.source, measuredAt: AT } : null,
    rating: null,
    seasonStatus: "unknown" as const,
    camCount: 2,
    liveCamCount: 1,
  };
}

function list(over: Partial<ResortListPublic> = {}): ResortListPublic {
  const resorts = [
    light("alta", "Alta", "UT", { base: 60, h24: 14, h48: 20, source: "snotel" }),
    light("breckenridge", "Breckenridge", "CO", { base: 42, h24: 6, h48: 11, source: "snotel" }),
    light("vail", "Vail", "CO", { base: 40, h24: 6, h48: 9, source: "snotel" }),
    light("whistler", "Whistler Blackcomb", "BC", { base: 80, h24: 30, h48: 40, source: "open_meteo" }),
    light("portillo", "Ski Portillo", "Chile", { base: 0, h24: 0, h48: 0, source: "open_meteo" }),
    light("loveland", "Loveland", "CO", { base: 30, h24: 0, h48: 2, source: "snotel" }),
    light("new-resort", "New Resort", "VT", null),
  ];
  return { count: resorts.length, resorts, attribution: PUBLIC_API_ATTRIBUTION, license: PUBLIC_API_LICENSE_URL, generatedAt: AT, ...over };
}

// ── Helpers ──────────────────────────────────────────────────

test("formatMountainTime renders the data clock in Mountain Time", () => {
  assert.equal(formatMountainTime(AT), "5:00 AM MT on Dec 20, 2026");
  assert.equal(formatMountainTime("2026-07-04T18:30:00Z"), "12:30 PM MT on Jul 4, 2026"); // MDT
  assert.equal(formatMountainTime("garbage"), "an unknown time");
});

test("sourceLabel names the station for SNOTEL and says estimate for the model", () => {
  assert.equal(sourceLabel(m(1)), "SNOTEL, Hoosier Pass, 11,400 ft");
  assert.equal(sourceLabel({ source: "snotel", station: { id: "1:X:SNTL", name: null, elevationFt: null } }), "SNOTEL, station 1:X:SNTL");
  assert.equal(sourceLabel(m(1, "in", "open_meteo")), "weather-model estimate");
  assert.equal(sourceLabel({ source: null }), "source unknown");
});

// ── Resort page ──────────────────────────────────────────────

test("the resort summary sentence is dated, labelled by source, and uses the narrative once", () => {
  const sentence = resortSummarySentence(resort());
  assert.equal(
    sentence,
    "As of 5:00 AM MT on Dec 20, 2026, Breckenridge measures a 42 in base, 6 in of new snow in the last 24 hours and 11 in over 48 hours (SNOTEL, Hoosier Pass, 11,400 ft). Snow water equivalent is 118% of the station's 1991-2020 median for today's date. Conditions rating: great; powder, fresh. Expect clear skies today.",
  );
});

test("a model-estimated resort says so and never claims a station", () => {
  const r = resort({
    name: "Whistler Blackcomb",
    location: { state: "BC", region: "Coast Mountains", country: "CA", lat: 50.1, lon: -122.9, baseElevationFt: null },
    snow: {
      ...resort().snow!,
      baseDepth: m(80, "in", "open_meteo"),
      newSnow24h: m(3, "in", "open_meteo"),
      newSnow48h: m(null, "in", "open_meteo"),
      swe: m(null, "in", "open_meteo"),
      pctOfNormal: m(null, "percent", "open_meteo"),
      trend7d: { value: null, source: "open_meteo", measuredAt: AT },
      rating: null,
      tags: [],
      narrative: null,
      source: "open_meteo",
    },
  });
  const md = resortMarkdown(r);
  assert.match(md, /^# Whistler Blackcomb, British Columbia: snow report and webcams\n/);
  assert.match(md, /As of 5:00 AM MT on Dec 20, 2026, Whistler Blackcomb has a 80 in base and 3 in of new snow in the last 24 hours \(weather-model estimate\)\./);
  assert.ok(!md.includes("SNOTEL,"), "no station label on a model resort");
  assert.match(md, /\| New snow, 48 h \| n\/a \| weather-model estimate \|/);
});

test("resortMarkdown carries the table, season, cams with capture provenance, links and attribution", () => {
  const md = resortMarkdown(resort());
  const lines = md.split("\n");
  assert.equal(lines[0], "# Breckenridge, Colorado: snow report and webcams");
  assert.match(lines[2], /^As of 5:00 AM MT on Dec 20, 2026, Breckenridge measures/);

  assert.ok(md.includes("| Base depth | 42 in | SNOTEL, Hoosier Pass, 11,400 ft | 2026-12-20T12:00:00.000Z |"));
  assert.ok(md.includes("| Snow water equivalent | 9.5 in |"));
  assert.ok(md.includes("| Percent of normal | 118% |"));
  assert.ok(md.includes("7-day trend: rising; outlook: more snow."));
  assert.ok(md.includes("Season: open (2026-27 season); opening date Nov 10, 2026, as of 2026-12-20."));

  assert.ok(md.includes("## Webcams (3)"));
  assert.ok(md.includes("- Summit (11,000 ft): live, provider still, capture time unknown; watch at https://www.peakcam.io/resorts/breckenridge"));
  assert.ok(md.includes("- Peak 8 Base: offline (last health check failed), captured 2026-12-20T11:30:00.000Z; watch at"));
  assert.ok(md.includes("- Village: unchecked, no still image; watch at"));

  assert.ok(md.includes("- Page: https://www.peakcam.io/resorts/breckenridge\n- API: https://www.peakcam.io/api/v1/resorts/breckenridge\n- Cams API: https://www.peakcam.io/api/v1/resorts/breckenridge/cams\n- Powder feed (Atom): https://www.peakcam.io/resorts/breckenridge/powder.xml\n- Resort website: https://www.breckenridge.com"));
  assert.ok(md.includes("Canonical: https://www.peakcam.io/resorts/breckenridge"));
  assert.ok(md.includes(`Data: ${PUBLIC_API_ATTRIBUTION}. Cite the canonical URL`));
  assert.ok(md.endsWith(`License: ${PUBLIC_API_LICENSE_URL}\n`));
});

test("a resort with no report and no cams still renders a complete, honest page", () => {
  const md = resortMarkdown(resort({ snow: null, cams: [] }), { now: new Date(AT) });
  assert.ok(md.includes("As of 5:00 AM MT on Dec 20, 2026, PeakCam has no snow report for Breckenridge yet."));
  assert.ok(!md.includes("| Measure |"));
  assert.ok(md.includes("## Webcams (0)\n\nNo active webcams."));
});

test("markdownPageHeaders is the public API set plus canonical Link and noindex", () => {
  const h = markdownPageHeaders("https://www.peakcam.io/resorts/breckenridge");
  assert.equal(h["Content-Type"], "text/markdown; charset=utf-8");
  assert.equal(h["X-Robots-Tag"], "noindex");
  assert.equal(h["Cache-Control"], "public, s-maxage=900, stale-while-revalidate=3600");
  assert.equal(h["Access-Control-Allow-Origin"], "*");
  assert.match(h.Link, /rel="author"/);
  assert.match(h.Link, /rel="license"/);
  assert.ok(h.Link.endsWith('<https://www.peakcam.io/resorts/breckenridge>; rel="canonical"'));
  for (const [k, v] of Object.entries(h)) assert.ok(/^[\x20-\x7e]*$/.test(v), `${k} must be printable ASCII (Latin-1 header rule)`);
});

// ── Index page ───────────────────────────────────────────────

test("topMeasured24h ranks SNOTEL resorts with new snow, excluding model rows and zeros", () => {
  assert.deepEqual(
    topMeasured24h(list()).map((r) => r.slug),
    ["alta", "breckenridge", "vail"], // Whistler (model) and Loveland (0 in) excluded; Breck beats Vail on 48 h
  );
  assert.equal(topMeasured24h(list(), 2).length, 2);
});

test("indexMarkdown has the dated line, the measured top list, state hubs and entry points", () => {
  const md = indexMarkdown(list());
  assert.match(md, /^# PeakCam: ski resort snow reports and live webcams\n\n> Snow reports and live webcams for 7 ski resorts/);
  assert.ok(md.includes("As of 5:00 AM MT on Dec 20, 2026, 3 of 4 station-measured resorts report new snow in the last 24 hours; the most is 14 in at Alta, Utah (SNOTEL)."));
  assert.ok(md.includes("| 1 | [Alta](https://www.peakcam.io/resorts/alta), Utah | 14 in | 20 in | 60 in | https://www.peakcam.io/resorts/alta/index.md |"));
  assert.ok(!md.includes("Whistler"), "model-estimated rows stay out of the measured table");
  assert.ok(md.includes("- [Colorado](https://www.peakcam.io/ski-cams/colorado): 3 resorts"));
  assert.ok(md.includes("- [Chile](https://www.peakcam.io/ski-cams/chile): 1 resort"));
  assert.ok(md.includes("- Markdown: https://www.peakcam.io/resorts/{slug}/index.md"));
  assert.ok(md.includes("- Powder feed (Atom): https://www.peakcam.io/resorts/{slug}/powder.xml"));
  assert.ok(md.includes("- OpenAPI 3.1: https://www.peakcam.io/api/v1/openapi.json"));
  assert.ok(md.includes("- API catalog (RFC 9727): https://www.peakcam.io/.well-known/api-catalog"));
  assert.ok(md.includes("Canonical: https://www.peakcam.io/"));
  assert.ok(md.endsWith(`License: ${PUBLIC_API_LICENSE_URL}\n`));
});

test("indexMarkdown with no measured new snow says so instead of printing an empty table", () => {
  const l = list();
  for (const r of l.resorts) if (r.snow) r.snow.newSnow24h = 0;
  const md = indexMarkdown(l);
  assert.ok(md.includes("none of the 4 station-measured resorts reports new snow"));
  assert.ok(md.includes("No measured new snow in the last 24 hours."));
  assert.ok(!md.includes("| # | Resort |"));
});

test("indexMarkdown honours baseUrl for site links (previews)", () => {
  const md = indexMarkdown(list(), { baseUrl: "https://preview.example" });
  assert.ok(md.includes("- API base: https://preview.example/api/v1"));
  assert.ok(md.includes("https://preview.example/ski-cams/colorado"));
});

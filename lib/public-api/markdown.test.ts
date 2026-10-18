import { test } from "node:test";
import assert from "node:assert/strict";
import type { CamPublic, Measurement, ResortPublic } from "./schema";
import {
  camLine,
  formatInches,
  formatInstant,
  formatMeasurement,
  formatStation,
  resortMarkdown,
  seasonSummary,
  snowSection,
  sourceLabel,
} from "./markdown";

const m = (value: number | null, unit: Measurement["unit"] = "in"): Measurement => ({
  value,
  unit,
  source: "snotel",
  measuredAt: "2026-12-20T12:00:00.000Z",
  station: { id: "842:CO:SNTL", name: "Copper Mountain", elevationFt: 10550 },
});

const cam: CamPublic = {
  id: "c1",
  name: "Summit",
  elevation: "11,000 ft",
  live: true,
  lastCheckedAt: "2026-12-20T11:00:00.000Z",
  stillUrl: "https://cams.example.com/summit.jpg",
  capturedAt: null,
  embedType: "image",
  pageUrl: "https://www.peakcam.io/resorts/vail",
  sourceUrl: "https://cams.example.com/summit.jpg",
};

const resort: ResortPublic = {
  slug: "vail",
  name: "Vail Mountain",
  canonicalUrl: "https://www.peakcam.io/resorts/vail",
  apiUrl: "https://www.peakcam.io/api/v1/resorts/vail",
  location: { state: "CO", region: "Colorado Rockies", country: "US", lat: 39.6, lon: -106.4, baseElevationFt: 8120 },
  snow: {
    baseDepth: m(42),
    newSnow24h: m(6),
    newSnow48h: m(11),
    swe: m(9.5),
    pctOfNormal: m(118, "percent"),
    trend7d: { value: "rising", source: "snotel", measuredAt: "2026-12-20T12:00:00.000Z" },
    outlook: "more_snow",
    rating: "great",
    tags: ["powder", "fresh"],
    narrative: "Expect clear skies today.",
    reportedAt: "2026-12-20T12:00:00.000Z",
    source: "snotel",
  },
  season: {
    status: "open",
    openDate: "2026-11-13",
    openDateKind: "confirmed",
    closingDate: null,
    seasonLabel: "2026-27",
    hemisphere: "north",
    asOf: "2026-12-20",
    source: "resort_openings",
    sourceUrl: null,
  },
  cams: [cam, { ...cam, id: "c2", name: "Base", live: false, stillUrl: null, sourceUrl: null, embedType: "youtube" }],
  websiteUrl: "https://www.vail.com",
  attribution: "PeakCam (https://www.peakcam.io) - SNOTEL data: USDA NRCS",
  license: "https://www.peakcam.io/about#terms",
  updatedAt: "2026-12-20T12:00:00.000Z",
};

test("formatters are deterministic and null-safe", () => {
  assert.equal(formatInstant("2026-12-20 12:00:00+00"), "2026-12-20 12:00 UTC");
  assert.equal(formatInstant(null), "unknown");
  assert.equal(formatInstant("garbage"), "unknown");
  assert.equal(formatMeasurement(m(6)), "6 in");
  assert.equal(formatMeasurement(m(9.5)), "9.5 in");
  assert.equal(formatMeasurement(m(118, "percent")), "118 %");
  assert.equal(formatMeasurement(m(null)), "n/a");
  assert.equal(formatMeasurement(null), "n/a");
  assert.equal(formatInches(0), "0 in");
  assert.equal(formatInches(null), "n/a");
  assert.equal(formatStation(m(1).station), "Copper Mountain at 10,550 ft");
  assert.equal(formatStation(null), null);
  assert.equal(sourceLabel("snotel"), "SNOTEL-measured (USDA NRCS)");
  assert.equal(sourceLabel("open_meteo", true), "model");
  assert.equal(sourceLabel(null), "source unknown");
});

test("seasonSummary covers confirmed, projected, closing and empty rows", () => {
  assert.equal(seasonSummary(resort.season), "open (confirmed opening 2026-11-13; as of 2026-12-20)");
  assert.equal(
    seasonSummary({ ...resort.season, status: "unknown", openDateKind: "projected", openDate: "2026-11-20" }),
    "unknown (projected opening 2026-11-20; as of 2026-12-20)",
  );
  assert.equal(
    seasonSummary({ ...resort.season, status: "closed", openDate: null, openDateKind: null, closingDate: "2026-10-05" }),
    "closed (closing 2026-10-05; as of 2026-12-20)",
  );
  assert.equal(seasonSummary({ ...resort.season, status: "unknown", openDate: null, openDateKind: null }), "unknown (no date on file; as of 2026-12-20)");
});

test("snowSection and camLine carry provenance", () => {
  const lines = snowSection(resort.snow);
  assert.equal(lines[0], "Latest report: SNOTEL-measured (USDA NRCS), station Copper Mountain at 10,550 ft, 2026-12-20 12:00 UTC.");
  assert.ok(lines.includes("| New snow 24 h | 6 in |"));
  assert.ok(lines.includes("| SWE % of normal | 118 % |"));
  assert.ok(lines.includes("| Outlook | more snow |"));
  assert.ok(lines.includes("Tags: powder, fresh"));
  assert.deepEqual(snowSection(null), ["No snow report on file for this resort."]);
  assert.equal(
    camLine(cam),
    "- **Summit** (11,000 ft) · live as of 2026-12-20 11:00 UTC · image · still: https://cams.example.com/summit.jpg · source: https://cams.example.com/summit.jpg",
  );
  assert.equal(camLine(resort.cams[1]), "- **Base** (11,000 ft) · down as of 2026-12-20 11:00 UTC · youtube");
});

test("resortMarkdown renders the full document and the count-only variant", () => {
  const md = resortMarkdown(resort);
  assert.match(md, /^# Vail Mountain snow report\n\nColorado Rockies, CO, US · base 8,120 ft\nSeason: open \(confirmed opening 2026-11-13; as of 2026-12-20\)\nPeakCam page \(cite this\): https:\/\/www\.peakcam\.io\/resorts\/vail\nJSON: https:\/\/www\.peakcam\.io\/api\/v1\/resorts\/vail\n\n## Snow\n/);
  assert.match(md, /## Cams \(2, 1 live\)\n\n- \*\*Summit\*\*/);
  assert.match(md, /Data: PeakCam \(https:\/\/www\.peakcam\.io\) - SNOTEL data: USDA NRCS\. Terms: https:\/\/www\.peakcam\.io\/about#terms\. Updated 2026-12-20 12:00 UTC\.\n$/);

  const capped = resortMarkdown(resort, { maxCams: 1 });
  assert.match(capped, /- …and 1 more at https:\/\/www\.peakcam\.io\/resorts\/vail/);

  const counted = resortMarkdown(resort, { cams: "count" });
  assert.match(counted, /## Cams \(2, 1 live\)\n\nCam list and players: https:\/\/www\.peakcam\.io\/resorts\/vail/);
  assert.doesNotMatch(counted, /\*\*Summit\*\*/);

  const noSnow = resortMarkdown({ ...resort, snow: null, cams: [] });
  assert.match(noSnow, /No snow report on file for this resort\./);
  assert.match(noSnow, /## Cams \(0, 0 live\)\n\nNo cams on file\./);
});

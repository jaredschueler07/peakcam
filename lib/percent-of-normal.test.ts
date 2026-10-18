import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPctOfNormalPage, countStationFed, PCT_OF_NORMAL_RULE, phaseCopy } from "./percent-of-normal";
import { PCT_OF_NORMAL_MAX, PCT_OF_NORMAL_MIN, PCT_OF_NORMAL_MIN_SWE_IN, publishablePctOfNormal } from "./resort-copy";
import type { QuotableResort } from "./quotable";
import type { SnowReport } from "./types";

// 2026-10-18 12:00 UTC = 6:00 a.m. MDT, an off-season month for the split.
const OCTOBER = new Date("2026-10-18T12:00:00Z");
const JANUARY = new Date("2027-01-15T12:00:00Z");

function makeSnow(overrides: Partial<SnowReport> = {}): SnowReport {
  return {
    id: "s1",
    resort_id: "r1",
    base_depth: 12,
    new_snow_24h: 1,
    new_snow_48h: 3,
    trails_open: null,
    trails_total: null,
    lifts_open: null,
    lifts_total: null,
    conditions: null,
    source: "snotel",
    updated_at: "2026-10-18T12:00:00Z",
    swe_in: 4,
    pct_of_normal: 85,
    trend_7d: null,
    outlook: null,
    auto_cond_rating: null,
    ...overrides,
  } as SnowReport;
}

function makeResort(name: string, snow: Partial<SnowReport> | null, station = true): QuotableResort {
  const slug = name.toLowerCase().replace(/\s+/g, "-");
  return {
    id: `id-${slug}`,
    name,
    slug,
    snotel_station_id: station ? `${slug}-stn` : null,
    snow_report: snow ? makeSnow(snow) : null,
  };
}

// Every way a row can be unpublishable, plus the rows that must survive.
const FIXTURE: QuotableResort[] = [
  makeResort("Breckenridge", { swe_in: 6, pct_of_normal: 140, updated_at: "2026-10-18T16:31:40Z" }),
  makeResort("Vail", { swe_in: 3, pct_of_normal: 35 }),
  makeResort("Alta", { swe_in: 2, pct_of_normal: 300 }), // on both edges, inclusive
  makeResort("Ski Cooper", { swe_in: 0.2, pct_of_normal: 900 }), // October dusting
  makeResort("Loveland", { swe_in: 1.9, pct_of_normal: 120 }), // just under the SWE floor
  makeResort("Monarch", { swe_in: 5, pct_of_normal: 9 }), // under the band
  makeResort("Wolf Creek", { swe_in: 5, pct_of_normal: 301 }), // over the band
  makeResort("Whistler", { source: "open_meteo", swe_in: 20, pct_of_normal: 200 }), // model row
  makeResort("Stowe", { swe_in: 8, pct_of_normal: 110 }, false), // snotel source but no station id
  makeResort("Keystone", { swe_in: 4, pct_of_normal: null }),
  makeResort("Aspen", null),
];

test("buildPctOfNormalPage lists exactly the rows publishablePctOfNormal accepts, deepest first", () => {
  const page = buildPctOfNormalPage(FIXTURE, OCTOBER);
  assert.deepEqual(
    page.ranked.map((r) => [r.name, r.pct, r.sweIn]),
    [
      ["Alta", 300, 2],
      ["Breckenridge", 140, 6],
      ["Vail", 35, 3],
    ],
  );

  // The page's filter is the shared rule, not a copy of it: every fixture
  // resort is on the page iff publishablePctOfNormal says it may be.
  const listed = new Set(page.ranked.map((r) => r.slug));
  for (const r of FIXTURE) {
    const allowed = publishablePctOfNormal(r.snow_report, Boolean(r.snotel_station_id)) != null;
    assert.equal(listed.has(r.slug), allowed, `${r.name} listed=${listed.has(r.slug)} allowed=${allowed}`);
  }
  for (const row of page.ranked) {
    assert.ok(row.pct >= PCT_OF_NORMAL_MIN && row.pct <= PCT_OF_NORMAL_MAX, `${row.name} ${row.pct}% outside band`);
    assert.ok(row.sweIn >= PCT_OF_NORMAL_MIN_SWE_IN, `${row.name} ${row.sweIn} in. under the SWE floor`);
  }

  assert.equal(page.phase, "season");
  // Breckenridge, Vail, Alta, Ski Cooper, Loveland, Monarch, Wolf Creek, Keystone: station + snotel source.
  assert.equal(page.stationFedCount, 8);
  assert.equal(countStationFed(FIXTURE), 8);
  // Dated by the newest station report, surfaced for WebPage.dateModified.
  assert.equal(page.asOf, "2026-10-18T16:31:40.000Z");
  assert.equal(page.sentence.asOf, page.asOf);
  assert.match(page.sentence.text, /^As of 10:31 a\.m\. MT Oct 18, 3 of 8 SNOTEL-fed resorts/);
  assert.match(page.sentence.text, /Alta at 300%, the thinnest Vail at 35%\.$/);
});

test("with nothing publishable the page is honest and season-aware", () => {
  const dusting = [
    makeResort("Ski Cooper", { swe_in: 0.2, pct_of_normal: 900 }),
    makeResort("Whistler", { source: "open_meteo", swe_in: 20, pct_of_normal: 200 }),
  ];

  const october = buildPctOfNormalPage(dusting, OCTOBER);
  assert.deepEqual(october.ranked, []);
  assert.equal(october.phase, "pre-season");
  assert.equal(october.stationFedCount, 1);
  assert.equal(
    october.sentence.text,
    "As of 6:00 a.m. MT Oct 18, none of the 1 SNOTEL-fed resorts has the 2 in. of snow water equivalent needed to compare its snowpack with the 1991–2020 median.",
  );
  assert.match(phaseCopy(october.phase, october.stationFedCount), /early in the water year/);

  const january = buildPctOfNormalPage(dusting, JANUARY);
  assert.equal(january.phase, "early");
  assert.match(phaseCopy(january.phase, january.stationFedCount), /under way/);

  const empty = buildPctOfNormalPage([], OCTOBER);
  assert.equal(empty.asOf, null);
  assert.equal(empty.stationFedCount, 0);
  assert.equal(empty.phase, "pre-season");
});

test("the rule copy quotes the live thresholds", () => {
  assert.match(PCT_OF_NORMAL_RULE, new RegExp(`${PCT_OF_NORMAL_MIN_SWE_IN} in\\. of SWE`));
  assert.match(PCT_OF_NORMAL_RULE, new RegExp(`between ${PCT_OF_NORMAL_MIN}% and ${PCT_OF_NORMAL_MAX}%`));
  assert.match(PCT_OF_NORMAL_RULE, /1991–2020 median/);
  assert.match(phaseCopy("season", 40), new RegExp(`below ${PCT_OF_NORMAL_MIN_SWE_IN} in\\. of SWE`));
});

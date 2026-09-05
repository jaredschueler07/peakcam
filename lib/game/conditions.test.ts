import assert from "node:assert/strict";
import test from "node:test";
import type { Resort, SnowReport, WeatherPeriod } from "../types";
import { buildConditionsSnapshot } from "./conditions";
import { physicsModelForRollout } from "./config/physics-rollout";

const resort = {
  id: "resort-1", name: "Heavenly", slug: "heavenly", state: "CA", country: "US",
  region: "Tahoe", lat: 38.9, lng: -120.0, website_url: null, cam_page_url: null,
  cond_rating: "good", snotel_station_id: null, x_url: null, facebook_url: null,
  instagram_url: null, is_active: true, created_at: "2025-01-01T00:00:00Z",
} satisfies Resort;

const report = {
  id: "report-1", resort_id: resort.id, base_depth: 64, new_snow_24h: 3,
  new_snow_48h: 5, trails_open: 90, trails_total: 97, lifts_open: 24,
  lifts_total: 28, conditions: "Packed powder", source: "pipeline",
  updated_at: "2026-02-03T14:00:00Z", swe_in: 18, pct_of_normal: 104,
  trend_7d: "rising", outlook: "stable", auto_cond_rating: "good",
  snowing_now: false,
} satisfies SnowReport;

const snowForecast = [{
  dow: "Today", condition: "light-snow", high: 26, low: 15, snowInches: 3,
  shortForecast: "Snow showers", windSpeed: 12, windDirection: "W",
  windGust: 24, precipProbability: 80, feelsLike: 14,
}] satisfies WeatherPeriod[];

test("words merely containing ice do not select ice physics", () => {
  // `/\bicy|ice\b/i` parses as `(\bicy)|(ice\b)`, so any word ENDING in "ice"
  // matched: "nice groomers" chose the ice integrator. Alternation needs the
  // group for the word boundaries to bind to both branches.
  for (const conditions of ["nice groomers", "twice-groomed", "lift service excellent"]) {
    assert.equal(
      buildConditionsSnapshot(resort, { ...report, conditions }).surface,
      "packed",
      `${conditions} must not select ice`,
    );
  }
});

test("genuine ice wording still selects ice physics", () => {
  for (const conditions of ["icy patches", "boilerplate ice", "Machine groomed, icy"]) {
    assert.equal(
      buildConditionsSnapshot(resort, { ...report, conditions }).surface,
      "ice",
      `${conditions} must select ice`,
    );
  }
});

test("the overloaded conditions string is split, never rendered raw", () => {
  // `snow_reports.conditions` is "tag1,tag2||narrative" (CLAUDE.md). The poster
  // was printing it whole, so Heavenly read "BLUEBIRD||EXPECT CLEAR BLUEBIRD
  // SKIES TODAY." — the separator leaking into the UI.
  const snapshot = buildConditionsSnapshot(resort, {
    ...report,
    conditions: "bluebird,packed||Expect clear bluebird skies today.",
  });
  assert.equal(snapshot.stamp, "bluebird, packed");
  assert.equal(snapshot.narrative, "Expect clear bluebird skies today.");
  assert.ok(!snapshot.stamp.includes("||"), "the separator must never reach the stamp");
});

test("a conditions string without a separator stays the stamp, with no narrative", () => {
  const snapshot = buildConditionsSnapshot(resort, { ...report, conditions: "Packed powder" });
  assert.equal(snapshot.stamp, "Packed powder");
  assert.equal(snapshot.narrative, null);
});

test("a narrative with no tags falls back to the rating stamp rather than an empty line", () => {
  const snapshot = buildConditionsSnapshot(resort, {
    ...report,
    conditions: "||Groomers are holding up well.",
  });
  assert.equal(snapshot.stamp, "Good conditions");
  assert.equal(snapshot.narrative, "Groomers are holding up well.");
});

test("only the first separator splits, so a narrative may contain pipes", () => {
  const snapshot = buildConditionsSnapshot(resort, {
    ...report,
    conditions: "icy||Ice below 8k||watch the traverse",
  });
  assert.equal(snapshot.stamp, "icy");
  assert.equal(snapshot.narrative, "Ice below 8k||watch the traverse");
});

test("eight inches in 24 hours takes priority and produces the powder-day snapshot", () => {
  assert.deepEqual(buildConditionsSnapshot(resort, { ...report, new_snow_24h: 8 }, null), {
    environment: { powderDepthCm: 20, windSpeedMps: 0, morningIce: false, visibilityM: 20000, northSign: -1 },
    surface: "powder", physicsModel: "v2", weatherDefault: 0, powderDay: true,
    baseDepthIn: 64, snow24In: 8, stamp: "POWDER DAY", narrative: null,
  });
});

test("poor and explicitly icy conditions map to distinct hard-snow surfaces", () => {
  assert.equal(buildConditionsSnapshot({ ...resort, cond_rating: "poor" }, report).surface, "firm");
  assert.equal(buildConditionsSnapshot({ ...resort, cond_rating: "icy" } as unknown as Resort, report).surface, "ice");
  assert.equal(buildConditionsSnapshot(resort, { ...report, conditions: "Machine groomed, icy" }).surface, "ice");
});

test("NWS snow selects the snowfall preset without changing packed surface", () => {
  assert.deepEqual(buildConditionsSnapshot(resort, report, snowForecast, "v2", 7), {
    environment: { powderDepthCm: 8, windSpeedMps: 5, morningIce: true, visibilityM: 800, northSign: -1 },
    surface: "packed", physicsModel: "v2", weatherDefault: 1, powderDay: false,
    baseDepthIn: 64, snow24In: 3, stamp: "Packed powder", narrative: null,
  });
});

test("missing live data uses the deterministic classic fallback", () => {
  assert.deepEqual(buildConditionsSnapshot(resort, null, null), {
    environment: { powderDepthCm: 0, windSpeedMps: 0, morningIce: false, visibilityM: 20000, northSign: -1 },
    surface: "packed", physicsModel: "v2", weatherDefault: 0, powderDay: false,
    baseDepthIn: null, snow24In: null, stamp: "Classic conditions", narrative: null,
  });
});

test("a forecast-only snapshot still starts in snowfall weather", () => {
  assert.deepEqual(buildConditionsSnapshot(resort, null, snowForecast, "v2", 7), {
    environment: { powderDepthCm: 0, windSpeedMps: 5, morningIce: true, visibilityM: 800, northSign: -1 },
    surface: "packed", physicsModel: "v2", weatherDefault: 1, powderDay: false,
    baseDepthIn: null, snow24In: null, stamp: "Classic conditions", narrative: null,
  });
});

test("physicsV2 defaults on with explicit offline v1 supported", () => {
  assert.equal(physicsModelForRollout(false), "v1");
  assert.equal(physicsModelForRollout(true), "v2");
  assert.equal(buildConditionsSnapshot(resort, report).physicsModel, "v2");
  assert.equal(buildConditionsSnapshot(resort, report, null, "v2").physicsModel, "v2");
});

test("Free Ride uses actual resort local hour for morning ice, including afternoon and night", () => {
  const morning = Date.parse("2026-09-05T14:00:00Z"); // 07:00 at Heavenly
  const afternoon = Date.parse("2026-09-05T21:00:00Z"); // 14:00 at Heavenly
  assert.equal(buildConditionsSnapshot(resort, report, snowForecast, "v2", undefined, morning).environment?.morningIce, true);
  assert.equal(buildConditionsSnapshot(resort, report, snowForecast, "v2", undefined, afternoon).environment?.morningIce, false);
  assert.equal(buildConditionsSnapshot(resort, report, snowForecast, "v2", 1).environment?.morningIce, false);
});

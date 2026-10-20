import { test } from "node:test";
import assert from "node:assert/strict";
import type { ResortOpening } from "./openings";
import {
  BASE_CONFIDENCE,
  CONDITION_FIELD_NAMES,
  buildConditions,
  depthDisagreement,
  deriveStatus,
  field,
  freshnessFor,
  freshnessMap,
  newestObservation,
  noneField,
  recommendToday,
  reportFieldSource,
  snowQualityFromTags,
  type ConditionsInput,
  type OperatorReport,
} from "./conditions-contract";
import { localDay, resortLocalDay, resortTimeZone } from "./resort-timezone";

const NOW = new Date("2026-12-20T18:00:00Z"); // 11:00 Mountain, 10:00 Pacific
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

function opening(over: Partial<ResortOpening> = {}): ResortOpening {
  return { id: "o", resort_id: "r", season: "2026-27", projected_open: null, confirmed_open: null, closing_date: null, source_url: null, notes: null, updated_at: "2026-10-01T00:00:00Z", ...over };
}

function operator(over: Partial<OperatorReport> = {}): OperatorReport {
  return {
    source: "liftie",
    sourceId: "alta",
    observedAt: hoursAgo(1),
    liftsOpen: 7,
    liftsHold: 1,
    liftsScheduled: 0,
    liftsClosed: 3,
    liftsTotal: 11,
    trailsOpen: null,
    trailsTotal: null,
    baseDepthIn: null,
    surface: null,
    openingDate: null,
    verified: false,
    ...over,
  };
}

function input(over: Partial<ConditionsInput> = {}): ConditionsInput {
  return {
    now: NOW,
    localDate: "2026-12-20",
    hemisphere: "north",
    report: { source: "snotel", updated_at: hoursAgo(5), base_depth: 42, new_snow_24h: 6, new_snow_48h: 11, swe_in: 9.5, pct_of_normal: 118, auto_cond_rating: "great", tags: ["Powder Day", "Bluebird"] },
    hasStation: true,
    opening: opening({ confirmed_open: "2026-11-20" }),
    operator: operator(),
    profile: { liftsTotal: 11, runsTotal: 119 },
    measured: [
      { role: "summit", source: "nws", observedAt: hoursAgo(1), snowDepthIn: null, tempF: 12, windMph: 31 },
      { role: "base", source: "snotel", observedAt: hoursAgo(18), snowDepthIn: 61, tempF: 18, windMph: null },
    ],
    forecast: { next48hCm: 12.5, issuedAt: hoursAgo(2) },
    ...over,
  };
}

// ── Freshness and confidence ─────────────────────────────────

test("freshness tiers follow the documented thresholds per source cadence", () => {
  assert.deepEqual(freshnessFor("operator", hoursAgo(1), NOW), { tier: "live", ageHours: 1 });
  assert.deepEqual(freshnessFor("station:nws", hoursAgo(2.5), NOW), { tier: "live", ageHours: 2.5 });
  assert.equal(freshnessFor("operator", hoursAgo(4), NOW).tier, "recent");
  // A daily station reading is never "live", however young.
  assert.equal(freshnessFor("snotel", hoursAgo(0.5), NOW).tier, "recent");
  assert.equal(freshnessFor("snotel", hoursAgo(29), NOW).tier, "recent");
  assert.equal(freshnessFor("snotel", hoursAgo(31), NOW).tier, "stale");
  assert.equal(freshnessFor("model", hoursAgo(5), NOW).tier, "estimated");
  assert.equal(freshnessFor("model", hoursAgo(40), NOW).tier, "stale");
  assert.deepEqual(freshnessFor("profile", null, NOW), { tier: "recent", ageHours: null });
  assert.equal(freshnessFor("snotel", null, NOW).tier, "unknown");
  assert.equal(freshnessFor("snotel", "not a date", NOW).tier, "unknown");
  assert.equal(freshnessFor("none", hoursAgo(1), NOW).tier, "unknown");
  assert.equal(freshnessFor("snotel", hoursAgo(1), NOW, false).tier, "unknown");
});

test("a field carries source, ISO observedAt, confidence from the source and halved when stale; null values are none", () => {
  const f = field(42, "snotel", "2026-12-20 12:00:00+00", NOW);
  assert.equal(f.value, 42);
  assert.equal(f.source, "snotel");
  assert.equal(f.observedAt, "2026-12-20T12:00:00.000Z");
  assert.equal(f.confidence, BASE_CONFIDENCE.snotel);
  assert.equal(f.freshness.tier, "recent");
  const stale = field(42, "snotel", hoursAgo(50), NOW);
  assert.equal(stale.freshness.tier, "stale");
  assert.equal(stale.confidence, 0.45);
  assert.deepEqual(field(null, "snotel", hoursAgo(1), NOW), noneField());
  assert.deepEqual(field(Number.NaN, "snotel", hoursAgo(1), NOW), noneField());
  assert.equal(noneField().confidence, 0);
  assert.equal(field(5, "derived", hoursAgo(1), NOW, { confidence: 0.5 }).confidence, 0.5);
});

test("report sources map onto contract sources; a snotel row without a station is derived, not measured", () => {
  assert.equal(reportFieldSource("snotel", true), "snotel");
  assert.equal(reportFieldSource("snotel", false), "derived");
  assert.equal(reportFieldSource("open_meteo", false), "model");
  assert.equal(reportFieldSource("pipeline", true), "derived");
  assert.equal(reportFieldSource("resort", false), "operator");
  assert.equal(reportFieldSource("manual", false), "operator");
  assert.equal(reportFieldSource(null, true), "none");
});

test("snow quality is read off the engine's tags", () => {
  assert.equal(snowQualityFromTags(["Powder Day", "Bluebird"]), "powder");
  assert.equal(snowQualityFromTags(["Spring Skiing"]), "spring");
  assert.equal(snowQualityFromTags(["Icy", "Wind Hold Risk"]), "ice");
  assert.equal(snowQualityFromTags(["Standard Conditions"]), null);
  assert.equal(snowQualityFromTags([]), null);
});

// ── Status ───────────────────────────────────────────────────

const base = { hemisphere: "north" as const, localDate: "2026-12-20", now: NOW };

test("status: a fresh operator feed with lifts open is OPEN; with lifts only scheduled it is still OPEN", () => {
  const open = deriveStatus({ ...base, opening: opening({ confirmed_open: "2026-11-20" }), operator: operator() });
  assert.equal(open.status, "OPEN");
  assert.equal(open.source, "operator");
  assert.match(open.reasons[0], /7 of 11 lifts open/);
  const scheduled = deriveStatus({ ...base, opening: null, operator: operator({ liftsOpen: 0, liftsScheduled: 9, liftsClosed: 2 }) });
  assert.equal(scheduled.status, "OPEN");
  assert.match(scheduled.reasons[0], /9 scheduled/);
});

test("status: a fresh operator feed with every lift closed inside the season is CLOSED_TODAY; outside a known season it falls through", () => {
  const closed = deriveStatus({ ...base, opening: opening({ confirmed_open: "2026-11-20" }), operator: operator({ liftsOpen: 0, liftsScheduled: 0, liftsHold: 0, liftsClosed: 11 }) });
  assert.equal(closed.status, "CLOSED_TODAY");
  assert.equal(closed.source, "operator");
  const unknownSeason = deriveStatus({ ...base, opening: null, operator: operator({ liftsOpen: 0, liftsScheduled: 0, liftsHold: 0, liftsClosed: 11 }) });
  assert.equal(unknownSeason.status, "UNKNOWN");
  assert.match(unknownSeason.reasons.join(" "), /0 of 11 lifts open/);
  assert.match(unknownSeason.reasons.join(" "), /no opening date/);
});

test("status: a stale operator feed is ignored and the opening row decides; a feed with no lift counts says nothing", () => {
  const stale = deriveStatus({ ...base, opening: opening({ confirmed_open: "2026-11-20" }), operator: operator({ observedAt: hoursAgo(60), liftsOpen: 0, liftsScheduled: 0, liftsClosed: 11 }) });
  assert.equal(stale.status, "OPEN");
  assert.match(stale.reasons[0], /stale/);
  assert.match(stale.reasons[1], /confirmed opening date 2026-11-20 has passed/);
  const empty = deriveStatus({ ...base, opening: opening({ confirmed_open: "2027-01-10" }), operator: operator({ liftsOpen: null, liftsTotal: null, liftsScheduled: null, liftsClosed: null, liftsHold: null }) });
  assert.equal(empty.status, "PRE_SEASON");
});

test("status from the opening row alone: confirmed past → OPEN, confirmed ahead → PRE_SEASON, projected ahead → PRE_SEASON (profile), projected past → UNKNOWN, closing past → OFF_SEASON, nothing → UNKNOWN", () => {
  assert.equal(deriveStatus({ ...base, opening: opening({ confirmed_open: "2026-11-20" }), operator: null }).status, "OPEN");
  assert.equal(deriveStatus({ ...base, opening: opening({ confirmed_open: "2026-12-20" }), operator: null }).status, "OPEN");
  const pre = deriveStatus({ ...base, opening: opening({ confirmed_open: "2026-12-21" }), operator: null });
  assert.equal(pre.status, "PRE_SEASON");
  assert.equal(pre.source, "operator");
  const projected = deriveStatus({ ...base, opening: opening({ projected_open: "2026-12-28" }), operator: null });
  assert.equal(projected.status, "PRE_SEASON");
  assert.equal(projected.source, "profile");
  const passed = deriveStatus({ ...base, opening: opening({ projected_open: "2026-11-28" }), operator: null });
  assert.equal(passed.status, "UNKNOWN");
  assert.equal(passed.source, "none");
  const off = deriveStatus({ ...base, hemisphere: "south", localDate: "2026-12-20", opening: opening({ season: "2026", closing_date: "2026-10-05" }), operator: null });
  assert.equal(off.status, "OFF_SEASON");
  const south = deriveStatus({ ...base, hemisphere: "south", localDate: "2026-08-20", opening: opening({ season: "2026", closing_date: "2026-10-05" }), operator: null });
  assert.equal(south.status, "OPEN");
  assert.equal(deriveStatus({ ...base, opening: null, operator: null }).status, "UNKNOWN");
  assert.equal(deriveStatus({ ...base, opening: opening(), operator: null }).status, "UNKNOWN");
});

test("status never reads OPEN without an operator feed or a confirmed / closing-date source", () => {
  const cases = [
    deriveStatus({ ...base, opening: null, operator: null }),
    deriveStatus({ ...base, opening: opening({ projected_open: "2026-11-01" }), operator: null }),
    deriveStatus({ ...base, opening: opening({ projected_open: "2026-11-01" }), operator: operator({ observedAt: hoursAgo(100) }) }),
    deriveStatus({ ...base, opening: opening(), operator: operator({ liftsOpen: null, liftsTotal: null }) }),
  ];
  for (const c of cases) assert.notEqual(c.status, "OPEN", c.reasons.join("; "));
});

test("the resort's own calendar day decides: an opening dated today reads OPEN at 11:00 Mountain and PRE_SEASON the evening before", () => {
  const evening = new Date("2026-12-20T05:00:00Z"); // 22:00 Mountain on the 19th
  const resort = { state: "CO", country: "US", lng: -106 };
  assert.equal(resortLocalDay(resort, evening), "2026-12-19");
  assert.equal(resortLocalDay(resort, NOW), "2026-12-20");
  const row = opening({ confirmed_open: "2026-12-20" });
  assert.equal(deriveStatus({ ...base, localDate: resortLocalDay(resort, evening), now: evening, opening: row, operator: null }).status, "PRE_SEASON");
  assert.equal(deriveStatus({ ...base, localDate: resortLocalDay(resort, NOW), opening: row, operator: null }).status, "OPEN");
});

// ── Time zones ───────────────────────────────────────────────

test("resort time zones by state, with Idaho split by longitude and the Andes by country", () => {
  assert.equal(resortTimeZone({ state: "CO", country: "US", lng: -106 }), "America/Denver");
  assert.equal(resortTimeZone({ state: "CA", country: "US", lng: -119 }), "America/Los_Angeles");
  assert.equal(resortTimeZone({ state: "AZ", country: "US", lng: -111.7 }), "America/Phoenix");
  assert.equal(resortTimeZone({ state: "VT", country: "US", lng: -72.8 }), "America/New_York");
  assert.equal(resortTimeZone({ state: "MN", country: "US", lng: -90.7 }), "America/Chicago");
  assert.equal(resortTimeZone({ state: "ID", country: "US", lng: -116.6 }), "America/Los_Angeles"); // Schweitzer
  assert.equal(resortTimeZone({ state: "ID", country: "US", lng: -114.4 }), "America/Denver"); // Sun Valley
  assert.equal(resortTimeZone({ state: "BC", country: "CA", lng: -122.9 }), "America/Vancouver");
  assert.equal(resortTimeZone({ state: "Chile", country: "CL", lng: -70.1 }), "America/Santiago");
  assert.equal(resortTimeZone({ state: "Argentina", country: "AR", lng: -71.4 }), "America/Argentina/Buenos_Aires");
  assert.equal(resortTimeZone({ state: "XX", country: "US", lng: -121 }), "America/Los_Angeles");
  assert.equal(localDay(new Date("2026-12-21T03:30:00Z"), "America/Santiago"), "2026-12-21");
  assert.equal(localDay(new Date("2026-12-21T03:30:00Z"), "America/Los_Angeles"), "2026-12-20");
});

// ── Depth disagreement and the verdict ───────────────────────

test("depth disagreement flags a gap above 30 % of the larger value and prefers the measurement", () => {
  assert.equal(depthDisagreement(42, 50), null);
  assert.equal(depthDisagreement(42, null), null);
  assert.equal(depthDisagreement(0, 0), null);
  const d = depthDisagreement(42, 70)!;
  assert.equal(d.differencePct, 40);
  assert.equal(d.preferred, "measured");
  assert.match(d.note, /42 in.*70 in.*40 %/);
  assert.equal(depthDisagreement(70, 42)!.differencePct, 40);
});

test("recommendToday needs OPEN on a usable source and a current base, and withholds on a poor rating", () => {
  const open = field<"OPEN">("OPEN", "operator", hoursAgo(1), NOW);
  const baseDepth = field(42, "snotel", hoursAgo(5), NOW);
  const snow = field(6, "snotel", hoursAgo(5), NOW);
  const yes = recommendToday({ status: open, baseDepthIn: baseDepth, operatorBaseDepthIn: noneField(), newSnow24hIn: snow, rating: "great" });
  assert.equal(yes.value, true);
  assert.match(yes.reasons[0], /base 42 in \(snotel, recent, 5 h old\)/);
  assert.match(yes.reasons[1], /6 in of new snow/);
  const closed = recommendToday({ status: field<"CLOSED_TODAY">("CLOSED_TODAY", "operator", hoursAgo(1), NOW), baseDepthIn: baseDepth, operatorBaseDepthIn: noneField(), newSnow24hIn: snow, rating: "great" });
  assert.deepEqual(closed, { value: false, reasons: ["status is CLOSED_TODAY"] });
  const noBase = recommendToday({ status: open, baseDepthIn: noneField(), operatorBaseDepthIn: noneField(), newSnow24hIn: noneField(), rating: null });
  assert.deepEqual(noBase, { value: false, reasons: ["no base depth on file"] });
  const stale = recommendToday({ status: open, baseDepthIn: field(42, "snotel", hoursAgo(80), NOW), operatorBaseDepthIn: noneField(), newSnow24hIn: noneField(), rating: null });
  assert.deepEqual(stale, { value: false, reasons: ["base depth is stale"] });
  const poor = recommendToday({ status: open, baseDepthIn: baseDepth, operatorBaseDepthIn: noneField(), newSnow24hIn: noneField(), rating: "poor" });
  assert.equal(poor.value, false);
  assert.equal(poor.reasons.at(-1), "PeakCam rating is poor");
  const operatorBase = recommendToday({ status: open, baseDepthIn: noneField(), operatorBaseDepthIn: field(30, "operator", hoursAgo(1), NOW), newSnow24hIn: noneField(), rating: null });
  assert.equal(operatorBase.value, true);
  assert.match(operatorBase.reasons[0], /operator, live/);
});

// ── The whole contract ───────────────────────────────────────

test("buildConditions: every field is sourced, the status is OPEN on the operator feed, and the verdict explains itself", () => {
  const c = buildConditions(input());
  assert.equal(c.status.value, "OPEN");
  assert.equal(c.status.source, "operator");
  assert.equal(c.status.freshness.tier, "live");
  assert.equal(c.recommendableToday, true);
  assert.equal(c.baseDepthIn.value, 42);
  assert.equal(c.baseDepthIn.source, "snotel");
  assert.equal(c.baseDepthIn.freshness.tier, "recent");
  assert.equal(c.newSnow24hIn.value, 6);
  assert.equal(c.sweIn.value, 9.5);
  assert.equal(c.percentOfNormal.value, 118);
  assert.equal(c.percentOfNormal.source, "derived");
  assert.equal(c.liftsOpen.value, 7);
  assert.equal(c.liftsOpen.source, "operator");
  assert.equal(c.liftsTotal.value, 11);
  assert.equal(c.liftsTotal.source, "operator");
  assert.equal(c.runsOpen.value, null);
  assert.equal(c.runsOpen.source, "none");
  assert.equal(c.runsTotal.value, 119);
  assert.equal(c.runsTotal.source, "profile");
  assert.equal(c.runsTotal.freshness.tier, "recent");
  assert.equal(c.runsTotal.freshness.ageHours, null);
  assert.equal(c.seasonOpening.value, "2026-11-20");
  assert.equal(c.seasonOpening.source, "operator");
  assert.equal(c.seasonClosing.source, "none");
  assert.equal(c.snowQuality.value, "powder");
  assert.equal(c.snowQuality.source, "derived");
  assert.equal(c.tempF.value, 12);
  assert.equal(c.tempF.source, "station:nws");
  assert.equal(c.tempF.freshness.tier, "live");
  assert.equal(c.windMph.value, 31);
  assert.equal(c.forecastNext48hCm.value, 12.5);
  assert.equal(c.forecastNext48hCm.source, "model");
  assert.equal(c.forecastNext48hCm.freshness.tier, "estimated");
  assert.equal(c.operatorBaseDepthIn.source, "none");
  assert.equal(c.surface.source, "none");
  assert.equal(c.depthDisagreement, null);
  assert.ok(c.reasons.some((r) => /7 of 11 lifts open/.test(r)));
  assert.ok(c.reasons.some((r) => /base 42 in/.test(r)));
  const tiers = freshnessMap(c);
  assert.equal(Object.keys(tiers).length, CONDITION_FIELD_NAMES.length);
  assert.equal(tiers.status, "live");
  assert.equal(tiers.runsOpen, "unknown");
  assert.equal(newestObservation(c), hoursAgo(1));
});

test("buildConditions: a model-estimated Andes resort after its closing date is OFF_SEASON, not recommendable, with estimated snow fields", () => {
  const c = buildConditions(
    input({
      hemisphere: "south",
      localDate: "2026-12-20",
      hasStation: false,
      report: { source: "open_meteo", updated_at: hoursAgo(4), base_depth: 20, new_snow_24h: 3, new_snow_48h: 4, swe_in: null, pct_of_normal: null, auto_cond_rating: "fair", tags: ["Standard Conditions"] },
      opening: opening({ season: "2026", closing_date: "2026-10-05" }),
      operator: null,
      profile: { liftsTotal: 14, runsTotal: 35 },
      measured: [],
      forecast: null,
    }),
  );
  assert.equal(c.status.value, "OFF_SEASON");
  assert.equal(c.status.source, "operator");
  assert.equal(c.recommendableToday, false);
  assert.equal(c.baseDepthIn.source, "model");
  assert.equal(c.baseDepthIn.freshness.tier, "estimated");
  assert.equal(c.baseDepthIn.confidence, 0.5);
  assert.equal(c.percentOfNormal.source, "none");
  assert.equal(c.liftsTotal.source, "profile");
  assert.equal(c.liftsOpen.source, "none");
  assert.equal(c.seasonClosing.value, "2026-10-05");
  assert.equal(c.tempF.source, "none");
  assert.equal(c.reasons[0], "closing date 2026-10-05 has passed");
  assert.equal(c.reasons[1], "status is OFF_SEASON");
});

test("buildConditions: no report, no opening, no operator is UNKNOWN with every snow field none", () => {
  const c = buildConditions(input({ report: null, opening: null, operator: null, measured: [], forecast: null, profile: { liftsTotal: null, runsTotal: null } }));
  assert.equal(c.status.value, "UNKNOWN");
  assert.equal(c.status.source, "none");
  assert.equal(c.status.confidence, 0);
  assert.equal(c.recommendableToday, false);
  for (const name of CONDITION_FIELD_NAMES) {
    if (name === "status") continue;
    assert.equal(c[name].source, "none", name);
    assert.equal(c[name].value, null, name);
  }
  assert.deepEqual(c.reasons, ["no opening date on file", "status is UNKNOWN"]);
});

test("buildConditions: an operator base that disagrees with the station is exposed, and the measured value stays the base depth", () => {
  const c = buildConditions(input({ operator: operator({ baseDepthIn: 70 }) }));
  assert.equal(c.baseDepthIn.value, 42);
  assert.equal(c.operatorBaseDepthIn.value, 70);
  assert.equal(c.operatorBaseDepthIn.source, "operator");
  assert.ok(c.depthDisagreement);
  assert.equal(c.depthDisagreement!.differencePct, 40);
  assert.ok(c.reasons.some((r) => /disagree by 40 %/.test(r)));
  // A model base never triggers the comparison: it is not a measurement.
  const model = buildConditions(input({ hasStation: false, report: { ...input().report!, source: "open_meteo" }, operator: operator({ baseDepthIn: 70 }) }));
  assert.equal(model.depthDisagreement, null);
});

test("buildConditions: a stale snow report makes the verdict false even when the operator says open", () => {
  const c = buildConditions(input({ report: { ...input().report!, updated_at: hoursAgo(72) } }));
  assert.equal(c.status.value, "OPEN");
  assert.equal(c.baseDepthIn.freshness.tier, "stale");
  assert.equal(c.baseDepthIn.confidence, 0.45);
  assert.equal(c.recommendableToday, false);
  assert.ok(c.reasons.includes("base depth is stale"));
});

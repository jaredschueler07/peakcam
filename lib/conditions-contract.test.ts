import { test } from "node:test";
import assert from "node:assert/strict";
import type { ResortOpening } from "./openings";
import { statusChipDisplay } from "./conditions-contract";
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
  baseDepthLabel,
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

test("status: a fresh operator feed with lifts open is OPEN; lifts only scheduled open it only after a confirmed opening", () => {
  const open = deriveStatus({ ...base, opening: opening({ confirmed_open: "2026-11-20" }), operator: operator() });
  assert.equal(open.status, "OPEN");
  assert.equal(open.source, "operator");
  assert.equal(open.basis, "feed");
  assert.equal(open.observedAt, hoursAgo(1));
  assert.match(open.reasons[0], /7 of 11 lifts open/);
  const scheduled = deriveStatus({ ...base, opening: opening({ confirmed_open: "2026-11-20" }), operator: operator({ liftsOpen: 0, liftsScheduled: 9, liftsClosed: 2 }) });
  assert.equal(scheduled.status, "OPEN");
  assert.match(scheduled.reasons[0], /9 lifts set to run today, none confirmed turning yet/);
  // Sun Valley, 2026-11-23: all 17 lifts "scheduled" three days before opening day, no date on file.
  const standing = deriveStatus({ ...base, opening: null, operator: operator({ liftsOpen: 0, liftsScheduled: 17, liftsClosed: 0, liftsTotal: 17 }) });
  assert.equal(standing.status, "UNKNOWN");
  assert.equal(standing.liftDay ?? null, null);
  assert.match(standing.reasons[0], /17 lifts listed as scheduled and none open/);
  // With the opening still ahead the date decides: pre-season, not open.
  const ahead = deriveStatus({ ...base, opening: opening({ confirmed_open: "2026-12-24" }), operator: operator({ liftsOpen: 0, liftsScheduled: 17, liftsClosed: 0, liftsTotal: 17 }) });
  assert.equal(ahead.status, "PRE_SEASON");
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
  const byDate = deriveStatus({ ...base, opening: opening({ confirmed_open: "2026-11-20" }), operator: null });
  assert.equal(byDate.status, "OPEN");
  assert.equal(byDate.basis, "date");
  assert.equal(byDate.observedAt, null, "a date-derived status is a fact about today, not an observation");
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
  assert.equal(resortTimeZone({ state: "AK", country: "US", lng: -149.1 }), "America/Anchorage");
  assert.equal(resortTimeZone({ state: "VT", country: "US", lng: -72.8 }), "America/New_York");
  assert.equal(resortTimeZone({ state: "NJ", country: "US", lng: -74.5 }), "America/New_York");
  assert.equal(resortTimeZone({ state: "OH", country: "US", lng: -81.6 }), "America/New_York");
  assert.equal(resortTimeZone({ state: "IN", country: "US", lng: -86.1 }), "America/Indiana/Indianapolis");
  assert.equal(resortTimeZone({ state: "MN", country: "US", lng: -90.7 }), "America/Chicago");
  assert.equal(resortTimeZone({ state: "MO", country: "US", lng: -94.6 }), "America/Chicago");
  assert.equal(resortTimeZone({ state: "SD", country: "US", lng: -103.8 }), "America/Denver"); // Terry Peak
  assert.equal(resortTimeZone({ state: "SD", country: "US", lng: -96.7 }), "America/Chicago"); // Sioux Falls
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
  const staleOperatorBase = recommendToday({ status: open, baseDepthIn: noneField(), operatorBaseDepthIn: field(30, "operator", hoursAgo(80), NOW), newSnow24hIn: noneField(), rating: null });
  assert.deepEqual(staleOperatorBase, { value: false, reasons: ["base depth is stale"] });
  const zeroBase = recommendToday({ status: open, baseDepthIn: field(0, "snotel", hoursAgo(5), NOW), operatorBaseDepthIn: noneField(), newSnow24hIn: noneField(), rating: null });
  assert.deepEqual(zeroBase, { value: false, reasons: ["no base depth on file"] });
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
  assert.equal(c.status.observedAt, null);
  assert.deepEqual(c.status.freshness, { tier: "recent", ageHours: null });
  assert.equal(c.status.confidence, 0.7);
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

// ── Status over the resort's local day (lib/operator-day.ts) ──

const DAY_ZONE = "America/Denver"; // UTC−7 in November
const mt = (clock: string, day = "2026-11-20") => new Date(Date.parse(`${day}T${clock}:00Z`) + 7 * 3_600_000);
const rd = (clock: string, open: number, scheduled: number, total: number, day = "2026-11-20") => ({ observedAt: mt(clock, day).toISOString(), liftsOpen: open, liftsScheduled: scheduled, liftsTotal: total });
const seasonOn = () => opening({ confirmed_open: "2026-11-13" });
function dayStatus(readings: ReturnType<typeof rd>[], now: Date, open: ReturnType<typeof opening> | null = seasonOn()) {
  const newest = [...readings].sort((a, b) => b.observedAt.localeCompare(a.observedAt))[0];
  return deriveStatus({
    hemisphere: "north",
    localDate: new Date(now.getTime() - 7 * 3_600_000).toISOString().slice(0, 10),
    now,
    timeZone: DAY_ZONE,
    opening: open,
    operator: operator({ observedAt: newest.observedAt, liftsOpen: newest.liftsOpen, liftsScheduled: newest.liftsScheduled, liftsTotal: newest.liftsTotal, readings }),
  });
}
const VAIL_DAY = [rd("09:56", 2, 0, 34), rd("15:05", 2, 0, 34), rd("15:35", 0, 4, 34)];

test("day status: Vail at 17:00 after its lifts stopped stays OPEN on the day's last open count", () => {
  const s = dayStatus(VAIL_DAY, mt("17:00"));
  assert.equal(s.status, "OPEN");
  assert.equal(s.basis, "feed");
  assert.equal(s.liftDay?.state, "operated");
  assert.equal(s.liftDay?.liftsOpen, 2);
  assert.equal(s.liftDay?.current, false);
  assert.match(s.reasons[0], /lifts ran today, 2 of 34 open at 15:05 resort time/);
  assert.doesNotMatch(s.reasons.join(" "), /scheduled to open today/);
});

test("day status: 0 open / 0 scheduled before core hours is not CLOSED_TODAY; the confirmed date decides", () => {
  const s = dayStatus([rd("06:05", 0, 0, 21), rd("06:35", 0, 0, 21)], mt("06:40"));
  assert.equal(s.status, "OPEN");
  assert.equal(s.basis, "date");
  assert.equal(s.liftDay ?? null, null);
  assert.match(s.reasons[0], /outside core hours that does not mean closed/);
  // Same reading with no opening row: UNKNOWN, never closed.
  assert.equal(dayStatus([rd("06:05", 0, 0, 21)], mt("06:40"), null).status, "UNKNOWN");
});

test("day status: 0/0 in core hours with nothing earlier is CLOSED_TODAY in season; after an open reading it is not", () => {
  const closed = dayStatus([rd("06:05", 0, 0, 9), rd("10:35", 0, 0, 9)], mt("10:40"));
  assert.equal(closed.status, "CLOSED_TODAY");
  assert.equal(closed.liftDay?.state, "closed");
  // Mount Snow's shape: one lift until midday, then 0/0.
  const ran = dayStatus([rd("09:56", 1, 0, 17), rd("12:35", 0, 0, 17), rd("14:05", 0, 0, 17)], mt("14:10"));
  assert.equal(ran.status, "OPEN");
  assert.equal(ran.liftDay?.state, "operated");
});

test("day status: lifts scheduled and none open is OPEN with a 'scheduled' reason before 16:00, and falls to the dates after", () => {
  const morning = dayStatus([rd("06:05", 0, 5, 27)], mt("06:30"));
  assert.equal(morning.status, "OPEN");
  assert.equal(morning.liftDay?.state, "scheduled");
  assert.match(morning.reasons[0], /5 lifts set to run today/);
  // A feed that flags its plan as open before first chair (A-Basin, 2026-11-21) reads the same way, never as lifts open.
  const flagged = dayStatus([rd("06:05", 2, 0, 9), rd("07:35", 2, 0, 9)], mt("07:40"));
  assert.equal(flagged.status, "OPEN");
  assert.equal(flagged.liftDay?.state, "scheduled");
  assert.equal(flagged.liftDay?.liftsScheduled, 2);
  assert.match(flagged.reasons[0], /2 lifts set to run today, none confirmed turning yet/);
  assert.doesNotMatch(flagged.reasons.join(" "), /lifts open/);
  const running = dayStatus([rd("07:35", 2, 0, 9), rd("08:05", 2, 0, 9)], mt("08:10"));
  assert.equal(running.liftDay?.state, "operated");
  assert.match(running.reasons[0], /2 of 9 lifts open/);
  const late = dayStatus([rd("08:05", 0, 4, 34), rd("15:35", 0, 4, 34)], mt("16:30"));
  assert.equal(late.basis, "date");
  assert.doesNotMatch(late.reasons.join(" "), /scheduled to open today/);
});

test("day status: before the next day's first chair the previous day's count is carried and dated; two days back is not", () => {
  const night = dayStatus(VAIL_DAY, mt("05:30", "2026-11-21"));
  assert.equal(night.status, "OPEN");
  assert.equal(night.basis, "feed");
  assert.equal(night.liftDay?.carried, true);
  assert.equal(night.liftDay?.localDate, "2026-11-20");
  assert.match(night.reasons[0], /nothing yet on 2026-11-21 before first chair; lifts ran on 2026-11-20, 2 of 34 open at 15:05/);
  assert.doesNotMatch(night.reasons[0], /today/);
  // Yesterday never had a lift open: nothing carried, the dates decide.
  const dry = dayStatus([rd("08:05", 0, 4, 34), rd("12:05", 0, 0, 34)], mt("00:30", "2026-11-21"));
  assert.equal(dry.basis, "date");
});

test("day status: without attached readings the newest row is the day's only reading", () => {
  const s = deriveStatus({ hemisphere: "north", localDate: "2026-11-20", now: mt("18:45"), timeZone: DAY_ZONE, opening: seasonOn(), operator: operator({ observedAt: mt("15:35").toISOString(), liftsOpen: 0, liftsScheduled: 0, liftsTotal: 21 }) });
  // 15:35 is outside core hours: not CLOSED_TODAY (the 19:45 Central score run reads this shape).
  assert.equal(s.status, "OPEN");
  assert.equal(s.basis, "date");
});

test("statusChipDisplay: an OPEN status on a scheduled lift day reads Opens today, everything else keeps its label", () => {
  assert.deepEqual(statusChipDisplay("OPEN", "scheduled"), { label: "Opens today", variant: "opens-today" });
  assert.deepEqual(statusChipDisplay("OPEN", "operated"), { label: "Open", variant: "status" });
  assert.deepEqual(statusChipDisplay("OPEN", null), { label: "Open", variant: "status" });
  assert.deepEqual(statusChipDisplay("OPEN"), { label: "Open", variant: "status" });
  // The scheduled state never softens a status that is not OPEN.
  assert.deepEqual(statusChipDisplay("CLOSED_TODAY", "scheduled"), { label: "Closed today", variant: "status" });
  assert.deepEqual(statusChipDisplay("PRE_SEASON", "scheduled"), { label: "Pre-season", variant: "status" });
});

// ── Root causes found on 2026-11-24 (big-resort conditions check) ──

test("temperature: a fresh hourly station wins over a stale summit reading (Lake Louise: a GHCN summit 206 h old vs ECCC this hour)", () => {
  const c = buildConditions(
    input({
      measured: [
        { role: "summit", source: "ghcn", observedAt: hoursAgo(206), snowDepthIn: null, tempF: 28, windMph: null },
        { role: "base", source: "eccc", observedAt: hoursAgo(1), snowDepthIn: null, tempF: 14.4, windMph: 9 },
      ],
    }),
  );
  assert.equal(c.tempF.value, 14.4);
  assert.equal(c.tempF.source, "station:eccc");
  assert.equal(c.tempF.freshness.tier, "live");
});

test("temperature: a daily SNOTEL value stamped 23:59Z and 15 h old is not shown as the temperature now (Vail, Breckenridge)", () => {
  const c = buildConditions(input({ measured: [{ role: "base", source: "snotel", observedAt: hoursAgo(15), snowDepthIn: 4, tempF: 31, windMph: null }] }));
  assert.equal(c.tempF.value, null);
  assert.equal(c.tempF.source, "none");
});

test("temperature: among live readings the higher role still wins; with none live the youngest within 6 h is used", () => {
  const both = buildConditions(
    input({
      measured: [
        { role: "base", source: "nws", observedAt: hoursAgo(0.5), snowDepthIn: null, tempF: 20, windMph: 5 },
        { role: "summit", source: "nws", observedAt: hoursAgo(2), snowDepthIn: null, tempF: 11, windMph: 30 },
      ],
    }),
  );
  assert.equal(both.tempF.value, 11);
  const older = buildConditions(
    input({
      measured: [
        { role: "summit", source: "snotel", observedAt: hoursAgo(5), snowDepthIn: null, tempF: 9, windMph: null },
        { role: "base", source: "snotel", observedAt: hoursAgo(4), snowDepthIn: null, tempF: 17, windMph: null },
      ],
    }),
  );
  assert.equal(older.tempF.value, 17);
});

test("day status: a near-full lift count before a projected opening is not believed (Beaver Creek, 25 of 25 on 2026-11-23, opening 2026-11-25)", () => {
  const bc = [rd("14:05", 24, 0, 25, "2026-11-23"), rd("15:05", 25, 0, 25, "2026-11-23")];
  const s = dayStatus(bc, mt("15:10", "2026-11-23"), opening({ projected_open: "2026-11-25" }));
  assert.notEqual(s.status, "OPEN");
  assert.equal(s.basis, "date");
  assert.match(s.reasons.join(" "), /25 of 25 lifts open at 15:05 resort time while the opening date is still ahead/);
  // A partial early opening (a few lifts) is still believed.
  const early = dayStatus([rd("10:05", 3, 0, 25, "2026-11-23")], mt("10:10", "2026-11-23"), opening({ projected_open: "2026-11-25" }));
  assert.equal(early.status, "OPEN");
  // Once the season is confirmed open, a full count is just a good day.
  const inSeason = dayStatus(bc, mt("15:10", "2026-11-23"), opening({ confirmed_open: "2026-11-14" }));
  assert.equal(inSeason.status, "OPEN");
});

test("base depth: a model 0 in at an open resort is not shown (Killington, Whistler, Lake Louise on 2026-11-24)", () => {
  const c = buildConditions(input({ hasStation: false, report: { ...input().report!, source: "open_meteo", base_depth: 0 } }));
  assert.equal(c.status.value, "OPEN");
  assert.equal(c.baseDepthIn.value, null);
  assert.equal(c.baseDepthIn.source, "none");
  assert.ok(c.reasons.some((r) => /valley-level snowpack, not the resort's base/.test(r)));
  // A non-zero model value is kept and labelled an estimate, never "measured".
  const est = buildConditions(input({ hasStation: false, report: { ...input().report!, source: "open_meteo", base_depth: 20 } }));
  assert.equal(est.baseDepthIn.value, 20);
  assert.equal(baseDepthLabel(est.baseDepthIn.source), "Base depth (model estimate)");
  assert.equal(baseDepthLabel("snotel"), "Base depth (measured)");
});

// ── Feed-detected openings (lib/feed-opening.ts, migration 037) ──

test("day status: the morning after a feed-detected opening reads OPEN, not UNKNOWN (Big Sky, 8 lifts scheduled at 07:05 MT on 2026-11-26)", () => {
  const D = "2026-11-26";
  const morning = [rd("06:05", 0, 8, 40, D), rd("06:35", 0, 8, 40, D), rd("07:05", 0, 8, 40, D)];
  const projectedOnly = opening({ projected_open: "2026-11-25" });
  // Before: the projection has passed, the feed only lists lifts as scheduled → UNKNOWN.
  assert.equal(dayStatus(morning, mt("07:10", D), projectedOnly).status, "UNKNOWN");
  // After: the feed's own Nov 25 lift day is on file → the scheduled lifts open the day.
  const s = dayStatus(morning, mt("07:10", D), opening({ projected_open: "2026-11-25", feed_open: "2026-11-25" }));
  assert.equal(s.status, "OPEN");
  assert.equal(s.basis, "feed");
});

test("day status: a 0/0 gap after first chair falls to the feed opening (Alta, 0 of 5 at 08:35 MT on 2026-11-26)", () => {
  const D = "2026-11-26";
  const gap = [rd("06:05", 0, 0, 5, D), rd("08:05", 0, 0, 5, D), rd("08:35", 0, 0, 5, D)];
  assert.equal(dayStatus(gap, mt("08:40", D), opening({ projected_open: "2026-11-25" })).status, "UNKNOWN");
  const s = dayStatus(gap, mt("08:40", D), opening({ projected_open: "2026-11-25", feed_open: "2026-11-25" }));
  assert.equal(s.status, "OPEN");
  assert.equal(s.basis, "date");
  assert.match(s.reasons.join(" "), /operator lift feed showed lifts running on 2026-11-25/);
});

test("day status: a closed core-hours reading after a feed opening is CLOSED_TODAY, not UNKNOWN", () => {
  const D = "2026-12-02";
  const closed = [rd("10:35", 0, 0, 15, D)];
  const s = dayStatus(closed, mt("10:40", D), opening({ projected_open: "2026-11-25", feed_open: "2026-11-25" }));
  assert.equal(s.status, "CLOSED_TODAY");
});

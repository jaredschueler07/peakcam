import { test } from "node:test";
import assert from "node:assert/strict";
import type { Cam, OperatorStatusRow, ResortStationJoined, ResortWithData, SnowReport } from "@/lib/types";
import type { ResortOpening } from "@/lib/openings";
import { ResortConditionsSchema } from "./schema";
import { buildResortConditions, operatorReportFromRow, serializeConditions } from "./conditions";
import { buildJsonSchemas, schemaUrl } from "./json-schemas";
import { buildOpenApiDocument } from "./openapi";
import { conditionsStatusSentence } from "@/lib/quotable";

// P6: the conditions envelope for every kind of resort in the catalogue —
// SNOTEL-fed and open, model-fed and off season, pre-season with a
// confirmed date, projected only, no report at all — must validate against
// its own schema, and no resort may read OPEN without an operator feed or a
// confirmed opening-date source. No env, no network.

const NOW = new Date("2026-12-20T18:00:00Z"); // 11:00 Mountain, 10:00 Pacific
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

function report(over: Partial<SnowReport> = {}): SnowReport {
  return {
    id: "sr", resort_id: "r", base_depth: 42, new_snow_24h: 6, new_snow_48h: 11, trails_open: null, trails_total: null, lifts_open: null, lifts_total: null,
    conditions: "Powder Day,Bluebird||Cold and clear behind the front.", source: "snotel", updated_at: hoursAgo(5), swe_in: 9.5, pct_of_normal: 118, trend_7d: "rising", outlook: "more_snow", auto_cond_rating: "great", snowing_now: false,
    ...over,
  };
}

function cam(over: Partial<Cam> = {}): Cam {
  return {
    id: "cam-1", resort_id: "r", name: "Summit", elevation: null, embed_type: "image", embed_url: "https://cams.example.com/a.jpg", youtube_id: null,
    is_active: true, consecutive_failures: 0, auto_disabled: false, last_checked_at: hoursAgo(1), created_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

function resort(slug: string, name: string, over: Partial<ResortWithData> = {}): ResortWithData {
  return {
    id: `id-${slug}`, name, slug, state: "CO", country: "US", region: "Colorado Rockies", lat: 39.5, lng: -106.1, website_url: null, cam_page_url: null, cond_rating: "good",
    snotel_station_id: "842:CO:SNTL", x_url: null, facebook_url: null, instagram_url: null, is_active: true, created_at: "2026-01-01T00:00:00Z", snow_report: report(), cams: [cam()],
    lifts_total: 11, runs_total: 119,
    ...over,
  };
}

function opening(resortId: string, over: Partial<ResortOpening> = {}): ResortOpening {
  return { id: `o-${resortId}`, resort_id: resortId, season: "2026-27", projected_open: null, confirmed_open: null, closing_date: null, source_url: "https://example.com/opening", notes: null, updated_at: "2026-10-01T00:00:00Z", ...over };
}

function operatorRow(resortId: string, over: Partial<OperatorStatusRow> = {}): OperatorStatusRow {
  return {
    resort_id: resortId, id: `os-${resortId}`, source: "liftie", source_id: "alta", observed_at: hoursAgo(1), fetched_at: hoursAgo(1),
    lifts_open: 7, lifts_hold: 1, lifts_scheduled: 0, lifts_closed: 3, lifts_total: 11, trails_open: null, trails_total: null, base_depth_in: null, surface: null, opening_date: null,
    source_url: "https://www.alta.com/lift-terrain-status", verified: false,
    ...over,
  };
}

const STATIONS: ResortStationJoined[] = [
  { role: "summit", distance_km: 2.3, rank: 1, station: { id: "st-amb", source: "nws", source_id: "AMB", name: "ALTA - MT BALDY", lat: 40.57, lng: -111.64, elevation_ft: 11066, kind: "nws_obs" }, latest: { station_id: "st-amb", observed_at: hoursAgo(1), snow_depth_in: null, swe_in: null, new_snow_in: null, temp_f: 12.2, wind_mph: 31, source_payload: null } },
  { role: "base", distance_km: 0.3, rank: 2, station: { id: "st-atwater", source: "snotel", source_id: "1308:UT:SNTL", name: "Atwater", lat: 40.59, lng: -111.64, elevation_ft: 8750, kind: "snotel" }, latest: { station_id: "st-atwater", observed_at: hoursAgo(18), snow_depth_in: 61, swe_in: 14.2, new_snow_in: 11, temp_f: 18, wind_mph: null, source_payload: null } },
];

// The fixture catalogue: one resort per situation the contract must handle.
const ALTA = resort("alta", "Alta Ski Area", { state: "UT", lat: 40.59, lng: -111.64, snotel_station_id: "766:UT:SNTL", snow_report: report({ base_depth: 60, swe_in: 14 }) });
const BRECK = resort("breckenridge", "Breckenridge"); // confirmed date passed, no operator feed
const VAIL = resort("vail", "Vail Mountain"); // confirmed date ahead
const KEYSTONE = resort("keystone", "Keystone Resort", { snow_report: report({ updated_at: hoursAgo(72) }) }); // projected date passed, stale report
const PORTILLO = resort("ski-portillo", "Ski Portillo", { state: "Chile", country: "CL", lat: -32.84, lng: -70.13, snotel_station_id: null, lifts_total: 14, runs_total: 35, snow_report: report({ source: "open_meteo", base_depth: 20, new_snow_24h: 3, swe_in: null, pct_of_normal: null, auto_cond_rating: "fair", conditions: "Standard Conditions||Quiet." }) });
const BIG_SKY = resort("big-sky", "Big Sky", { state: "MT", lat: 45.28, lng: -111.4, snow_report: null, cams: [], lifts_total: null, runs_total: null }); // nothing at all
const LOVELAND = resort("loveland", "Loveland Ski Area", { snow_report: report({ auto_cond_rating: "poor", conditions: "Icy||Firm." }) }); // open per operator, poor rating

const OPENINGS: Record<string, ResortOpening> = {
  "id-alta": opening("id-alta", { projected_open: "2026-11-20" }),
  "id-breckenridge": opening("id-breckenridge", { confirmed_open: "2026-11-07" }),
  "id-vail": opening("id-vail", { confirmed_open: "2026-12-26" }),
  "id-keystone": opening("id-keystone", { projected_open: "2026-11-15" }),
  "id-ski-portillo": opening("id-ski-portillo", { season: "2026", closing_date: "2026-10-05" }),
  "id-loveland": opening("id-loveland", { confirmed_open: "2026-10-30" }),
};

const OPERATORS: Record<string, OperatorStatusRow> = {
  "id-alta": operatorRow("id-alta"),
  "id-loveland": operatorRow("id-loveland", { source_id: "loveland", lifts_open: 4, lifts_total: 9, lifts_closed: 5, lifts_hold: 0 }),
  // Stale feed from two days ago: must not decide the status.
  "id-keystone": operatorRow("id-keystone", { source_id: "keystone", observed_at: hoursAgo(50), lifts_open: 5 }),
};

const CATALOGUE = [ALTA, BRECK, VAIL, KEYSTONE, PORTILLO, BIG_SKY, LOVELAND];

function envelopeFor(r: ResortWithData) {
  return serializeConditions(r, {
    now: NOW,
    opening: OPENINGS[r.id] ?? null,
    operator: OPERATORS[r.id] ?? null,
    observationStations: r.slug === "alta" ? STATIONS : [],
    forecast: r.slug === "alta" ? { runs: [{ id: "run-1", point: "summit", model: "gfs_seamless", issuedAt: hoursAgo(2), horizonDays: 14, daily: [{ date: "2026-12-20", snowfallCm: 4, tempMaxC: -5, tempMinC: -12, precipProb: 80, windGustKmh: 40, weatherCode: 73 }, { date: "2026-12-21", snowfallCm: 8.5, tempMaxC: -6, tempMinC: -14, precipProb: 90, windGustKmh: 50, weatherCode: 75 }] }] } : null,
  });
}

test("every fixture resort's envelope validates against ResortConditions, carries the schema URL and a tier per field", () => {
  for (const r of CATALOGUE) {
    const doc = envelopeFor(r);
    assert.doesNotThrow(() => ResortConditionsSchema.parse(doc), `${r.slug} validates`);
    assert.equal(doc.schemaVersion, "1.0.0");
    assert.equal(doc.schemaUrl, "https://www.peakcam.io/.well-known/schemas/resort-conditions-v1.json");
    assert.equal(doc.schemaUrl, schemaUrl("ResortConditions"));
    assert.equal(doc.meta.resolvedAt, NOW.toISOString());
    assert.equal(Object.keys(doc.meta.freshness).length, 18, `${r.slug} has a tier per field`);
    assert.ok(doc.sentence.length > 20, `${r.slug} has a sentence`);
    assert.equal(doc.canonicalUrl, `https://www.peakcam.io/resorts/${r.slug}`);
  }
  assert.ok("resort-conditions-v1" in buildJsonSchemas());
  const api = buildOpenApiDocument() as { paths: Record<string, unknown> };
  assert.ok("/resorts/{slug}/conditions" in api.paths);
});

test("no resort reads OPEN without an operator feed or a confirmed opening-date source, and each situation lands on its status", () => {
  const by = Object.fromEntries(CATALOGUE.map((r) => [r.slug, envelopeFor(r).data]));
  for (const [slug, data] of Object.entries(by)) {
    if (data.status.value === "OPEN") assert.equal(data.status.source, "operator", `${slug} is OPEN on ${data.status.source}`);
  }
  assert.equal(by.alta.status.value, "OPEN"); // fresh Liftie feed; the projection alone would not do it
  assert.equal(by.breckenridge.status.value, "OPEN"); // confirmed date passed
  assert.equal(by.vail.status.value, "PRE_SEASON");
  assert.equal(by.keystone.status.value, "UNKNOWN"); // projection passed, feed stale
  assert.match(by.keystone.reasons[0], /operator feed is stale/);
  assert.equal(by["ski-portillo"].status.value, "OFF_SEASON");
  assert.equal(by["big-sky"].status.value, "UNKNOWN");
  assert.equal(by.loveland.status.value, "OPEN");
  assert.equal(by.loveland.recommendableToday, false);
  assert.ok(by.loveland.reasons.includes("PeakCam rating is poor"));
});

test("Alta: operator lifts, station temperature and wind, the blended 48-hour forecast and the measured base all carry their sources and tiers", () => {
  const doc = envelopeFor(ALTA);
  const d = doc.data;
  assert.equal(d.liftsOpen.value, 7);
  assert.equal(d.liftsOpen.source, "operator");
  assert.equal(d.liftsOpen.freshness.tier, "live");
  assert.equal(d.liftsOpen.observedAt, hoursAgo(1));
  assert.equal(d.liftsTotal.value, 11);
  assert.equal(d.liftsTotal.source, "operator");
  assert.equal(d.runsTotal.value, 119);
  assert.equal(d.runsTotal.source, "profile");
  assert.equal(d.baseDepthIn.value, 60);
  assert.equal(d.baseDepthIn.source, "snotel");
  assert.equal(d.baseDepthIn.freshness.tier, "recent");
  assert.equal(d.baseDepthIn.freshness.ageHours, 5);
  assert.equal(d.percentOfNormal.value, 118);
  assert.equal(d.tempF.value, 12.2);
  assert.equal(d.tempF.source, "station:nws");
  assert.equal(d.windMph.value, 31);
  assert.equal(d.forecastNext48hCm.value, 12.5);
  assert.equal(d.forecastNext48hCm.source, "model");
  assert.equal(d.forecastNext48hCm.freshness.tier, "estimated");
  assert.equal(d.snowQuality.value, "powder");
  assert.equal(d.seasonOpening.value, "2026-11-20");
  assert.equal(d.seasonOpening.source, "profile");
  assert.equal(d.recommendableToday, true);
  assert.deepEqual(doc.meta.sources, ["snotel", "station:nws", "operator", "derived", "model", "profile"]);
  assert.equal(doc.meta.freshness.liftsOpen, "live");
  assert.equal(doc.meta.freshness.runsOpen, "unknown");
  assert.equal(doc.meta.timeZone, "America/Denver");
  assert.equal(doc.meta.localDate, "2026-12-20");
  assert.equal(doc.meta.newestObservationAt, hoursAgo(1));
  assert.equal(doc.measuredNow.length, 2);
  assert.match(doc.sentence, /^As of 10:00 a\.m\. MT Dec 20, Alta Ski Area is open: 7 of 11 lifts open \(operator feed, 1 h old\); base 60 in\. \(SNOTEL, 5 h old\), 6 in\. of new snow in 24 h \(SNOTEL\)\.$/);
});

test("Portillo: model-estimated fields, the resort's own day in Santiago, and the off-season sentence", () => {
  const doc = envelopeFor(PORTILLO);
  assert.equal(doc.meta.timeZone, "America/Santiago");
  assert.equal(doc.data.baseDepthIn.source, "model");
  assert.equal(doc.data.baseDepthIn.freshness.tier, "estimated");
  assert.equal(doc.data.liftsTotal.source, "profile");
  assert.equal(doc.data.liftsOpen.source, "none");
  assert.equal(doc.data.percentOfNormal.source, "none");
  assert.equal(doc.data.snowQuality.source, "none");
  assert.deepEqual(doc.meta.sources, ["operator", "model", "profile"]);
  assert.match(doc.sentence, /^As of Dec 20, Ski Portillo is closed for the season: closed Oct 5; base 20 in\. \(model estimate, 5 h old\), 3 in\. of new snow in 24 h \(model estimate\)\.$/);
  assert.equal(doc.meta.freshness.status, "recent");
});

test("Big Sky with nothing on file is UNKNOWN everywhere and still validates", () => {
  const doc = envelopeFor(BIG_SKY);
  assert.equal(doc.data.status.value, "UNKNOWN");
  assert.equal(doc.meta.newestObservationAt, null);
  assert.deepEqual(doc.meta.sources, []);
  assert.equal(doc.sentence, "As of Dec 20, Big Sky has no confirmed operating status.");
  assert.doesNotThrow(() => ResortConditionsSchema.parse(doc));
});

test("operatorReportFromRow normalises numeric strings and nulls; buildResortConditions exposes a depth disagreement when the operator's base is far off", () => {
  const row = operatorRow("id-alta", { lifts_open: "6" as unknown as number, base_depth_in: "95.0" as unknown as number });
  const rep = operatorReportFromRow(row)!;
  assert.equal(rep.liftsOpen, 6);
  assert.equal(rep.baseDepthIn, 95);
  assert.equal(operatorReportFromRow(null), null);
  const { contract } = buildResortConditions(ALTA, { now: NOW, opening: OPENINGS["id-alta"], operator: row, observationStations: [] });
  assert.equal(contract.baseDepthIn.value, 60);
  assert.equal(contract.operatorBaseDepthIn.value, 95);
  assert.ok(contract.depthDisagreement);
  assert.equal(contract.depthDisagreement!.differencePct, 37);
  const s = conditionsStatusSentence(ALTA.name, contract, "2026-12-20");
  assert.match(s.text, /base 60 in\. \(SNOTEL, 5 h old\), the operator reports 95 in\./);
});

test("pre-season and closed-today sentences name the date or the lift count", () => {
  const vail = envelopeFor(VAIL);
  // Dated by the resort's own day, not by the opening row's update time.
  assert.equal(vail.sentence, "As of Dec 20, Vail Mountain has not opened for the season: confirmed opening Dec 26; base 42 in. (SNOTEL, 5 h old), 6 in. of new snow in 24 h (SNOTEL).");
  assert.equal(vail.data.status.observedAt, null);
  assert.equal(vail.data.status.freshness.tier, "recent");
  const closed = serializeConditions(LOVELAND, { now: NOW, opening: OPENINGS["id-loveland"], operator: operatorRow("id-loveland", { lifts_open: 0, lifts_scheduled: 0, lifts_hold: 0, lifts_closed: 9, lifts_total: 9 }), observationStations: [] });
  assert.equal(closed.data.status.value, "CLOSED_TODAY");
  assert.match(closed.sentence, /Loveland Ski Area is closed today: 0 of 9 lifts open \(operator feed, 1 h old\)/);
});

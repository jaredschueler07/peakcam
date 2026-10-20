import { test } from "node:test";
import assert from "node:assert/strict";
import type { Cam, ResortWithData, SnowReport } from "@/lib/types";
import type { ResortOpening } from "@/lib/openings";
import {
  CamListSchema,
  TimelapseListSchema,
  PowderListSchema,
  ResortListSchema,
  ResortSchema,
  ResortLightSchema,
} from "./schema";
import {
  camLive,
  clampPctOfNormal,
  conditionsTags,
  rankPowder,
  serializeCam,
  serializeCams,
  serializeResort,
  serializeResortLight,
  serializeTimelapses,
  serializeResortList,
  serializeSeason,
  toIsoInstant,
} from "./serialize";
import {
  PUBLIC_API_ATTRIBUTION,
  PUBLIC_API_LICENSE_URL,
  publicApiHeaders,
  publicError,
  publicJson,
  publicOptions,
  withPublicHeaders,
} from "./headers";
import { buildOpenApiDocument } from "./openapi";

// ── Fixtures ─────────────────────────────────────────────────

const NOW = new Date("2026-12-20T18:00:00Z"); // 10:00 Pacific, 2026-12-20

let seq = 0;

function report(over: Partial<SnowReport> = {}): SnowReport {
  return {
    id: `sr-${++seq}`,
    resort_id: "r",
    base_depth: 42,
    new_snow_24h: 6,
    new_snow_48h: 11,
    trails_open: null,
    trails_total: null,
    lifts_open: null,
    lifts_total: null,
    conditions: "powder,fresh||Expect clear skies today.",
    source: "snotel",
    updated_at: "2026-12-20 12:00:00+00",
    swe_in: 9.5,
    pct_of_normal: 118,
    trend_7d: "rising",
    outlook: "more_snow",
    auto_cond_rating: "great",
    snowing_now: false,
    ...over,
  };
}

function cam(over: Partial<Cam> = {}): Cam {
  const id = `cam-${++seq}`;
  return {
    id,
    resort_id: "r",
    name: "Summit",
    elevation: "11,000 ft",
    embed_type: "image",
    embed_url: "https://cams.example.com/summit.jpg",
    youtube_id: null,
    is_active: true,
    consecutive_failures: 0,
    auto_disabled: false,
    last_checked_at: "2026-12-20T11:00:00Z",
    created_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

function resort(over: Partial<ResortWithData> = {}): ResortWithData {
  const slug = over.slug ?? `resort-${++seq}`;
  return {
    id: over.id ?? `id-${slug}`,
    name: "Vail Mountain",
    slug,
    state: "CO",
    country: "US",
    region: "Colorado Rockies",
    lat: 39.6433,
    lng: -106.3781,
    website_url: "https://www.vail.com",
    cam_page_url: null,
    cond_rating: "good",
    snotel_station_id: "842:CO:SNTL",
    x_url: null,
    facebook_url: null,
    instagram_url: null,
    is_active: true,
    created_at: "2026-01-01T00:00:00Z",
    snow_report: report(),
    cams: [cam()],
    ...over,
  };
}

function opening(over: Partial<ResortOpening> = {}): ResortOpening {
  return {
    id: "o",
    resort_id: "r",
    season: "2026-27",
    projected_open: null,
    confirmed_open: null,
    closing_date: null,
    source_url: "https://example.com/opening",
    notes: null,
    updated_at: "2026-10-01T00:00:00Z",
    ...over,
  };
}

// ── Shapes ───────────────────────────────────────────────────

test("serializeResort output parses against the published schema", () => {
  const doc = serializeResort(resort(), { now: NOW, opening: opening({ confirmed_open: "2026-11-13" }), elevation: { baseFt: 8120 } });
  const parsed = ResortSchema.parse(doc);
  assert.equal(parsed.slug, doc.slug);
  assert.equal(parsed.canonicalUrl, `https://www.peakcam.io/resorts/${doc.slug}`);
  assert.equal(parsed.apiUrl, `https://www.peakcam.io/api/v1/resorts/${doc.slug}`);
  assert.equal(parsed.location.baseElevationFt, 8120);
  assert.equal(parsed.location.lon, -106.3781);
  assert.equal(parsed.attribution, PUBLIC_API_ATTRIBUTION);
  assert.equal(parsed.license, PUBLIC_API_LICENSE_URL);
  assert.equal(parsed.websiteUrl, "https://www.vail.com");
});

test("light row, cam list and powder list all parse", () => {
  const r = resort();
  ResortLightSchema.parse(serializeResortLight(r, { now: NOW }));
  CamListSchema.parse(serializeCams(r, { now: NOW }));
  ResortListSchema.parse(serializeResortList([r, resort({ name: "Alta" })], { now: NOW }));
  PowderListSchema.parse(rankPowder([r], {}, { now: NOW }));
});

test("a resort with no report has snow: null and an updatedAt from its cams", () => {
  const doc = serializeResort(resort({ snow_report: null }), { now: NOW });
  assert.equal(doc.snow, null);
  assert.equal(doc.updatedAt, "2026-12-20T11:00:00.000Z");
  ResortSchema.parse(doc);
});

test("a custom base URL rewrites every absolute URL", () => {
  const doc = serializeResort(resort({ slug: "alta" }), { now: NOW, baseUrl: "http://localhost:3200" });
  assert.equal(doc.canonicalUrl, "http://localhost:3200/resorts/alta");
  assert.equal(doc.apiUrl, "http://localhost:3200/api/v1/resorts/alta");
  assert.equal(doc.cams[0].pageUrl, "http://localhost:3200/resorts/alta");
});

// ── Provenance per field ─────────────────────────────────────

test("every snow field carries the report's source, instant and (for SNOTEL) the station", () => {
  const doc = serializeResort(resort(), { now: NOW });
  const snow = doc.snow!;
  for (const key of ["baseDepth", "newSnow24h", "newSnow48h", "swe", "pctOfNormal"] as const) {
    assert.equal(snow[key].source, "snotel", key);
    assert.equal(snow[key].measuredAt, "2026-12-20T12:00:00.000Z", key);
    assert.deepEqual(snow[key].station, { id: "842:CO:SNTL", name: "Vail Mountain", elevationFt: 10290 }, key);
  }
  assert.equal(snow.baseDepth.unit, "in");
  assert.equal(snow.pctOfNormal.unit, "percent");
  assert.equal(snow.trend7d.value, "rising");
  assert.equal(snow.trend7d.station?.id, "842:CO:SNTL");
  assert.equal(snow.source, "snotel");
  assert.equal(snow.reportedAt, "2026-12-20T12:00:00.000Z");
});

test("a model-estimate resort says open_meteo on every field and names no station", () => {
  const r = resort({ snotel_station_id: null, snow_report: report({ source: "open_meteo", pct_of_normal: null }) });
  const snow = serializeResort(r, { now: NOW }).snow!;
  for (const key of ["baseDepth", "newSnow24h", "newSnow48h", "swe", "pctOfNormal"] as const) {
    assert.equal(snow[key].source, "open_meteo", key);
    assert.equal("station" in snow[key], false, key);
  }
  assert.equal(snow.trend7d.station, undefined);
});

test("an unknown station id still gets an id with null name/elevation", () => {
  const snow = serializeResort(resort({ snotel_station_id: "999:ZZ:SNTL" }), { now: NOW }).snow!;
  assert.deepEqual(snow.baseDepth.station, { id: "999:ZZ:SNTL", name: null, elevationFt: null });
});

test("tags and narrative are split out of the overloaded conditions string", () => {
  const snow = serializeResort(resort(), { now: NOW }).snow!;
  assert.deepEqual(snow.tags, ["powder", "fresh"]);
  assert.equal(snow.narrative, "Expect clear skies today.");
  assert.deepEqual(conditionsTags("powder, groomed"), ["powder", "groomed"]);
  assert.deepEqual(conditionsTags(null), []);
  assert.equal(serializeResort(resort({ snow_report: report({ conditions: "powder" }) }), { now: NOW }).snow!.narrative, null);
});

test("rating prefers the engine's auto rating and falls back to the resort column", () => {
  assert.equal(serializeResort(resort(), { now: NOW }).snow!.rating, "great");
  assert.equal(serializeResort(resort({ snow_report: report({ auto_cond_rating: null }) }), { now: NOW }).snow!.rating, "good");
});

test("timestamps are normalised to ISO-8601 UTC", () => {
  assert.equal(toIsoInstant("2026-12-20 12:00:00+00"), "2026-12-20T12:00:00.000Z");
  assert.equal(toIsoInstant("2026-12-20T05:00:00-07:00"), "2026-12-20T12:00:00.000Z");
  assert.equal(toIsoInstant("not a date"), null);
  assert.equal(toIsoInstant(null), null);
});

// ── Percent of normal ────────────────────────────────────────

test("pctOfNormal is clamped to the 10–300 band and suppressed under 2 in of SWE or without a station", () => {
  assert.equal(clampPctOfNormal(118, 9.5, true), 118);
  assert.equal(clampPctOfNormal(10, 9.5, true), 10);
  assert.equal(clampPctOfNormal(300, 9.5, true), 300);
  assert.equal(clampPctOfNormal(9, 9.5, true), null);
  assert.equal(clampPctOfNormal(301, 9.5, true), null);
  assert.equal(clampPctOfNormal(118, 1.9, true), null);
  assert.equal(clampPctOfNormal(118, null, true), null);
  assert.equal(clampPctOfNormal(118, 9.5, false), null);
  assert.equal(clampPctOfNormal(null, 9.5, true), null);

  const early = serializeResort(resort({ snow_report: report({ pct_of_normal: 450, swe_in: 0.4 }) }), { now: NOW }).snow!;
  assert.equal(early.pctOfNormal.value, null);
  assert.equal(early.pctOfNormal.source, "snotel", "provenance survives suppression");
});

// ── Cams ─────────────────────────────────────────────────────

test("live derives from the health columns and is null until the first check", () => {
  assert.equal(camLive({ auto_disabled: false, consecutive_failures: 0, last_checked_at: null }), null);
  assert.equal(camLive({ auto_disabled: false, consecutive_failures: 0, last_checked_at: "2026-12-20T11:00:00Z" }), true);
  assert.equal(camLive({ auto_disabled: false, consecutive_failures: 2, last_checked_at: "2026-12-20T11:00:00Z" }), false);
  assert.equal(camLive({ auto_disabled: true, consecutive_failures: 0, last_checked_at: null }), false);
});

test("provider stills carry no capturedAt; PeakCam captures carry still_captured_at", () => {
  const r = resort({ slug: "vail" });
  const provider = serializeCam(cam(), r);
  assert.equal(provider.stillUrl, "https://cams.example.com/summit.jpg");
  assert.equal(provider.capturedAt, null);
  assert.equal(provider.embedType, "image");
  assert.equal(provider.pageUrl, "https://www.peakcam.io/resorts/vail");
  assert.equal(provider.sourceUrl, "https://cams.example.com/summit.jpg");

  const yt = serializeCam(cam({ embed_type: "youtube", embed_url: null, youtube_id: "dQw4w9WgXcQ" }), r);
  assert.equal(yt.stillUrl, "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
  assert.equal(yt.capturedAt, null);
  assert.equal(yt.sourceUrl, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");

  const captured = serializeCam(
    cam({
      embed_type: "iframe",
      embed_url: "https://player.example.com/embed/abc",
      still_url: "https://owsx.supabase.co/storage/v1/object/public/cam-stills/abc.jpg",
      still_captured_at: "2026-12-20 10:30:00+00",
      still_source: "hls",
    }),
    r,
  );
  assert.equal(captured.stillUrl, "https://owsx.supabase.co/storage/v1/object/public/cam-stills/abc.jpg");
  assert.equal(captured.capturedAt, "2026-12-20T10:30:00.000Z");

  const player = serializeCam(cam({ embed_type: "iframe", embed_url: "https://player.example.com/embed/abc" }), r);
  assert.equal(player.stillUrl, null);
  assert.equal(player.capturedAt, null);
});

test("inactive cams are omitted; names resolve like the site does", () => {
  const r = resort({ cams: [cam({ name: "  Peak 8 " }), cam({ is_active: false }), cam({ name: "", embed_url: "https://cams.example.com/CP/base_lodge.png" })] });
  const list = serializeCams(r, { now: NOW });
  assert.equal(list.cams.length, 2);
  assert.deepEqual(list.cams.map((c) => c.name), ["Peak 8", "base lodge"]);
  assert.equal(list.updatedAt, "2026-12-20T11:00:00.000Z");
});

// ── Season ───────────────────────────────────────────────────

test("season status collapses the openings helper to open / closed / unknown", () => {
  const north = resort();
  assert.equal(serializeSeason(north, { now: NOW, opening: null }).status, "unknown");
  assert.equal(serializeSeason(north, { now: NOW, opening: opening({ projected_open: "2026-11-20" }) }).status, "unknown");
  assert.equal(serializeSeason(north, { now: NOW, opening: opening({ confirmed_open: "2026-12-25" }) }).status, "closed");
  assert.equal(serializeSeason(north, { now: NOW, opening: opening({ confirmed_open: "2026-11-13" }) }).status, "open");

  const confirmed = serializeSeason(north, { now: NOW, opening: opening({ confirmed_open: "2026-11-13", projected_open: "2026-11-10" }) });
  assert.equal(confirmed.openDate, "2026-11-13");
  assert.equal(confirmed.openDateKind, "confirmed");
  assert.equal(confirmed.seasonLabel, "2026-27");
  assert.equal(confirmed.hemisphere, "north");
  assert.equal(confirmed.asOf, "2026-12-20");
  assert.equal(confirmed.source, "resort_openings");
  assert.equal(confirmed.sourceUrl, "https://example.com/opening");

  const projected = serializeSeason(north, { now: NOW, opening: opening({ projected_open: "2026-11-20" }) });
  assert.equal(projected.openDate, "2026-11-20");
  assert.equal(projected.openDateKind, "projected");

  const south = resort({ lat: -32.8, state: "Chile", country: "CL" });
  const andes = serializeSeason(south, { now: NOW, opening: opening({ season: "2026", closing_date: "2026-10-05" }) });
  assert.equal(andes.status, "closed");
  assert.equal(andes.hemisphere, "south");
  assert.equal(andes.closingDate, "2026-10-05");
  assert.equal(serializeSeason(south, { now: new Date("2026-08-01T18:00:00Z"), opening: opening({ closing_date: "2026-10-05" }) }).status, "open");
});

test("the day is read in US Pacific, so a resort does not read open before its own midnight", () => {
  // 03:00 UTC on Nov 13 is still Nov 12 in Pacific — a Nov 13 confirmed date is not open yet.
  const s = serializeSeason(resort(), { now: new Date("2026-11-13T03:00:00Z"), opening: opening({ confirmed_open: "2026-11-13" }) });
  assert.equal(s.asOf, "2026-11-12");
  assert.equal(s.status, "closed");
});

// ── List ─────────────────────────────────────────────────────

test("the light list is alphabetical, counts cams and threads the opening rows by id", () => {
  const a = resort({ id: "a", name: "Alta", slug: "alta", cams: [cam(), cam({ consecutive_failures: 3 }), cam({ last_checked_at: null })] });
  const b = resort({ id: "b", name: "Breckenridge", slug: "breckenridge", snow_report: null });
  const openings = new Map([["a", opening({ resort_id: "a", confirmed_open: "2026-11-20" })]]);
  const list = serializeResortList([b, a], { now: NOW, openings });
  assert.equal(list.count, 2);
  assert.deepEqual(list.resorts.map((r) => r.slug), ["alta", "breckenridge"]);
  assert.equal(list.resorts[0].seasonStatus, "open");
  assert.equal(list.resorts[1].seasonStatus, "unknown");
  assert.equal(list.resorts[0].camCount, 3);
  assert.equal(list.resorts[0].liveCamCount, 1);
  assert.deepEqual(list.resorts[0].snow, {
    baseDepth: 42,
    newSnow24h: 6,
    newSnow48h: 11,
    unit: "in",
    source: "snotel",
    measuredAt: "2026-12-20T12:00:00.000Z",
  });
  assert.equal(list.resorts[1].snow, null);
  assert.equal(list.generatedAt, NOW.toISOString());
});

// ── Powder ───────────────────────────────────────────────────

function powderSet(): ResortWithData[] {
  return [
    resort({ name: "Alta", slug: "alta", state: "UT", snow_report: report({ new_snow_24h: 10, new_snow_48h: 14 }) }),
    resort({ name: "Vail", slug: "vail", state: "CO", snow_report: report({ new_snow_24h: 6, new_snow_48h: 20 }) }),
    resort({ name: "Breck", slug: "breck", state: "co", snow_report: report({ new_snow_24h: 6, new_snow_48h: 9 }) }),
    resort({ name: "Whistler", slug: "whistler", state: "BC", country: "CA", snotel_station_id: null, snow_report: report({ source: "open_meteo", new_snow_24h: 12, new_snow_48h: 15 }) }),
    resort({ name: "Nowhere", slug: "nowhere", state: "CO", snow_report: report({ new_snow_24h: null, new_snow_48h: 30 }) }),
    resort({ name: "Silent", slug: "silent", state: "CO", snow_report: null }),
  ];
}

test("powder ranks by 24 h then 48 h, drops unknowns, numbers ranks from 1", () => {
  const out = rankPowder(powderSet(), {}, { now: NOW });
  assert.equal(out.window, "24h");
  assert.deepEqual(out.results.map((r) => r.slug), ["whistler", "alta", "vail", "breck"]);
  assert.deepEqual(out.results.map((r) => r.rank), [1, 2, 3, 4]);
  assert.equal(out.count, 4);
  assert.equal(out.results[0].newSnow24h.source, "open_meteo");
  assert.equal(out.results[1].newSnow24h.station?.id, "842:CO:SNTL");
  assert.deepEqual(out.filters, { state: null, minInches: null, source: null });
});

test("powder filters: source=snotel, state (case-insensitive), minInches, window=48h, limit", () => {
  const set = powderSet();
  assert.deepEqual(rankPowder(set, { source: "snotel" }, { now: NOW }).results.map((r) => r.slug), ["alta", "vail", "breck"]);
  assert.deepEqual(rankPowder(set, { state: "co" }, { now: NOW }).results.map((r) => r.slug), ["vail", "breck"]);
  assert.deepEqual(rankPowder(set, { minInches: 8 }, { now: NOW }).results.map((r) => r.slug), ["whistler", "alta"]);
  assert.deepEqual(rankPowder(set, { window: "48h" }, { now: NOW }).results.map((r) => r.slug), ["nowhere", "vail", "whistler", "alta", "breck"]);
  assert.deepEqual(rankPowder(set, { limit: 2 }, { now: NOW }).results.map((r) => r.slug), ["whistler", "alta"]);
  const filtered = rankPowder(set, { state: " CO ", minInches: 6, source: "snotel" }, { now: NOW });
  assert.deepEqual(filtered.filters, { state: "CO", minInches: 6, source: "snotel" });
});

// ── Headers ──────────────────────────────────────────────────

test("the shared header set is complete and CORS-open", () => {
  const h = publicApiHeaders();
  assert.equal(h["Access-Control-Allow-Origin"], "*");
  assert.equal(h["Access-Control-Expose-Headers"], "Link, X-Attribution");
  assert.equal(h["X-Attribution"], PUBLIC_API_ATTRIBUTION);
  assert.equal(h["Cache-Control"], "public, s-maxage=900, stale-while-revalidate=3600");
  assert.equal(h.Vary, "Accept");
  assert.equal(h.Link, '<https://www.peakcam.io>; rel="author", <https://www.peakcam.io/about#terms>; rel="license"');
  assert.equal(h["Content-Type"], "application/json; charset=utf-8");
});

test("publicJson / publicError / publicOptions / withPublicHeaders", async () => {
  const ok = publicJson({ a: 1 });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("X-Attribution"), PUBLIC_API_ATTRIBUTION);
  assert.deepEqual(await ok.json(), { a: 1 });

  const err = publicError(404, "resort_not_found", "nope");
  assert.equal(err.status, 404);
  assert.equal(err.headers.get("Cache-Control"), "no-store");
  assert.equal(err.headers.get("Access-Control-Allow-Origin"), "*");
  assert.deepEqual(await err.json(), { error: "resort_not_found", detail: "nope", status: 404 });

  const pre = publicOptions();
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get("Access-Control-Allow-Methods"), "GET, OPTIONS");

  const wrapped = withPublicHeaders(Response.json({ b: 2 }), { extraLinks: ['<https://x>; rel="x"'] });
  assert.match(wrapped.headers.get("Link")!, /rel="license", <https:\/\/x>; rel="x"$/);
  assert.equal(wrapped.headers.get("X-Attribution"), PUBLIC_API_ATTRIBUTION);
});

// ── OpenAPI ──────────────────────────────────────────────────

test("the OpenAPI document references only schemas it defines", () => {
  const doc = buildOpenApiDocument() as { openapi: string; paths: Record<string, unknown>; components: { schemas: Record<string, Record<string, unknown>> } };
  assert.equal(doc.openapi, "3.1.0");
  assert.deepEqual(Object.keys(doc.paths), ["/resorts", "/snow-report", "/resorts/{slug}/score-components", "/resorts/{slug}", "/resorts/{slug}/cams", "/resorts/{slug}/conditions", "/resorts/{slug}/timelapses", "/resorts/{slug}/forecast", "/resorts/{slug}/forecast-accuracy", "/resorts/search-index", "/powder", "/status", "/ask", "/resorts/{slug}/history", "/resorts/{slug}/season-stats", "/resorts/{slug}/monthly", "/leaderboards/{kind}", "/batch"]);
  const ids = new Set(Object.keys(doc.components.schemas));
  for (const id of ["Resort", "ResortList", "CamList", "PowderList", "Measurement", "Station", "Season", "Cam", "Error", "SearchIndex", "Status", "AskAnswer", "BatchRequest", "BatchResponse", "Forecast", "ForecastAccuracy", "ForecastSummary", "ForecastScore", "ResortConditions", "ConditionsContract", "ResortStatus", "ResortScore", "ScoreComponent", "ScoreComponents", "ScoreLight", "ResortScoreHistory", "SnowReportList"]) {
    assert.ok(ids.has(id), `missing component ${id}`);
  }
  for (const schema of Object.values(doc.components.schemas)) {
    assert.equal("$schema" in schema, false);
    assert.equal("$id" in schema, false);
  }
  const refs = JSON.stringify(doc).match(/"\$ref":"([^"]+)"/g) ?? [];
  assert.ok(refs.length > 10);
  for (const r of refs) {
    const target = r.slice('"$ref":"#/components/schemas/'.length, -1);
    assert.ok(r.startsWith('"$ref":"#/components/schemas/'), r);
    assert.ok(ids.has(target), `dangling $ref ${target}`);
  }
});

// ── Parity data model (migrations 025–028) ───────────────────

test("profile is always present; null / empty until the row carries migration-025 values", () => {
  const bare = serializeResort(resort(), { now: NOW });
  assert.deepEqual(bare.profile, {
    runsTotal: null,
    liftsTotal: null,
    skiableAcres: null,
    verticalFt: null,
    annualSnowfallIn: null,
    longestRunMi: null,
    description: null,
    descriptionSource: null,
    trailMapUrl: null,
    wikidataId: null,
    aliases: [],
    passes: [],
  });
  assert.equal(bare.location.summitElevationFt, null);
  ResortSchema.parse(bare);

  const full = serializeResort(
    resort({
      runs_total: 195,
      lifts_total: 31,
      skiable_acres: 5317,
      vertical_ft: 3450,
      annual_snowfall_in: 354,
      longest_run_mi: 4,
      description: "Back Bowls and all.",
      description_source: "editor",
      trail_map_url: "https://www.vail.com/map.pdf",
      wikidata_id: "Q1234",
      aliases: ["Vail", "Vail Resort"],
      passes: ["epic"],
      elevation_base_ft: 8120,
      elevation_summit_ft: 11570,
    }),
    { now: NOW },
  );
  assert.equal(full.profile.runsTotal, 195);
  assert.equal(full.profile.skiableAcres, 5317);
  assert.equal(full.profile.descriptionSource, "editor");
  assert.deepEqual(full.profile.aliases, ["Vail", "Vail Resort"]);
  assert.deepEqual(full.profile.passes, ["epic"]);
  assert.equal(full.location.baseElevationFt, 8120);
  assert.equal(full.location.summitElevationFt, 11570);
  ResortSchema.parse(full);
});

test("profile drops a descriptionSource without a description and unknown passes", () => {
  const doc = serializeResort(
    resort({ description: null, description_source: "operator", passes: ["epic", "season" as never] }),
    { now: NOW },
  );
  assert.equal(doc.profile.descriptionSource, null);
  assert.deepEqual(doc.profile.passes, ["epic"]);
});

test("explicit elevation option (resort_metadata) wins over the resort row; the row fills the gaps", () => {
  const row = resort({ elevation_base_ft: 8000, elevation_summit_ft: 11000 });
  const explicit = serializeResort(row, { now: NOW, elevation: { baseFt: 8120 } });
  assert.equal(explicit.location.baseElevationFt, 8120);
  assert.equal(explicit.location.summitElevationFt, 11000);
  const none = serializeResort(row, { now: NOW, elevation: null });
  assert.equal(none.location.baseElevationFt, 8000);
});

test("cam kind, credit and sourceTermsUrl are null until classified and pass through when set", () => {
  const plain = serializeCam(cam(), { slug: "vail" });
  assert.equal(plain.kind, null);
  assert.equal(plain.credit, null);
  assert.equal(plain.sourceTermsUrl, null);
  assert.ok(!("timelapses" in plain));
  const tagged = serializeCam(
    cam({ kind: "snow-stake", credit: "Courtesy Vail Resorts", source_terms_url: "https://www.vail.com/terms" }),
    { slug: "vail" },
  );
  assert.equal(tagged.kind, "snow-stake");
  assert.equal(tagged.credit, "Courtesy Vail Resorts");
  assert.equal(tagged.sourceTermsUrl, "https://www.vail.com/terms");
  CamListSchema.parse(serializeCams(resort({ cams: [cam({ kind: "approach" })] }), { now: NOW }));
});

test("the OpenAPI components carry the parity shapes and the resort document references them", () => {
  const doc = buildOpenApiDocument("https://www.peakcam.io") as {
    components: { schemas: Record<string, { properties?: Record<string, unknown>; required?: string[] }> };
  };
  const schemas = doc.components.schemas;
  for (const id of [
    "ResortProfile",
    "ObservationStation",
    "MeasuredNow",
    "ForecastRun",
    "ForecastDaily",
    "ForecastScore",
    "ScoreComponents",
    "ResortScore",
    "CamTimelapse",
    "CamKind",
  ]) {
    assert.ok(schemas[id], `components.schemas.${id}`);
  }
  const resortProps = schemas.Resort.properties!;
  assert.ok(resortProps.profile, "Resort.profile");
  assert.ok(schemas.Resort.required!.includes("profile"), "profile is required (null fields, never omitted)");
  for (const key of ["stations", "measuredNow", "forecast", "forecastScores", "score"]) {
    assert.ok(resortProps[key], `Resort.${key}`);
    assert.ok(!schemas.Resort.required!.includes(key), `${key} is optional until its block lands`);
  }
  assert.ok(schemas.Cam.required!.includes("kind"));
  assert.ok(!schemas.Cam.required!.includes("timelapses"));
});

// ── Stations (migration 026) ─────────────────────────────────

test("serializeStations: every linked station listed, measuredNow only for rows with an observation and a known network, ages from `now`", async () => {
  const { serializeStations } = await import("./serialize");
  const { MeasuredNowSchema, ObservationStationSchema } = await import("./schema");
  const now = new Date("2026-12-20T18:00:00Z");
  const rows = [
    {
      role: "base" as const,
      distance_km: 0.3,
      rank: 2,
      station: { id: "st-1", source: "snotel", source_id: "1308:UT:SNTL", name: "Atwater", lat: 40.59, lng: -111.64, elevation_ft: 8750, kind: "snotel" as const },
      latest: { station_id: "st-1", observed_at: "2026-12-19T23:59:59+00:00", snow_depth_in: 61, swe_in: 14.2, new_snow_in: 11, temp_f: 18, wind_mph: null, source_payload: null },
    },
    {
      role: "summit" as const,
      distance_km: 2.3,
      rank: 1,
      station: { id: "st-2", source: "nws", source_id: "AMB", name: "ALTA - MT BALDY", lat: 40.57, lng: -111.64, elevation_ft: 11066, kind: "nws_obs" as const },
      latest: { station_id: "st-2", observed_at: "2026-12-20T17:00:00+00:00", snow_depth_in: null, swe_in: null, new_snow_in: null, temp_f: 12.2, wind_mph: 31, source_payload: null },
    },
    {
      role: "mid" as const,
      distance_km: 9,
      rank: 3,
      station: { id: "st-3", source: "mystery_net", source_id: "X1", name: null, lat: null, lng: null, elevation_ft: null, kind: "nws_obs" as const },
      latest: { station_id: "st-3", observed_at: "2026-12-20T17:00:00+00:00", snow_depth_in: 1, swe_in: null, new_snow_in: null, temp_f: null, wind_mph: null, source_payload: null },
    },
  ];
  const out = serializeStations(rows, now);
  assert.deepEqual(out.stations.map((s) => [s.rank, s.role, s.sourceId]), [[1, "summit", "AMB"], [2, "base", "1308:UT:SNTL"], [3, "mid", "X1"]]);
  for (const s of out.stations) ObservationStationSchema.parse(s);
  assert.deepEqual(out.measuredNow.map((m) => m.sourceId), ["AMB", "1308:UT:SNTL"], "an undocumented network is listed but gets no measuredNow row");
  for (const m of out.measuredNow) MeasuredNowSchema.parse(m);
  const [summit, base] = out.measuredNow;
  assert.equal(summit.ageMinutes, 60);
  assert.equal(summit.observedAt, "2026-12-20T17:00:00.000Z");
  assert.equal(summit.windMph, 31);
  assert.equal(base.ageMinutes, 1080);
  assert.equal(base.snowDepthIn, 61);
  assert.equal(base.attribution, "USDA NRCS SNOTEL");
  assert.equal(summit.attribution, "NOAA National Weather Service");
});

test("serializeResort: stations/measuredNow appear only when the caller passes observationStations", async () => {
  const { serializeResort } = await import("./serialize");
  const { ResortSchema } = await import("./schema");
  const fixture = resort();
  const without = serializeResort(fixture, { now: new Date("2026-12-20T18:00:00Z") });
  assert.equal("stations" in without, false);
  assert.equal("measuredNow" in without, false);
  ResortSchema.parse(without);
  const withEmpty = serializeResort(fixture, { now: new Date("2026-12-20T18:00:00Z"), observationStations: [] });
  assert.deepEqual(withEmpty.stations, []);
  assert.deepEqual(withEmpty.measuredNow, []);
  ResortSchema.parse(withEmpty);
});

// ── P8 block 2: timelapse clips ───────────────────────────────

test("cams carry `timelapses` only when the caller loaded them; /timelapses lists clips per cam with the newest storm reel", () => {
  const a = cam({ name: "Summit" });
  const b = cam({ name: "Base" });
  const r = resort({ cams: [a, b] });
  const clip = (id: string, window: "24h" | "storm", stormDate: string | null, renderedAt = "2026-12-20T06:00:00Z") => ({
    id, window, url: `https://x.supabase.co/storage/v1/object/public/cam-timelapses/vail/${id}.mp4?v=1`, posterUrl: `https://x.supabase.co/storage/v1/object/public/cam-timelapses/vail/${id}.jpg?v=1`,
    frames: 96, startsAt: "2026-12-19T06:00:00Z", endsAt: "2026-12-20T05:45:00Z", bytes: 900_000, renderedAt, stormDate,
  });
  const timelapses = [
    { camId: a.id, current: clip("a-24h", "24h", null), storms: [clip("a-s2", "storm", "2026-12-18"), clip("a-s1", "storm", "2026-12-10")] },
    { camId: b.id, current: null, storms: [clip("b-s3", "storm", "2026-12-19", "2026-12-19T18:00:00Z")] },
  ];

  const plain = serializeCams(r, { now: NOW });
  assert.equal("timelapses" in plain.cams[0], false, "key absent when nothing was loaded");
  const withNull = serializeCams(r, { now: NOW, timelapses: null });
  assert.equal("timelapses" in withNull.cams[0], false, "view unavailable reads like not loaded");
  const loaded = serializeCams(r, { now: NOW, timelapses });
  CamListSchema.parse(loaded);
  assert.deepEqual(loaded.cams[0].timelapses!.map((c) => c.id), ["a-24h", "a-s2", "a-s1"], "24 h clip first, then storms");
  assert.deepEqual(loaded.cams[1].timelapses!.map((c) => c.id), ["b-s3"]);
  const empty = serializeCams(resort({ cams: [cam()] }), { now: NOW, timelapses: [] });
  assert.deepEqual(empty.cams[0].timelapses, [], "loaded but no clip: empty list, not absent");

  const doc = serializeTimelapses(r, { now: NOW, timelapses });
  TimelapseListSchema.parse(doc);
  assert.equal(doc.available, true);
  assert.equal(doc.clipCount, 4);
  assert.deepEqual(doc.cams.map((c) => c.camId), [a.id, b.id]);
  assert.equal(doc.cams[0].camName, "Summit");
  assert.match(doc.cams[0].pageUrl, new RegExp(`/resorts/${r.slug}/webcams#cam-${a.id}$`));
  assert.equal(doc.lastStorm?.id, "b-s3", "newest storm date across cams");
  assert.equal(doc.lastStorm?.camName, "Base");
  assert.equal(doc.newestRenderedAt, "2026-12-20T06:00:00.000Z");
  assert.match(doc.note, /Link them/);

  const off = serializeTimelapses(r, { now: NOW, timelapses: null });
  TimelapseListSchema.parse(off);
  assert.equal(off.available, false);
  assert.equal(off.clipCount, 0);
  assert.match(off.note, /not served/);
  const none = serializeTimelapses(r, { now: NOW, timelapses: [] });
  assert.equal(none.available, true);
  assert.match(none.note, /No clips yet/);
});

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import type { Cam, OperatorStatusRow, ResortStationJoined, ResortWithData, SnowReport, WeatherPeriod } from "@/lib/types";
import type { ResortOpening } from "@/lib/openings";
import type { PublicApiCatalog } from "@/lib/public-api/data";
import { CamListSchema, PowderListSchema, ResortConditionsSchema, ResortSchema } from "@/lib/public-api/schema";
import pkg from "@/package.json";
import {
  PEAKCAM_MCP_INSTRUCTIONS,
  PEAKCAM_MCP_NAME,
  PEAKCAM_RESOURCE_TEMPLATE,
  READ_ONLY_TOOL_ANNOTATIONS,
  createPeakCamServer,
} from "./server";
import { MAX_CAMS, PEAKCAM_TOOL_NAMES, buildTools, diceSimilarity, editDistance, matchResorts, normalizeText, scoreResort } from "./tools";
import type { McpDataSource, SnowHistoryRow, UnmatchedQuestion } from "./types";
import type { ResortHistoryData } from "@/lib/public-api/data";
import type { SeasonAggregateRow } from "@/lib/leaderboards";
import { addDays, deriveNewSnow, type CumulativeNormalRow, type DailyRow, type MonthlyNormalRow } from "@/lib/snow-history";
import type { CamTimelineFrame } from "@/lib/cam-timeline";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ALL_MODELS, parseModelRuns, type OpenMeteoMultiModelResponse } from "@/lib/forecast/open-meteo-models";
import type { StoredForecast } from "@/lib/forecast/store";
import type { AccuracyInput } from "@/lib/public-api/forecast";
import { AskAnswerSchema } from "@/lib/public-api/schema";

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
    conditions: "powder,fresh||Cold and clear behind the front.",
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
    name: `Cam ${id}`,
    elevation: "11,000 ft",
    embed_type: "image",
    embed_url: `https://cams.example.com/${id}.jpg`,
    youtube_id: null,
    is_active: true,
    consecutive_failures: 0,
    auto_disabled: false,
    last_checked_at: "2026-12-20T11:00:00Z",
    created_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

function resort(over: Partial<ResortWithData> & { slug: string; name: string }): ResortWithData {
  return {
    id: `id-${over.slug}`,
    state: "CO",
    country: "US",
    region: "Colorado Rockies",
    lat: 39.48,
    lng: -106.07,
    website_url: null,
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

function opening(resortId: string, over: Partial<ResortOpening> = {}): ResortOpening {
  return {
    id: `o-${resortId}`,
    resort_id: resortId,
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

const RESORTS: ResortWithData[] = [
  resort({ slug: "breckenridge", name: "Breckenridge", snow_report: report({ new_snow_24h: 9, new_snow_48h: 14, base_depth: 38 }) }),
  resort({ slug: "vail", name: "Vail Mountain", snow_report: report({ new_snow_24h: 6, new_snow_48h: 11 }), cams: [cam(), cam({ consecutive_failures: 2 })] }),
  resort({
    slug: "alta",
    name: "Alta",
    state: "UT",
    region: "Wasatch",
    lat: 40.59,
    lng: -111.64,
    snotel_station_id: "766:UT:SNTL",
    snow_report: report({ new_snow_24h: 12, new_snow_48h: 20, base_depth: 60, swe_in: 14 }),
    cams: Array.from({ length: MAX_CAMS + 3 }, () => cam()),
  }),
  resort({
    slug: "ski-portillo",
    name: "Ski Portillo",
    state: "Chile",
    country: "CL",
    region: "Andes",
    lat: -32.84,
    lng: -70.13,
    snotel_station_id: null,
    snow_report: report({ new_snow_24h: 3, new_snow_48h: 4, base_depth: 20, source: "open_meteo", swe_in: null, pct_of_normal: null }),
  }),
  resort({ slug: "big-sky", name: "Big Sky", state: "MT", region: "Montana", lat: 45.28, lng: -111.4, snow_report: null, cams: [] }),
];

const OPENINGS: ResortOpening[] = [
  opening("id-breckenridge", { confirmed_open: "2026-11-07" }),
  opening("id-vail", { confirmed_open: "2026-11-13" }),
  opening("id-alta", { projected_open: "2026-11-20" }),
  opening("id-ski-portillo", { season: "2026", closing_date: "2026-10-05" }),
];

// P6: Alta has a fresh Liftie row; the others have no operator feed.
const OPERATORS: Record<string, OperatorStatusRow> = {
  "id-alta": {
    resort_id: "id-alta", id: "os-alta", source: "liftie", source_id: "alta", observed_at: "2026-12-20T17:00:00Z", fetched_at: "2026-12-20T17:05:00Z",
    lifts_open: 7, lifts_hold: 1, lifts_scheduled: 0, lifts_closed: 3, lifts_total: 11, trails_open: null, trails_total: null, base_depth_in: null, surface: null, opening_date: null,
    source_url: "https://www.alta.com/lift-terrain-status", verified: false,
  },
};

function catalog(): PublicApiCatalog {
  return {
    resorts: RESORTS,
    openings: new Map(OPENINGS.map((o) => [o.resort_id, o])),
    elevations: { "id-breckenridge": { base_ft: 9600, summit_ft: 12998 } },
    stations: STATIONS,
    operatorStatus: OPERATORS,
    now: NOW,
  };
}

// Station layer (migration 026): Alta has a summit mesonet sensor, a SNOTEL
// pillow at the base and one station with no observation yet; Vail has none.
const STATIONS: Record<string, ResortStationJoined[]> = {
  "id-alta": [
    {
      role: "summit",
      distance_km: 2.3,
      rank: 1,
      station: { id: "st-amb", source: "nws", source_id: "AMB", name: "ALTA - MT BALDY", lat: 40.57, lng: -111.64, elevation_ft: 11066, kind: "nws_obs" },
      latest: { station_id: "st-amb", observed_at: "2026-12-20T17:00:00+00:00", snow_depth_in: null, swe_in: null, new_snow_in: null, temp_f: 12.2, wind_mph: 31, source_payload: null },
    },
    {
      role: "base",
      distance_km: 0.3,
      rank: 2,
      station: { id: "st-atwater", source: "snotel", source_id: "1308:UT:SNTL", name: "Atwater", lat: 40.59, lng: -111.64, elevation_ft: 8750, kind: "snotel" },
      latest: { station_id: "st-atwater", observed_at: "2026-12-19T23:59:59+00:00", snow_depth_in: 61, swe_in: 14.2, new_snow_in: 11, temp_f: 18, wind_mph: null, source_payload: null },
    },
    {
      role: "mid",
      distance_km: 1.3,
      rank: 3,
      station: { id: "st-cln", source: "nws", source_id: "CLN", name: "ALTA - COLLINS", lat: 40.58, lng: -111.64, elevation_ft: 9662, kind: "nws_obs" },
      latest: null,
    },
  ],
  "id-vail": [],
};

const FORECAST: WeatherPeriod[] = [
  { dow: "Today", date: "2026-12-20", condition: "heavy-snow", high: 22, low: 9, snowInches: 8, shortForecast: "Heavy Snow", windSpeed: 15, windDirection: "W", windGust: null, precipProbability: 90, feelsLike: 8 },
  { dow: "Sun", date: "2026-12-21", condition: "clear", high: 28, low: 12, snowInches: 0, shortForecast: "Sunny", windSpeed: 5, windDirection: "N", windGust: null, precipProbability: 0, feelsLike: 25 },
];

const HISTORY: SnowHistoryRow[] = [
  { date: "2026-12-18", station_id: "842:CO:SNTL", snow_depth_in: 30, swe_in: 7.9, precip_accum_in: 9.1, temp_max_f: 25, temp_min_f: 8, qc_flag: "valid" },
  { date: "2026-12-20", station_id: "842:CO:SNTL", snow_depth_in: 38, swe_in: 9.5, precip_accum_in: 10.4, temp_max_f: 20, temp_min_f: 5, qc_flag: "valid" },
  { date: "2026-12-19", station_id: "842:CO:SNTL", snow_depth_in: 33, swe_in: 8.6, precip_accum_in: 9.8, temp_max_f: 23, temp_min_f: 6, qc_flag: "suspect" },
];

const BRECK_CAM_ID = RESORTS[0].cams[0].id;

const FRAMES: CamTimelineFrame[] = [
  { id: 1, camId: BRECK_CAM_ID, url: "https://x.supabase.co/storage/v1/object/public/cam-stills/archive/a/2026-12-20T06-00-00Z.jpg", capturedAt: "2026-12-20T06:00:00Z", snow24hAtCapture: 9, keeper: true },
  { id: 2, camId: BRECK_CAM_ID, url: "https://x.supabase.co/storage/v1/object/public/cam-stills/archive/a/2026-12-20T12-00-00Z.jpg", capturedAt: "2026-12-20T12:00:00Z", snow24hAtCapture: 9, keeper: true },
  { id: 3, camId: BRECK_CAM_ID, url: "https://x.supabase.co/storage/v1/object/public/cam-stills/archive/a/2026-12-18T12-00-00Z.jpg", capturedAt: "2026-12-18T12:00:00Z", snow24hAtCapture: 2, keeper: false },
];

// Stored multi-model runs for Vail only, from the recorded Alta response
// (dates 2026-10-18..31; the fixture catalogue's "now" is 2026-12-20, which
// the blend does not care about — it blends whatever is stored).
const OPEN_METEO_FIXTURE = JSON.parse(
  readFileSync(join(__dirname, "..", "forecast", "fixtures", "open-meteo-alta-summit-2026-10-18.json"), "utf8"),
) as OpenMeteoMultiModelResponse;
const STORED: StoredForecast = {
  runs: parseModelRuns(OPEN_METEO_FIXTURE, ALL_MODELS).map((r) => ({ id: `run-${r.model}`, point: "summit" as const, issuedAt: "2026-10-18T12:00:00.000Z", ...r })),
};
const ACCURACY: AccuracyInput = {
  truthBasis: "snotel",
  measuredDays: 41,
  station: { id: "842:CO:SNTL", name: "Vail Mountain", elevationFt: 10300 },
  scoredPoint: "summit",
  scores: [
    { resort_id: "id-vail", model: "gfs_seamless", period_days: 90, day1_mae: 4.2, day3_mae: 6.1, day7_mae: 8, samples: 41, bias_ratio: 1.3, computed_at: "2026-12-20T07:30:00Z" },
    { resort_id: "id-vail", model: "ecmwf_ifs025", period_days: 90, day1_mae: 2.5, day3_mae: 4, day7_mae: 7.2, samples: 41, bias_ratio: 0.9, computed_at: "2026-12-20T07:30:00Z" },
    { resort_id: "id-vail", model: "blend", period_days: 90, day1_mae: 2.1, day3_mae: 3.8, day7_mae: 6.9, samples: 41, bias_ratio: 1.05, computed_at: "2026-12-20T07:30:00Z" },
  ],
};


// P5: ten past winters plus 80 days of the 2026-27 season at Breckenridge, with a normal band.
const HISTORY_DATA: ResortHistoryData = (() => {
  const rows: DailyRow[] = [];
  for (let wy = 2017; wy <= 2027; wy++) {
    let depth = 0;
    const days = wy === 2027 ? 80 : 273;
    for (let d = 1; d <= days; d++) {
      depth += d % 3 === 0 ? 2 : 0;
      if (d === 60) depth += 12;
      rows.push({ date: addDays(`${wy - 1}-10-01`, d - 1), snowDepthIn: depth, sweIn: depth / 4, newSnowIn: null, qcFlag: "valid" });
    }
  }
  const normals: CumulativeNormalRow[] = Array.from({ length: 273 }, (_, i) => ({ dayOfWaterYear: i + 1, meanIn: (i + 1) * 0.7, p25In: (i + 1) * 0.5, p75In: (i + 1) * 0.9, years: 30, recentMeanIn: (i + 1) * 0.6, recentYears: 10 }));
  const monthly: MonthlyNormalRow[] = [10, 11, 12, 1, 2, 3].flatMap((month) => [
    { month, window: "30yr" as const, avgSnowfallIn: 25, avgSnowDays: 8, avgDepthIn: 40, maxStormIn: 20, maxStormStart: "2019-12-25", maxStormEnd: "2019-12-26", yearsTracked: 30 },
    { month, window: "10yr" as const, avgSnowfallIn: month === 1 ? 18 : 26, avgSnowDays: 7, avgDepthIn: 38, maxStormIn: 16, maxStormStart: "2024-01-05", maxStormEnd: "2024-01-05", yearsTracked: 10 },
  ]);
  return { rows: deriveNewSnow(rows), normals, monthly };
})();

const AGGREGATES: SeasonAggregateRow[] = [
  { resortId: "id-breckenridge", stationId: "842:CO:SNTL", seasonTotalIn: 64, snowDays: 26, powderDays: 1, daysMeasured: 80, deepestBaseIn: 64, deepestBaseDate: "2026-12-19", weekTotalIn: 4, lastDate: "2026-12-19", latestDepthIn: 64 },
  { resortId: "id-vail", stationId: "842:CO:SNTL", seasonTotalIn: 50, snowDays: 20, powderDays: 0, daysMeasured: 80, deepestBaseIn: 50, deepestBaseDate: "2026-12-19", weekTotalIn: 9, lastDate: "2026-12-20", latestDepthIn: 50 },
  { resortId: "id-alta", stationId: "766:UT:SNTL", seasonTotalIn: 120, snowDays: 30, powderDays: 5, daysMeasured: 80, deepestBaseIn: 80, deepestBaseDate: "2026-12-20", weekTotalIn: 20, lastDate: "2026-12-20", latestDepthIn: 80 },
];


const calls = { catalog: 0, forecast: 0, history: 0, stills: 0, runs: 0 };
const logged: UnmatchedQuestion[] = [];

function fixtureData(over: Partial<McpDataSource> = {}): McpDataSource {
  return {
    async catalog() {
      calls.catalog++;
      return catalog();
    },
    async forecast(r, blendByDate) {
      calls.forecast++;
      if (r.country !== "US") return null;
      return FORECAST.map((p) => (p.date && blendByDate?.[p.date] != null ? { ...p, snowInches: blendByDate[p.date], snowSource: "blend" as const } : { ...p, snowSource: "nws_keyword" as const }));
    },
    async forecastRuns(resortId) {
      calls.runs++;
      return resortId === "id-vail" ? STORED : { runs: [] };
    },
    async forecastAccuracy(r) {
      return r.id === "id-vail" ? ACCURACY : { scores: [], measuredDays: 0, truthBasis: "none" };
    },
    async snowHistory(resortId, days) {
      calls.history++;
      return resortId === "id-breckenridge" ? HISTORY.slice(0, days) : [];
    },
    async camStills(filter) {
      calls.stills++;
      if (filter.camId) return FRAMES.filter((f) => f.camId === filter.camId);
      return filter.resortId === "id-breckenridge" ? FRAMES : [];
    },
    async logUnmatchedQuestion(entry) {
      logged.push(entry);
    },
    async resortHistory(resort) {
      calls.history++;
      return resort.id === "id-breckenridge" ? HISTORY_DATA : { rows: [], normals: [], monthly: [] };
    },
    async seasonAggregates() {
      return AGGREGATES;
    },
    ...over,
  };
}

// ── In-memory client ─────────────────────────────────────────

type TextBlock = { type: "text"; text: string };

function text(result: { content: unknown }): string {
  const blocks = result.content as TextBlock[];
  assert.ok(blocks.length >= 1 && blocks[0].type === "text", "first content block is text");
  return blocks[0].text;
}

async function connect(data: McpDataSource = fixtureData()) {
  const server = createPeakCamServer(data);
  const client = new Client({ name: "peakcam-test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return { client, server };
}

let client: Client;
let server: Awaited<ReturnType<typeof connect>>["server"];

before(async () => {
  ({ client, server } = await connect());
});

after(async () => {
  await client.close();
  await server.close();
});

async function call(name: string, args: Record<string, unknown> = {}) {
  return client.callTool({ name, arguments: args });
}

// ── Handshake ────────────────────────────────────────────────

test("initialize reports io.peakcam/snow, the package version and instructions", () => {
  const info = client.getServerVersion();
  assert.equal(info?.name, PEAKCAM_MCP_NAME);
  assert.equal(info?.version, pkg.version);
  assert.equal(info?.title, "PeakCam Snow");
  assert.equal(client.getInstructions(), PEAKCAM_MCP_INSTRUCTIONS);
  assert.match(PEAKCAM_MCP_INSTRUCTIONS, /SNOTEL/);
  assert.match(PEAKCAM_MCP_INSTRUCTIONS, /canonicalUrl/);
  const version = client.getNegotiatedProtocolVersion();
  assert.ok(typeof version === "string" && /^\d{4}-\d{2}-\d{2}$/.test(version), `negotiated protocol version: ${version}`);
  console.log(`negotiated protocol version ${version} (${client.getProtocolEra()} era)`);
});

test("tools/list returns every tool in the name tuple, each read-only with input and output schemas", async () => {
  const { tools } = await client.listTools();
  assert.deepEqual(
    tools.map((t) => t.name),
    [...PEAKCAM_TOOL_NAMES],
  );
  assert.equal(tools.length, PEAKCAM_TOOL_NAMES.length);
  for (const tool of tools) {
    assert.deepEqual(tool.annotations, READ_ONLY_TOOL_ANNOTATIONS, `${tool.name} annotations`);
    assert.ok(tool.title, `${tool.name} has a title`);
    assert.ok(tool.description && tool.description.length > 40, `${tool.name} has a description`);
    assert.equal(tool.inputSchema.type, "object", `${tool.name} input schema is an object`);
    assert.ok(tool.outputSchema && tool.outputSchema.type === "object", `${tool.name} has an object output schema`);
  }
  const powder = tools.find((t) => t.name === "find_powder")!;
  const props = powder.inputSchema.properties as Record<string, { description?: string }>;
  assert.deepEqual(Object.keys(props).sort(), ["limit", "minInches", "sourceOnly", "state", "window"]);
  assert.ok(props.sourceOnly.description?.includes("snotel"));
});

// ── get_stations ─────────────────────────────────────────────

test("get_stations: bands, networks, ages and attribution for Alta; empty list for Vail; suggestions for a typo", async () => {
  const res = await call("get_stations", { slug: "alta" });
  assert.notEqual(res.isError, true);
  const doc = res.structuredContent as { available: boolean; count: number; stations: { role: string; source: string }[]; measuredNow: { role: string; sourceId: string; ageMinutes: number; tempF: number | null; snowDepthIn: number | null; attribution: string }[]; sources: { source: string }[] };
  assert.equal(doc.available, true);
  assert.equal(doc.count, 3, "every linked station is listed");
  assert.deepEqual(doc.stations.map((s) => s.role), ["summit", "base", "mid"]);
  assert.deepEqual(doc.measuredNow.map((m) => m.sourceId), ["AMB", "1308:UT:SNTL"], "Collins has no observation yet, so no measuredNow row");
  const [summit, base] = doc.measuredNow;
  assert.equal(summit.ageMinutes, 60, "17:00 reading at 18:00 generatedAt");
  assert.equal(summit.tempF, 12.2);
  assert.equal(base.snowDepthIn, 61);
  assert.equal(base.ageMinutes, 18 * 60);
  assert.match(base.attribution, /USDA NRCS SNOTEL/);
  assert.deepEqual(doc.sources.map((s) => s.source), ["nws", "snotel"]);
  const text = (res.content[0] as { text: string }).text;
  assert.match(text, /\| Summit \| ALTA - MT BALDY \(`AMB`\) \| NWS \| 11,066 ft \| 2\.3 km \| n\/a \| n\/a \| n\/a \| 12\.2 °F \| 31 mph \| 2026-12-20 17:00 UTC \(1 h ago\) \|/);
  assert.match(text, /\| Base \| Atwater \(`1308:UT:SNTL`\) \| SNOTEL \| 8,750 ft \| 0\.3 km \| 61 in \| 11 in \| 14\.2 in \| 18 °F \| – \|/);
  assert.match(text, /https:\/\/www\.peakcam\.io\/resorts\/alta/);

  const vail = await call("get_stations", { slug: "vail" });
  const vailDoc = vail.structuredContent as { available: boolean; count: number };
  assert.equal(vailDoc.available, true);
  assert.equal(vailDoc.count, 0);
  assert.match((vail.content[0] as { text: string }).text, /No observation station within 25 km/);

  const typo = await call("get_stations", { slug: "atla" });
  assert.equal(typo.isError, true);
  assert.match((typo.content[0] as { text: string }).text, /alta/);
});

test("get_stations: a catalogue without the station layer says so instead of inventing an empty list", async () => {
  const bare: McpDataSource = fixtureData({ catalog: async () => ({ ...catalog(), stations: null }) });
  const tool = buildTools(bare).find((t) => t.name === "get_stations")!;
  const res = await tool.handler({ slug: "alta" });
  const doc = res.structuredContent as { available: boolean; count: number };
  assert.equal(doc.available, false);
  assert.equal(doc.count, 0);
  assert.match((res.content[0] as { text: string }).text, /not populated/);
});

// ── find_powder ──────────────────────────────────────────────

test("find_powder ranks measured snow, labels sources and links canonical URLs", async () => {
  const res = await call("find_powder", { window: "24h" });
  assert.notEqual(res.isError, true);
  const doc = PowderListSchema.parse(res.structuredContent);
  assert.equal(doc.window, "24h");
  assert.deepEqual(
    doc.results.map((r) => r.slug),
    ["alta", "breckenridge", "vail", "ski-portillo"],
    "big-sky has no report and is left out",
  );
  assert.equal(doc.results[0].rank, 1);
  assert.equal(doc.results[0].newSnow24h.value, 12);
  assert.equal(doc.results[0].newSnow24h.source, "snotel");
  assert.equal(doc.results[3].newSnow24h.source, "open_meteo");
  assert.equal(doc.generatedAt, NOW.toISOString());
  const md = text(res);
  assert.match(md, /Most new snow, last 24h/);
  assert.match(md, /1\. \*\*Alta\*\*/);
  assert.match(md, /SNOTEL-measured \(USDA NRCS\)/);
  assert.match(md, /model estimate \(Open-Meteo\)/);
  assert.match(md, /https:\/\/www\.peakcam\.io\/resorts\/alta/);
  assert.match(md, /2026-12-20 12:00 UTC/);
});

test("find_powder honours sourceOnly, state, minInches, window and limit", async () => {
  const measured = PowderListSchema.parse((await call("find_powder", { sourceOnly: "snotel" })).structuredContent);
  assert.deepEqual(
    measured.results.map((r) => r.slug),
    ["alta", "breckenridge", "vail"],
  );
  assert.equal(measured.filters.source, "snotel");

  const colorado = PowderListSchema.parse((await call("find_powder", { state: "co" })).structuredContent);
  assert.deepEqual(
    colorado.results.map((r) => r.slug),
    ["breckenridge", "vail"],
  );

  const deep = PowderListSchema.parse((await call("find_powder", { minInches: 10 })).structuredContent);
  assert.deepEqual(
    deep.results.map((r) => r.slug),
    ["alta"],
  );

  const two = PowderListSchema.parse((await call("find_powder", { window: "48h", limit: 2 })).structuredContent);
  assert.equal(two.window, "48h");
  assert.equal(two.count, 2);

  const none = await call("find_powder", { state: "MT" });
  assert.equal(PowderListSchema.parse(none.structuredContent).count, 0);
  assert.match(text(none), /No resort passed these filters/);
});

test("find_powder rejects an out-of-range limit before the handler runs", async () => {
  const before = calls.catalog;
  let rejected = false;
  try {
    const res = await call("find_powder", { limit: 999 });
    rejected = res.isError === true;
  } catch {
    rejected = true;
  }
  assert.ok(rejected, "limit 999 is refused");
  assert.equal(calls.catalog, before, "no catalogue read for an invalid call");
});

// ── get_resort_conditions ────────────────────────────────────

test("get_resort_conditions returns the full resort document and a sourced markdown report", async () => {
  const res = await call("get_resort_conditions", { slug: "Breckenridge " });
  assert.notEqual(res.isError, true);
  const doc = ResortSchema.parse(res.structuredContent);
  assert.equal(doc.slug, "breckenridge");
  assert.equal(doc.canonicalUrl, "https://www.peakcam.io/resorts/breckenridge");
  assert.equal(doc.snow?.newSnow24h.value, 9);
  assert.equal(doc.snow?.newSnow24h.source, "snotel");
  assert.equal(doc.snow?.newSnow24h.station?.id, "842:CO:SNTL");
  assert.equal(doc.snow?.pctOfNormal.value, 118);
  assert.equal(doc.season.status, "open");
  assert.equal(doc.season.openDate, "2026-11-07");
  assert.equal(doc.location.baseElevationFt, 9600);
  const md = text(res);
  assert.match(md, /^# Breckenridge snow report/);
  assert.match(md, /SNOTEL-measured \(USDA NRCS\), station .*842:CO:SNTL|SNOTEL-measured \(USDA NRCS\), station /);
  assert.match(md, /\| New snow 24 h \| 9 in \|/);
  assert.match(md, /Season: open \(confirmed opening 2026-11-07; as of 2026-12-20\)/);
  assert.match(md, /PeakCam page \(cite this\): https:\/\/www\.peakcam\.io\/resorts\/breckenridge/);
  assert.match(md, /Cold and clear behind the front\./);
  assert.doesNotMatch(md, /- \*\*Cam /, "conditions tool summarises cams instead of listing them");
});

test("get_resort_conditions carries the P6 envelope: Alta is OPEN on the operator feed with sourced, tiered fields; Breckenridge on its confirmed date; Alta's projection alone never opens it", async () => {
  const alta = await call("get_resort_conditions", { slug: "alta" });
  const doc = alta.structuredContent as { data: Record<string, { value: unknown; source: string; freshness: { tier: string } }>; meta: { freshness: Record<string, string>; sources: string[] }; sentence: string; schemaUrl: string; measuredNow: unknown[] };
  assert.equal(doc.schemaUrl, "https://www.peakcam.io/.well-known/schemas/resort-conditions-v1.json");
  assert.equal(doc.data.status.value, "OPEN");
  assert.equal(doc.data.status.source, "operator");
  assert.equal(doc.data.liftsOpen.value, 7);
  assert.equal(doc.data.liftsOpen.freshness.tier, "live");
  assert.equal(doc.data.baseDepthIn.value, 60);
  assert.equal(doc.data.baseDepthIn.source, "snotel");
  assert.equal(doc.data.tempF.value, 12.2);
  assert.equal(doc.data.tempF.source, "station:nws");
  assert.equal(doc.data.forecastNext48hCm.source, "none"); // no stored run for Alta in the fixtures
  assert.equal(doc.meta.freshness.status, "live");
  assert.equal(doc.measuredNow.length, 2);
  assert.match(doc.sentence, /^As of 10:00 a\.m\. MT Dec 20, Alta is open: 7 of 11 lifts open \(operator feed, 1 h old\); base 60 in\. \(SNOTEL, 6 h old\), 12 in\. of new snow in 24 h \(SNOTEL\)\.$/);
  // The envelope's own schema validates the structured result minus the compatibility subset.
  const { schemaVersion, schemaUrl, sentence, meta, data, measuredNow, slug, name, canonicalUrl, apiUrl, attribution, license } = alta.structuredContent as Record<string, unknown>;
  assert.doesNotThrow(() => ResortConditionsSchema.parse({ schemaVersion, schemaUrl, sentence, meta, data, measuredNow, slug, name, canonicalUrl, apiUrl, attribution, license }));
  const md = text(alta);
  assert.match(md, /## Status: OPEN — As of/);
  assert.match(md, /- Lifts open: 7 \(operator, live, 1 h old\)/);
  assert.match(md, /- Recommendable today: yes/);

  const breck = (await call("get_resort_conditions", { slug: "breckenridge" })).structuredContent as { data: { status: { value: string; source: string }; liftsOpen: { source: string }; reasons: string[] } };
  assert.equal(breck.data.status.value, "OPEN");
  assert.equal(breck.data.status.source, "operator");
  assert.equal(breck.data.liftsOpen.source, "none");
  assert.match(breck.data.reasons[0], /confirmed opening date 2026-11-07 has passed/);

  // Without its Liftie row Alta has only a projection (2026-11-20, passed): UNKNOWN, never OPEN.
  const bare = buildTools(fixtureData({ catalog: async () => ({ ...catalog(), operatorStatus: {} }) }));
  const tool = bare.find((t) => t.name === "get_resort_conditions")!;
  const res = await tool.handler(tool.inputSchema.parse({ slug: "alta" }) as never);
  const noFeed = res.structuredContent as { data: { status: { value: string; source: string } } };
  assert.equal(noFeed.data.status.value, "UNKNOWN");
  assert.equal(noFeed.data.status.source, "none");
});

test("ask answers \"is Alta open today\" through the contract: the envelope's status sentence, dated by the operator feed", async () => {
  const res = await call("ask", { question: "Is Alta open today?" });
  const answer = AskAnswerSchema.parse(res.structuredContent);
  assert.equal(answer.answerable, true);
  assert.equal(answer.intent, "openings");
  assert.equal(answer.tool, "get_resort_conditions");
  assert.match(answer.sentence, /^As of 10:00 a\.m\. MT Dec 20, Alta is open: 7 of 11 lifts open \(operator feed, 1 h old\)/);
  assert.equal(answer.asOf, "2026-12-20T17:00:00.000Z");
  assert.equal((answer.data as { data: { status: { value: string } } }).data.status.value, "OPEN");
  const vail = AskAnswerSchema.parse((await call("ask", { question: "is vail open" })).structuredContent);
  assert.match(vail.sentence, /Vail Mountain is open: confirmed opening Nov 13/);
});

test("an unknown slug is an isError result that lists close matches", async () => {
  const res = await call("get_resort_conditions", { slug: "breckenrige" });
  assert.equal(res.isError, true);
  const md = text(res);
  assert.match(md, /No active resort with slug "breckenrige"/);
  assert.match(md, /breckenridge \(Breckenridge\)/);
  assert.match(md, /search_resorts/);
  assert.equal(res.structuredContent, undefined);

  const garbage = await call("get_resort_cams", { slug: "Not A Slug!!" });
  assert.equal(garbage.isError, true);
});

// ── search_resorts ───────────────────────────────────────────

test("search_resorts matches names, slugs, regions and typos, with state and country filters", async () => {
  const breck = await call("search_resorts", { query: "breck" });
  const rows = (breck.structuredContent as { resorts: Array<{ slug: string }>; count: number }).resorts;
  assert.equal(rows[0].slug, "breckenridge");
  assert.match(text(breck), /1\. \*\*Breckenridge\*\* \(`breckenridge`, CO, US\) — 24 h 9 in · base 38 in · SNOTEL/);

  const typo = (await call("search_resorts", { query: "Portilo" })).structuredContent as { resorts: Array<{ slug: string }> };
  assert.equal(typo.resorts[0]?.slug, "ski-portillo");

  const region = (await call("search_resorts", { query: "wasatch" })).structuredContent as { resorts: Array<{ slug: string }> };
  assert.deepEqual(
    region.resorts.map((r) => r.slug),
    ["alta"],
  );

  const chile = (await call("search_resorts", { query: "ski", country: "cl" })).structuredContent as { resorts: Array<{ slug: string }> };
  assert.deepEqual(
    chile.resorts.map((r) => r.slug),
    ["ski-portillo"],
  );

  const utahVail = (await call("search_resorts", { query: "vail", state: "UT" })).structuredContent as { count: number };
  assert.equal(utahVail.count, 0);
  assert.match(text(await call("search_resorts", { query: "zzzz" })), /No PeakCam resort matches "zzzz"/);
});

test("matching helpers: normalisation, dice similarity and scores", () => {
  assert.equal(normalizeText("Mt. Bachelor / Nevé"), "mt bachelor neve");
  assert.equal(diceSimilarity("night", "nacht"), 0.25);
  assert.equal(diceSimilarity("alta", "alta"), 1);
  assert.equal(scoreResort("Alta", RESORTS[2]), 100);
  assert.equal(scoreResort("ski portillo", RESORTS[3]), 100);
  assert.equal(scoreResort("brec", RESORTS[0]), 85);
  assert.equal(scoreResort("mountain", RESORTS[1]), 70);
  assert.equal(scoreResort("colorado", RESORTS[0]), 50);
  assert.equal(scoreResort("xyz", RESORTS[0]), 0);
  assert.equal(editDistance("vial", "vail"), 1);
  assert.equal(editDistance("breckenrige", "breckenridge"), 1);
  assert.equal(editDistance("", "alta"), 4);
  assert.equal(scoreResort("vial", RESORTS[1]), 25, "one transposition inside the edit budget");
  assert.equal(scoreResort("atla", RESORTS[0]), 0, "a typo of another resort does not match Breckenridge");
  assert.deepEqual(
    matchResorts(RESORTS, "colorado", { limit: 1 }).map((r) => r.slug),
    ["breckenridge"],
  );
});

// ── get_resort_cams ──────────────────────────────────────────

test("get_resort_cams returns links and health, capped at MAX_CAMS", async () => {
  const res = await call("get_resort_cams", { slug: "alta" });
  const doc = CamListSchema.parse(res.structuredContent);
  assert.equal(doc.slug, "alta");
  assert.equal(doc.cams.length, MAX_CAMS);
  assert.equal(doc.cams[0].live, true);
  assert.equal(doc.cams[0].pageUrl, "https://www.peakcam.io/resorts/alta");
  assert.match(doc.cams[0].stillUrl ?? "", /^https:\/\/cams\.example\.com\//);
  const md = text(res);
  assert.match(md, new RegExp(`^# Alta webcams \\(${MAX_CAMS + 3}, ${MAX_CAMS + 3} live\\)`));
  assert.match(md, /…and 3 more at https:\/\/www\.peakcam\.io\/resorts\/alta/);

  const vail = CamListSchema.parse((await call("get_resort_cams", { slug: "vail" })).structuredContent);
  assert.deepEqual(
    vail.cams.map((c) => c.live),
    [true, false],
  );
  assert.match(text(await call("get_resort_cams", { slug: "vail" })), /down as of 2026-12-20 11:00 UTC/);
});

// ── compare_resorts ──────────────────────────────────────────

test("compare_resorts builds a side-by-side table and refuses unknown slugs", async () => {
  const res = await call("compare_resorts", { slugs: ["breckenridge", "alta", "ski-portillo"] });
  assert.notEqual(res.isError, true);
  const doc = res.structuredContent as { count: number; resorts: Array<{ slug: string; camCount: number; liveCamCount: number; cams?: unknown }> };
  assert.equal(doc.count, 3);
  assert.deepEqual(
    doc.resorts.map((r) => r.slug),
    ["breckenridge", "alta", "ski-portillo"],
  );
  assert.equal(doc.resorts[1].camCount, MAX_CAMS + 3);
  assert.equal(doc.resorts[1].cams, undefined, "compare entries carry counts, not cam lists");
  const md = text(res);
  assert.match(md, /\| Resort \| 24 h \| 48 h \| Base \| SWE % normal \| Rating \| Season \| Source \| Cams live \|/);
  assert.match(md, /\| \[Alta\]\(https:\/\/www\.peakcam\.io\/resorts\/alta\) \| 12 in \| 20 in \| 60 in \| 118 % \| great \| unknown \| SNOTEL 2026-12-20 12:00 UTC \| 15\/15 \|/);
  assert.match(md, /\| \[Ski Portillo\]\(https:\/\/www\.peakcam\.io\/resorts\/ski-portillo\) \| 3 in \| 4 in \| 20 in \| n\/a \| great \| closed \| model 2026-12-20 12:00 UTC \| 1\/1 \|/);

  const bad = await call("compare_resorts", { slugs: ["alta", "vial"] });
  assert.equal(bad.isError, true);
  assert.match(text(bad), /Unknown resort slug: "vial" \(did you mean vail\?\)/);

  const dup = await call("compare_resorts", { slugs: ["alta", "alta"] });
  assert.equal(dup.isError, true);
});

// ── get_forecast ─────────────────────────────────────────────

test("get_forecast returns the 14-day blend with modelCount and the band, plus the NWS narrative for US resorts", async () => {
  const res = await call("get_forecast", { slug: "vail" });
  const doc = res.structuredContent as {
    available: boolean;
    provider: string;
    point: string;
    modelCount: number;
    models: string[];
    summary: { total14dIn: number; peak: { date: string } | null } | null;
    days: Array<{ date: string; snowfallIn: number; snowfallLoIn: number; snowfallHiIn: number; modelCount: number }>;
    periods: Array<{ dow: string; date: string | null; snowInches: number; snowSource: string }>;
    credits: Array<{ text: string; license: string }>;
    note: string | null;
  };
  assert.notEqual(res.isError, true);
  assert.equal(doc.available, true);
  assert.equal(doc.provider, "blend");
  assert.equal(doc.point, "summit");
  assert.equal(doc.modelCount, 9);
  assert.equal(doc.models.length, 9);
  assert.equal(doc.days.length, 14);
  assert.equal(doc.days[13].modelCount, 2, "only two models reach day 14");
  assert.ok(doc.days.every((d) => d.snowfallLoIn <= d.snowfallIn && d.snowfallIn <= d.snowfallHiIn));
  assert.equal(doc.summary?.peak?.date, "2026-10-29");
  assert.equal(doc.periods.length, 2, "NWS narrative still present for a US resort");
  assert.equal(doc.periods[0].snowSource, "nws_keyword", "the NWS dates are outside the stored blend's range, so the keyword value stands");
  assert.equal(doc.note, null);
  assert.match(doc.credits[0].text, /Open-Meteo/);
  const md = text(res);
  assert.match(md, /blend of 9 models/);
  assert.match(md, /\| 2026-10-23 \| 2\.2 \| /);
  assert.match(md, /Weather data by Open-Meteo\.com \(CC BY 4\.0\)/);
});

test("get_forecast: no stored run → NWS narrative with keyword amounts for a US resort, available=false elsewhere", async () => {
  const breck = (await call("get_forecast", { slug: "breckenridge" })).structuredContent as { available: boolean; provider: string; note: string | null; days: unknown[]; periods: Array<{ snowInches: number; snowSource: string }> };
  assert.equal(breck.available, true);
  assert.equal(breck.provider, "nws");
  assert.deepEqual(breck.days, []);
  assert.equal(breck.periods[0].snowInches, 8);
  assert.equal(breck.periods[0].snowSource, "nws_keyword");
  assert.match(breck.note ?? "", /keyword estimates/);

  const before = calls.forecast;
  const chile = (await call("get_forecast", { slug: "ski-portillo" })).structuredContent as { available: boolean; provider: string; note: string | null; periods: unknown[] };
  assert.equal(chile.available, false);
  assert.equal(chile.provider, "none");
  assert.match(chile.note ?? "", /every 6 hours/);
  assert.deepEqual(chile.periods, []);
  assert.equal(calls.forecast, before, "no NWS call for a non-US resort");
});

test("get_forecast degrades to available=false when nothing is stored and NWS does not answer", async () => {
  const { client: c, server: s } = await connect(fixtureData({ forecast: async () => null, forecastRuns: async () => ({ runs: [] }) }));
  try {
    const res = await c.callTool({ name: "get_forecast", arguments: { slug: "vail" } });
    const doc = res.structuredContent as { available: boolean; note: string | null };
    assert.equal(doc.available, false);
    assert.match(doc.note ?? "", /did not answer/);
    assert.notEqual(res.isError, true);
  } finally {
    await c.close();
    await s.close();
  }
});

// ── compare_models ───────────────────────────────────────────

test("compare_models returns ranked scores with the truth basis and each model's 7-day outlook", async () => {
  const res = await call("compare_models", { slug: "vail" });
  assert.notEqual(res.isError, true);
  const doc = res.structuredContent as {
    truthBasis: string;
    measuredDays: number;
    bestModel: string | null;
    scores: Array<{ model: string; rank: number | null }>;
    outlook: Array<{ model: string; total7dIn: number; horizonDays: number }>;
    blendTotal7dIn: number | null;
    note: string | null;
  };
  assert.equal(doc.truthBasis, "snotel");
  assert.equal(doc.measuredDays, 41);
  assert.equal(doc.bestModel, "blend");
  assert.deepEqual(doc.scores.map((s) => [s.model, s.rank]), [["blend", 1], ["ecmwf_ifs025", 2], ["gfs_seamless", 3]]);
  assert.equal(doc.outlook.length, 9);
  assert.equal(doc.outlook.find((o) => o.model === "gfs_hrrr")?.horizonDays, 2);
  assert.ok(doc.outlook[0].total7dIn >= doc.outlook[8].total7dIn, "outlook sorted by 7-day total");
  assert.equal(typeof doc.blendTotal7dIn, "number");
  assert.equal(doc.note, null);
  const md = text(res);
  assert.match(md, /SNOTEL-measured 24 h snow on 41 days of the last 90 \(Vail Mountain\)/);
  assert.match(md, /\| 1 \| PeakCam blend \| 2\.1 \|/);

  const none = (await call("compare_models", { slug: "ski-portillo" })).structuredContent as { truthBasis: string; scores: unknown[]; outlook: unknown[]; note: string | null };
  assert.equal(none.truthBasis, "none");
  assert.deepEqual(none.scores, []);
  assert.deepEqual(none.outlook, []);
  assert.match(none.note ?? "", /No measured snow series/);
});

// ── get_snow_history ─────────────────────────────────────────

test("get_snow_history maps snowpack_daily rows newest first with station provenance", async () => {
  const res = await call("get_snow_history", { slug: "breckenridge", days: 3 });
  assert.notEqual(res.isError, true);
  const doc = res.structuredContent as {
    source: string | null;
    station: { id: string } | null;
    days: number;
    count: number;
    rows: Array<{ date: string; snowDepthIn: number | null; qcFlag: string }>;
  };
  assert.equal(doc.source, "snotel");
  assert.equal(doc.station?.id, "842:CO:SNTL");
  assert.equal(doc.days, 3);
  assert.equal(doc.count, 3);
  assert.deepEqual(
    doc.rows.map((r) => r.date),
    ["2026-12-20", "2026-12-19", "2026-12-18"],
  );
  assert.equal(doc.rows[1].qcFlag, "suspect");
  const md = text(res);
  assert.match(md, /^# Breckenridge snow history, last 3 days \(3 rows, SNOTEL-measured \(USDA NRCS\)/);
  assert.match(md, /\| 2026-12-20 \| 38 in \| 9.5 in \| 10.4 in \| 20 \/ 5 \| valid \|/);
  assert.match(md, /Depth 2026-12-18 → 2026-12-20: 30 in → 38 in \(\+8 in\)/);

  const empty = (await call("get_snow_history", { slug: "big-sky" })).structuredContent as { count: number; source: string | null; station: unknown };
  assert.equal(empty.count, 0);
  assert.equal(empty.source, "snotel");
  assert.match(text(await call("get_snow_history", { slug: "big-sky" })), /No daily rows on file/);
});

// ── get_opening_dates ────────────────────────────────────────

test("get_opening_dates lists season status soonest first and filters by state", async () => {
  const res = await call("get_opening_dates", {});
  const doc = res.structuredContent as {
    asOf: string;
    count: number;
    totalMatching: number;
    resorts: Array<{ slug: string; season: { status: string; openDate: string | null } }>;
  };
  assert.equal(doc.asOf, "2026-12-20");
  assert.equal(doc.count, 5);
  assert.deepEqual(
    doc.resorts.map((r) => r.slug),
    ["ski-portillo", "breckenridge", "vail", "alta", "big-sky"],
  );
  assert.equal(doc.resorts[0].season.status, "closed");
  assert.equal(doc.resorts[1].season.status, "open");
  assert.equal(doc.resorts[3].season.status, "unknown");
  const md = text(res);
  assert.match(md, /- \*\*Breckenridge\*\* \(`breckenridge`, CO\): open \(confirmed opening 2026-11-07; as of 2026-12-20\)/);
  assert.match(md, /- \*\*Alta\*\* \(`alta`, UT\): unknown \(projected opening 2026-11-20; as of 2026-12-20\)/);
  assert.match(md, /- \*\*Big Sky\*\* \(`big-sky`, MT\): unknown \(no date on file; as of 2026-12-20\)/);

  const co = (await call("get_opening_dates", { state: "co", limit: 1 })).structuredContent as { count: number; totalMatching: number; resorts: Array<{ slug: string }> };
  assert.equal(co.count, 1);
  assert.equal(co.totalMatching, 2);
  assert.equal(co.resorts[0].slug, "breckenridge");
});

// ── Resources ────────────────────────────────────────────────

test("the peakcam://resorts/{slug} resource lists every resort and reads as markdown", async () => {
  const { resourceTemplates } = await client.listResourceTemplates();
  assert.deepEqual(
    resourceTemplates.map((t) => t.uriTemplate),
    [PEAKCAM_RESOURCE_TEMPLATE],
  );
  assert.equal(resourceTemplates[0].mimeType, "text/markdown");

  const { resources } = await client.listResources();
  assert.equal(resources.length, RESORTS.length);
  assert.ok(resources.some((r) => r.uri === "peakcam://resorts/alta" && r.title === "Alta"));

  const read = await client.readResource({ uri: "peakcam://resorts/breckenridge" });
  assert.equal(read.contents.length, 1);
  const content = read.contents[0] as { uri: string; mimeType?: string; text?: string };
  assert.equal(content.uri, "peakcam://resorts/breckenridge");
  assert.equal(content.mimeType, "text/markdown");
  // The resource is the Sprint 4 /resorts/{slug}/index.md document, so a
  // client that already fetched the page alternate sees the same text.
  const { resortMarkdown: pageMarkdown } = await import("@/lib/public-api/markdown-page");
  const { serializeResort } = await import("@/lib/public-api/serialize");
  const { serializeOptionsFor } = await import("./tools");
  const { resortConditionsView } = await import("@/lib/public-api/conditions");
  const cat = catalog();
  const options = serializeOptionsFor(cat, RESORTS[0]);
  // P6: the resource carries the "Status and freshness" section the page alternate carries.
  const expected = pageMarkdown(serializeResort(RESORTS[0], options), { now: cat.now, conditions: resortConditionsView(RESORTS[0], { ...options, forecast: { runs: [] } }) });
  assert.equal(content.text, expected);
  assert.match(content.text ?? "", /## Status and freshness\n\n\*\*OPEN\*\* — /);
  assert.match(content.text ?? "", /^# Breckenridge, .*: snow report and webcams/);
  assert.match(content.text ?? "", /## Webcams \(1\)/);
  assert.match(content.text ?? "", /- Page: https:\/\/www\.peakcam\.io\/resorts\/breckenridge/);
  assert.match(content.text ?? "", /Data: PeakCam \(https:\/\/www\.peakcam\.io\)/);

  await assert.rejects(client.readResource({ uri: "peakcam://resorts/breckenrige" }), /No active resort with slug "breckenrige".*peakcam:\/\/resorts\/breckenridge/);
});

test("every tool's structuredContent parses against its own outputSchema", async () => {
  const tools = buildTools(fixtureData());
  const samples: Record<string, Record<string, unknown>> = {
    search_resorts: { query: "vail" },
    get_resort_conditions: { slug: "vail" },
    get_resort_cams: { slug: "vail" },
    find_powder: { window: "48h" },
    compare_resorts: { slugs: ["vail", "alta"] },
    get_forecast: { slug: "vail" },
    compare_models: { slug: "vail" },
    get_snow_history: { slug: "breckenridge", days: 2 },
    get_opening_dates: { state: "CO" },
    get_stations: { slug: "alta" },
    get_resort_profile: { slug: "breckenridge" },
    get_percent_of_normal: { state: "CO" },
    list_regions: {},
    get_alert_options: { slug: "alta" },
    get_cam_timeline: { slug: "breckenridge", hours: 24 },
    ask: { question: "how much snow at Alta" },
    get_season_stats: { slug: "breckenridge" },
    get_monthly_climatology: { slug: "breckenridge" },
    get_leaderboard: { kind: "season-snowfall", state: "CO" },
  };
  for (const tool of tools) {
    const args = tool.inputSchema.parse(samples[tool.name]);
    const result = await tool.handler(args);
    assert.notEqual(result.isError, true, `${tool.name} succeeds`);
    assert.doesNotThrow(() => tool.outputSchema.parse(result.structuredContent), `${tool.name} structuredContent matches outputSchema`);
    const body = JSON.stringify(result.structuredContent);
    assert.ok(body.length < 60_000, `${tool.name} payload stays small (${body.length} bytes)`);
  }
});

// ── P9 block 1 tools ─────────────────────────────────────────

test("get_resort_profile returns identity, URLs, station and season without snow numbers", async () => {
  const res = await call("get_resort_profile", { slug: "breckenridge" });
  assert.notEqual(res.isError, true);
  const doc = res.structuredContent as Record<string, Record<string, unknown>>;
  assert.equal(doc.canonicalUrl, "https://www.peakcam.io/resorts/breckenridge");
  assert.equal(doc.urls.markdown, "https://www.peakcam.io/resorts/breckenridge/index.md");
  assert.equal(doc.urls.powderFeed, "https://www.peakcam.io/resorts/breckenridge/powder.xml");
  assert.equal(doc.urls.stateHub, "https://www.peakcam.io/ski-cams/colorado");
  assert.equal(doc.location.stateLabel, "Colorado");
  assert.equal(doc.location.baseElevationFt, 9600);
  assert.equal(doc.location.summitElevationFt, 12998);
  assert.equal((doc.station as { id: string }).id, "842:CO:SNTL");
  assert.equal(doc.season.status, "open");
  assert.equal("snow" in doc, false);
  assert.match(text(res), /Colorado, US/);
});

test("get_percent_of_normal ranks station-fed resorts and honours the state filter", async () => {
  const all = (await call("get_percent_of_normal", {})).structuredContent as { results: Array<{ slug: string; pctOfNormal: number }>; phase: string; sentence: string };
  assert.equal(all.phase, "season");
  assert.deepEqual(all.results.map((r) => r.slug), ["alta", "breckenridge", "vail"], "portillo is a model estimate and big-sky has no report");
  assert.equal(all.results[0].pctOfNormal, 118);
  assert.match(all.sentence, /^As of /);
  const co = (await call("get_percent_of_normal", { state: "co" })).structuredContent as { results: Array<{ slug: string }>; stationFedCount: number };
  assert.deepEqual(co.results.map((r) => r.slug), ["breckenridge", "vail"]);
  assert.equal(co.stationFedCount, 2);
});

test("list_regions counts resorts, measured reports and cams per state with hub URLs", async () => {
  const res = await call("list_regions", {});
  const doc = res.structuredContent as { totalResorts: number; regions: Array<Record<string, unknown>>; countries: Array<{ country: string; resorts: number }> };
  assert.equal(doc.totalResorts, 5);
  assert.equal(doc.regions[0].state, "CO");
  assert.equal(doc.regions[0].resorts, 2);
  assert.equal(doc.regions[0].measured, 2);
  assert.equal(doc.regions[0].hubUrl, "https://www.peakcam.io/ski-cams/colorado");
  assert.deepEqual(doc.countries.map((c) => c.country), ["US", "CL"]);
  assert.match(text(res), /\| Colorado \(`CO`, US\) \| 2 \|/);
});

test("get_alert_options explains every channel, fills the resort feed, and writes nothing", async () => {
  const res = await call("get_alert_options", { slug: "alta" });
  const doc = res.structuredContent as { writes: boolean; thresholdInches: number; channels: Array<{ kind: string }>; resortFeed: { atomUrl: string } };
  assert.equal(doc.writes, false);
  assert.equal(doc.thresholdInches, 8);
  assert.deepEqual(doc.channels.map((c) => c.kind), ["email", "webhook", "atom", "ical", "resort_atom"]);
  assert.equal(doc.resortFeed.atomUrl, "https://www.peakcam.io/resorts/alta/powder.xml");
  assert.match(text(res), /webhook-signature/);
  const bad = await call("get_alert_options", { slug: "nowhere" });
  assert.equal(bad.isError, true);
});

test("get_cam_timeline returns frames as links inside the window plus the last storm frame", async () => {
  const res = await call("get_cam_timeline", { slug: "breckenridge", hours: 24 });
  assert.notEqual(res.isError, true);
  const doc = res.structuredContent as { frameCount: number; camCount: number; newestCapturedAt: string; lastStorm: { capturedAt: string } | null; cams: Array<{ camId: string; frames: Array<{ capturedAt: string }> }> };
  assert.equal(doc.camCount, 1);
  assert.equal(doc.frameCount, 2, "the 2026-12-18 frame is outside 24 h");
  assert.deepEqual(doc.cams[0].frames.map((f) => f.capturedAt), ["2026-12-20T06:00:00Z", "2026-12-20T12:00:00Z"], "oldest first");
  assert.equal(doc.newestCapturedAt, "2026-12-20T12:00:00Z");
  assert.equal(doc.lastStorm?.capturedAt, "2026-12-20T12:00:00Z");
  assert.match(text(res), /storage\/v1\/object\/public\/cam-stills/);

  const none = await call("get_cam_timeline", { slug: "vail" });
  const empty = none.structuredContent as { frameCount: number; note: string };
  assert.equal(empty.frameCount, 0);
  assert.match(empty.note, /No archived frames/);

  const wrongCam = await call("get_cam_timeline", { slug: "vail", camId: "00000000-0000-4000-8000-000000000000" });
  assert.equal(wrongCam.isError, true);

  const down = await call("get_cam_timeline", { slug: "breckenridge" }).catch(() => null);
  assert.ok(down);
});

test("get_cam_timeline degrades when the archive read fails", async () => {
  const broken = buildTools(fixtureData({ camStills: async () => { throw new Error("view missing"); } }));
  const tool = broken.find((t) => t.name === "get_cam_timeline")!;
  const res = await tool.handler(tool.inputSchema.parse({ slug: "breckenridge" }));
  assert.notEqual(res.isError, true);
  assert.match((res.structuredContent as { note: string }).note, /unavailable/);
});

test("ask routes a question to a tool, quotes a dated sentence and cites the resort", async () => {
  const res = await call("ask", { question: "How much snow did Breck get?" });
  assert.notEqual(res.isError, true);
  const answer = AskAnswerSchema.parse(res.structuredContent);
  assert.equal(answer.answerable, true);
  assert.equal(answer.intent, "conditions");
  assert.equal(answer.tool, "get_resort_conditions");
  assert.equal(answer.resort?.slug, "breckenridge");
  assert.match(answer.sentence, /^As of .* MT Dec 20, the Breckenridge SNOTEL station/);
  assert.match(answer.sentence, /9 in\. of new snow in 24 h/);
  assert.deepEqual(answer.citations, ["https://www.peakcam.io/resorts/breckenridge"]);
  assert.equal(answer.asOf, "2026-12-20T12:00:00.000Z");
  assert.equal((answer.data as { slug: string }).slug, "breckenridge");
  assert.match(text(res), /Routed to get_resort_conditions/);
});

test("ask declines unanswerable questions, offers suggestions and logs them without PII", async () => {
  logged.length = 0;
  const res = await call("ask", { question: "Book me a flight to Denver, my email is jo@example.com" });
  const answer = AskAnswerSchema.parse(res.structuredContent);
  assert.equal(answer.answerable, false);
  assert.equal(answer.intent, "unknown");
  assert.equal(answer.data, null);
  assert.ok(answer.suggestions.length >= 5);
  assert.equal(logged.length, 1);
  assert.equal(logged[0].via, "mcp");
  assert.equal(logged[0].ipHash, null);
  assert.doesNotMatch(logged[0].question, /example\.com/);
  assert.match(logged[0].question, /\[email\]/);
});

// ── P5 history tools ─────────────────────────────────────────

test("get_season_stats: season-to-date numbers on both baselines, last year, and a dated sentence", async () => {
  const res = await call("get_season_stats", { slug: "breckenridge" });
  assert.notEqual(res.isError, true);
  const doc = res.structuredContent as Record<string, unknown> & { percentOfNormal: Record<string, unknown>; lastYear: Record<string, unknown> | null };
  assert.equal(doc.available, true);
  assert.equal((doc.season as { label: string }).label, "2026-27");
  assert.equal(doc.asOf, "2026-12-19");
  assert.equal(doc.powderDays, 1);
  assert.equal(doc.powderDayThresholdIn, 8);
  assert.ok(Math.abs((doc.percentOfNormal.normalToDateIn as number) - 56.7) < 1e-9, "day 81 (Dec 20 Mountain) × 0.7");
  assert.ok(typeof doc.percentOfNormal.thirtyYear === "number");
  assert.match(doc.percentOfNormal.baselineNote as string, /14% below/);
  assert.ok(doc.lastYear && (doc.lastYear.seasonToDateIn as number) > 0);
  assert.match(text(res), /^# Breckenridge season 2026-27 to date — https:\/\/www\.peakcam\.io\/resorts\/breckenridge\/history/);
  assert.match(text(res), /Through Dec 19, the Breckenridge SNOTEL station \(Vail Mountain\) has measured/);
  assert.match(text(res), /Same day last season \(2025-26\)/);
});

test("get_season_stats for a resort with no rows answers zeros, not an error; a pre-P5 source answers available: false", async () => {
  const res = await call("get_season_stats", { slug: "alta" });
  assert.notEqual(res.isError, true);
  const doc = res.structuredContent as Record<string, unknown>;
  assert.equal(doc.seasonToDateIn, 0);
  assert.equal(doc.asOf, null);
  assert.match(text(res), /No daily measurements yet this season for Alta/);

  const { client: old, server: oldServer } = await connect(fixtureData({ resortHistory: undefined, seasonAggregates: undefined }));
  const legacy = await old.callTool({ name: "get_season_stats", arguments: { slug: "breckenridge" } });
  assert.notEqual(legacy.isError, true);
  assert.equal((legacy.structuredContent as Record<string, unknown>).available, false);
  const board = await old.callTool({ name: "get_leaderboard", arguments: { kind: "season-snowfall" } });
  assert.equal((board.structuredContent as Record<string, unknown>).unavailable, true);
  await old.close();
  await oldServer.close();
});

test("get_monthly_climatology: months in season order, both baselines, the January note", async () => {
  const res = await call("get_monthly_climatology", { slug: "breckenridge" });
  assert.notEqual(res.isError, true);
  const doc = res.structuredContent as { available: boolean; months: Array<{ month: number; label: string; recentVsThirtyPct: number | null; baselineNote: string | null }> };
  assert.equal(doc.available, true);
  assert.deepEqual(doc.months.slice(0, 4).map((m) => m.month), [10, 11, 12, 1]);
  const jan = doc.months.find((m) => m.month === 1)!;
  assert.equal(jan.recentVsThirtyPct, 72);
  assert.match(jan.baselineNote ?? "", /28% below/);
  assert.match(text(res), /\| Jan \| 25 in \| 18 in \(72%\) \|/);
  const none = await call("get_monthly_climatology", { slug: "ski-portillo" });
  assert.equal((none.structuredContent as { available: boolean }).available, false);
});

test("get_leaderboard ranks from the aggregates, filters by state, and deepest-base needs none", async () => {
  const res = await call("get_leaderboard", { kind: "season-snowfall", limit: 5 });
  assert.notEqual(res.isError, true);
  const doc = res.structuredContent as { results: Array<{ slug: string; value: number; station: { name: string | null } | null }>; sentence: string; unavailable: boolean };
  assert.deepEqual(doc.results.map((r) => [r.slug, r.value]), [["alta", 120], ["breckenridge", 64], ["vail", 50]]);
  assert.equal(doc.results[0].station?.name, "Snowbird", "the 766:UT:SNTL name from the bundled index");
  assert.match(doc.sentence, /the most snow since Oct 1 is 120 in\. at Alta \(SNOTEL\), then 64 in\. at Breckenridge \(SNOTEL\)\./);
  const co = await call("get_leaderboard", { kind: "season-powder-days", state: "co" });
  assert.deepEqual((co.structuredContent as { results: Array<{ slug: string }> }).results.map((r) => r.slug), ["breckenridge", "vail"]);
  const base = await call("get_leaderboard", { kind: "deepest-base", sourceOnly: "snotel" });
  const baseDoc = base.structuredContent as { results: Array<{ slug: string; value: number; source: string }> };
  assert.deepEqual(baseDoc.results.map((r) => r.slug), ["alta", "vail", "breckenridge"]);
  assert.ok(baseDoc.results.every((r) => r.source === "snotel"));
});

test("get_snow_history with season returns every daily row of that season, oldest first, with new snow", async () => {
  const res = await call("get_snow_history", { slug: "breckenridge", season: "2024-25" });
  assert.notEqual(res.isError, true);
  const doc = res.structuredContent as { season: string | null; count: number; rows: Array<{ date: string; newSnowIn?: number | null }> };
  assert.equal(doc.season, "2024-25");
  assert.equal(doc.count, 273);
  assert.equal(doc.rows[0].date, "2024-10-01");
  assert.equal(doc.rows[59].newSnowIn, 14, "the day-60 storm plus the every-third-day inch");
  assert.match(text(res), /season 2024-25 daily history \(273 rows from 2024-10-01/);
  const current = await call("get_snow_history", { slug: "breckenridge", season: "current" });
  assert.equal((current.structuredContent as { season: string }).season, "2026-27");
  assert.equal((current.structuredContent as { count: number }).count, 80);
  const plain = await call("get_snow_history", { slug: "breckenridge", days: 2 });
  assert.equal((plain.structuredContent as { season: string | null }).season, null);
});

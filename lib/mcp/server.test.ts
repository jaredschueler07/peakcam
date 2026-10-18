import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import type { Cam, ResortStationJoined, ResortWithData, SnowReport, WeatherPeriod } from "@/lib/types";
import type { ResortOpening } from "@/lib/openings";
import type { PublicApiCatalog } from "@/lib/public-api/data";
import { CamListSchema, PowderListSchema, ResortSchema } from "@/lib/public-api/schema";
import pkg from "@/package.json";
import {
  PEAKCAM_MCP_INSTRUCTIONS,
  PEAKCAM_MCP_NAME,
  PEAKCAM_RESOURCE_TEMPLATE,
  READ_ONLY_TOOL_ANNOTATIONS,
  createPeakCamServer,
} from "./server";
import { MAX_CAMS, PEAKCAM_TOOL_NAMES, buildTools, diceSimilarity, editDistance, matchResorts, normalizeText, scoreResort } from "./tools";
import type { McpDataSource, SnowHistoryRow } from "./types";

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

function catalog(): PublicApiCatalog {
  return {
    resorts: RESORTS,
    openings: new Map(OPENINGS.map((o) => [o.resort_id, o])),
    elevations: { "id-breckenridge": { base_ft: 9600, summit_ft: 12998 } },
    stations: STATIONS,
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

const calls = { catalog: 0, forecast: 0, history: 0 };

function fixtureData(over: Partial<McpDataSource> = {}): McpDataSource {
  return {
    async catalog() {
      calls.catalog++;
      return catalog();
    },
    async forecast(r) {
      calls.forecast++;
      return r.country === "US" ? FORECAST : null;
    },
    async snowHistory(resortId, days) {
      calls.history++;
      return resortId === "id-breckenridge" ? HISTORY.slice(0, days) : [];
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

test("tools/list returns the nine tools, each read-only with input and output schemas", async () => {
  const { tools } = await client.listTools();
  assert.deepEqual(
    tools.map((t) => t.name),
    [...PEAKCAM_TOOL_NAMES],
  );
  assert.equal(tools.length, 9);
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

test("get_forecast returns NWS periods for US resorts and available=false elsewhere", async () => {
  const res = await call("get_forecast", { slug: "vail" });
  const doc = res.structuredContent as { available: boolean; provider: string; periods: Array<{ dow: string; snowInchesEstimate: number }>; note: string | null };
  assert.equal(doc.available, true);
  assert.equal(doc.provider, "nws");
  assert.equal(doc.periods.length, 2);
  assert.equal(doc.periods[0].snowInchesEstimate, 8);
  assert.equal(doc.note, null);
  const md = text(res);
  assert.match(md, /\| Today 2026-12-20 \| Heavy Snow \| 22 \/ 9 \| 90 \| 15 mph W \| ~8 in \|/);
  assert.match(md, /keyword heuristics/);

  const before = calls.forecast;
  const chile = (await call("get_forecast", { slug: "ski-portillo" })).structuredContent as { available: boolean; note: string | null; periods: unknown[] };
  assert.equal(chile.available, false);
  assert.match(chile.note ?? "", /US resorts only/);
  assert.deepEqual(chile.periods, []);
  assert.equal(calls.forecast, before, "no NWS call for a non-US resort");
});

test("get_forecast degrades to available=false when NWS does not answer", async () => {
  const { client: c, server: s } = await connect(fixtureData({ forecast: async () => null }));
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
  const cat = catalog();
  const expected = pageMarkdown(serializeResort(RESORTS[0], serializeOptionsFor(cat, RESORTS[0])), { now: cat.now });
  assert.equal(content.text, expected);
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
    get_snow_history: { slug: "breckenridge", days: 2 },
    get_opening_dates: { state: "CO" },
    get_stations: { slug: "alta" },
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

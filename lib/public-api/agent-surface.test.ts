import { test } from "node:test";
import assert from "node:assert/strict";
import type { Cam, ResortWithData, SnowReport } from "@/lib/types";
import type { PublicApiCatalog } from "./data";
import { buildStatus, STATUS_REPORT_MAX_AGE_HOURS } from "./status";
import { buildSearchIndex } from "./search-index";
import { matchBatchPath, parseBatchBody, BATCH_MAX_REQUESTS } from "./batch";
import { buildJsonSchemas, buildSchemaIndex, schemaFileStem, schemaUrl } from "./json-schemas";
import { buildLlmsFull, RATE_LIMIT_TEXT } from "./llms-full";
import { buildGptInstructions } from "./gpt-instructions";
import { SearchIndexSchema, StatusSchema } from "./schema";
import { buildTools } from "@/lib/mcp/tools";
import { PEAKCAM_TOOL_NAMES } from "@/lib/mcp/tool-names";
import { TOOL_EXAMPLES } from "@/lib/mcp/examples";
import type { McpDataSource } from "@/lib/mcp/types";

// P9 block 1: the pure builders behind /api/v1/status, /api/v1/resorts/
// search-index, /api/v1/batch, /.well-known/schemas, /llms-full.txt and
// /gpt-instructions.md. No env, no network.

const NOW = new Date("2026-12-20T18:00:00Z");

function report(over: Partial<SnowReport> = {}): SnowReport {
  return {
    id: "sr", resort_id: "r", base_depth: 40, new_snow_24h: 5, new_snow_48h: 9, trails_open: null, trails_total: null, lifts_open: null, lifts_total: null,
    conditions: null, source: "snotel", updated_at: "2026-12-20T12:00:00Z", swe_in: 9, pct_of_normal: 110, trend_7d: "rising", outlook: "stable", auto_cond_rating: "good", snowing_now: false,
    ...over,
  };
}

function cam(over: Partial<Cam> = {}): Cam {
  return {
    id: `cam-${Math.random().toString(36).slice(2, 8)}`, resort_id: "r", name: "Summit", elevation: null, embed_type: "image", embed_url: "https://cams.example.com/a.jpg", youtube_id: null,
    is_active: true, consecutive_failures: 0, auto_disabled: false, last_checked_at: "2026-12-20T11:00:00Z", created_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

function resort(slug: string, name: string, over: Partial<ResortWithData> = {}): ResortWithData {
  return {
    id: `id-${slug}`, name, slug, state: "CO", country: "US", region: "Colorado Rockies", lat: 39.5, lng: -106.1, website_url: null, cam_page_url: null, cond_rating: "good",
    snotel_station_id: "842:CO:SNTL", x_url: null, facebook_url: null, instagram_url: null, is_active: true, created_at: "2026-01-01T00:00:00Z", snow_report: report(), cams: [cam()],
    ...over,
  };
}

function catalog(resorts: ResortWithData[], now = NOW): PublicApiCatalog {
  return { resorts, openings: new Map(), elevations: {}, stations: null, now };
}

const HEALTHY = catalog([
  resort("breckenridge", "Breckenridge"),
  resort("alta", "Alta Ski Area", { state: "UT", cams: [cam(), cam({ consecutive_failures: 3 })] }),
  resort("ski-portillo", "Ski Portillo", { state: "Chile", country: "CL", snotel_station_id: null, snow_report: report({ source: "open_meteo" }), cams: [cam({ last_checked_at: null })] }),
  resort("big-sky", "Big Sky", { state: "MT", snow_report: null, cams: [] }),
]);

// ── status ───────────────────────────────────────────────────

test("status: ok when the newest report is fresh and most cams pass; cam ratio below 90 % degrades", () => {
  const allLive = catalog(HEALTHY.resorts.map((r) => ({ ...r, cams: r.cams.map((c) => cam({ id: c.id })) })));
  const fine = StatusSchema.parse(buildStatus(allLive));
  assert.equal(fine.status, "ok");
  assert.deepEqual(fine.issues, []);
  assert.equal(fine.checks.cams.liveRatio, 1);

  const doc = StatusSchema.parse(buildStatus(HEALTHY));
  assert.equal(doc.checks.snowReports.status, "ok");
  assert.equal(doc.checks.snowReports.resorts, 4);
  assert.equal(doc.checks.snowReports.reporting, 3);
  assert.equal(doc.checks.snowReports.ageHours, 6);
  assert.deepEqual(doc.checks.snowReports.bySource, { snotel: 2, open_meteo: 1 });
  assert.equal(doc.checks.cams.total, 4);
  assert.equal(doc.checks.cams.live, 2);
  assert.equal(doc.checks.cams.down, 1);
  assert.equal(doc.checks.cams.unchecked, 1);
  assert.equal(doc.checks.cams.liveRatio, 0.667, "2 of 3 checked");
  assert.equal(doc.checks.cams.status, "degraded");
  assert.equal(doc.status, "degraded");
});

test("status: degraded when the newest report is older than the sync cadence allows", () => {
  const late = catalog(HEALTHY.resorts.map((r) => ({ ...r, cams: [cam()] })), new Date("2026-12-21T12:00:00Z"));
  const doc = buildStatus(late);
  assert.equal(doc.checks.cams.status, "ok");
  assert.equal(doc.checks.snowReports.status, "degraded");
  assert.equal(doc.checks.snowReports.ageHours, 24);
  assert.equal(doc.checks.snowReports.staleResorts, 0, "24 h is not yet over the 24 h stale line");
  assert.match(doc.issues[0], new RegExp(`${STATUS_REPORT_MAX_AGE_HOURS} h`));
  const empty = buildStatus(catalog([resort("x", "X", { snow_report: null, cams: [] })]));
  assert.equal(empty.status, "degraded");
  assert.match(empty.issues[0], /No resort has a snow report/);
});

// ── search index ─────────────────────────────────────────────

test("search index: alphabetical, with aliases, coordinates and canonical URLs", () => {
  const doc = SearchIndexSchema.parse(buildSearchIndex(HEALTHY));
  assert.deepEqual(doc.resorts.map((r) => r.slug), ["alta", "big-sky", "breckenridge", "ski-portillo"]);
  const alta = doc.resorts[0];
  assert.equal(alta.aliases.includes("alta"), false, "the slug itself is not published as an alias");
  assert.equal(alta.aliases.includes("alta ski area"), false, "nor is the full name");
  assert.equal(alta.canonicalUrl, "https://www.peakcam.io/resorts/alta");
  assert.equal(alta.lon, -106.1);
  assert.ok(doc.resorts[2].aliases.includes("breck"));
  assert.ok(doc.resorts[3].aliases.includes("portillo"));
});

// ── batch ────────────────────────────────────────────────────

test("batch: parses both body shapes, caps at ten, and refuses anything that is not a known GET route", () => {
  const ok = parseBatchBody({ requests: [{ path: "/api/v1/resorts/alta" }, { path: "/api/v1/powder?state=CO&limit=3" }, { path: "/api/v1/resorts/vail/cams" }] });
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.deepEqual(ok.paths.map((p) => p.route), ["resort", "powder", "cams"]);
    assert.equal(ok.paths[0].slug, "alta");
    assert.equal(ok.paths[2].slug, "vail");
  }
  const bare = parseBatchBody(["/api/v1/status", "/api/v1/resorts/search-index", "/api/v1/ask?q=is+alta+open", "/api/v1/resorts"]);
  assert.ok(bare.ok);
  if (bare.ok) assert.deepEqual(bare.paths.map((p) => p.route), ["status", "searchIndex", "ask", "resorts"]);

  const tooMany = parseBatchBody(Array.from({ length: BATCH_MAX_REQUESTS + 1 }, () => "/api/v1/status"));
  assert.ok(!tooMany.ok && tooMany.error === "too_many_requests");
  for (const bad of ["/api/v1/openapi.json", "/api/mcp", "/api/alerts/trigger", "https://evil.example/api/v1/resorts", "/api/v1/resorts/../alerts", "/api/v1/batch", "/api/v1/resorts/Alta"]) {
    assert.equal(matchBatchPath(bad), null, bad);
    const r = parseBatchBody([bad]);
    assert.ok(!r.ok && r.error === "disallowed_path", bad);
  }
  assert.ok(!parseBatchBody({}).ok);
  assert.ok(!parseBatchBody({ requests: [] }).ok);
  assert.ok(!parseBatchBody({ requests: [{ nope: 1 }] }).ok);
});

// ── JSON schemas ─────────────────────────────────────────────

test("well-known schemas: every $ref points at a file the directory serves, with the documented stems", () => {
  const files = buildJsonSchemas();
  const index = buildSchemaIndex();
  assert.equal(index.count, Object.keys(files).length);
  for (const stem of ["resort", "cams", "powder", "status", "search-index", "ask", "batch", "resort-list", "measurement", "cam"]) {
    assert.ok(stem in files, `missing ${stem}.json`);
  }
  assert.equal(schemaFileStem("CamList"), "cams");
  assert.equal(schemaFileStem("TrendMeasurement"), "trend-measurement");
  assert.equal(schemaUrl("Resort"), "https://www.peakcam.io/.well-known/schemas/resort.json");
  const urls = new Set(index.schemas.map((s) => s.url));
  for (const [stem, schema] of Object.entries(files)) {
    assert.equal(schema.$id, `https://www.peakcam.io/.well-known/schemas/${stem}.json`);
    assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
    const refs = JSON.stringify(schema).match(/"\$ref":"([^"]+)"/g) ?? [];
    for (const r of refs) {
      const target = r.slice('"$ref":"'.length, -1);
      assert.ok(urls.has(target), `${stem}.json has a dangling $ref ${target}`);
    }
  }
});

// ── llms-full.txt and gpt-instructions.md ────────────────────

const never = async (): Promise<never> => {
  throw new Error("not called");
};
const STUB: McpDataSource = { catalog: never, forecast: never, forecastRuns: never, forecastAccuracy: never, snowHistory: never, camStills: never };

test("llms-full.txt documents every tool with an example that parses, every REST route, the attribution line and the real rate limit", () => {
  const text = buildLlmsFull();
  const tools = buildTools(STUB);
  assert.equal(tools.length, PEAKCAM_TOOL_NAMES.length);
  for (const tool of tools) {
    assert.ok(text.includes(`### ${tool.name} — ${tool.title}`), `${tool.name} has a section`);
    assert.ok(text.includes(`--tool-name ${tool.name}`), `${tool.name} has an inspector example`);
    const example = TOOL_EXAMPLES[tool.name];
    assert.doesNotThrow(() => tool.inputSchema.parse(example.args), `${tool.name} example parses against its inputSchema`);
  }
  for (const route of ["GET /api/v1/resorts", "GET /api/v1/resorts/search-index", "GET /api/v1/resorts/{slug}", "GET /api/v1/resorts/{slug}/cams", "GET /api/v1/powder", "GET /api/v1/status", "GET /api/v1/ask", "POST /api/v1/ask", "POST /api/v1/batch", "GET /ask"]) {
    assert.ok(text.includes(`### ${route}`), `${route} is documented`);
  }
  assert.ok(text.includes("PeakCam (https://www.peakcam.io) - SNOTEL data: USDA NRCS"));
  assert.ok(text.includes(RATE_LIMIT_TEXT));
  assert.match(RATE_LIMIT_TEXT, /60 requests per minute per IP/);
  assert.match(RATE_LIMIT_TEXT, /403/);
  assert.doesNotMatch(RATE_LIMIT_TEXT, /\b429\b(?! and)/, "the live limit is a 403, not a 429");
  assert.ok(text.includes("https://www.peakcam.io/.well-known/schemas"));
  assert.ok(text.includes("https://www.peakcam.io/api/mcp"));
});

test("gpt-instructions.md names the OpenAPI Action, the ask-first workflow, the source rules and the limit", () => {
  const text = buildGptInstructions();
  assert.ok(text.includes("https://www.peakcam.io/api/v1/openapi.json"));
  assert.match(text, /getAsk/);
  assert.match(text, /batchRead/);
  assert.match(text, /answerable/);
  assert.match(text, /snotel/);
  assert.match(text, /open_meteo/);
  assert.ok(text.includes(RATE_LIMIT_TEXT));
  assert.match(text, /does not have lift or trail open counts/);
});

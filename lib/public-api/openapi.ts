// ─────────────────────────────────────────────────────────────
// Public API v1 — OpenAPI 3.1 document, generated from the zod registry.
//
// `components.schemas` is `z.toJSONSchema(publicApiRegistry)`, so the
// document can never drift from what the serializer emits: the tests parse
// serializer output against the same schemas. Pure (no Next.js) so the test
// can write it to disk for `npx @redocly/cli lint`.
// ─────────────────────────────────────────────────────────────

import { z } from "zod";
import { SITE_URL } from "@/lib/site";
import {
  PUBLIC_API_ATTRIBUTION,
  PUBLIC_API_LICENSE_URL,
  PUBLIC_API_REVALIDATE_SECONDS,
} from "./headers";
import { PUBLIC_API_VERSION, publicApiRegistry } from "./schema";
import { SCHEMAS_PATH } from "./json-schemas";
import { STATUS_REPORT_MAX_AGE_HOURS, STATUS_CAM_LIVE_MIN_RATIO } from "./status";
import { BATCH_MAX_REQUESTS } from "./batch";

type JsonObject = Record<string, unknown>;

/** Strip the per-schema `$schema`/`$id` zod adds; OpenAPI carries the dialect once at the root. */
function componentSchemas(): Record<string, JsonObject> {
  const { schemas } = z.toJSONSchema(publicApiRegistry, {
    uri: (id) => `#/components/schemas/${id}`,
    target: "draft-2020-12",
  });
  const out: Record<string, JsonObject> = {};
  for (const [id, schema] of Object.entries(schemas as Record<string, JsonObject>)) {
    const rest = { ...schema };
    delete rest.$schema;
    delete rest.$id;
    out[id] = rest;
  }
  return out;
}

const ref = (id: string) => ({ $ref: `#/components/schemas/${id}` });

const SHARED_HEADERS = {
  "X-Attribution": {
    description: "Attribution line to carry with any reuse of the data.",
    schema: { type: "string", const: PUBLIC_API_ATTRIBUTION },
  },
  Link: {
    description: 'Web links: `rel="author"` (PeakCam) and `rel="license"` (terms of reuse).',
    schema: { type: "string" },
  },
  "Cache-Control": {
    description: `public, s-maxage=${PUBLIC_API_REVALIDATE_SECONDS}, stale-while-revalidate=3600 — data refreshes on a 15-minute ISR window; the sync jobs write new reports every 6 hours.`,
    schema: { type: "string" },
  },
};

function jsonResponse(description: string, schemaId: string) {
  return {
    description,
    headers: SHARED_HEADERS,
    content: { "application/json": { schema: ref(schemaId) } },
  };
}

const ERROR_404 = {
  description: "No active resort with that slug.",
  content: { "application/json": { schema: ref("Error") } },
};

// The limit is a Vercel WAF rule in front of the app (60 requests per 60 s
// per IP on /api/v1/ and /api/mcp, action Deny), so the blocked response is the
// edge's plain-text 403 with `x-vercel-mitigated: deny`, not a JSON 429.
const ERROR_403 = {
  description:
    "Rate limit exceeded: 60 requests per minute per IP across /api/v1 and /api/mcp. The edge answers a plain-text `Forbidden` with `x-vercel-mitigated: deny` and no Retry-After; the window resets within a minute.",
  content: { "text/plain": { schema: { type: "string", example: "Forbidden" } } },
};

const ERROR_400 = {
  description: "A query parameter failed validation.",
  content: { "application/json": { schema: ref("Error") } },
};

const SLUG_PARAM = {
  name: "slug",
  in: "path",
  required: true,
  description: "The resort slug, as in `https://www.peakcam.io/resorts/{slug}`.",
  schema: { type: "string", pattern: "^[a-z0-9-]+$" },
  example: "breckenridge",
};

export function buildOpenApiDocument(baseUrl: string = SITE_URL): JsonObject {
  return {
    openapi: "3.1.0",
    jsonSchemaDialect: "https://json-schema.org/draft/2020-12/schema",
    info: {
      title: "PeakCam Public API",
      version: PUBLIC_API_VERSION,
      summary: "Live ski-resort snow conditions and webcams with per-field provenance.",
      description: [
        "Read-only JSON for the resorts PeakCam tracks across North and South America: latest snow report (base depth, 24/48 h new snow, SWE, percent of the 30-year normal, 7-day trend), season status, and webcams with a still image where one exists.",
        "",
        "Every snow number carries its own `source` and `measuredAt`. `snotel` values are NRCS SNOTEL/SCAN station telemetry, quality-controlled by PeakCam and synced every six hours; `open_meteo` values are weather-model estimates for resorts without a station. A station sits at one elevation, so its numbers can differ from a resort's own marketing report.",
        "",
        `No authentication. Rate limit: 60 requests per minute per IP across /api/v1 and /api/mcp, enforced at the edge (a plain-text 403, see each operation). Responses are cacheable for ${PUBLIC_API_REVALIDATE_SECONDS} s. When you quote a value, cite the resort's \`canonicalUrl\` and keep the attribution line.`,
        "",
        `Agents: \`GET /ask?q=\` answers a question deterministically (one tool call, a dated sentence, citations; never a guess); \`POST /batch\` runs up to ${BATCH_MAX_REQUESTS} reads in one request; \`GET /resorts/search-index\` is the name-to-slug table. The same data is an MCP server at ${baseUrl}/api/mcp (setup: ${baseUrl}/connect). An NLWeb-shaped form of the answer endpoint is at ${baseUrl}/ask (outside this server's base path).`,
        "",
        `Methodology: ${baseUrl}/methodology. Short and long agent guides: ${baseUrl}/llms.txt, ${baseUrl}/llms-full.txt. Standalone JSON Schemas for every shape below: ${baseUrl}${SCHEMAS_PATH}.`,
      ].join("\n"),
      contact: { name: "PeakCam", url: baseUrl },
      license: { name: "PeakCam Terms of Service", url: PUBLIC_API_LICENSE_URL },
      "x-attribution": PUBLIC_API_ATTRIBUTION,
      "x-mcp-endpoint": `${baseUrl}/api/mcp`,
      "x-nlweb-endpoint": `${baseUrl}/ask`,
      "x-json-schemas": `${baseUrl}${SCHEMAS_PATH}`,
    },
    externalDocs: { description: "How the numbers are measured", url: `${baseUrl}/methodology` },
    servers: [{ url: `${baseUrl}/api/v1`, description: "Production" }],
    // Explicitly unauthenticated: an empty requirement list is the OpenAPI
    // way to say "no security scheme applies" (and what linters look for).
    security: [],
    tags: [
      { name: "resorts", description: "Catalogue and per-resort conditions." },
      { name: "cams", description: "Webcams and stills." },
      { name: "forecast", description: "Blended multi-model snow forecast and its verification." },
      { name: "powder", description: "Ranked new-snow queries." },
      { name: "ask", description: "The deterministic answer endpoint." },
      { name: "batch", description: "Several reads in one request." },
      { name: "status", description: "Service health derived from the data." },
      { name: "history", description: "Season history, season-to-date stats and monthly climatology per resort." },
      { name: "leaderboards", description: "Season rankings: 7-day snow, powder days, deepest base, season snowfall." },
    ],
    paths: {
      "/resorts": {
        get: {
          operationId: "listResorts",
          tags: ["resorts"],
          summary: "List every active resort with headline snow numbers",
          description: "Alphabetical. One row per resort with base depth and new snow, the report source, rating, season status and cam counts. Fetch `/resorts/{slug}` for provenance per field, the season detail and the cam list.",
          responses: { "200": jsonResponse("The resort list.", "ResortList"), "403": ERROR_403 },
        },
      },
      "/resorts/{slug}": {
        get: {
          operationId: "getResort",
          tags: ["resorts"],
          summary: "One resort: location, latest snow report with provenance, season, cams",
          parameters: [SLUG_PARAM],
          responses: {
            "200": jsonResponse("The resort document.", "Resort"),
            "404": ERROR_404,
            "403": ERROR_403,
          },
        },
      },
      "/resorts/{slug}/cams": {
        get: {
          operationId: "getResortCams",
          tags: ["cams"],
          summary: "The resort's webcams",
          description: "Active cams with health (`live`), a still URL where the operator publishes one or PeakCam captured one, and `capturedAt` only for PeakCam captures. Frames are linked, never proxied; rights stay with the operator.",
          parameters: [SLUG_PARAM],
          responses: {
            "200": jsonResponse("The cam list.", "CamList"),
            "404": ERROR_404,
            "403": ERROR_403,
          },
        },
      },
      "/resorts/{slug}/conditions": {
        get: {
          operationId: "getResortConditions",
          tags: ["resorts"],
          summary: "Conditions contract v2: every field with source, time, confidence and freshness, plus the derived status",
          description:
            "The versioned conditions envelope (`schemaVersion`, `schemaUrl`). `data` carries one Field per measure (`value`, `source`, `observedAt`, `confidence`, `freshness.tier` and `ageHours`): base depth (measured, with the operator's own figure beside it and a `depthDisagreement` block when they differ by more than 30 %), new snow 24/48 h, SWE, percent of normal, lifts and runs open and total, surface, snow quality, temperature and wind from the nearest station, the blended 48-hour forecast, and the season dates. `data.status` is derived from the operator feed, the resort's confirmed opening date and the resort's own calendar day: OPEN, CLOSED_TODAY, PRE_SEASON, OFF_SEASON or UNKNOWN, never defaulting to open; `recommendableToday` and `reasons` say why. `meta.freshness` lists the tier per field; `measuredNow` is the station layer. `sentence` is a dated line to quote.",
          parameters: [SLUG_PARAM],
          responses: {
            "200": jsonResponse("The conditions envelope.", "ResortConditions"),
            "404": ERROR_404,
            "403": ERROR_403,
          },
        },
      },
      "/resorts/{slug}/forecast": {
        get: {
          operationId: "getResortForecast",
          tags: ["forecast"],
          summary: "Blended 14-day snow forecast with every model run",
          description:
            "Per day, the median snowfall across the models that reach that day (ECMWF IFS, GFS, GEM, ICON, JMA, Météo-France, UKMO; NBM and HRRR added for US points), with the 25th/75th percentile across models as `snowfallLoIn`/`snowfallHiIn` and `modelCount` per day. `summary` carries next 48 h, 7- and 14-day totals and the peak day; `byModel` is the newest run per model in the provider's units (cm, °C, km/h). Runs are stored every 6 hours from Open-Meteo at the resort's summit and base elevations. `available: false` with empty arrays when no run is current. Weather data by Open-Meteo.com (CC BY 4.0): carry the `credits` line with any reuse.",
          parameters: [SLUG_PARAM, { name: "point", in: "query", description: "Which elevation's blend to return. Falls back to the other point with a `note` when the asked one has no runs.", schema: { type: "string", enum: ["summit", "base"], default: "summit" } }],
          responses: {
            "200": jsonResponse("The forecast document.", "Forecast"),
            "400": ERROR_400,
            "404": ERROR_404,
            "403": ERROR_403,
          },
        },
      },
      "/resorts/{slug}/forecast-accuracy": {
        get: {
          operationId: "getResortForecastAccuracy",
          tags: ["forecast"],
          summary: "How each model has verified at this resort over 90 days",
          description:
            "One row per model plus `blend`, ranked by day-1 mean absolute error (cm), with day-3 and day-7 MAE, a bias ratio (total forecast over total measured; above 1 over-forecasts) and `samples` (measured days graded). `truthBasis` says what the forecasts were graded against — `snotel` means NRCS station depth change clipped at zero, measured, not modelled — and `measuredDays` how many days of the window had a measurement. Empty `models` until the scorer has measured days for the resort.",
          parameters: [SLUG_PARAM],
          responses: {
            "200": jsonResponse("The accuracy document.", "ForecastAccuracy"),
            "404": ERROR_404,
            "403": ERROR_403,
          },
        },
      },
      "/resorts/search-index": {
        get: {
          operationId: "getSearchIndex",
          tags: ["resorts"],
          summary: "Slug, name, aliases and coordinates for every resort",
          description:
            "The name-to-slug table: every active resort with the lowercase aliases the answer endpoint also accepts (nicknames, the name minus generic suffixes), its state or country, coordinates and page URL. Alphabetical. Changes only when resorts are imported, so it is cached for a day.",
          responses: { "200": jsonResponse("The search index.", "SearchIndex"), "403": ERROR_403 },
        },
      },
      "/powder": {
        get: {
          operationId: "findPowder",
          tags: ["powder"],
          summary: "Resorts ranked by new snow",
          description: "Ranked by the chosen window (default 24 h) descending, the other window as tiebreak. Resorts without a value for the window are omitted. `source=snotel` restricts to station-measured reports.",
          parameters: [
            { name: "window", in: "query", schema: { type: "string", enum: ["24h", "48h"], default: "24h" } },
            { name: "state", in: "query", description: "State/province code or country name as stored, case-insensitive (`CO`, `BC`, `Chile`).", schema: { type: "string" } },
            { name: "minInches", in: "query", description: "Minimum new snow in the window, inches.", schema: { type: "number", minimum: 0 } },
            { name: "source", in: "query", description: "Keep only reports from this source.", schema: ref("MeasurementSource") },
            { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 200, default: 25 } },
          ],
          responses: {
            "200": jsonResponse("The ranking.", "PowderList"),
            "400": ERROR_400,
            "403": ERROR_403,
          },
        },
      },
      "/status": {
        get: {
          operationId: "getServiceStatus",
          tags: ["status"],
          summary: "Service status derived from the data",
          description: `Two checks with stated thresholds: the newest snow report must be under ${STATUS_REPORT_MAX_AGE_HOURS} h old (the sync jobs write every 6 h) and at least ${Math.round(STATUS_CAM_LIVE_MIN_RATIO * 100)} % of checked cams must have passed their last probe. Answers 200 with \`status: "degraded"\` when a check fails, so read the body; a 503 means the catalogue read itself failed. Cached 5 minutes.`,
          responses: {
            "200": jsonResponse("The status document (ok or degraded).", "Status"),
            "503": { description: "The status check itself failed.", content: { "application/json": { schema: { type: "object", properties: { status: { type: "string", const: "degraded" }, generatedAt: { type: "string" }, issues: { type: "array", items: { type: "string" } } } } } } },
            "403": ERROR_403,
          },
        },
      },
      "/ask": {
        get: {
          operationId: "getAsk",
          tags: ["ask"],
          summary: "Answer a natural-language question deterministically",
          description:
            "Resolves the resort the question names (name, slug or nickname, one typo of slack), picks an intent from the wording (snow, open/closed, forecast, cams, cam timeline, history, compare, where did it snow, percent of normal, profile, regions, alerts), runs the one matching tool and returns its structured result with a dated, source-labelled sentence and the URLs to cite. No language model. Unanswerable questions are a 200 with `answerable: false` and suggestions, never a guess. Only a missing or oversized question is a 400. Also accepts `query` and `question` as the parameter name.",
          parameters: [{ name: "q", in: "query", required: true, description: "The question as the user asked it, up to 300 characters.", schema: { type: "string", maxLength: 300 }, example: "is Alta open" }],
          responses: {
            "200": jsonResponse("The answer, answerable or not.", "AskAnswer"),
            "400": ERROR_400,
            "403": ERROR_403,
          },
        },
        post: {
          operationId: "postAsk",
          tags: ["ask"],
          summary: "Answer a question (JSON body)",
          description: "Identical to the GET; the question is `query` (or `q`, `question`) in a JSON body.",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { type: "object", required: ["query"], properties: { query: { type: "string", maxLength: 300 } } }, example: { query: "where did it snow most in Colorado" } } },
          },
          responses: {
            "200": jsonResponse("The answer, answerable or not.", "AskAnswer"),
            "400": ERROR_400,
            "403": ERROR_403,
          },
        },
      },
      // ── P5: history, season stats, monthly climatology, leaderboards ──
      "/resorts/{slug}/history": {
        get: {
          operationId: "getResortHistory",
          tags: ["history"],
          summary: "Season snowfall curve vs the station's normal band, plus ten past seasons",
          description:
            "The current season's cumulative measured snowfall by day (daily new snow = the positive change in station depth, a floor on what fell) against the station's 30-winter normal band (mean, p25, p75, with the recent-decade mean), and up to ten past seasons with totals, snow and powder days, the biggest storm, the deepest base, weekly cumulative totals and the winter's ENSO phase. Resorts without a station get the curve without a band. Backs https://www.peakcam.io/resorts/{slug}/history.",
          parameters: [SLUG_PARAM],
          responses: { "200": jsonResponse("The history document.", "ResortHistory"), "404": ERROR_404, "403": ERROR_403 },
        },
      },
      "/resorts/{slug}/season-stats": {
        get: {
          operationId: "getResortSeasonStats",
          tags: ["history"],
          summary: "Season-to-date snowfall, powder days, base and percent of normal on two baselines",
          description:
            "Season-to-date measured snowfall, days measured, snow days, powder days (8 in or more, the alert threshold), current and deepest base, percent of the 30-winter normal to this day and of the recent decade (with a `baselineNote` when the two differ by more than 10 %), the same day last year, a 7-day trend and a dated sentence to quote.",
          parameters: [SLUG_PARAM],
          responses: { "200": jsonResponse("The season stats.", "SeasonStats"), "404": ERROR_404, "403": ERROR_403 },
        },
      },
      "/resorts/{slug}/monthly": {
        get: {
          operationId: "getResortMonthly",
          tags: ["history"],
          summary: "Monthly climatology at the resort's station",
          description:
            "Average snowfall, snow days, depth and the biggest storm per calendar month over the 30 most recent complete winters and, separately, the 10 most recent, with the recent decade as a percent of the 30-winter figure. `available: false` for resorts without a station normal.",
          parameters: [SLUG_PARAM],
          responses: { "200": jsonResponse("The monthly climatology.", "MonthlyClimatology"), "404": ERROR_404, "403": ERROR_403 },
        },
      },
      "/leaderboards/{kind}": {
        get: {
          operationId: "getLeaderboard",
          tags: ["leaderboards"],
          summary: "One of the four season leaderboards",
          description:
            "`best-powder-this-week` (measured new snow in the last 7 days), `season-powder-days` (days with 8 in or more since Oct 1), `deepest-base` (latest station or model depth) and `season-snowfall` (measured new snow since Oct 1). The two season-bound boards cover the Northern hemisphere only. Each answers a dated sentence, the rule in words and ranked rows with source and station. Same data as https://www.peakcam.io/snow-report/{kind}.",
          parameters: [
            { name: "kind", in: "path", required: true, schema: ref("LeaderboardKind"), example: "season-snowfall" },
            { name: "state", in: "query", description: "State/province code or country name as stored, case-insensitive (`CO`, `BC`, `Chile`).", schema: { type: "string" } },
            { name: "source", in: "query", description: "Keep only rows from this source (`snotel` = measured only).", schema: ref("MeasurementSource") },
            { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 200, default: 25 } },
          ],
          responses: {
            "200": jsonResponse("The leaderboard.", "Leaderboard"),
            "400": ERROR_400,
            "404": { description: "Unknown leaderboard kind.", content: { "application/json": { schema: ref("Error") } } },
            "403": ERROR_403,
          },
        },
      },
      "/batch": {
        post: {
          operationId: "batchRead",
          tags: ["batch"],
          summary: `Run up to ${BATCH_MAX_REQUESTS} GET requests in one call`,
          description:
            `Accepts up to ${BATCH_MAX_REQUESTS} GET paths under /api/v1 (with query strings) and answers them in order, each with the status and body that path would have returned on its own. The paths run in-process against the same handlers, so a batch is one function invocation and one request against the edge rate limit. Read-only by construction: only /resorts, /resorts/search-index, /resorts/{slug}, /resorts/{slug}/cams, /resorts/{slug}/conditions, /resorts/{slug}/forecast, /resorts/{slug}/forecast-accuracy, /resorts/{slug}/history, /resorts/{slug}/season-stats, /resorts/{slug}/monthly, /leaderboards/{kind}, /powder, /status and /ask (GET) dispatch; any other path fails the whole batch with a 400 naming it. The response is never cached.`,
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: ref("BatchRequest"),
                example: { requests: [{ path: "/api/v1/resorts/alta" }, { path: "/api/v1/resorts/vail/cams" }, { path: "/api/v1/powder?state=UT&limit=3" }] },
              },
            },
          },
          responses: {
            "200": jsonResponse("Per-path results in request order.", "BatchResponse"),
            "400": { description: "Invalid body, more than ten paths, or a path that is not batchable.", content: { "application/json": { schema: ref("Error") } } },
            "403": ERROR_403,
          },
        },
      },
    },
    components: { schemas: componentSchemas() },
  };
}

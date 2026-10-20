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
  // Absent while an operation is current. Present only once an operation or
  // field is scheduled for removal, per the policy in info.description.
  Deprecation: {
    description:
      "RFC 9745. Present only on a deprecated operation: the moment the deprecation was announced, as an RFC 9651 Date (`@` + Unix seconds, e.g. `@1767225600`). Absent on every current operation.",
    schema: { type: "string", pattern: "^@[0-9]+$" },
    required: false,
  },
  Sunset: {
    description:
      "RFC 8594. Present only on a deprecated operation: the HTTP-date after which it may stop answering, at least 12 months after `Deprecation`. A `Link: <...>; rel=\"sunset\"` points at the changelog entry that names the replacement.",
    schema: { type: "string" },
    required: false,
  },
};

/** The versioning and deprecation commitment, printed in info.description and carried as `x-deprecation-policy`. */
export const DEPRECATION_POLICY = {
  noticeMonths: 12,
  announcedAt: ["/llms-full.txt", "/connect", "/api/v1/openapi.json"],
  headers: ["Deprecation", "Sunset", "Link rel=sunset"],
  rfcs: ["RFC 9745 (Deprecation)", "RFC 8594 (Sunset)"],
} as const;

export function deprecationPolicyText(baseUrl: string): string {
  return [
    `Versioning and deprecation: the base path carries the major version (/api/v1); within it, PeakCam only adds fields, enum values and operations, never renames or removes them without notice. `,
    `A removal is announced at least ${DEPRECATION_POLICY.noticeMonths} months ahead: the affected operation starts answering with a \`Deprecation\` header (RFC 9745, the announcement date) and a \`Sunset\` header (RFC 8594, the earliest removal date) plus \`Link: <changelog>; rel="sunset"\`, its summary in this document gains "Deprecated:" with the replacement, and the same notice appears in ${baseUrl}/llms-full.txt and on ${baseUrl}/connect. `,
    `Current operations carry neither header. A new major version is published at its own base path (/api/v2) and the previous one keeps answering for the full notice period after the new one is announced. `,
    `The MCP server (${baseUrl}/api/mcp) follows the same rule for tool names and argument shapes: a renamed tool keeps its old name registered, marked deprecated in its description, for ${DEPRECATION_POLICY.noticeMonths} months.`,
  ].join("");
}

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
        "",
        deprecationPolicyText(baseUrl),
      ].join("\n"),
      contact: { name: "PeakCam", url: baseUrl },
      license: { name: "PeakCam Terms of Service", url: PUBLIC_API_LICENSE_URL },
      "x-attribution": PUBLIC_API_ATTRIBUTION,
      "x-mcp-endpoint": `${baseUrl}/api/mcp`,
      "x-nlweb-endpoint": `${baseUrl}/ask`,
      "x-json-schemas": `${baseUrl}${SCHEMAS_PATH}`,
      "x-deprecation-policy": DEPRECATION_POLICY,
      "x-stdio-package": "npx -y peakcam-mcp",
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
      { name: "score", description: "The 0–100 Snow Score: components, history and the sortable snow-report table." },
    ],
    paths: {
      "/resorts": {
        get: {
          operationId: "listResorts",
          tags: ["resorts"],
          summary: "List every active resort with headline snow numbers",
          description: "Alphabetical by default; `sort=score` puts the highest Snow Score first. One row per resort with base depth and new snow, the report source, rating, today's Snow Score (`score`, P7), season status and cam counts. Fetch `/resorts/{slug}` for provenance per field, the season detail and the cam list.",
          parameters: [{ name: "sort", in: "query", description: "`name` (default) or `score` (today's Snow Score, unscored resorts last).", schema: { type: "string", enum: ["name", "score"], default: "name" } }],
          responses: { "200": jsonResponse("The resort list.", "ResortList"), "400": ERROR_400, "403": ERROR_403 },
        },
      },
      "/snow-report": {
        get: {
          operationId: "getSnowReport",
          tags: ["score"],
          summary: "The snow-report table, sortable by Snow Score, new snow or base",
          description:
            "Every active resort as a light row (the same shape as `/resorts`), ordered by `sort`: `score` ranks by today's 0–100 Snow Score with unscored resorts last, `newSnow24h` and `baseDepth` rank by the latest report, `name` is alphabetical. `state` keeps one state / province (or `Chile` / `Argentina`). The dated `sentence` names the top three Snow Scores among the rows kept, and `scoredAsOf` is the newest score day among them. Components per resort: `/resorts/{slug}/score-components`.",
          parameters: [
            { name: "sort", in: "query", schema: { type: "string", enum: ["name", "score", "newSnow24h", "baseDepth"], default: "name" } },
            { name: "state", in: "query", description: "Case-insensitive `resorts.state` match: `CO`, `BC`, `Chile`.", schema: { type: "string", minLength: 1, maxLength: 40 } },
          ],
          responses: { "200": jsonResponse("The snow-report table.", "SnowReportList"), "400": ERROR_400, "403": ERROR_403 },
        },
      },
      "/resorts/{slug}/score-components": {
        get: {
          operationId: "getResortScoreComponents",
          tags: ["score"],
          summary: "Today's Snow Score with its five components and the 30-day history",
          description:
            "PeakCam's 0–100 Snow Score for one resort: `today` carries the score, its four-tier `rating` (great ≥ 75, good ≥ 55, fair ≥ 35, else poor), a dated `tagline` to quote and the five `components` (depth vs normal 30, new snow over 7 days 25, blended 7-day forecast 20, snow quality 15, operating status 10), each with `points`, `max`, a one-line `basis` and its `source`. `history` is one `{date, score, rating}` per scored day over the trailing 30 days for a sparkline. `scoredBy` is always `algorithmic`: the score is a fixed function of measured and modelled inputs, documented at https://www.peakcam.io/methodology#score. `available: false` before the first scoring run.",
          parameters: [SLUG_PARAM],
          responses: { "200": jsonResponse("The score document.", "ResortScoreHistory"), "404": ERROR_404, "403": ERROR_403 },
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
          description: "Active cams with health (`live`), a still URL where the operator publishes one or PeakCam captured one, `capturedAt` only for PeakCam captures, and `timelapses` (the cam's rendered clips, present once the clip table is served). Frames and clips are linked, never proxied; rights stay with the operator.",
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
      "/resorts/{slug}/timelapses": {
        get: {
          operationId: "getResortTimelapses",
          tags: ["cams"],
          summary: "Rendered timelapse clips per cam: the rolling 24 h MP4 and storm reels",
          description:
            "For every cam whose operator allows archiving: the rolling 24 h clip (H.264, 7 fps, 720p max, at most 3 MB, replaced every 6 h from the still archive) with its poster JPEG and frame bounds, plus storm reels (rendered while the resort's measured 24 h new snow is at or past 8 in, from the first frame after the last dry day, capped at 72 h; one per storm day, kept a year). Links only, never inline media. `available: false` means the clip table is not served by this deployment yet; an empty `cams` list with `available: true` means nothing is rendered for this resort. Backs the Last 24 hours strip on https://www.peakcam.io/resorts/{slug}/webcams.",
          parameters: [SLUG_PARAM],
          responses: {
            "200": jsonResponse("The clip list.", "TimelapseList"),
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
            `Accepts up to ${BATCH_MAX_REQUESTS} GET paths under /api/v1 (with query strings) and answers them in order, each with the status and body that path would have returned on its own. The paths run in-process against the same handlers, so a batch is one function invocation and one request against the edge rate limit. Read-only by construction: only /resorts, /resorts/search-index, /resorts/{slug}, /resorts/{slug}/cams, /resorts/{slug}/conditions, /resorts/{slug}/timelapses, /resorts/{slug}/forecast, /resorts/{slug}/forecast-accuracy, /resorts/{slug}/score-components, /resorts/{slug}/history, /resorts/{slug}/season-stats, /resorts/{slug}/monthly, /leaderboards/{kind}, /snow-report, /powder, /status and /ask (GET) dispatch; any other path fails the whole batch with a 400 naming it. The response is never cached.`,
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

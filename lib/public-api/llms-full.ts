// ─────────────────────────────────────────────────────────────
// llms-full.txt — the long-form agent guide (https://llmstxt.org).
//
// Built from the same sources as the surfaces it describes: tool names,
// titles, descriptions and input schemas from buildTools(), one example per
// tool from lib/mcp/examples.ts, the header set and attribution line from
// headers.ts, and the rate-limit truth as docs/runbook.md records it. Pure
// (the stub data source is never called: buildTools only touches it inside
// handlers), so the route is static and the test can diff it.
// ─────────────────────────────────────────────────────────────

import { z } from "zod";
import { SITE_URL } from "@/lib/site";
import { PEAKCAM_MCP_ENDPOINT, PEAKCAM_MCP_NAME } from "@/lib/mcp/server";
import { buildTools, type ToolDefinition } from "@/lib/mcp/tools";
import { TOOL_EXAMPLES, inspectorArgs } from "@/lib/mcp/examples";
import type { McpDataSource } from "@/lib/mcp/types";
import { PUBLIC_API_ATTRIBUTION, PUBLIC_API_LICENSE_URL, PUBLIC_API_REVALIDATE_SECONDS } from "./headers";
import { SCHEMAS_PATH } from "./json-schemas";

/** docs/runbook.md "Public API": the live limit and what exceeding it looks like. */
export const RATE_LIMIT_TEXT =
  "60 requests per minute per IP across /api/v1/* and /api/mcp, enforced at the Vercel edge (cache hits count). " +
  "The 61st request inside a minute gets a plain-text 403 `Forbidden` with `x-vercel-mitigated: deny` and no Retry-After; the window resets within about a minute. " +
  "There is no 429 and no key that raises the limit. Use POST /api/v1/batch (up to 10 reads for one request) and respect Cache-Control.";

const never = async (): Promise<never> => {
  throw new Error("llms-full.txt never calls a tool");
};
const STUB: McpDataSource = { catalog: never, forecast: never, forecastRuns: never, forecastAccuracy: never, snowHistory: never, camStills: never };

interface ParamDoc {
  name: string;
  required: boolean;
  type: string;
  description: string;
}

function paramsOf(tool: ToolDefinition): ParamDoc[] {
  const schema = z.toJSONSchema(tool.inputSchema, { target: "draft-2020-12", io: "input" }) as {
    properties?: Record<string, Record<string, unknown>>;
    required?: string[];
  };
  const required = new Set(schema.required ?? []);
  return Object.entries(schema.properties ?? {}).map(([name, p]) => {
    const type = Array.isArray(p.enum)
      ? (p.enum as unknown[]).map((v) => `\`${String(v)}\``).join(" | ")
      : p.type === "array"
        ? `array of ${((p.items as { type?: string } | undefined)?.type ?? "string")}`
        : String(p.type ?? "string");
    const dflt = p.default !== undefined ? ` Default ${JSON.stringify(p.default)}.` : "";
    return { name, required: required.has(name), type, description: `${String(p.description ?? "")}${dflt}`.trim() };
  });
}

function toolSection(tool: ToolDefinition, baseUrl: string): string {
  const example = TOOL_EXAMPLES[tool.name];
  const params = paramsOf(tool);
  const lines = [
    `### ${tool.name} — ${tool.title}`,
    "",
    tool.description,
    "",
    ...(params.length
      ? ["Arguments:", ...params.map((p) => `- \`${p.name}\` (${p.type}${p.required ? ", required" : ""}): ${p.description}`)]
      : ["Arguments: none."]),
    "",
    `Example — "${example.prompt}":`,
    "",
    "```bash",
    `npx @modelcontextprotocol/inspector --cli ${baseUrl}/api/mcp --method tools/call --tool-name ${tool.name}${Object.keys(example.args).length ? ` ${inspectorArgs(example.args)}` : ""}`,
    "```",
    "",
    "Or as one JSON-RPC POST:",
    "",
    "```bash",
    `curl -s ${baseUrl}/api/mcp -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \\`,
    `  -d '${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: tool.name, arguments: example.args } })}'`,
    "```",
  ];
  return lines.join("\n");
}

interface RestDoc {
  method: "GET" | "POST";
  path: string;
  summary: string;
  example: string;
  schema: string;
}

function restDocs(baseUrl: string): RestDoc[] {
  const api = `${baseUrl}/api/v1`;
  return [
    { method: "GET", path: "/api/v1/resorts", summary: "Every active resort as a light row: headline snow numbers, source, rating, season status, cam counts.", example: `curl -s ${api}/resorts | jq '.resorts[:3]'`, schema: "resort-list" },
    { method: "GET", path: "/api/v1/resorts/search-index", summary: "Slug, name, aliases, state, country, lat/lon and page URL per resort, for client-side name matching. Cached a day.", example: `curl -s ${api}/resorts/search-index | jq '.resorts[] | select(.aliases | length > 0) | {slug, aliases}' | head -40`, schema: "search-index" },
    { method: "GET", path: "/api/v1/resorts/{slug}", summary: "One resort: location, latest snow report with per-field source and time, season, cams.", example: `curl -s ${api}/resorts/alta | jq '{name, snow: .snow.newSnow24h, season: .season.status}'`, schema: "resort" },
    { method: "GET", path: "/api/v1/resorts/{slug}/cams", summary: "The resort's cams with health, still URLs and their rendered timelapse clips (`timelapses`, when the clip table is served). Links only.", example: `curl -s ${api}/resorts/breckenridge/cams | jq '.cams[] | {name, live, stillUrl}'`, schema: "cams" },
    { method: "GET", path: "/api/v1/resorts/{slug}/timelapses", summary: "Rendered timelapse clips per cam: the rolling 24 h MP4 (7 fps, 720p max, at most 3 MB, replaced every 6 h) with its poster, plus storm reels (one per storm day, kept a year). Links only; `available: false` until the clip table is served.", example: `curl -s ${api}/resorts/alta/timelapses | jq '{clipCount, lastStorm: .lastStorm.stormDate, cams: [.cams[] | {camName, clip: .current.url, poster: .current.posterUrl, storms: [.storms[].stormDate]}]}'`, schema: "timelapses" },
    { method: "GET", path: "/api/v1/resorts/{slug}/forecast?point=summit|base", summary: "Blended 14-day snow forecast: per-day median across up to nine weather models with the 25th/75th band and model count, a summary (next 48 h, 7/14-day totals, peak), and every model run in provider units. Weather data by Open-Meteo.com (CC BY 4.0).", example: `curl -s ${api}/resorts/alta/forecast | jq '{models: .summary.modelCount, next7: .summary.total7dIn, days: [.daily[] | {date, in: .snowfallIn, lo: .snowfallLoIn, hi: .snowfallHiIn, n: .modelCount}]}'`, schema: "forecast" },
    { method: "GET", path: "/api/v1/resorts/{slug}/forecast-accuracy", summary: "Per-model verification over 90 days against measured snow: day-1/3/7 MAE (cm), bias ratio, samples, rank, with truthBasis and measuredDays. Empty models until the scorer has measured days.", example: `curl -s ${api}/resorts/alta/forecast-accuracy | jq '{truthBasis, measuredDays, best: .bestModel, models: [.models[] | {model, rank, day1Mae, biasRatio}]}'`, schema: "forecast-accuracy" },
    { method: "GET", path: "/api/v1/powder?window=24h|48h&state=&minInches=&source=snotel&limit=", summary: "Resorts ranked by new snow; `source=snotel` keeps measured reports only.", example: `curl -s '${api}/powder?window=24h&state=CO&source=snotel&limit=5' | jq '.results[] | {rank, name, in24: .newSnow24h.value}'`, schema: "powder" },
    { method: "GET", path: "/api/v1/status", summary: "Service status from the data: snow-report freshness and cam health, with thresholds. 200 even when degraded; read `status`.", example: `curl -s ${api}/status | jq '{status, age: .checks.snowReports.ageHours, cams: .checks.cams.liveRatio}'`, schema: "status" },
    { method: "GET", path: "/api/v1/resorts/{slug}/history", summary: "The season's cumulative measured snowfall curve by day against the station's 30-winter normal band (mean, p25, p75, recent-decade mean), plus ten past seasons with totals, powder days, biggest storm, deepest base, weekly cumulative totals and ENSO phase.", example: `curl -s ${api}/resorts/breckenridge/history | jq '{season: .season.label, asOf, days: (.curve.points|length), past: [.pastSeasons[] | {s: .season.label, totalIn, powderDays}]}'`, schema: "resort-history" },
    { method: "GET", path: "/api/v1/resorts/{slug}/season-stats", summary: "Season-to-date snowfall, days measured, snow and powder days, base, percent of normal on the 30-winter and recent-decade baselines (with a note when they disagree), the same day last year, a 7-day trend and a dated sentence.", example: `curl -s ${api}/resorts/breckenridge/season-stats | jq '{sentence, seasonToDateIn, powderDays, pct: .percentOfNormal.thirtyYear, lastYear: .lastYear.seasonToDateIn}'`, schema: "season-stats" },
    { method: "GET", path: "/api/v1/resorts/{slug}/monthly", summary: "Monthly climatology at the station: average snowfall, snow days, depth and biggest storm per month, 30-winter and recent-decade; `available: false` without a station normal.", example: `curl -s ${api}/resorts/alta/monthly | jq '.months[] | {label, avg: .thirtyYear.avgSnowfallIn, recent: .recentDecade.avgSnowfallIn}'`, schema: "monthly-climatology" },
    { method: "GET", path: "/api/v1/leaderboards/{kind}?state=&source=snotel&limit=", summary: "One of four boards: best-powder-this-week, season-powder-days, deepest-base, season-snowfall. Dated sentence, rule in words, ranked rows with source and station.", example: `curl -s '${api}/leaderboards/season-snowfall?state=CO&limit=5' | jq '{sentence, rows: [.results[] | {rank, name, value}]}'`, schema: "leaderboard" },
    { method: "GET", path: "/api/v1/ask?q=", summary: "Deterministic answer endpoint: resort + intent from the wording, one tool call, a dated sentence, citations. `answerable: false` instead of a guess.", example: `curl -s '${api}/ask?q=is+alta+open' | jq '{answerable, intent, tool, sentence, citations}'`, schema: "ask" },
    { method: "POST", path: "/api/v1/ask", summary: "The same with a JSON body `{\"query\": \"...\"}`.", example: `curl -s ${api}/ask -H 'content-type: application/json' -d '{"query":"where did it snow most in Utah"}' | jq .sentence`, schema: "ask" },
    { method: "POST", path: "/api/v1/batch", summary: "Up to 10 GET /api/v1 paths in one request, answered in order with each route's status and body. One request against the rate limit.", example: `curl -s ${api}/batch -H 'content-type: application/json' -d '{"requests":[{"path":"/api/v1/resorts/alta"},{"path":"/api/v1/resorts/vail/cams"},{"path":"/api/v1/powder?state=UT&limit=3"}]}' | jq '.results[] | {path, status}'`, schema: "batch" },
    { method: "GET", path: "/ask?query=", summary: "NLWeb-compatible form of the answer endpoint (`query_id`, `results[]` with `schema_object`; full answer under `peakcam`). GET or POST.", example: `curl -s '${baseUrl}/ask?query=compare+vail+and+keystone' | jq '.results[0].description'`, schema: "ask" },
  ];
}

export function buildLlmsFull(baseUrl: string = SITE_URL): string {
  const tools = buildTools(STUB);
  const rest = restDocs(baseUrl);
  const lines: string[] = [
    "# PeakCam — full guide for agents",
    "",
    `> Live ski-resort snow reports, SNOTEL measurements, webcams, forecasts, season dates and powder rankings for about 150 resorts in the US, Canada, Chile and Argentina, as an MCP server, a REST API, an answer endpoint and markdown pages. Everything here is read-only, anonymous and free. Short form: ${baseUrl}/llms.txt. Human setup page: ${baseUrl}/connect.`,
    "",
    "## What the data is",
    "",
    "- Every snow number carries a `source` and a `measuredAt`. `snotel` means measured at a USDA NRCS SNOTEL/SCAN station near the resort, quality-controlled by PeakCam and synced every 6 hours; the station sits at one elevation (`station.elevationFt`), not the summit. `open_meteo` means a weather-model estimate for resorts with no station (most of Canada, the East and the Andes). Say which it is when you quote a number.",
    "- Forecasts are PeakCam's blend of up to nine weather models (ECMWF IFS, GFS, GEM, ICON, JMA, Météo-France, UKMO; NBM and HRRR for US points) fetched from Open-Meteo every 6 hours at the summit and base: per day the median snowfall, a 25th–75th percentile band, and `modelCount` (fewer models reach the far days — say so when you quote day 10). US resorts also get the National Weather Service narrative with its snow amounts replaced by the blend. Each model and the blend is graded against measured SNOTEL snow over 90 days (`compare_models`, `/forecast-accuracy`); quote `truthBasis` and `measuredDays` with any accuracy claim. Credit: Weather data by Open-Meteo.com (CC BY 4.0).",
    "- Webcams are returned as links (PeakCam page, operator stream, still URL with its capture time). Never describe a frame you have not fetched. Archived stills exist only for cams whose operator allows it.",
    "- Season status comes from `resort_openings`: `open` once a resort-confirmed date has passed, `closed` before it, `unknown` when PeakCam has only a projection or no date. Never report a resort as open without a confirmed source.",
    "- Percent of normal is SWE against the station's 1991–2020 median for the day of the water year, published only inside 10–300 % and above 2 in of SWE.",
    `- Methodology: ${baseUrl}/methodology. Freshness guarantees: ${baseUrl}/methodology#freshness.`,
    "",
    "## Attribution and terms",
    "",
    `- Attribution string (also in the \`X-Attribution\` header and every JSON body): \`${PUBLIC_API_ATTRIBUTION}\`.`,
    "- Cite the resort's `canonicalUrl` (its PeakCam page) whenever you quote a number. Label SNOTEL values as measured and model values as estimates. Cam frames are linked, not redistributed.",
    `- Terms: ${PUBLIC_API_LICENSE_URL}. Contact: hello@peakcam.io.`,
    "",
    "## Rate limit and caching",
    "",
    `- ${RATE_LIMIT_TEXT}`,
    `- JSON responses carry \`Cache-Control: public, s-maxage=${PUBLIC_API_REVALIDATE_SECONDS}, stale-while-revalidate=3600\`; the sync jobs write new reports every 6 hours, so polling faster than every 15 minutes buys nothing. The search index and the schema files are cached a day; /api/v1/status five minutes.`,
    "- CORS is open (`Access-Control-Allow-Origin: *`); `Link` carries `rel=\"author\"` and `rel=\"license\"`.",
    "",
    "## MCP server",
    "",
    `- Name \`${PEAKCAM_MCP_NAME}\`, endpoint \`${PEAKCAM_MCP_ENDPOINT}\`, stateless Streamable HTTP, no auth, no SSE mount. Protocol 2026-07-28 natively; 2025-11-25 and 2025-06-18 through the SDK fallback.`,
    `- Server card: ${baseUrl}/.well-known/mcp/server-card.json (also ${baseUrl}/api/mcp/server-card). Client recipes (Claude, ChatGPT, Cursor, Claude Code, stdio bridges): ${baseUrl}/connect#clients.`,
    "- Workflow: `search_resorts` (or `ask`) turns a name into a slug; the `get_*` tools take the slug; `find_powder`, `get_opening_dates`, `get_percent_of_normal` and `get_leaderboard` take an optional `state` whose valid values `list_regions` returns. Season questions: `get_season_stats` (summary), `get_snow_history` with `season` (daily rows), `get_monthly_climatology` (what a month usually brings).",
    "- Every tool is annotated read-only and idempotent, validates its input, and returns a dated markdown `content` block plus `structuredContent` matching its `outputSchema` (the same shapes as the REST API).",
    "- Resource: `peakcam://resorts/{slug}` (text/markdown), the same document as `/resorts/{slug}/index.md`.",
    "",
    `## Tools (${tools.length})`,
    "",
    ...tools.map((t) => toolSection(t, baseUrl)),
    "",
    "## REST API (`/api/v1`)",
    "",
    `OpenAPI 3.1: ${baseUrl}/api/v1/openapi.json. Standalone JSON Schemas: ${baseUrl}${SCHEMAS_PATH} (one file per shape, e.g. \`resort.json\`, \`cams.json\`, \`powder.json\`, \`status.json\`, \`ask.json\`). API catalog (RFC 9727): ${baseUrl}/.well-known/api-catalog.`,
    "",
    ...rest.flatMap((r) => [
      `### ${r.method} ${r.path}`,
      "",
      `${r.summary} Schema: \`${SCHEMAS_PATH}/${r.schema}.json\`.`,
      "",
      "```bash",
      r.example,
      "```",
      "",
    ]),
    "## Answer endpoint rules",
    "",
    "- `/api/v1/ask` and `/ask` are deterministic: a resort is resolved from its name, slug or nickname (one typo of slack), an intent from keywords (snow, open/closed, forecast, cams, cam timeline, history, compare, where did it snow, percent of normal, profile, regions, alerts), and exactly one tool runs. No language model.",
    "- When nothing matches, the answer is `answerable: false` with `suggestions`. Relay that; do not substitute a similarly named resort.",
    "- `sentence` is quotable as is: it is dated in Mountain time with the report's own timestamp and names the source. `citations[0]` is the page to link.",
    "",
    "## Markdown, feeds and other alternates",
    "",
    `- Markdown: ${baseUrl}/index.md (every resort) and ${baseUrl}/resorts/{slug}/index.md (one resort); each HTML page advertises its alternate in a \`Link\` header.`,
    `- Atom per resort: ${baseUrl}/resorts/{slug}/powder.xml. Subscriber Atom and iCal, e-mail and signed webhooks (Standard Webhooks): ${baseUrl}/alerts/manage; the \`get_alert_options\` tool explains them without writing anything.`,
    `- Custom GPT instructions: ${baseUrl}/gpt-instructions.md (import ${baseUrl}/api/v1/openapi.json as the Action).`,
    `- robots.txt carries \`Content-Signal: search=yes, ai-input=yes, ai-train=yes\`.`,
    "",
    "## What PeakCam does not have (do not invent)",
    "",
    "- Lift and trail open counts, terrain statistics and pass affiliations are not in this API yet. Say so rather than estimating.",
    "- Season history is PeakCam's own daily station record (ten seasons, from the backfill) and daily new snow is the positive change in station depth, a measured floor: do not present a season total as the resort's marketing snowfall figure. Resorts without a station have model-estimated daily values and no normal band or monthly climatology.",
    "- Resorts outside the catalogue: `search_resorts` or `/api/v1/resorts/search-index` is the authority on what is tracked.",
    "",
  ];
  return `${lines.join("\n")}\n`;
}

# PeakCam MCP server (`io.peakcam/snow`)

Read-only [Model Context Protocol](https://modelcontextprotocol.io) server that gives an AI
assistant the same data as the site and `/api/v1`: the latest snow report per resort with its
provenance, season status, webcams as links and archived stills, NWS forecasts, SNOTEL daily
history, percent-of-normal rankings, resort profiles, regions, alert recipes, and an `ask` tool
that routes a plain question to the right one of them deterministically. Nineteen tools.

| | |
| --- | --- |
| Endpoint | `https://www.peakcam.io/api/mcp` |
| Transport | Streamable HTTP, stateless (no sessions, no Redis). No separate `/sse` mount. |
| Auth | None. Public, read-only, same data as the public API. |
| Server name / title | `io.peakcam/snow` / "PeakCam Snow" |
| Version | `package.json` version (reported in `initialize`) |
| Protocol revisions | 2026-07-28 served natively; 2025-11-25, 2025-06-18 and 2025-03-26 clients are served through the SDK's stateless fallback. See *Negotiated versions* below. |
| Code | `app/api/mcp/route.ts` (handler), `lib/mcp/server.ts` (identity + registration), `lib/mcp/tools.ts` (tools), `lib/mcp/data.ts` (production data source), `lib/public-api/markdown.ts` (compact tool markdown), `lib/public-api/markdown-page.ts` (resource markdown, shared with `/resorts/{slug}/index.md`) |
| Libraries | `mcp-handler@2.3.0`, `@modelcontextprotocol/server@2.3.1` (runtime), `@modelcontextprotocol/client@2.3.1` (tests only) |

A plain browser `GET https://www.peakcam.io/api/mcp` (no `text/event-stream` in `Accept`)
returns a small JSON pointer (`endpoint`, `transport`, `tools`, `docs`) so the URL is
self-describing when pasted into a chat. MCP clients never see that branch: they `POST`
JSON-RPC, or `GET` with `Accept: text/event-stream`.

## Tools

Every tool is annotated `readOnlyHint: true, destructiveHint: false, idempotentHint: true,
openWorldHint: false`, validates its input with a zod schema (descriptions are in the
`tools/list` output), and returns both a short markdown `content` block (dated, source-labelled,
with the resort's canonical URL) and a `structuredContent` document that matches the tool's
`outputSchema`. The structured shapes are the `/api/v1` wire types from
`lib/public-api/schema.ts`, so a client that already understands the JSON API understands these.

| Tool | Arguments | Returns | Notes |
| --- | --- | --- | --- |
| `search_resorts` | `query` (name, fragment or region), `state?`, `country?` (ISO-2), `limit?` 1–20 (10) | `{ query, count, resorts: ResortLight[] }` | Typo-tolerant. Call first to turn a name into a slug. |
| `get_resort_conditions` | `slug` | `Resort` (full `/api/v1/resorts/{slug}` document, cams capped at 12) **plus the P6 envelope**: `schemaVersion`, `schemaUrl`, `sentence`, `meta` (freshness tier per field, sources, the resort's local date and zone), `data` (the `ConditionsContract`) | `data.status` is OPEN / CLOSED_TODAY / PRE_SEASON / OFF_SEASON / UNKNOWN with `reasons`, OPEN only on a fresh operator lift feed or a resort-confirmed date; every `data` field is `{value, source, observedAt, confidence, freshness: {tier, ageHours}}`; `depthDisagreement` when station and operator differ by more than 30 %. The markdown opens with a `## Status` block. |
| `get_resort_cams` | `slug` | `CamList` (cams capped at 12) | Links only: PeakCam page, operator source, still-image URL, health (`live`/`down`/`unchecked`). |
| `find_powder` | `window?` `24h`\|`48h` (24h), `state?`, `minInches?`, `sourceOnly?` `snotel`, `limit?` 1–25 (10) | `PowderList` | Ranked by new snow; `sourceOnly=snotel` answers "measured only". Resorts with no report are left out. |
| `compare_resorts` | `slugs[]` 2–6 | `{ count, resorts: (Resort without cams + camCount/liveCamCount)[] }` | Markdown table side by side. Any unknown slug is an error with suggestions. |
| `get_forecast` | `slug`, `point?` `summit`\|`base` (summit) | `{ provider: "blend"\|"nws"\|"none", available, note, point, issuedAt, modelCount, models[], summary, days: ForecastBlendDay[] (≤ 14), periods[] (NWS narrative, US only), credits[] }` | The stored multi-model blend (P4): per day the median snowfall across the models that reach it, `snowfallLoIn`/`snowfallHiIn` as the 25th/75th percentile, `modelCount`. US resorts also get the NWS narrative with its snow amounts replaced by the blend (`snowSource`). `provider: "nws"` with keyword amounts only when no run is stored yet; `available: false` when neither exists. Credit: Weather data by Open-Meteo.com (CC BY 4.0). |
| `compare_models` | `slug` | `{ periodDays: 90, truthBasis: "snotel"\|"ghcn"\|"none", measuredDays, station, scoredPoint, bestModel, scores: ForecastScore[], outlook: { model, label, total7dIn, horizonDays, issuedAt }[], blendTotal7dIn, note, credits[] }` | Per-model verification at the resort (day-1/3/7 MAE in cm, bias ratio, samples, rank; the `blend` row graded by the same rule) from `forecast_scores`, plus what each stored run says for the next 7 days. Scores are empty, with `note`, until the scorer has measured days. P4. |
| `get_snow_history` | `slug`, `days?` 1–30 (14), `season?` (`2024-25`, `2026` for the Andes, or `current`) | `{ source, station, season, rows[] }` | Daily depth, SWE, precipitation accumulation, temperatures and QC flag from `snowpack_daily`, newest first; with `season`, every daily row of that season oldest first with `newSnowIn` (P5). |
| `get_opening_dates` | `state?`, `limit?` 1–150 (50) | `{ asOf, totalMatching, resorts: { season }[] }` | Season open/closed/unknown with confirmed or projected dates, soonest first. |
| `get_resort_profile` | `slug` | `{ urls, location (elevations), websiteUrl, camPageUrl, socials, station, dataSource, season, camCount, liveCamCount }` | Identity without the snow numbers: where, how high, which station, every PeakCam URL (page, JSON, markdown, Atom, state hub). P9 block 1. |
| `get_percent_of_normal` | `state?`, `limit?` 1–50 (10) | `{ asOf, phase, sentence, rule, stationFedCount, totalMatching, results[] }` | SNOTEL-fed resorts ranked by SWE against the station's 1991–2020 median (`lib/percent-of-normal.ts`); the 10–300 % / 2 in rule withholds early-season noise. |
| `list_regions` | none | `{ totalResorts, countries[], regions: { state, label, country, resorts, reporting, measured, cams, liveCams, hubUrl }[] }` | The valid `state` values for the other tools, with counts and hub pages. |
| `get_alert_options` | `slug?` | `{ thresholdInches, schedule, manageUrl, channels[], resortFeed, webhook, writes: false }` | Explains e-mail, signed webhook, Atom, iCal and the public per-resort feed. Never writes; a person registers destinations on `/alerts/manage`. |
| `get_cam_timeline` | `slug`, `camId?` (uuid), `hours?` 1–48 (24) | `{ camCount, frameCount, newestCapturedAt, lastStorm, cams: { camId, camName, frames[], lastStorm }[] , note }` | Archived stills from `cam_still_timeline` (migration 024) as links with capture times, 8 per cam, 12 cams; only archive-allowed cams. Degrades to `note` when the view is unavailable. S8 item 7. |
| `ask` | `question` ≤ 300 chars | `AskAnswer` (`answerable`, `intent`, `tool`, `arguments`, `resort(s)`, `sentence`, `asOf`, `data`, `citations`, `suggestions`) | Deterministic router (`lib/ask/router.ts`): resort by name/slug/nickname with one typo of slack, intent by keywords, one tool call, a `lib/quotable.ts` sentence. `answerable: false` with suggestions instead of a guess; unmatched questions are logged to `agent_memory` (`entity = ask:unmatched`, salted IP hash only over HTTP, 30-day TTL). |
| `get_season_stats` | `slug` | `SeasonStats` + `available` | Season-to-date measured snowfall, days measured, snow/powder days (≥ 8 in, `POWDER_DAY_IN`), current and deepest base, percent of normal on the 30-winter and recent-decade baselines (`baselineNote` when they differ > 10 %), same day last year, 7-day trend, dated sentence. `lib/mcp/tools-history.ts`, P5. |
| `get_monthly_climatology` | `slug` | `MonthlyClimatology` | Average snowfall, snow days, depth and biggest storm per month at the station, 30-winter and recent-decade; `available: false` without a station normal. P5. |
| `get_leaderboard` | `kind` (`best-powder-this-week` \| `season-powder-days` \| `deepest-base` \| `season-snowfall`), `state?`, `sourceOnly?` `snotel`, `limit?` 1–50 (10) | `Leaderboard` | The four season boards over `season_stats()` (migration 030); deepest-base needs only the catalogue. `unavailable: true` when the function is missing. P5. |
| `get_stations` | `slug` | `{ available, count, stations: ObservationStation[], measuredNow: MeasuredNow[], sources[] }` | Up to three stations within 25 km by elevation band (summit / mid / base) with network, elevation, distance, reading time and age, depth, new snow, SWE, temperature, wind. `available: false` until the station layer is populated. Markdown is a table plus the attribution lines. |

Unknown slugs return `isError: true` with up to five close matches, for example:

```
No active resort with slug "breckenrige". Did you mean: breckenridge (Breckenridge)? Use search_resorts to look a resort up by name.
```

### Source labels

Every snow number carries a `source`. The markdown spells them out so the assistant can quote
them:

| `source` | Markdown label | Meaning |
| --- | --- | --- |
| `snotel` | SNOTEL-measured (USDA NRCS) | Read from the NRCS station nearest the resort, quality-controlled, refreshed every 6 h. Valid at the station's elevation (in `station.elevationFt`), not the summit. |
| `open_meteo` | model estimate (Open-Meteo) | Weather-model estimate for resorts without a station (most of Canada and the Andes). |
| `pipeline` / `manual` / `resort` | PeakCam multi-source blend / hand-entered / resort-reported | Rare today. |

`get_stations` names observation networks rather than report sources (`measuredNow[].source`):
`snotel` (USDA NRCS, daily, depth + SWE), `ghcn` (NOAA NCEI GHCN-Daily cooperative observers,
daily, depth + new snow), `nws` (NOAA NWS hourly surface observations: METAR and mesonet,
temperature + wind), `bc_asws` (BC River Forecast Centre automated snow stations, hourly),
`eccc` (Environment and Climate Change Canada, hourly). Each row carries the attribution line
its terms ask for; `docs/stations.md` has the endpoints and licences.

## Resource

`peakcam://resorts/{slug}` (`text/markdown`): byte-for-byte the document served at
`https://www.peakcam.io/resorts/{slug}/index.md`, rendered by `resortMarkdown()` in
`lib/public-api/markdown-page.ts` (Sprint 4) from the same `serializeResort()` output the JSON
API uses. `resources/list` enumerates every active resort; `resources/templates/list` returns
the template; the `slug` variable supports completion.

Two markdown renderers exist on purpose: `markdown-page.ts` is the long-form page document;
`lib/public-api/markdown.ts` is the compact, source-labelled form the tools put in their
`content` blocks (a tool result should not carry a whole page). Both read the serializer's
output, so numbers and source labels agree.

## Server instructions

The `initialize` result carries an `instructions` string (see `PEAKCAM_MCP_INSTRUCTIONS` in
`lib/mcp/server.ts`) telling the model what the data is, that cams are links, the tool
workflow, and that answers should label each number with its source and time and link the
resort's `canonicalUrl`.

## Example prompts

- "Where did it snow most in the last 24 hours, measured only?" → `find_powder(window="24h", sourceOnly="snotel")`
- "Which Colorado resorts picked up more than 6 inches over the weekend?" → `find_powder(window="48h", state="CO", minInches=6)`
- "What are conditions like at Alta right now, and is the base deeper than last week?" → `search_resorts("alta")`, `get_resort_conditions("alta")`, `get_snow_history("alta", days=7)`
- "Show me Breckenridge's webcams." → `get_resort_cams("breckenridge")` (links; the assistant should not describe frames it has not seen)
- "Compare Vail, Breckenridge and Keystone for a trip this weekend." → `compare_resorts(["vail","breckenridge","keystone"])`, `get_forecast` for each
- "When does Mammoth open this season? What about the rest of California?" → `get_opening_dates(state="CA")`
- "Which Utah resorts are above normal snowpack right now?" → `get_percent_of_normal(state="UT")`
- "What did Alta's cams look like over the last 24 hours?" → `get_cam_timeline("alta", hours=24)` (links only)
- "Tell me about Jackson Hole: where it is, how high, and where its snow numbers come from." → `get_resort_profile("jackson-hole")`
- "Is Breck open yet, and how do I get an alert when it dumps?" → `ask("is Breck open")`, `get_alert_options("breckenridge")`

## Connecting

### Claude.ai (custom connector)

Settings → Connectors → *Add custom connector* → name `PeakCam`, URL
`https://www.peakcam.io/api/mcp`, no OAuth. Or open the prefilled link:

```
https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=PeakCam&connectorUrl=https://www.peakcam.io/api/mcp
```

### Claude Code

```bash
claude mcp add --transport http peakcam https://www.peakcam.io/api/mcp
```

### ChatGPT (developer mode)

Settings → Apps & Connectors → Advanced → enable *Developer mode* → *Create* → name
`PeakCam`, MCP server URL `https://www.peakcam.io/api/mcp`, authentication *None*. Start a chat
with the connector enabled.

### Cursor

`~/.cursor/mcp.json` (or project `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "peakcam": { "url": "https://www.peakcam.io/api/mcp" }
  }
}
```

### Any stdio-only client

```json
{
  "mcpServers": {
    "peakcam": { "command": "npx", "args": ["-y", "mcp-remote", "https://www.peakcam.io/api/mcp"] }
  }
}
```

### MCP Inspector (smoke test)

```bash
npx @modelcontextprotocol/inspector --cli https://www.peakcam.io/api/mcp --method tools/list
npx @modelcontextprotocol/inspector --cli https://www.peakcam.io/api/mcp --method tools/call --tool-name find_powder --tool-arg window=24h sourceOnly=snotel
npx @modelcontextprotocol/inspector --cli https://www.peakcam.io/api/mcp --method resources/read --uri peakcam://resorts/breckenridge
```

## Negotiated versions

Recorded from the Sprint 5 verification (2026-10-18):

| Client | Negotiated protocol | Era |
| --- | --- | --- |
| `@modelcontextprotocol/client@2.3.1`, default options, over `InMemoryTransport` (the test suite) and over HTTP | `2025-11-25` | legacy (the SDK client does not probe for `2026-07-28` unless `versionNegotiation: { mode: "auto" }` is set) |
| `@modelcontextprotocol/client@2.3.1` with `versionNegotiation: { mode: "auto" }` over HTTP | `2026-07-28` | modern (`server/discover`, per-request `_meta` envelope) |
| `curl` sending `initialize` with `protocolVersion: "2025-06-18"` | `2025-06-18` | legacy stateless fallback |
| `@modelcontextprotocol/inspector@2.11.0 --cli` over HTTP | `tools/list`, `tools/call`, `resources/list`, `resources/templates/list`, `resources/read` all answered (the CLI does not print the negotiated revision) | |

Warm-instance latency measured locally over HTTP: `initialize` + `tools/list` 30–47 ms,
`find_powder` 33–51 ms through the SDK client, about 5 ms for a raw `curl` POST.

The handler advertises `2026-07-28` natively (`server/discover`, per-request `_meta`
envelope) and serves `2025-11-25`, `2025-06-18`, `2025-03-26` and `2024-11-05` requests through
`@modelcontextprotocol/server`'s stateless legacy fallback. The 2024-11-05 HTTP+SSE transport
(`/sse` + `/message`) is not served; `GET`/`DELETE` session operations from 2025-era clients
answer `405` by design.

## Operations

- **Caching.** Tools read the same `unstable_cache` catalogue as `/api/v1` (one hour, tag
  `peakcam-resort-catalog`), openings and elevations at 15 minutes, `snowpack_daily` at 15 minutes
  per `(resort, days)`, and NWS at one hour per grid point. A tool call is an in-memory
  serialisation on a warm instance.
- **Limits.** `maxDuration = 60`. Payloads are capped: 12 cams, 30 history rows, 25 powder rows,
  20 search rows, 6 compared resorts, 150 opening rows, 50 percent-of-normal rows, 8 frames × 12 cams
  per timeline, 300-character questions.
- **Proxy.** `proxy.ts` excludes `api/mcp` from the Supabase session refresh.
- **CORS.** `*` with `POST, GET, DELETE, OPTIONS`, matching the public API's posture.
- **Adding a tool.** Add a `defineTool` block in `lib/mcp/tools.ts`, append its name to
  `PEAKCAM_TOOL_NAMES` in `lib/mcp/tool-names.ts`, give it an example in `lib/mcp/examples.ts`
  (llms-full.txt and the tests read it), a `TOOL_COPY` entry in `components/connect/links.ts`
  (the /connect table and server card derive from the name tuple; both are type errors until
  you do), cover it in `lib/mcp/server.test.ts` (the schema round-trip test picks it up once a
  sample argument set is added), and list it in the table above. If the ask router should
  reach it, add an intent rule in `lib/ask/router.ts` and a sentence in `lib/ask/answer.ts`.
- **Data source.** `McpDataSource` (`lib/mcp/types.ts`) has `catalog`, `forecast`,
  `snowHistory`, `camStills` and the optional `logUnmatchedQuestion`; `lib/mcp/data.ts` is the
  production implementation, the tests inject fixtures. The catalogue helpers the tools and
  the router share (`findResort`, `matchResorts`, …) live in `lib/mcp/catalog.ts`.
- **Tests.** `node --import tsx --test lib/mcp/server.test.ts lib/ask/router.test.ts lib/public-api/agent-surface.test.ts`
  runs the server in memory with fixtures, the router against 20+ questions, and the
  status/search-index/batch/llms-full builders; no env, no network.

## Answer endpoint and REST additions (P9 block 1, 2026-10-18)

The `ask` tool is also HTTP: `GET|POST /api/v1/ask` (`q`/`query`/`question`, JSON body on POST)
returns the `AskAnswer` document, and `GET|POST /ask` wraps the same answer in the NLWeb list
shape (`query_id`, `results[]` with `schema_object`, full answer under `peakcam`; `mode`, `prev`,
`site`, `streaming` accepted and ignored). Alongside it: `POST /api/v1/batch` (≤ 10 GET paths
dispatched in-process to the route handlers, results in order), `GET /api/v1/resorts/search-index`
(slug, name, aliases from `lib/ask/aliases.ts`, state, country, lat/lon; 24 h cache) and
`GET /api/v1/status` (report freshness and cam health with thresholds; 200 `degraded`, 503 only
when the read fails). Discovery: `/llms-full.txt` (built from the tool definitions and
`lib/mcp/examples.ts`), `/gpt-instructions.md`, `/.well-known/schemas` (+ `/{file}.json` per
registered shape). All documented in `/api/v1/openapi.json`; smoke checks in `docs/runbook.md`.

## Multi-model forecast and verification (P4, 2026-10-20)

`get_forecast` reads the runs `scripts/forecast-sync.ts` stores every 6 h (migration 027) and
blends them on the way out (`lib/forecast/blend.ts`): per day the median snowfall across the
models that reach that day, the 25th/75th percentile as the band, `modelCount` per day, totals
and the peak window. `compare_models` reads `forecast_scores` (written daily by
`scripts/forecast-score.ts`, graded against SNOTEL depth deltas clipped at zero over 90 days,
`lib/forecast/score.ts`) and the same runs for a per-model 7-day outlook. Both go through the
`McpDataSource` (`forecastRuns`, `forecastAccuracy`) so the tests run on fixtures; the
production source reads through the public API's 15-minute caches. The REST twins are
`/api/v1/resorts/{slug}/forecast` and `/forecast-accuracy`; the shapes are `Forecast`,
`ForecastBlendDay`, `ForecastSummary`, `ForecastAccuracy` and `ForecastScore` in
`lib/public-api/schema.ts`. Every surface that serves blend numbers carries "Weather data by
Open-Meteo.com" (CC BY 4.0) in `credits` and, on REST, `X-Attribution`.

## Season history (P5, 2026-10-19)

Three tools over PeakCam's own daily station record (`snowpack_daily`, ten water years from
`scripts/snotel-backfill.ts`) and the station normals (`scripts/seed-snotel-normals.ts`, migration
030): `get_season_stats`, `get_monthly_climatology`, `get_leaderboard`, plus `season` on
`get_snow_history`. The structured shapes are the REST documents at
`/api/v1/resorts/{slug}/history`, `/season-stats`, `/monthly` and `/api/v1/leaderboards/{kind}`
(`lib/public-api/history.ts`); the pure maths is `lib/snow-history.ts`, `lib/season-stats.ts`
and `lib/leaderboards.ts`. Daily new snow is the positive change in station depth (a measured
floor); the powder-day threshold is `POWDER_DAY_IN` (8 in) in one place, passed to the SQL
function as `powder_in`. A data source without the optional `resortHistory` /
`seasonAggregates` methods (fixtures written before P5) gets `available: false` /
`unavailable: true`, never an error.

```bash
npx @modelcontextprotocol/inspector --cli https://www.peakcam.io/api/mcp --method tools/call --tool-name get_season_stats --tool-arg slug=breckenridge
npx @modelcontextprotocol/inspector --cli https://www.peakcam.io/api/mcp --method tools/call --tool-name get_leaderboard --tool-arg kind=season-snowfall --tool-arg state=CO
npx @modelcontextprotocol/inspector --cli https://www.peakcam.io/api/mcp --method tools/call --tool-name get_snow_history --tool-arg slug=alta --tool-arg season=2024-25
```

## Conditions contract v2 and operator status (P6, 2026-10-20)

`get_resort_conditions` now returns the conditions envelope on top of the Resort document, the
same JSON as `GET /api/v1/resorts/{slug}/conditions` (`lib/public-api/conditions.ts` over the
pure `lib/conditions-contract.ts`; schema `ResortConditions`, file
`/.well-known/schemas/resort-conditions-v1.json`). Every field is a `Field`:
`{value, source, observedAt, confidence, freshness: {tier, ageHours}}`.

| Source | Meaning |
| --- | --- |
| `snotel` | The resort's NRCS station as written to the snow report (quality-controlled, 6-hourly sync). |
| `station:<network>` | A reading from the P3 station layer (`nws`, `ghcn`, `bc_asws`, `eccc`, `snotel`). |
| `operator` | The resort's own published report: lift status parsed by Liftie (`scripts/operator-sync.ts`, migration 031), or a resort-confirmed opening date. |
| `model` | A weather-model estimate (Open-Meteo report rows, the P4 blend's 48-hour total). |
| `profile` | A static catalogue fact: lift and run totals, a third-party projected opening date. |
| `derived` | Computed by PeakCam from other fields (percent of normal, snow quality from the engine's tags). |
| `none` | Nothing on file. |

Tiers: `live` (≤ 3 h from an hourly source), `recent` (≤ 30 h), `estimated` (a model value
≤ 30 h), `stale` (> 30 h), `unknown`. Confidence: SNOTEL 0.9, other stations 0.8, operator 0.7,
profile and derived 0.6, model 0.5; halved when stale, 0 when unknown.

`data.status` is derived, never defaulting to open: a fresh operator feed with lifts open or
scheduled → `OPEN`; every lift closed inside the season → `CLOSED_TODAY`; a confirmed opening
date that has passed → `OPEN`; a confirmed or projected date ahead → `PRE_SEASON`; a closing
date passed → `OFF_SEASON`; otherwise `UNKNOWN`. `today` is the resort's own calendar day
(`lib/resort-timezone.ts`). `recommendableToday` needs OPEN, a current base depth and a
rating above poor; `reasons` spells out both. The `ask` tool answers "is Alta open today"
with the envelope's `sentence`, dated by the operator feed.

```bash
npx @modelcontextprotocol/inspector --cli https://www.peakcam.io/api/mcp --method tools/call --tool-name get_resort_conditions --tool-arg slug=alta | head -40
npx @modelcontextprotocol/inspector --cli https://www.peakcam.io/api/mcp --method tools/call --tool-name ask --tool-arg question="is Alta open today"
curl -s https://www.peakcam.io/api/v1/resorts/alta/conditions | jq '{status: .data.status, lifts: [.data.liftsOpen.value, .data.liftsTotal.value], verdict: .data.recommendableToday, reasons: .data.reasons, sentence}'
```

Liftie (liftie.info) sits behind a Cloudflare managed challenge for non-browser clients as of
2026-10-20 (403, `cf-mitigated: challenge`, from the Air and the mini alike); until that
clears, `liftsOpen` carries `source: "none"` and the status falls back to the opening row.
`docs/runbook.md` "Operator status" has the job and the follow-up list of operator feeds.

## Discovery (Sprint 6)

Shipped 2026-10-18: `/.well-known/mcp/server-card.json` (also at the SEP-2127 reserved
`/api/mcp/server-card`), `server.json` for the MCP Registry (published as `io.peakcam/snow`
0.1.0, re-publish steps in `docs/runbook.md`), the MCP line in `llms.txt`, the `/connect` page
and the footer link. Everything they need is exported
from `lib/mcp/server.ts` (`PEAKCAM_MCP_NAME`, `PEAKCAM_MCP_TITLE`, `PEAKCAM_MCP_VERSION`,
`PEAKCAM_MCP_ENDPOINT`, `PEAKCAM_MCP_INSTRUCTIONS`) and `lib/mcp/tools.ts`
(`PEAKCAM_TOOL_NAMES`, `buildTools()` for titles and descriptions).

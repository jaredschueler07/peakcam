# PeakCam MCP server (`io.peakcam/snow`)

Read-only [Model Context Protocol](https://modelcontextprotocol.io) server that gives an AI
assistant the same data as the site and `/api/v1`: the latest snow report per resort with its
provenance, season status, webcams as links, NWS forecasts and SNOTEL daily history.

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
| `get_resort_conditions` | `slug` | `Resort` (full `/api/v1/resorts/{slug}` document, cams capped at 12) | Snow numbers with `source`, `measuredAt` and `station`; season status; canonical URL. |
| `get_resort_cams` | `slug` | `CamList` (cams capped at 12) | Links only: PeakCam page, operator source, still-image URL, health (`live`/`down`/`unchecked`). |
| `find_powder` | `window?` `24h`\|`48h` (24h), `state?`, `minInches?`, `sourceOnly?` `snotel`, `limit?` 1–25 (10) | `PowderList` | Ranked by new snow; `sourceOnly=snotel` answers "measured only". Resorts with no report are left out. |
| `compare_resorts` | `slugs[]` 2–6 | `{ count, resorts: (Resort without cams + camCount/liveCamCount)[] }` | Markdown table side by side. Any unknown slug is an error with suggestions. |
| `get_forecast` | `slug` | `{ available, provider: "nws", note, periods[] }` | Five-day NWS forecast for US resorts; `available: false` for Canada and the Andes, or when NWS does not answer. Snow inches are keyword heuristics, not QPF. |
| `get_snow_history` | `slug`, `days?` 1–30 (14) | `{ source, station, rows[] }` | Daily depth, SWE, precipitation accumulation, temperatures and QC flag from `snowpack_daily`, newest first. |
| `get_opening_dates` | `state?`, `limit?` 1–150 (50) | `{ asOf, totalMatching, resorts: { season }[] }` | Season open/closed/unknown with confirmed or projected dates, soonest first. |

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
  20 search rows, 6 compared resorts, 150 opening rows.
- **Proxy.** `proxy.ts` excludes `api/mcp` from the Supabase session refresh.
- **CORS.** `*` with `POST, GET, DELETE, OPTIONS`, matching the public API's posture.
- **Adding a tool.** Add a `defineTool` block in `lib/mcp/tools.ts`, append its name to
  `PEAKCAM_TOOL_NAMES`, cover it in `lib/mcp/server.test.ts` (the schema round-trip test picks
  it up automatically once a sample argument set is added), and list it in the table above.
  Sprint 8's `get_cam_timeline(slug, camId, hours<=48)` is the next one.
- **Tests.** `node --import tsx --test lib/mcp/server.test.ts lib/public-api/markdown.test.ts`
  runs the server in memory with fixtures; no env, no network.

## Discovery (Sprint 6)

Shipped 2026-10-18: `/.well-known/mcp/server-card.json` (also at the SEP-2127 reserved
`/api/mcp/server-card`), `server.json` for the MCP Registry (published as `io.peakcam/snow`
0.1.0, re-publish steps in `docs/runbook.md`), the MCP line in `llms.txt`, the `/connect` page
and the footer link. Everything they need is exported
from `lib/mcp/server.ts` (`PEAKCAM_MCP_NAME`, `PEAKCAM_MCP_TITLE`, `PEAKCAM_MCP_VERSION`,
`PEAKCAM_MCP_ENDPOINT`, `PEAKCAM_MCP_INSTRUCTIONS`) and `lib/mcp/tools.ts`
(`PEAKCAM_TOOL_NAMES`, `buildTools()` for titles and descriptions).

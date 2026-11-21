# MCP server (retired)

The public PeakCam MCP server, `io.peakcam/snow` at `https://www.peakcam.io/api/mcp`, was
retired on 2026-11-21 by the owner's decision, together with the developer-facing pages that
advertised it: the `/connect` setup page, the server card
(`/.well-known/mcp/server-card.json`, `/api/mcp/server-card`), the MCP Registry manifest
`server.json` and the unpublished npm stdio bridge `packages/peakcam-mcp/`. The earlier content
of this file (transport, tool list, client verification) is in git history.

## What replaced it

- **REST API**: `/api/v1/*`, described by `/api/v1/openapi.json`, `/.well-known/api-catalog` and
  the JSON Schemas under `/.well-known/schemas`. Unchanged.
- **Answer endpoint**: `GET|POST /api/v1/ask` and the NLWeb-shaped `GET|POST /ask`: a resort and
  an intent from the wording, one internal tool call, a dated sentence and citations. No model.
- **Agent guides and alternates**: `/llms.txt`, `/llms-full.txt`, `/gpt-instructions.md` and the
  markdown alternates (`/index.md`, `/resorts/{slug}/index.md` and the subpages). None of them
  mentions MCP any more; `lib/public-api/agent-surface.test.ts` checks that.

## What the old URLs do now

- `/api/mcp` answers GET, POST and DELETE with HTTP 410 and
  `{error: "gone", message, openapi, docs}` (CORS `*`, `Cache-Control: public, max-age=3600`);
  OPTIONS stays 204. `app/api/mcp/route.ts`, tested by `tests/mcp-retired.test.ts`.
- `/connect` redirects permanently to `/` (`next.config.ts`).
- The server-card URLs are gone (404).

## What stays in the repo

`lib/mcp/` is kept, under its old name, as the internal tool layer: `buildTools()` in
`lib/mcp/tools.ts` and `tools-history.ts`, the catalogue helpers, the data source and the name
tuple. `lib/ask/*` runs one of those tools per question and `lib/public-api/markdown*.ts` and the
resort snow-report page share its types. `lib/mcp/tools.test.ts` runs every tool against
fixtures by calling the handlers directly. Nothing imports an MCP SDK: the
`@modelcontextprotocol/server`, `@modelcontextprotocol/client` and `mcp-handler` dependencies
were removed and the tool result type is declared in `lib/mcp/types.ts`.

## Still to do (owner)

- Withdraw the MCP Registry entry `io.peakcam/snow` (published 2026-10-18); it still points at
  `/api/mcp`. Key and DNS record: `docs/runbook.md`, "MCP server and /connect: retired
  2026-11-21".
- Withdraw the Claude Connectors Directory submission of 2026-10-18 and remove any connector
  that was added by URL.

# peakcam-mcp

A stdio bridge to the PeakCam Snow MCP server (`io.peakcam/snow`): live snow reports,
SNOTEL measurements, multi-model forecasts, webcams, timelapses, season history and
powder rankings for ski resorts across the United States, Canada, Chile and Argentina.
Read-only, anonymous, no key.

The hosted server speaks Streamable HTTP at `https://www.peakcam.io/api/mcp`. Clients that
can use a URL directly (Claude.ai, Claude Code, Cursor, ChatGPT developer mode) should use
it; see <https://www.peakcam.io/connect>. This package is for clients that only start a
command and talk over stdin/stdout: it forwards every JSON-RPC message to the hosted server
and writes the answers back. It keeps no state and caches nothing.

## Use

Claude Desktop (`claude_desktop_config.json`), Windsurf, Zed, and any client with an
`mcpServers` map:

```json
{
  "mcpServers": {
    "peakcam": { "command": "npx", "args": ["-y", "peakcam-mcp"] }
  }
}
```

Claude Code, as a stdio server:

```bash
claude mcp add peakcam -- npx -y peakcam-mcp
```

Smoke test from a shell (the bridge exits when stdin closes):

```bash
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' \
  | npx -y peakcam-mcp
```

## Options

| | |
| --- | --- |
| `--url <https://…>` | Bridge to another endpoint (a preview deployment, a mirror). |
| `PEAKCAM_MCP_URL` | The same, as an environment variable. |
| `--help` | Usage. |

Only `https://` endpoints are accepted (plus `localhost` for development).

## What you get

Twenty read-only tools (`search_resorts`, `get_resort_conditions`, `get_resort_cams`,
`find_powder`, `compare_resorts`, `get_forecast`, `compare_models`, `get_snow_history`,
`get_opening_dates`, `get_resort_profile`, `get_percent_of_normal`, `list_regions`,
`get_alert_options`, `get_cam_timeline`, `get_stations`, `ask`, `get_season_stats`,
`get_monthly_climatology`, `get_leaderboard`, `get_timelapses`) and one resource,
`peakcam://resorts/{slug}` (markdown). Every snow number carries its source and time.
The full guide is <https://www.peakcam.io/llms-full.txt>.

## Data and attribution

Measured values are USDA NRCS SNOTEL/SCAN telemetry; model values are estimates and are
labelled; forecasts are blended from Open-Meteo (CC BY 4.0); webcams are links to their
operators. Quote numbers with a link to the resort's PeakCam page. Terms:
<https://www.peakcam.io/about#terms>. Questions: hello@peakcam.io.

## Development

The bridge is one file, `bin/peakcam-mcp.mjs`, on `@modelcontextprotocol/sdk`'s
`StdioServerTransport` and `StreamableHTTPClientTransport`. It lives in the PeakCam
repository under `packages/peakcam-mcp`; `server.json` at the repository root and the
server card at `https://www.peakcam.io/.well-known/mcp/server-card.json` list it beside the
HTTP remote. Bump `version` here and in `server.json`'s `packages[0]` together, publish to
npm first, then re-publish `server.json` to the MCP Registry (it verifies the npm package's
`mcpName`).

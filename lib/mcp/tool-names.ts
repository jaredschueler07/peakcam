// ─────────────────────────────────────────────────────────────
// MCP server — the tool name tuple, on its own so lib/ask/* and
// components/connect/links.ts can depend on the names without importing the
// tool definitions (tools.ts imports lib/ask/answer.ts for the `ask` tool).
// Registration order on the server; the /connect table follows it.
// ─────────────────────────────────────────────────────────────

export const PEAKCAM_TOOL_NAMES = [
  "search_resorts",
  "get_resort_conditions",
  "get_resort_cams",
  "find_powder",
  "compare_resorts",
  "get_forecast",
  "get_snow_history",
  "get_opening_dates",
  "get_resort_profile",
  "get_percent_of_normal",
  "list_regions",
  "get_alert_options",
  "get_cam_timeline",
  "get_stations",
  "ask",
  // P5 history
  "get_season_stats",
  "get_monthly_climatology",
  "get_leaderboard",
] as const;

export type PeakCamToolName = (typeof PEAKCAM_TOOL_NAMES)[number];

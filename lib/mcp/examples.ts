// ─────────────────────────────────────────────────────────────
// MCP server — one worked example per tool, used by llms-full.txt, the
// /connect prompts and the tests (every example must parse against its
// tool's inputSchema). Keyed by the name tuple so a new tool without an
// example is a type error.
// ─────────────────────────────────────────────────────────────

import type { PeakCamToolName } from "./tool-names";

export interface ToolExample {
  /** The user-facing question the call answers. */
  prompt: string;
  /** Arguments as the tool's inputSchema expects them. */
  args: Record<string, unknown>;
}

export const TOOL_EXAMPLES: Record<PeakCamToolName, ToolExample> = {
  search_resorts: { prompt: "Which resort is 'big sky'?", args: { query: "big sky" } },
  get_resort_conditions: { prompt: "What are conditions at Alta right now?", args: { slug: "alta" } },
  get_resort_cams: { prompt: "Show me Breckenridge's webcams.", args: { slug: "breckenridge" } },
  find_powder: { prompt: "Where did it snow most in Colorado, measured only?", args: { window: "24h", state: "CO", sourceOnly: "snotel", limit: 5 } },
  compare_resorts: { prompt: "Compare Vail, Breckenridge and Keystone.", args: { slugs: ["vail", "breckenridge", "keystone"] } },
  get_forecast: { prompt: "What's the forecast for Jackson Hole?", args: { slug: "jackson-hole" } },
  compare_models: { prompt: "Which forecast model has been most accurate at Alta, and what does each say for the week?", args: { slug: "alta" } },
  get_snow_history: { prompt: "How has Alta's base changed this week?", args: { slug: "alta", days: 7 } },
  get_opening_dates: { prompt: "When do California resorts open?", args: { state: "CA", limit: 20 } },
  get_resort_profile: { prompt: "Where is Mammoth and how high is it?", args: { slug: "mammoth" } },
  get_percent_of_normal: { prompt: "Which Utah resorts are above normal snowpack?", args: { state: "UT", limit: 10 } },
  list_regions: { prompt: "Which states does PeakCam cover?", args: {} },
  get_alert_options: { prompt: "How do I get an alert when it dumps at Alta?", args: { slug: "alta" } },
  get_cam_timeline: { prompt: "What did Breckenridge's cams look like over the last 24 hours?", args: { slug: "breckenridge", hours: 24 } },
  ask: { prompt: "Is Breck open?", args: { question: "Is Breck open?" } },
};

/** `--tool-arg k=v` pairs for the MCP Inspector CLI (arrays and objects as JSON). */
export function inspectorArgs(args: Record<string, unknown>): string {
  return Object.entries(args)
    .map(([k, v]) => `--tool-arg ${k}=${typeof v === "string" ? JSON.stringify(v) : `'${JSON.stringify(v)}'`}`)
    .join(" ");
}

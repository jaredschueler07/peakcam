// ─────────────────────────────────────────────────────────────
// /connect — every URL, tool, prompt and client recipe the page renders,
// kept as data so tests/connect-links.test.ts can check that each internal
// href resolves to a route under app/ or a file under public/, and so the
// footer, llms.txt and the server card quote the same strings.
//
// Pure: no React, no Next imports.
// ─────────────────────────────────────────────────────────────

import { SITE_URL } from "@/lib/site";
import {
  PEAKCAM_MCP_ENDPOINT,
  PEAKCAM_MCP_NAME,
  PEAKCAM_MCP_TITLE,
  PEAKCAM_RESOURCE_TEMPLATE,
} from "@/lib/mcp/server";
import { PEAKCAM_TOOL_NAMES, type PeakCamToolName } from "@/lib/mcp/tool-names";

/** MCP server identity, re-exported from the server module so the page cannot drift from it. */
export const MCP_NAME: string = PEAKCAM_MCP_NAME;
export const MCP_TITLE: string = PEAKCAM_MCP_TITLE;
export const MCP_PATH = "/api/mcp";
export const MCP_ENDPOINT: string = PEAKCAM_MCP_ENDPOINT;
export const SERVER_CARD_PATH = "/.well-known/mcp/server-card.json";
export const CONNECT_PATH = "/connect";
export const CONNECT_URL = `${SITE_URL}${CONNECT_PATH}`;

/** One-line prefilled "add custom connector" deep link for claude.ai. */
export const CLAUDE_CONNECTOR_LINK =
  "https://claude.ai/customize/connectors?modal=add-custom-connector" +
  `&connectorName=PeakCam&connectorUrl=${encodeURIComponent(MCP_ENDPOINT)}`;

export interface ConnectLink {
  /** Site-relative path, may carry a fragment. */
  href: string;
  label: string;
  /**
   * For a route that ships on another branch: tests/connect-links.test.ts
   * tolerates a missing route only while this flag is set, and fails once
   * the route exists so the flag is removed. No link is pending today.
   */
  pending?: boolean;
}

/**
 * Every internal href the page links to, by id. Add here, then reference
 * from the page; never write a bare "/path" string in connect JSX.
 */
export const CONNECT_LINKS = {
  mcp: { href: MCP_PATH, label: "MCP endpoint" },
  serverCard: { href: SERVER_CARD_PATH, label: "MCP server card" },
  apiResorts: { href: "/api/v1/resorts", label: "REST: resort list" },
  apiResort: { href: "/api/v1/resorts/breckenridge", label: "REST: one resort" },
  apiCams: { href: "/api/v1/resorts/breckenridge/cams", label: "REST: a resort's cams" },
  apiPowder: { href: "/api/v1/powder?source=snotel", label: "REST: powder ranking" },
  apiSearchIndex: { href: "/api/v1/resorts/search-index", label: "REST: search index" },
  apiStatus: { href: "/api/v1/status", label: "REST: service status" },
  apiAsk: { href: "/api/v1/ask?q=is+alta+open", label: "REST: ask a question" },
  apiBatch: { href: "/api/v1/batch", label: "REST: batch (POST)" },
  nlwebAsk: { href: "/ask?query=where+did+it+snow+most", label: "NLWeb: /ask" },
  openapi: { href: "/api/v1/openapi.json", label: "OpenAPI 3.1" },
  schemas: { href: "/.well-known/schemas", label: "JSON Schemas" },
  llmsFull: { href: "/llms-full.txt", label: "llms-full.txt" },
  gptInstructions: { href: "/gpt-instructions.md", label: "Custom GPT instructions" },
  serverCardAlias: { href: "/api/mcp/server-card", label: "MCP server card (SEP-2127 location)" },
  apiCatalog: { href: "/.well-known/api-catalog", label: "API catalog (RFC 9727)" },
  indexMd: { href: "/index.md", label: "Markdown: site index" },
  resortMd: { href: "/resorts/breckenridge/index.md", label: "Markdown: one resort" },
  powderAtom: { href: "/resorts/breckenridge/powder.xml", label: "Atom: powder feed per resort" },
  llms: { href: "/llms.txt", label: "llms.txt" },
  robots: { href: "/robots.txt", label: "robots.txt (Content-Signal)" },
  alerts: { href: "/alerts", label: "Powder alerts" },
  alertsManage: { href: "/alerts/manage", label: "Manage alerts and webhooks" },
  methodology: { href: "/methodology", label: "How we measure snow" },
  snotel: { href: "/methodology#snotel", label: "SNOTEL and SCAN sensors" },
  freshness: { href: "/methodology#freshness", label: "Freshness" },
  about: { href: "/about", label: "About PeakCam" },
  terms: { href: "/about#terms", label: "Terms of service" },
  privacy: { href: "/about#privacy", label: "Privacy policy" },
  snowReport: { href: "/snow-report", label: "Snow report" },
  home: { href: "/", label: "Home" },
} as const satisfies Record<string, ConnectLink>;

export type ConnectLinkId = keyof typeof CONNECT_LINKS;

export function absolute(id: ConnectLinkId): string {
  return `${SITE_URL}${CONNECT_LINKS[id].href}`;
}

/** External documentation the page cites. Not route-checked. */
export const EXTERNAL_LINKS = {
  mcpSpec: "https://modelcontextprotocol.io",
  standardWebhooks: "https://www.standardwebhooks.com",
  nrcs: "https://www.nrcs.usda.gov/resources/data-and-reports/snow-and-water-interactive-map",
  openMeteo: "https://open-meteo.com",
  nws: "https://www.weather.gov",
  repo: "https://github.com/jaredschueler07/peakcam",
} as const;

// ── Tools ────────────────────────────────────────────────────

export interface ConnectTool {
  name: PeakCamToolName;
  title: string;
  /** One line, as rendered in the table and quoted in the server card. */
  summary: string;
}

/**
 * Page copy per tool, keyed by the server's own name tuple so a renamed or
 * added tool is a type error here. Titles mirror lib/mcp/tools.ts
 * (tests/mcp-listings.test.ts checks them against buildTools()); summaries
 * are the page's one-line form of the tool descriptions.
 */
const TOOL_COPY: Record<PeakCamToolName, Omit<ConnectTool, "name">> = {
  search_resorts: {
    title: "Search resorts",
    summary: "Find a resort by name, fragment or region and get its slug with a one-line snow summary.",
  },
  get_resort_conditions: {
    title: "Resort conditions",
    summary: "The latest snow report for one resort, every number labelled with its source and time, plus the page URL to cite.",
  },
  get_resort_cams: {
    title: "Resort webcams",
    summary: "The resort's webcams as links with live, down or unchecked health. Frames are never returned inline.",
  },
  find_powder: {
    title: "Find powder",
    summary: "Rank resorts by new snow in the last 24 or 48 hours, by state, with a measured-only option.",
  },
  compare_resorts: {
    title: "Compare resorts",
    summary: "Side-by-side snow, season status and cam counts for two to six resorts.",
  },
  get_forecast: {
    title: "Resort forecast",
    summary: "Five-day National Weather Service forecast for US resorts; Canada and the Andes return available: false.",
  },
  get_snow_history: {
    title: "Snow history",
    summary: "Daily depth, snow water equivalent, precipitation and temperatures for the last 1 to 30 days at the resort's station.",
  },
  get_opening_dates: {
    title: "Opening dates",
    summary: "Season opening and closing dates with open, closed or unknown status, soonest first.",
  },
  get_stations: {
    title: "Nearby stations",
    summary: "What the instruments near a resort measured, by elevation band: station, network, elevation, age, depth, new snow, temperature and wind.",
  },
  get_resort_profile: {
    title: "Resort profile",
    summary: "Where a resort is, its elevations, website, socials, station, season status and every PeakCam URL for it.",
  },
  get_percent_of_normal: {
    title: "Percent of normal",
    summary: "SNOTEL-fed resorts ranked by snowpack against the station's 1991 to 2020 median, deepest first, by state.",
  },
  list_regions: {
    title: "List regions",
    summary: "Every state, province and country covered, with resort, measured and cam counts and the valid state codes.",
  },
  get_alert_options: {
    title: "Alert options",
    summary: "How to be told when it snows: e-mail, signed webhook, Atom and iCal recipes and the manage page. Writes nothing.",
  },
  get_cam_timeline: {
    title: "Cam timeline",
    summary: "Archived webcam stills for a resort or one cam over the last 48 hours, as links with capture times, plus the last storm frame.",
  },
  ask: {
    title: "Ask PeakCam",
    summary: "A plain question routed to the right tool by name and keywords, with a dated sentence to quote. No model, no guessing.",
  },
};

/** In the server's registration order. */
export const CONNECT_TOOLS: readonly ConnectTool[] = PEAKCAM_TOOL_NAMES.map((name) => ({ name, ...TOOL_COPY[name] }));

export const MCP_RESOURCE_TEMPLATE: string = PEAKCAM_RESOURCE_TEMPLATE;

/**
 * Protocol revisions the endpoint negotiates (docs/mcp.md "Negotiated
 * versions": 2026-07-28 natively, the two 2025 revisions through the SDK's
 * stateless fallback).
 */
export const MCP_PROTOCOL_VERSIONS = ["2026-07-28", "2025-11-25", "2025-06-18"] as const;

// ── Example prompts ──────────────────────────────────────────

export interface ExamplePrompt {
  prompt: string;
  /** Which tools a well-behaved assistant reaches for. */
  tools: string;
}

export const EXAMPLE_PROMPTS: readonly ExamplePrompt[] = [
  { prompt: "Where did it snow most in the last 24 hours, measured only?", tools: "find_powder (24h, sourceOnly snotel)" },
  { prompt: "Which Colorado resorts picked up more than 6 inches over the weekend?", tools: "find_powder (48h, CO, minInches 6)" },
  {
    prompt: "What are conditions like at Alta right now, and is the base deeper than last week?",
    tools: "search_resorts, get_resort_conditions, get_snow_history (7 days)",
  },
  { prompt: "Show me Breckenridge's webcams.", tools: "get_resort_cams (links only)" },
  { prompt: "Compare Vail, Breckenridge and Keystone for a trip this weekend.", tools: "compare_resorts, then get_forecast for each" },
  { prompt: "When does Mammoth open this season? What about the rest of California?", tools: "get_opening_dates (CA)" },
  { prompt: "Which Utah resorts are above normal snowpack right now?", tools: "get_percent_of_normal (UT)" },
  { prompt: "What did Alta's cams look like over the last 24 hours?", tools: "get_cam_timeline (alta, 24 h; links only)" },
  { prompt: "Tell me about Jackson Hole: where it is, how high, and where its snow numbers come from.", tools: "get_resort_profile" },
  { prompt: "Is Breck open yet, and how do I get an alert when it dumps?", tools: "ask (\"is Breck open\"), get_alert_options" },
];

// ── Client recipes ───────────────────────────────────────────

export const CURSOR_MCP_JSON = JSON.stringify({ mcpServers: { peakcam: { url: MCP_ENDPOINT } } }, null, 2);

export const CLAUDE_CODE_COMMAND = `claude mcp add --transport http peakcam ${MCP_ENDPOINT}`;

/** The same recipe as docs/alerts-verification.md, trimmed to the one-liner. */
export const HERMES_WEBHOOK_COMMAND = [
  "hermes webhook subscribe --name peakcam-powder \\",
  '  --secret "$PEAKCAM_WEBHOOK_SECRET" \\',
  "  --on powder.alert \"notify 'Powder: {{resort.name}} {{inches}}\\\" ({{kind}}) {{url}}'\"",
].join("\n");

export const WEBHOOK_SAMPLE = JSON.stringify(
  {
    type: "powder.alert",
    resort: { slug: "alta", name: "Alta Ski Area", url: `${SITE_URL}/resorts/alta` },
    inches: 11,
    kind: "measured",
    measuredAt: "2026-12-01T12:30:00.000Z",
    url: `${SITE_URL}/resorts/alta`,
    threshold: 8,
  },
  null,
  2,
);

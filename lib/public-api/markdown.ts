// ─────────────────────────────────────────────────────────────
// Public API — markdown rendering of the serializer shapes.
//
// Pure functions over the wire types in schema.ts: no Next.js, no Supabase,
// no clock (every date is read from the document). This is the compact form
// the MCP tools (lib/mcp/tools.ts) put in their `content` blocks: a short,
// dated, source-labelled report that fits a tool result. The long-form page
// documents served at /resorts/{slug}/index.md and /index.md (and the MCP
// `peakcam://resorts/{slug}` resource) live in markdown-page.ts; both read
// the same `serializeResort()` output, so the numbers and labels agree.
// ─────────────────────────────────────────────────────────────

import type {
  CamPublic,
  Measurement,
  MeasurementSource,
  ResortPublic,
  SeasonPublic,
  SnowPublic,
  Station,
} from "./schema";

// ── Source labels ────────────────────────────────────────────

/** Long form, for a sentence: "SNOTEL-measured (USDA NRCS)". */
export const SOURCE_LABELS: Record<MeasurementSource, string> = {
  snotel: "SNOTEL-measured (USDA NRCS)",
  open_meteo: "model estimate (Open-Meteo)",
  pipeline: "PeakCam multi-source blend",
  manual: "hand-entered",
  resort: "resort-reported",
};

/** Short form, for a table cell or a list row. */
export const SHORT_SOURCE_LABELS: Record<MeasurementSource, string> = {
  snotel: "SNOTEL",
  open_meteo: "model",
  pipeline: "blend",
  manual: "manual",
  resort: "resort",
};

export function sourceLabel(source: MeasurementSource | null | undefined, short = false): string {
  if (!source) return short ? "unknown" : "source unknown";
  return (short ? SHORT_SOURCE_LABELS : SOURCE_LABELS)[source];
}

// ── Formatting ───────────────────────────────────────────────

/** `2026-12-20 12:00 UTC` from an ISO instant; `unknown` when null or unparsable. */
export function formatInstant(iso: string | null | undefined): string {
  if (!iso) return "unknown";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "unknown";
  return `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** `6 in`, `118 %`, or `n/a`. */
export function formatMeasurement(m: Measurement | null | undefined): string {
  if (!m || m.value == null) return "n/a";
  return m.unit === "percent" ? `${formatNumber(m.value)} %` : `${formatNumber(m.value)} in`;
}

/** `6 in` or `n/a` for a bare number (the light list rows carry no Measurement). */
export function formatInches(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? "n/a" : `${formatNumber(value)} in`;
}

export function formatStation(station: Station | null | undefined): string | null {
  if (!station) return null;
  const name = station.name ?? station.id;
  const elevation = station.elevationFt != null ? ` at ${station.elevationFt.toLocaleString("en-US")} ft` : "";
  return `${name}${elevation}`;
}

// ── Sections ─────────────────────────────────────────────────

/** `open (confirmed opening 2026-11-14; as of 2026-12-20)` */
export function seasonSummary(season: SeasonPublic): string {
  const parts: string[] = [];
  if (season.openDate) parts.push(`${season.openDateKind === "confirmed" ? "confirmed" : "projected"} opening ${season.openDate}`);
  if (season.closingDate) parts.push(`closing ${season.closingDate}`);
  if (!parts.length) parts.push("no date on file");
  return `${season.status} (${parts.join(", ")}; as of ${season.asOf})`;
}

/** The station a snow document was read from, when any field carries one. */
export function snowStation(snow: SnowPublic | null | undefined): Station | null {
  if (!snow) return null;
  return snow.swe.station ?? snow.baseDepth.station ?? snow.newSnow24h.station ?? null;
}

/** One sentence naming the source, station and report time. */
export function snowProvenance(snow: SnowPublic): string {
  const station = formatStation(snowStation(snow));
  return `Latest report: ${sourceLabel(snow.source)}${station ? `, station ${station}` : ""}, ${formatInstant(snow.reportedAt)}.`;
}

export function snowSection(snow: SnowPublic | null): string[] {
  if (!snow) return ["No snow report on file for this resort."];
  const rows: Array<[string, string]> = [
    ["New snow 24 h", formatMeasurement(snow.newSnow24h)],
    ["New snow 48 h", formatMeasurement(snow.newSnow48h)],
    ["Base depth", formatMeasurement(snow.baseDepth)],
    ["Snow water equivalent", formatMeasurement(snow.swe)],
    ["SWE % of normal", formatMeasurement(snow.pctOfNormal)],
    ["7-day SWE trend", snow.trend7d.value ?? "n/a"],
    ["Outlook", snow.outlook ? snow.outlook.replace(/_/g, " ") : "n/a"],
    ["PeakCam rating", snow.rating ?? "n/a"],
  ];
  const lines = [snowProvenance(snow), "", "| Metric | Value |", "| --- | --- |", ...rows.map(([k, v]) => `| ${k} | ${v} |`)];
  if (snow.tags.length) lines.push("", `Tags: ${snow.tags.join(", ")}`);
  if (snow.narrative) lines.push("", snow.narrative);
  return lines;
}

export function camHealthLabel(cam: Pick<CamPublic, "live">): "live" | "down" | "unchecked" {
  return cam.live === true ? "live" : cam.live === false ? "down" : "unchecked";
}

export function camLine(cam: CamPublic): string {
  const bits: string[] = [
    `**${cam.name}**${cam.elevation ? ` (${cam.elevation})` : ""}`,
    `${camHealthLabel(cam)}${cam.lastCheckedAt ? ` as of ${formatInstant(cam.lastCheckedAt)}` : ""}`,
    cam.embedType,
  ];
  if (cam.stillUrl) bits.push(`still: ${cam.stillUrl}${cam.capturedAt ? ` (captured ${formatInstant(cam.capturedAt)})` : ""}`);
  if (cam.sourceUrl) bits.push(`source: ${cam.sourceUrl}`);
  return `- ${bits.join(" · ")}`;
}

/** Up to `maxCams` lines, then a pointer to the page for the rest. */
export function camsSection(cams: readonly CamPublic[], pageUrl: string, maxCams = 12): string[] {
  if (!cams.length) return ["No cams on file."];
  const shown = cams.slice(0, maxCams);
  const lines = shown.map(camLine);
  if (cams.length > shown.length) lines.push(`- …and ${cams.length - shown.length} more at ${pageUrl}`);
  return lines;
}

// ── Document ─────────────────────────────────────────────────

export interface ResortMarkdownOptions {
  /** Cam lines to print before pointing at the page. Default 12. */
  maxCams?: number;
  /** `list` prints the cam lines; `count` prints only the count and the page URL. Default `list`. */
  cams?: "list" | "count";
}

/**
 * The compact markdown report for one resort, built from `serializeResort()`
 * output. Heading, where it is, season status, the snow table with its
 * provenance sentence, the cams, and the attribution footer.
 */
export function resortMarkdown(resort: ResortPublic, options: ResortMarkdownOptions = {}): string {
  const { maxCams = 12, cams = "list" } = options;
  const live = resort.cams.filter((c) => c.live === true).length;
  const base = resort.location.baseElevationFt != null ? ` · base ${resort.location.baseElevationFt.toLocaleString("en-US")} ft` : "";
  const lines: string[] = [
    `# ${resort.name} snow report`,
    "",
    `${resort.location.region}, ${resort.location.state}, ${resort.location.country}${base}`,
    `Season: ${seasonSummary(resort.season)}`,
    `PeakCam page (cite this): ${resort.canonicalUrl}`,
    `JSON: ${resort.apiUrl}`,
    "",
    "## Snow",
    "",
    ...snowSection(resort.snow),
    "",
    `## Cams (${resort.cams.length}, ${live} live)`,
    "",
  ];
  if (cams === "list") lines.push(...camsSection(resort.cams, resort.canonicalUrl, maxCams));
  else lines.push(resort.cams.length ? `Cam list and players: ${resort.canonicalUrl}` : "No cams on file.");
  lines.push("", `Data: ${resort.attribution}. Terms: ${resort.license}. Updated ${formatInstant(resort.updatedAt)}.`);
  return `${lines.join("\n")}\n`;
}

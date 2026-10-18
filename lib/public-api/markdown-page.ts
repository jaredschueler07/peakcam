// ─────────────────────────────────────────────────────────────
// Markdown alternates: the full-page documents served at
// /resorts/{slug}/index.md and /index.md (execution plan Sprint 4).
//
// Pure functions from the public API shapes (schema.ts) to markdown text, so
// the routes are one serializer call plus one of these, and the tests build
// fixtures by hand. Every number carries its provenance in words the way the
// resort page does: a SNOTEL value names its station and elevation, a model
// value says "weather-model estimate". No Supabase, no Next.js.
//
// Sprint 5 is writing a compact per-tool builder as lib/public-api/markdown.ts
// for MCP `content`; this file is the long form and will be reconciled with it.
// ─────────────────────────────────────────────────────────────

import { SITE_URL } from "@/lib/site";
import { HUB_BASE_PATH, stateHubPath, stateLabel } from "@/lib/hubs";
import type { WeatherPeriod } from "@/lib/types";
import type { CamTimeline } from "@/lib/cam-timeline";
import type { SnowHistoryRow } from "@/lib/mcp/types";
import { DESCRIPTION_SOURCE_LABELS, type ResortDescription } from "@/lib/resort-profile";
import { RESORT_SUBPAGES, resortTabMarkdownPath, resortTabPath } from "@/lib/resort-pages";
import { publicApiHeaders } from "./headers";
import type {
  CamPublic,
  Measurement,
  MeasurementSource,
  ResortLightPublic,
  ResortListPublic,
  ResortPublic,
  SeasonPublic,
} from "./schema";

export const MARKDOWN_CONTENT_TYPE = "text/markdown; charset=utf-8";

export interface MarkdownPageOptions {
  /** Render instant for the dated line when the document carries no timestamp of its own. */
  now?: Date;
  /** Origin for site links (API, hubs, feeds). Defaults to the production www host. */
  baseUrl?: string;
  /** The stored `resorts.description` with its provenance, when the row has one (P2 plumbing). */
  description?: ResortDescription | null;
}

/**
 * Response headers for a markdown alternate: the public API set (CORS,
 * attribution, author/license Link) plus the canonical Link and a noindex so
 * the HTML page, not this document, is what search engines rank.
 */
export function markdownPageHeaders(canonicalUrl: string): Record<string, string> {
  return {
    ...publicApiHeaders({
      contentType: MARKDOWN_CONTENT_TYPE,
      extraLinks: [`<${canonicalUrl}>; rel="canonical"`],
    }),
    "X-Robots-Tag": "noindex",
  };
}

// ── Formatting helpers ───────────────────────────────────────

const MOUNTAIN_TIME = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Denver",
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** "5:00 AM MT on Dec 20, 2026" — the site's data clock is Mountain Time. */
export function formatMountainTime(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "an unknown time";
  const parts = MOUNTAIN_TIME.formatToParts(d);
  const get = (type: Intl.DateTimeFormatPart["type"]) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("hour")}:${get("minute")} ${get("dayPeriod")} MT on ${get("month")} ${get("day")}, ${get("year")}`;
}

const LONG_DATE = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });

/** "Nov 10, 2026" from a YYYY-MM-DD day; the input echoed back if it does not parse. */
function formatDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? day : LONG_DATE.format(d);
}

function inches(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "n/a";
  return `${Number.isInteger(value) ? value : Math.round(value * 10) / 10} in`;
}

function percent(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? "n/a" : `${Math.round(value)}%`;
}

function feet(value: number | null | undefined): string | null {
  return value == null || !Number.isFinite(value) ? null : `${Math.round(value).toLocaleString("en-US")} ft`;
}

/** The parenthetical the resort page uses after a number: who measured it and where. */
export function sourceLabel(m: Pick<Measurement, "source" | "station"> | null | undefined): string {
  if (!m?.source) return "source unknown";
  switch (m.source) {
    case "snotel": {
      const bits = ["SNOTEL"];
      if (m.station?.name) bits.push(m.station.name);
      else if (m.station?.id) bits.push(`station ${m.station.id}`);
      const elev = feet(m.station?.elevationFt);
      if (elev) bits.push(elev);
      return bits.join(", ");
    }
    case "open_meteo":
      return "weather-model estimate";
    case "pipeline":
      return "PeakCam multi-source blend";
    case "manual":
      return "entered by hand";
    case "resort":
      return "resort-published";
  }
}

function sourceWord(source: MeasurementSource | null): string {
  return source === "snotel" ? "measured" : source === "open_meteo" ? "estimated" : "reported";
}

function liveWord(live: boolean | null): string {
  if (live === true) return "live";
  if (live === false) return "offline (last health check failed)";
  return "unchecked";
}

function camLine(cam: CamPublic): string {
  const name = cam.elevation ? `${cam.name} (${cam.elevation})` : cam.name;
  const captured = cam.capturedAt
    ? `captured ${cam.capturedAt}`
    : cam.stillUrl
      ? "provider still, capture time unknown"
      : "no still image";
  return `- ${name}: ${liveWord(cam.live)}, ${captured}; watch at ${cam.pageUrl}`;
}

function seasonLine(season: SeasonPublic): string {
  const label = season.seasonLabel ? ` (${season.seasonLabel} season)` : "";
  const parts: string[] = [];
  if (season.openDate) {
    const verb = season.openDateKind === "confirmed" ? "opening date" : "projected opening";
    parts.push(`${verb} ${formatDay(season.openDate)}`);
  }
  if (season.closingDate) parts.push(`closing ${formatDay(season.closingDate)}`);
  const detail = parts.length ? `; ${parts.join(", ")}` : "";
  const src = season.sourceUrl ? ` Source: ${season.sourceUrl}` : "";
  return `Season: ${season.status}${label}${detail}, as of ${season.asOf}.${src}`;
}

function attributionBlock(canonicalUrl: string, attribution: string, license: string): string {
  return [
    `Canonical: ${canonicalUrl}`,
    "",
    `Data: ${attribution}. Cite the canonical URL when quoting these numbers.`,
    `License: ${license}`,
  ].join("\n");
}

// ── /resorts/{slug}/index.md ─────────────────────────────────

/** The dated opening sentence, in the same voice as the resort page's summary. */
export function resortSummarySentence(resort: ResortPublic, opts: MarkdownPageOptions = {}): string {
  const snow = resort.snow;
  if (!snow) {
    const when = formatMountainTime(opts.now ?? new Date());
    return `As of ${when}, PeakCam has no snow report for ${resort.name} yet.`;
  }
  const when = formatMountainTime(snow.reportedAt ?? opts.now ?? new Date());
  const src = `(${sourceLabel(snow.baseDepth.source ? snow.baseDepth : snow.newSnow24h)})`;
  const clauses: string[] = [];
  if (snow.baseDepth.value != null) clauses.push(`a ${inches(snow.baseDepth.value)} base`);
  if (snow.newSnow24h.value != null) clauses.push(`${inches(snow.newSnow24h.value)} of new snow in the last 24 hours`);
  if (snow.newSnow48h.value != null) clauses.push(`${inches(snow.newSnow48h.value)} over 48 hours`);
  let sentence: string;
  if (clauses.length === 0) {
    sentence = `As of ${when}, the latest ${sourceWord(snow.source)} report for ${resort.name} carries no depth or new-snow values ${src}.`;
  } else {
    const list = clauses.length === 1 ? clauses[0] : `${clauses.slice(0, -1).join(", ")} and ${clauses[clauses.length - 1]}`;
    sentence = `As of ${when}, ${resort.name} ${snow.source === "snotel" ? "measures" : "has"} ${list} ${src}.`;
  }
  if (snow.pctOfNormal.value != null) {
    sentence += ` Snow water equivalent is ${percent(snow.pctOfNormal.value)} of the station's 1991-2020 median for today's date.`;
  }
  if (snow.rating) {
    const tags = snow.tags.length ? `; ${snow.tags.join(", ")}` : "";
    sentence += ` Conditions rating: ${snow.rating}${tags}.`;
  }
  if (snow.narrative) sentence += ` ${snow.narrative.replace(/\.{2,}$/, ".")}`;
  return sentence;
}

function snowTable(snow: NonNullable<ResortPublic["snow"]>): string {
  const row = (label: string, m: Measurement, fmt: (v: number | null) => string) =>
    `| ${label} | ${fmt(m.value)} | ${sourceLabel(m)} | ${m.measuredAt ?? "n/a"} |`;
  return [
    "| Measure | Value | Source | Measured at (UTC) |",
    "| --- | --- | --- | --- |",
    row("Base depth", snow.baseDepth, inches),
    row("New snow, 24 h", snow.newSnow24h, inches),
    row("New snow, 48 h", snow.newSnow48h, inches),
    row("Snow water equivalent", snow.swe, inches),
    row("Percent of normal", snow.pctOfNormal, percent),
  ].join("\n");
}

export function resortMarkdown(resort: ResortPublic, opts: MarkdownPageOptions = {}): string {
  const place = stateLabel(resort.location.state);
  const snow = resort.snow;
  const lines: string[] = [
    `# ${resort.name}, ${place}: snow report and webcams`,
    "",
    resortSummarySentence(resort, opts),
    "",
  ];

  if (opts.description) {
    lines.push(`Description (${DESCRIPTION_SOURCE_LABELS[opts.description.source]}): ${opts.description.text}`, "");
  }

  if (snow) {
    lines.push(snowTable(snow), "");
    const extras: string[] = [];
    if (snow.trend7d.value) extras.push(`7-day trend: ${snow.trend7d.value}`);
    if (snow.outlook) extras.push(`outlook: ${snow.outlook.replace("_", " ")}`);
    if (extras.length) lines.push(`${extras.join("; ")}.`, "");
  }

  lines.push(seasonLine(resort.season), "");

  lines.push(`## Webcams (${resort.cams.length})`, "");
  if (resort.cams.length === 0) {
    lines.push("No active webcams.", "");
  } else {
    lines.push(...resort.cams.map(camLine), "");
    lines.push(
      "`live` is the last health check, not proof of a live broadcast. A capture time is given only for frames PeakCam captured itself; provider snapshots are served as published and their age is unknown.",
      "",
    );
  }

  lines.push("## Links", "");
  lines.push(`- Page: ${resort.canonicalUrl}`);
  lines.push(`- API: ${resort.apiUrl}`);
  lines.push(`- Cams API: ${resort.apiUrl}/cams`);
  lines.push(`- Powder feed (Atom): ${resort.canonicalUrl}/powder.xml`);
  if (resort.websiteUrl) lines.push(`- Resort website: ${resort.websiteUrl}`);
  lines.push(...subpageLinks(resort, opts.baseUrl));
  lines.push("");

  lines.push(attributionBlock(resort.canonicalUrl, resort.attribution, resort.license), "");
  return lines.join("\n");
}

/** "- Snow report: …/snow-report (markdown: …/snow-report/index.md)" for every subpage in the family. */
function subpageLinks(resort: Pick<ResortPublic, "slug">, baseUrl: string = SITE_URL): string[] {
  return RESORT_SUBPAGES.map(
    (tab) => `- ${tab.label}: ${baseUrl}${resortTabPath(resort.slug, tab.key)} (markdown: ${baseUrl}${resortTabMarkdownPath(resort.slug, tab.key)})`,
  );
}

// ── /resorts/{slug}/snow-report/index.md ─────────────────────

export interface SnowReportMarkdownExtras extends MarkdownPageOptions {
  /** `snowpack_daily` rows, newest first (the 7-day history table). */
  history: readonly SnowHistoryRow[];
  /** NWS (US) or Open-Meteo daily periods, or null when the service did not answer. */
  forecast: readonly WeatherPeriod[] | null;
  /** Unflagged on-mountain user reports in the last 48 hours. */
  userReportCount48h: number;
}

function degrees(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? "n/a" : `${Math.round(value)}°F`;
}

function historyTable(rows: readonly SnowHistoryRow[]): string[] {
  if (!rows.length) return ["No daily station history stored for this resort yet."];
  const out = ["| Date | Snow depth | SWE | Precip (accum.) | High / low | QC |", "| --- | --- | --- | --- | --- | --- |"];
  for (const r of rows) {
    out.push(
      `| ${r.date} | ${inches(r.snow_depth_in)} | ${inches(r.swe_in)} | ${inches(r.precip_accum_in)} | ${degrees(r.temp_max_f)} / ${degrees(r.temp_min_f)} | ${r.qc_flag} |`,
    );
  }
  const station = rows[0].station_id;
  out.push(
    "",
    station === "open-meteo"
      ? "Rows are weather-model estimates (Open-Meteo), one per day, written by PeakCam's model sync."
      : `Rows are daily readings from NRCS station ${station}, quality-controlled (range and spike checks; \`suspect\` rows are kept but flagged).`,
  );
  return out;
}

function forecastTable(periods: readonly WeatherPeriod[] | null, country: string): string[] {
  if (!periods || !periods.length) return ["Forecast unavailable at render time."];
  const out = ["| Day | Forecast | High / low | Est. snow | Precip chance |", "| --- | --- | --- | --- | --- |"];
  for (const p of periods) {
    const chance = p.precipProbability == null ? "n/a" : `${Math.round(p.precipProbability)}%`;
    out.push(`| ${p.dow} | ${p.shortForecast} | ${degrees(p.high)} / ${degrees(p.low)} | ${inches(p.snowInches)} | ${chance} |`);
  }
  out.push(
    "",
    country === "US"
      ? "Source: National Weather Service point forecast. Snow amounts are keyword estimates from the forecast text, not a quantitative precipitation forecast."
      : "Source: Open-Meteo model forecast for the resort's coordinates. Snow amounts are model estimates.",
  );
  return out;
}

export function snowReportMarkdown(resort: ResortPublic, extras: SnowReportMarkdownExtras): string {
  const base = extras.baseUrl ?? SITE_URL;
  const canonical = `${base}${resortTabPath(resort.slug, "snow-report")}`;
  const snow = resort.snow;
  const lines: string[] = [
    `# ${resort.name} snow report: measured conditions`,
    "",
    resortSummarySentence(resort, extras),
    "",
  ];
  if (snow) {
    lines.push("## Today's numbers", "", snowTable(snow), "");
    const extrasLine: string[] = [];
    if (snow.trend7d.value) extrasLine.push(`7-day trend: ${snow.trend7d.value}`);
    if (snow.outlook) extrasLine.push(`outlook: ${snow.outlook.replace("_", " ")}`);
    if (extrasLine.length) lines.push(`${extrasLine.join("; ")}.`, "");
  } else {
    lines.push("## Today's numbers", "", "No snow report yet this season.", "");
  }
  lines.push(seasonLine(resort.season), "");
  lines.push(`## Last ${extras.history.length || 7} days`, "", ...historyTable(extras.history), "");
  lines.push("## Forecast", "", ...forecastTable(extras.forecast, resort.location.country), "");
  const n = extras.userReportCount48h;
  lines.push(
    "## On-mountain reports",
    "",
    n === 0
      ? "No user-submitted conditions reports in the last 48 hours."
      : `${n} user-submitted conditions report${n === 1 ? "" : "s"} in the last 48 hours; read them on the resort page.`,
    "",
  );
  const station = snow?.baseDepth.station ?? snow?.newSnow24h.station;
  lines.push("## Links", "");
  lines.push(`- Resort page: ${resort.canonicalUrl}`);
  lines.push(...subpageLinks(resort, base));
  lines.push(`- API: ${resort.apiUrl}`);
  lines.push(`- Powder feed (Atom): ${resort.canonicalUrl}/powder.xml`);
  lines.push(`- How the station is read: ${base}/methodology#snotel${station ? ` (station ${station.id}${station.name ? `, ${station.name}` : ""})` : ""}`);
  lines.push("");
  lines.push(attributionBlock(canonical, resort.attribution, resort.license), "");
  return lines.join("\n");
}

// ── /resorts/{slug}/webcams/index.md ─────────────────────────

export interface WebcamsMarkdownExtras extends MarkdownPageOptions {
  /** camId → still-archive timeline (only cams with frames on tape). */
  timelines: Readonly<Record<string, CamTimeline>>;
}

function timelineLines(timeline: CamTimeline | undefined): string[] {
  if (!timeline) return [];
  const out: string[] = [];
  if (timeline.frames.length) {
    out.push(`  - Last ${timeline.hours} h on tape (${timeline.frames.length} frame${timeline.frames.length === 1 ? "" : "s"}):`);
    for (const f of timeline.frames) {
      const snow = f.snow24hAtCapture == null ? "" : `, ${inches(f.snow24hAtCapture)} new in 24 h at capture`;
      out.push(`    - ${f.capturedAt}${snow}: ${f.url}`);
    }
  }
  if (timeline.lastStorm) {
    const s = timeline.lastStorm;
    out.push(`  - Last storm on tape: ${s.capturedAt}${s.snow24hAtCapture == null ? "" : ` (${inches(s.snow24hAtCapture)} in 24 h)`}: ${s.url}`);
  }
  return out;
}

export function webcamsMarkdown(resort: ResortPublic, extras: WebcamsMarkdownExtras): string {
  const base = extras.baseUrl ?? SITE_URL;
  const canonical = `${base}${resortTabPath(resort.slug, "webcams")}`;
  const cams = resort.cams;
  const live = cams.filter((c) => c.live === true).length;
  const offline = cams.filter((c) => c.live === false).length;
  const unchecked = cams.length - live - offline;
  const checks = cams.map((c) => c.lastCheckedAt).filter((v): v is string => Boolean(v)).sort();
  const latestCheck = checks.length ? checks[checks.length - 1] : null;
  const lines: string[] = [`# ${resort.name} webcams: ${cams.length} live cam${cams.length === 1 ? "" : "s"}`, ""];
  if (cams.length === 0) {
    lines.push(`PeakCam lists no active webcams for ${resort.name}.`, "");
  } else {
    const when = latestCheck ? ` as of the last health check at ${formatMountainTime(latestCheck)}` : "";
    lines.push(
      `${cams.length} webcam${cams.length === 1 ? "" : "s"} at ${resort.name}: ${live} live, ${offline} offline, ${unchecked} not yet checked${when}.`,
      "",
    );
    for (const cam of cams) {
      lines.push(camLine(cam), ...timelineLines(extras.timelines[cam.id]));
    }
    lines.push(
      "",
      "`live` is the last health check, not proof of a live broadcast. Frames on tape are PeakCam's own 6-hourly captures of cams whose operators allow archiving; provider snapshots are served as published and their age is unknown.",
      "",
    );
  }
  lines.push("## Links", "");
  lines.push(`- Resort page: ${resort.canonicalUrl}`);
  lines.push(...subpageLinks(resort, base));
  lines.push(`- Cams API: ${resort.apiUrl}/cams`);
  if (resort.websiteUrl) lines.push(`- Resort website: ${resort.websiteUrl}`);
  lines.push("");
  lines.push(attributionBlock(canonical, resort.attribution, resort.license), "");
  return lines.join("\n");
}

// ── /index.md ────────────────────────────────────────────────

const num = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? -Infinity : v);

/** Resorts with a measured (SNOTEL) 24 h value above zero, most snow first, at most `limit`. */
export function topMeasured24h(list: ResortListPublic, limit = 10): ResortLightPublic[] {
  return list.resorts
    .filter((r) => r.snow?.source === "snotel" && r.snow.newSnow24h != null && r.snow.newSnow24h > 0)
    .sort(
      (a, b) =>
        num(b.snow!.newSnow24h) - num(a.snow!.newSnow24h) ||
        num(b.snow!.newSnow48h) - num(a.snow!.newSnow48h) ||
        num(b.snow!.baseDepth) - num(a.snow!.baseDepth) ||
        a.name.localeCompare(b.name, "en"),
    )
    .slice(0, limit);
}

export function indexMarkdown(list: ResortListPublic, opts: MarkdownPageOptions = {}): string {
  const base = opts.baseUrl ?? SITE_URL;
  const when = formatMountainTime(list.generatedAt || opts.now || new Date());
  const measured = list.resorts.filter((r) => r.snow?.source === "snotel");
  const top = topMeasured24h(list);
  const leader = top[0];

  const dated = leader
    ? `As of ${when}, ${top.length === 10 ? "at least 10" : top.length} of ${measured.length} station-measured resorts report new snow in the last 24 hours; the most is ${inches(leader.snow!.newSnow24h)} at ${leader.name}, ${stateLabel(leader.location.state)} (SNOTEL).`
    : `As of ${when}, none of the ${measured.length} station-measured resorts reports new snow in the last 24 hours.`;

  const lines: string[] = [
    "# PeakCam: ski resort snow reports and live webcams",
    "",
    `> Snow reports and live webcams for ${list.count} ski resorts across North and South America. Where a resort has an assigned NRCS SNOTEL/SCAN station its numbers are sensor telemetry, quality-controlled and synced every six hours; resorts without one use weather-model estimates and are labelled as such.`,
    "",
    dated,
    "",
    "## Most new snow in the last 24 hours (measured only)",
    "",
  ];

  if (top.length) {
    lines.push("| # | Resort | 24 h | 48 h | Base | Markdown |", "| --- | --- | --- | --- | --- | --- |");
    top.forEach((r, i) => {
      lines.push(
        `| ${i + 1} | [${r.name}](${r.canonicalUrl}), ${stateLabel(r.location.state)} | ${inches(r.snow!.newSnow24h)} | ${inches(r.snow!.newSnow48h)} | ${inches(r.snow!.baseDepth)} | ${r.canonicalUrl}/index.md |`,
      );
    });
  } else {
    lines.push("No measured new snow in the last 24 hours.");
  }
  lines.push("", `Full ranking, including model-estimated resorts: ${base}/api/v1/powder?window=24h`, "");

  // State hubs: the same groups as /ski-cams, counted from the list itself.
  const byState = new Map<string, number>();
  for (const r of list.resorts) byState.set(r.location.state, (byState.get(r.location.state) ?? 0) + 1);
  const states = [...byState.entries()].sort((a, b) => b[1] - a[1] || stateLabel(a[0]).localeCompare(stateLabel(b[0]), "en"));
  lines.push("## Resorts by state, province and country", "");
  lines.push(`Each hub lists its resorts ranked by base depth with live cams. Index: ${base}${HUB_BASE_PATH}`, "");
  for (const [code, count] of states) {
    lines.push(`- [${stateLabel(code)}](${base}${stateHubPath(code)}): ${count} resort${count === 1 ? "" : "s"}`);
  }
  lines.push("");

  lines.push("## Per-resort documents", "");
  lines.push(`- Markdown: ${base}/resorts/{slug}/index.md`);
  lines.push(`- JSON: ${base}/api/v1/resorts/{slug} (cams at /cams)`);
  lines.push(`- Powder feed (Atom): ${base}/resorts/{slug}/powder.xml`);
  lines.push(`- HTML page: ${base}/resorts/{slug}`);
  lines.push("", `Slugs: ${base}/api/v1/resorts`, "");

  lines.push("## Machine-readable entry points", "");
  lines.push(`- API base: ${base}/api/v1`);
  lines.push(`- OpenAPI 3.1: ${base}/api/v1/openapi.json`);
  lines.push(`- API catalog (RFC 9727): ${base}/.well-known/api-catalog`);
  lines.push(`- llms.txt: ${base}/llms.txt`);
  lines.push(`- Sitemap: ${base}/sitemap.xml`);
  lines.push("");

  lines.push(attributionBlock(`${base}/`, list.attribution, list.license), "");
  return lines.join("\n");
}

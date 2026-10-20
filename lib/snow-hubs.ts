// ─────────────────────────────────────────────────────────────
// Per-state snow-report hubs (parity plan P10): /snow-report/{hub} mirrors
// /ski-cams/{hub} — the same hub resolver over the same resort list, with
// the leaderboard layout instead of the cam table: every resort in the
// state ranked by measured base with new snow, source and the reading's
// time. Pure: no Next.js, no database, no Date.now.
// ─────────────────────────────────────────────────────────────

import type { ResortWithData, SnowReportSource } from "./types";
import { LEADERBOARD_KINDS } from "./leaderboards";
import { listHubs, resolveHub, type Hub, type HubResortLike, type RegionGroup, type StateGroup } from "./hubs";
import { formatMountainTime, inches, latestUpdatedAt, sourceLabel, type Quotable, type QuotableSegment } from "./quotable";
import { stationMeta } from "./stations";
import { SITE_URL } from "./site";
import { PUBLIC_API_ATTRIBUTION } from "./public-api/headers";

export const SNOW_HUB_BASE_PATH = "/snow-report";

/**
 * Static children of /snow-report that a hub slug must never shadow. Next
 * routes static segments before the dynamic one, so a collision would hide
 * the hub silently; lib/snow-hubs.test.ts checks the catalogue against it.
 */
export const RESERVED_SNOW_REPORT_SEGMENTS: readonly string[] = [...LEADERBOARD_KINDS, "percent-of-normal", "leaderboards"];

export function snowHubPath(hub: Pick<Hub, "slug">): string {
  return `${SNOW_HUB_BASE_PATH}/${hub.slug}`;
}

export function snowHubMarkdownPath(hub: Pick<Hub, "slug">): string {
  return `${snowHubPath(hub)}/index.md`;
}

/** Every hub that gets a snow-report page: the same set as /ski-cams. */
export function listSnowHubs<T extends HubResortLike>(resorts: readonly T[]): { states: StateGroup<T>[]; regions: RegionGroup<T>[] } {
  return listHubs(resorts);
}

const num = (v: number | string | null | undefined): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** One resort's measured numbers today, as the hub and pass tables show them. */
export interface MeasuredRow {
  slug: string;
  name: string;
  state: string;
  country: string;
  region: string;
  baseIn: number | null;
  new24In: number | null;
  new48In: number | null;
  pctOfNormal: number | null;
  /** Null when the resort has no report yet this season. */
  source: SnowReportSource | null;
  stationId: string | null;
  stationName: string | null;
  /** ISO instant of the report, null without one. */
  measuredAt: string | null;
  liveCams: number;
}

export function measuredRow(r: ResortWithData): MeasuredRow {
  const snow = r.snow_report;
  const stationId = snow?.source === "snotel" ? r.snotel_station_id : null;
  return {
    slug: r.slug,
    name: r.name,
    state: r.state,
    country: r.country,
    region: r.region ?? "",
    baseIn: num(snow?.base_depth),
    new24In: num(snow?.new_snow_24h),
    new48In: num(snow?.new_snow_48h),
    pctOfNormal: snow?.source === "snotel" ? num(snow.pct_of_normal) : null,
    source: snow?.source ?? null,
    stationId,
    stationName: stationId ? (stationMeta(stationId)?.name ?? null) : null,
    measuredAt: snow?.updated_at ?? null,
    liveCams: (r.cams ?? []).filter((c) => c.is_active && !c.auto_disabled).length,
  };
}

/** Deepest base first, then most new snow, then name; resorts without a report go last. */
export function rankByBase(rows: readonly MeasuredRow[]): MeasuredRow[] {
  return [...rows].sort((a, b) => {
    const ar = a.source ? 1 : 0;
    const br = b.source ? 1 : 0;
    if (ar !== br) return br - ar;
    return (b.baseIn ?? -1) - (a.baseIn ?? -1) || (b.new24In ?? -1) - (a.new24In ?? -1) || a.name.localeCompare(b.name, "en");
  });
}

export interface SnowHubPage {
  hub: Hub;
  kind: Hub["kind"];
  rows: MeasuredRow[];
  count: number;
  /** Rows with a report this season. */
  reported: number;
  /** Newest report among the rows; null when none has one. */
  asOf: string | null;
  sentence: Quotable;
  pageUrl: string;
  markdownUrl: string;
}

function finish(asOf: string | null, segments: QuotableSegment[]): Quotable {
  const text = segments.map((s) => s.text).join("");
  const href = segments.find((s) => s.href)?.href;
  return href ? { asOf, text, href, segments } : { asOf, text, segments };
}

function rowClause(row: MeasuredRow): QuotableSegment[] {
  const parts: string[] = [];
  if (row.baseIn != null) parts.push(`base ${inches(row.baseIn)}`);
  if (row.new24In != null) parts.push(`${inches(row.new24In)} of new snow in 24 h`);
  const src = row.source ? ` (${sourceLabel(row.source)}${row.stationName ? `, ${row.stationName}` : ""})` : "";
  return [{ text: row.name, href: `/resorts/${row.slug}` }, { text: `${parts.length ? ` at ${parts.join(", ")}` : ""}${src}` }];
}

export interface SentenceWording {
  /** "in Colorado", "among Ikon Pass resorts". */
  where: string;
  /** "Colorado", "Ikon Pass" — qualifies "resorts" in the counts. */
  group: string;
}

/**
 * The dated sentence under the H1: the deepest base in the group with its
 * source, then the second, and how many resorts have a report. Dated to the
 * newest report the rows carry, never the render time.
 */
export function snowHubSentence(rows: readonly MeasuredRow[], wording: SentenceWording): Quotable {
  const { where, group } = wording;
  const reported = rows.filter((r) => r.source);
  const asOf = latestUpdatedAt(reported.map((r) => ({ updated_at: r.measuredAt! })));
  if (!reported.length) {
    return finish(null, [{ text: `No snow reports yet this season for the ${rows.length} ${group} ${rows.length === 1 ? "resort" : "resorts"} PeakCam tracks.` }]);
  }
  const stamp = asOf ? `As of ${formatMountainTime(asOf)}, ` : "";
  const withBase = reported.filter((r) => r.baseIn != null && r.baseIn > 0);
  if (!withBase.length) {
    return finish(asOf, [{ text: `${stamp}none of the ${reported.length} ${group} resorts with a report has snow on the ground.` }]);
  }
  const segments: QuotableSegment[] = [{ text: `${stamp}the deepest base ${where} is ` }, ...rowClause(withBase[0])];
  if (withBase[1]) segments.push({ text: ", then " }, ...rowClause(withBase[1]));
  segments.push({ text: `; ${reported.length} of ${rows.length} resorts have a report.` });
  return finish(asOf, segments);
}

/** The hub behind a /snow-report/{slug} segment, or null for a 404. */
export function buildSnowHub(slug: string, resorts: readonly ResortWithData[], baseUrl: string = SITE_URL): SnowHubPage | null {
  const resolved = resolveHub(slug, resorts);
  if (!resolved) return null;
  const rows = rankByBase(resolved.resorts.map(measuredRow));
  const reported = rows.filter((r) => r.source);
  const pageUrl = `${baseUrl}${snowHubPath(resolved.hub)}`;
  return {
    hub: resolved.hub,
    kind: resolved.kind,
    rows,
    count: resolved.count,
    reported: reported.length,
    asOf: latestUpdatedAt(reported.map((r) => ({ updated_at: r.measuredAt! }))),
    sentence: snowHubSentence(rows, { where: `in ${resolved.hub.label}`, group: resolved.hub.label }),
    pageUrl,
    markdownUrl: `${baseUrl}${snowHubMarkdownPath(resolved.hub)}`,
  };
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "{Colorado} Snow Report — 25 Resorts, Measured Base & New Snow | PeakCam" */
export function snowHubTitle(hub: Hub, count: number): string {
  return `${hub.label} Snow Report — ${plural(count, "Resort")}, Measured Base & New Snow | PeakCam`;
}

export function snowHubDescription(hub: Hub, page: Pick<SnowHubPage, "count" | "reported" | "rows">): string {
  const lead = page.rows.find((r) => r.baseIn != null && r.baseIn > 0);
  const head = `Today's snow report for every ${hub.label} ski resort PeakCam tracks (${page.count}): base depth and new snow from NRCS SNOTEL stations where one exists, weather-model estimates elsewhere, each dated to its reading.`;
  return lead ? `${head} Deepest base right now: ${lead.name}, ${inches(lead.baseIn!)}.` : head;
}

function cell(v: number | null): string {
  return v == null ? "–" : inches(v);
}

/** The hub as one markdown document for agents (the HTML page's rel=alternate). */
export function snowHubMarkdown(page: SnowHubPage, baseUrl: string = SITE_URL): string {
  const lines: string[] = [
    `# ${page.hub.label} snow report, ${plural(page.count, "resort")}`,
    "",
    `Canonical page: ${page.pageUrl}  ·  Webcams: ${baseUrl}/ski-cams/${page.hub.slug}  ·  JSON: ${baseUrl}/api/v1/resorts?state=${encodeURIComponent(page.hub.kind === "region" ? "" : page.hub.key)}`,
    "",
    page.sentence.text,
    "",
    "| # | Resort | Base | New 24 h | New 48 h | % of normal | Source | Dated | Live cams |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  page.rows.forEach((r, i) => {
    const source = r.source ? `${sourceLabel(r.source)}${r.stationName ? ` (${r.stationName})` : ""}` : "no report yet";
    lines.push(`| ${i + 1} | [${r.name}](${baseUrl}/resorts/${r.slug}) | ${cell(r.baseIn)} | ${cell(r.new24In)} | ${cell(r.new48In)} | ${r.pctOfNormal != null ? `${Math.round(r.pctOfNormal)}%` : "–"} | ${source} | ${r.measuredAt ? formatMountainTime(r.measuredAt) : "–"} | ${r.liveCams} |`);
  });
  lines.push(
    "",
    "Base and new snow are read at the resort's NRCS SNOTEL station (one fixed elevation, usually mid-mountain) or, without a station, estimated by a weather model; both are synced every 6 hours. Dates are Mountain time.",
    "",
    `Attribution: ${PUBLIC_API_ATTRIBUTION}  ·  Terms: ${baseUrl}/about#terms`,
    "",
  );
  return lines.join("\n");
}

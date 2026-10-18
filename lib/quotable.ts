// ─────────────────────────────────────────────────────────────
// Quotable freshness sentences.
//
// One dated, source-labelled sentence per surface, written so an answer
// engine can lift it verbatim: "As of 6:00 a.m. MT Oct 18, the most new snow
// in the last 24 h is 8 in. at Lagunillas (model estimate) …". Every function
// here is pure — the page passes `now` in and the output is a function of its
// inputs only, so the ISR'd HTML is identical on every machine and the whole
// module is unit-tested in lib/quotable.test.ts without a database.
//
// Rules:
// - The timestamp is the newest `updated_at` across the reports the sentence
//   actually used — never the render time. A sentence rendered from stale
//   data must say so by carrying the stale time.
// - Mountain time with the zone named, because that is where most of the
//   catalogue's stations are and because an unlabelled time is unquotable.
// - Every number is labelled with where it came from: "SNOTEL" for a
//   telemetry station, "model estimate" for Open-Meteo / pipeline rows.
// - Missing fields drop out of the sentence; they are never papered over.
// ─────────────────────────────────────────────────────────────

import type { ResortWithData, SnowReport, SnowReportSource } from "./types";
import { formatOpeningDate, toPacificDay, type ResortOpening } from "./openings";
import { publishablePctOfNormal } from "./resort-copy";

/** The zone every sentence is dated in. */
export const QUOTABLE_TIME_ZONE = "America/Denver";
/** Fixed zone label; "MT" rather than MDT/MST so copy reads the same year-round. */
export const QUOTABLE_ZONE_LABEL = "MT";

export interface QuotableSegment {
  text: string;
  /** Set on resort names and the opening-dates reference so the UI can link them. */
  href?: string;
}

export interface Quotable {
  /** ISO timestamp of the newest report the sentence used; null when it used none. */
  asOf: string | null;
  /** The full sentence as plain text (what curl and crawlers see). */
  text: string;
  /** The first link in the sentence, when there is one. */
  href?: string;
  /** The sentence split for rendering, with links on the segments that carry them. */
  segments: QuotableSegment[];
}

export interface StationInfo {
  /** NRCS station name, e.g. "Hoosier Pass". */
  name: string;
  /** Station elevation in feet. */
  elevationFt?: number | null;
}

/** The slice of a resort the home sentence needs — `ResortWithData` satisfies it. */
export type QuotableResort = Pick<ResortWithData, "id" | "name" | "slug" | "snotel_station_id" | "snow_report">;

// ── Formatting ───────────────────────────────────────────────

const MT_TIME = new Intl.DateTimeFormat("en-US", {
  timeZone: QUOTABLE_TIME_ZONE,
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
  month: "short",
  day: "numeric",
});

/**
 * "6:00 a.m. MT Oct 18" for an ISO instant, in Mountain time regardless of the
 * machine's zone. Returns "" for an unparseable input rather than "Invalid Date".
 */
export function formatMountainTime(iso: string | Date): string {
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const parts = MT_TIME.formatToParts(d);
  const part = (type: Intl.DateTimeFormatPart["type"]) => parts.find((p) => p.type === type)?.value ?? "";
  const period = part("dayPeriod").toLowerCase().startsWith("p") ? "p.m." : "a.m.";
  return `${part("hour")}:${part("minute")} ${period} ${QUOTABLE_ZONE_LABEL} ${part("month")} ${part("day")}`;
}

/** Inches as the site writes them in data copy: "8 in.", "0.5 in.". */
export function inches(value: number): string {
  const n = Number(value);
  const rounded = Math.round(n * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)} in.`;
}

/** Source label for a parenthetical after a number. */
export function sourceLabel(source: SnowReportSource | null | undefined): string {
  switch (source) {
    case "snotel":
      return "SNOTEL";
    case "manual":
    case "resort":
      return "resort-reported";
    default:
      return "model estimate";
  }
}

/** The newest `updated_at` across a set of reports, or null when none has one. */
export function latestUpdatedAt(reports: ReadonlyArray<Pick<SnowReport, "updated_at"> | null | undefined>): string | null {
  let best: { iso: string; ms: number } | null = null;
  for (const report of reports) {
    if (!report?.updated_at) continue;
    const ms = Date.parse(report.updated_at);
    if (Number.isNaN(ms)) continue;
    if (!best || ms > best.ms) best = { iso: report.updated_at, ms };
  }
  return best ? new Date(best.ms).toISOString() : null;
}

/**
 * Ends a sentence with exactly one period. Half the clauses end in the
 * abbreviation "in.", and "base 76 in.." is how a quotable line stops being
 * quoted. Applied to the joined segments, so a trailing "." segment is dropped
 * when the text before it already closes the sentence.
 */
function endSentence(segments: QuotableSegment[]): QuotableSegment[] {
  const out = segments.filter((s) => s.text.length > 0);
  if (out.length === 0) return out;
  const last = out[out.length - 1];
  if (last.text === "." && out.length > 1 && out[out.length - 2].text.endsWith(".")) return out.slice(0, -1);
  if (!last.text.endsWith(".")) return [...out.slice(0, -1), { ...last, text: `${last.text}.` }];
  return out;
}

function finish(asOf: string | null, rawSegments: QuotableSegment[]): Quotable {
  const segments = endSentence(rawSegments);
  const text = segments.map((s) => s.text).join("");
  const href = segments.find((s) => s.href)?.href;
  return href ? { asOf, text, href, segments } : { asOf, text, segments };
}

function asNumber(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function newSnow24h(resort: QuotableResort): number {
  return asNumber(resort.snow_report?.new_snow_24h) ?? 0;
}

// ── Openings ─────────────────────────────────────────────────

export interface UpcomingOpening {
  name: string;
  slug: string;
  /** YYYY-MM-DD, confirmed when the resort has announced, else projected. */
  date: string;
  confirmed: boolean;
}

/**
 * The next `limit` openings on or after `now`'s calendar day (US Pacific, the
 * same day /opening-dates uses), soonest first. A row whose resort is not in
 * `resorts` (inactive, or a stale id) is skipped rather than named blindly.
 */
export function upcomingOpenings(
  openings: readonly ResortOpening[],
  resorts: ReadonlyArray<Pick<ResortWithData, "id" | "name" | "slug">>,
  now: Date,
  limit = 3,
): UpcomingOpening[] {
  const today = toPacificDay(now);
  const byId = new Map(resorts.map((r) => [r.id, r]));
  const rows: UpcomingOpening[] = [];
  for (const row of openings) {
    const resort = byId.get(row.resort_id);
    if (!resort) continue;
    const date = row.confirmed_open ?? row.projected_open;
    if (!date || date < today) continue;
    rows.push({ name: resort.name, slug: resort.slug, date, confirmed: row.confirmed_open != null });
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.name.localeCompare(b.name, "en")));
  return rows.slice(0, limit);
}

// ── Home ─────────────────────────────────────────────────────

/**
 * Picks the resorts the in-season sentence names: the SNOTEL leader first
 * (a measured number outranks a modelled one however large), then the model
 * leader; when only one source has snow, the top two from that source. Ties
 * break alphabetically so the sentence is stable between syncs.
 */
export function snowLeaders(resorts: readonly QuotableResort[], limit = 2): QuotableResort[] {
  const withSnow = resorts
    .filter((r) => newSnow24h(r) > 0)
    .sort((a, b) => newSnow24h(b) - newSnow24h(a) || a.name.localeCompare(b.name, "en"));
  const measured = withSnow.filter((r) => r.snow_report?.source === "snotel");
  const modelled = withSnow.filter((r) => r.snow_report?.source !== "snotel");
  if (measured.length && modelled.length) return [measured[0], modelled[0]].slice(0, limit);
  return (measured.length ? measured : modelled).slice(0, limit);
}

/**
 * The homepage sentence. In season (any resort reporting new snow in the last
 * 24 h): the leaders with their sources. Off season: the honest count and the
 * next three openings, linking /opening-dates.
 */
export function homeSentence(
  resorts: readonly QuotableResort[],
  openings: readonly ResortOpening[],
  now: Date,
): Quotable {
  const asOf = latestUpdatedAt(resorts.map((r) => r.snow_report));
  const stamp = asOf ? `As of ${formatMountainTime(asOf)}, ` : "";
  const leaders = snowLeaders(resorts);

  if (leaders.length) {
    const segments: QuotableSegment[] = [{ text: `${stamp}the most new snow in the last 24 h is ` }];
    leaders.forEach((r, i) => {
      const snow = r.snow_report!;
      if (i > 0) segments.push({ text: " and " });
      segments.push({ text: `${inches(newSnow24h(r))} at ` });
      segments.push({ text: r.name, href: `/resorts/${r.slug}` });
      segments.push({ text: ` (${sourceLabel(snow.source)})` });
    });
    segments.push({ text: "." });
    return finish(asOf, segments);
  }

  const reporting = resorts.filter((r) => r.snow_report).length;
  const segments: QuotableSegment[] = [
    { text: `${stamp}0 of ${reporting} resorts report new snow in the last 24 h.` },
  ];
  const next = upcomingOpenings(openings, resorts, now);
  if (next.length) {
    segments.push({ text: " " });
    segments.push({ text: "First openings", href: "/opening-dates" });
    segments.push({
      text: `: ${next.map((o) => `${o.name} (${formatOpeningDate(o.date)})`).join(", ")}.`,
    });
  }
  return finish(asOf, segments);
}

// ── Resort ───────────────────────────────────────────────────

export interface ResortSentenceExtras {
  /** NRCS station name and elevation, when known; omitted from the sentence otherwise. */
  station?: StationInfo | null;
  /** This resort's opening row, used only when there is no report yet. */
  opening?: ResortOpening | null;
}

/** "1 in. of new snow in 24 h, 3 in. in 48 h, base 12 in., snowpack 85% of normal" — null fields dropped. */
function readingClauses(snow: SnowReport, hasStation: boolean): string[] {
  const clauses: string[] = [];
  const n24 = asNumber(snow.new_snow_24h);
  const n48 = asNumber(snow.new_snow_48h);
  const base = asNumber(snow.base_depth);
  if (n24 != null) clauses.push(`${inches(n24)} of new snow in 24 h`);
  if (n48 != null) clauses.push(n24 != null ? `${inches(n48)} in 48 h` : `${inches(n48)} of new snow in 48 h`);
  if (base != null) clauses.push(`base ${inches(base)}`);
  const pct = publishablePctOfNormal(snow, hasStation);
  if (pct != null) clauses.push(`snowpack ${pct}% of normal`);
  return clauses;
}

/**
 * The first sentence under a resort page's H1. Branches on the report's
 * source so a station reading is never dressed up as a model estimate or the
 * other way round; a resort with no report yet says so and names its opening
 * date when one is known.
 */
export function resortSentence(
  resort: QuotableResort,
  now: Date,
  extras: ResortSentenceExtras = {},
): Quotable {
  const snow = resort.snow_report;
  if (!snow) {
    const segments: QuotableSegment[] = [{ text: `No snow report yet this season for ${resort.name}` }];
    const opening = extras.opening ?? null;
    const date = opening?.confirmed_open ?? opening?.projected_open ?? null;
    if (date && date >= toPacificDay(now)) {
      segments.push({ text: "; " });
      segments.push({
        text: `${opening?.confirmed_open ? "opening" : "projected opening"} ${formatOpeningDate(date)}`,
        href: "/opening-dates",
      });
    }
    segments.push({ text: "." });
    return finish(null, segments);
  }

  const asOf = latestUpdatedAt([snow]);
  const stamp = asOf ? `As of ${formatMountainTime(asOf)}, ` : "";
  const hasStation = Boolean(resort.snotel_station_id);
  const clauses = readingClauses(snow, hasStation);

  if (snow.source === "snotel") {
    const station = extras.station?.name
      ? ` (${extras.station.name}${
          extras.station.elevationFt != null ? `, ${Math.round(extras.station.elevationFt).toLocaleString("en-US")} ft` : ""
        })`
      : "";
    const subject = `the ${resort.name} SNOTEL station${station}`;
    const body = clauses.length ? `reports ${clauses.join(", ")}` : "has no readings in its latest report";
    return finish(asOf, [{ text: `${stamp}${subject} ${body}` }]);
  }

  if (snow.source === "manual" || snow.source === "resort") {
    const body = clauses.length ? `${resort.name} reports ${clauses.join(", ")}` : `${resort.name} has no readings in its latest report`;
    return finish(asOf, [{ text: `${stamp}${body} (resort-reported)` }]);
  }

  const body = clauses.length
    ? `a weather-model estimate for ${resort.name} puts ${clauses.join(", ")}`
    : `the weather-model estimate for ${resort.name} has no readings in its latest run`;
  return finish(asOf, [{ text: `${stamp}${body}` }]);
}

// ── Percent of normal (Sprint 9 leaderboard) ─────────────────

export interface PctOfNormalEntry {
  name: string;
  slug: string;
  pct: number;
  sweIn: number;
  updatedAt: string;
}

/**
 * SNOTEL-fed resorts with a publishable percent-of-normal (the 10–300 band,
 * at least 2 in. of SWE — lib/resort-copy.ts owns the rule), ranked deepest
 * relative to normal first. Everything the leaderboard page lists comes
 * through here, so nothing outside the band can appear on it.
 */
export function rankPctOfNormal(resorts: readonly QuotableResort[]): PctOfNormalEntry[] {
  const rows: PctOfNormalEntry[] = [];
  for (const r of resorts) {
    const snow = r.snow_report;
    const pct = publishablePctOfNormal(snow, Boolean(r.snotel_station_id));
    if (pct == null || !snow) continue;
    rows.push({ name: r.name, slug: r.slug, pct, sweIn: asNumber(snow.swe_in) ?? 0, updatedAt: snow.updated_at });
  }
  return rows.sort((a, b) => b.pct - a.pct || a.name.localeCompare(b.name, "en"));
}

/**
 * The dated sentence for the percent-of-normal page: "As of …, 42 SNOTEL-fed
 * resorts have a snowpack to measure against normal; the deepest relative to
 * its 1991–2020 median is Breckenridge at 140%, the thinnest Ski Cooper at
 * 35%." With nothing publishable (early October), it says why.
 */
export function pctOfNormalSentence(resorts: readonly QuotableResort[], now: Date): Quotable {
  void now; // the sentence is dated by the data, not the clock; kept for API symmetry with homeSentence
  const ranked = rankPctOfNormal(resorts);
  const stationFed = resorts.filter((r) => r.snotel_station_id && r.snow_report?.source === "snotel");
  const asOf = latestUpdatedAt((ranked.length ? stationFed : resorts).map((r) => r.snow_report));
  const stamp = asOf ? `As of ${formatMountainTime(asOf)}, ` : "";

  if (!ranked.length) {
    return finish(asOf, [
      {
        text: `${stamp}none of the ${stationFed.length} SNOTEL-fed resorts has the 2 in. of snow water equivalent needed to compare its snowpack with the 1991–2020 median.`,
      },
    ]);
  }

  const top = ranked[0];
  const bottom = ranked[ranked.length - 1];
  const segments: QuotableSegment[] = [
    { text: `${stamp}${ranked.length} of ${stationFed.length} SNOTEL-fed resorts have enough snow to measure against normal; the deepest relative to its 1991–2020 median is ` },
    { text: top.name, href: `/resorts/${top.slug}` },
    { text: ` at ${top.pct}%` },
  ];
  if (ranked.length > 1) {
    segments.push({ text: ", the thinnest " });
    segments.push({ text: bottom.name, href: `/resorts/${bottom.slug}` });
    segments.push({ text: ` at ${bottom.pct}%` });
  }
  segments.push({ text: "." });
  return finish(asOf, segments);
}

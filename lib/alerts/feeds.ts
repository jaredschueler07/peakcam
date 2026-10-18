// ─────────────────────────────────────────────────────────────
// Powder feeds: Atom and iCalendar built by hand (no dependency).
//
// Pure functions only — the route handlers load rows and pass them in, so
// everything here is covered by lib/alerts/feeds.test.ts without a
// database. Two consumers:
//   /resorts/[slug]/powder.xml   public, one feed per resort, 6″ threshold
//   /alerts/feed/[token]         per subscriber, their resorts + thresholds,
//                                `?format=ics` for forecast storm windows
// ─────────────────────────────────────────────────────────────

import { SITE_URL } from "@/lib/site";

/**
 * A public-feed entry is a day on which a report showed at least this much
 * new snow in 24 h. This is the FEED threshold, deliberately separate from
 * the 8″ powder-alert default elsewhere in the app and from each
 * subscriber's own `threshold_inches` (which the per-subscriber feed uses).
 */
export const FEED_POWDER_INCHES = 6;
/** How far back the public feed looks. */
export const FEED_LOOKBACK_DAYS = 60;
/** Forecast log rows older than this are not storm windows worth listing. */
export const FEED_FORECAST_LOOKBACK_DAYS = 14;
/** Atom ids are tag URIs minted in 2026; the year is part of the id, not a date. */
const TAG_PREFIX = "tag:peakcam.io,2026:powder";

export interface FeedResort {
  slug: string;
  name: string;
}

export interface FeedReport {
  new_snow_24h: number | null;
  updated_at: string;
}

/** A powder_alert_log row with kind = 'forecast'. */
export interface FeedForecastLog {
  new_snow_inches: number;
  alert_date: string;
  storm_start_date: string | null;
  sent_at?: string | null;
}

export interface PowderFeedEntry {
  id: string;
  kind: "measured" | "forecast";
  resort: FeedResort;
  inches: number;
  /** YYYY-MM-DD the entry is about (report day, or storm start). */
  date: string;
  /** ISO timestamp from the data: the report's updated_at or the log's sent_at. */
  updated: string;
  title: string;
  summary: string;
  link: string;
}

export function resortUrl(slug: string): string {
  return `${SITE_URL}/resorts/${slug}`;
}

function formatInches(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function isoDay(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * One entry per UTC day on which any report for the resort showed
 * `thresholdInches` or more of new snow in 24 h, carrying that day's peak
 * reading, plus one entry per distinct forecast storm (by start date) from
 * the alert log. Newest first.
 */
export function powderEntries(
  resort: FeedResort,
  reports: readonly FeedReport[],
  forecastLogs: readonly FeedForecastLog[] = [],
  thresholdInches: number = FEED_POWDER_INCHES,
): PowderFeedEntry[] {
  const link = resortUrl(resort.slug);
  const byDay = new Map<string, { inches: number; updated: string }>();
  for (const report of reports) {
    const inches = report.new_snow_24h;
    if (inches == null || !Number.isFinite(inches) || inches < thresholdInches) continue;
    if (!report.updated_at) continue;
    const day = isoDay(report.updated_at);
    const current = byDay.get(day);
    if (!current || inches > current.inches || (inches === current.inches && report.updated_at > current.updated)) {
      byDay.set(day, { inches, updated: report.updated_at });
    }
  }

  const entries: PowderFeedEntry[] = [];
  for (const [day, { inches, updated }] of byDay) {
    entries.push({
      id: `${TAG_PREFIX}:${resort.slug}:${day}`,
      kind: "measured",
      resort,
      inches,
      date: day,
      updated,
      title: `${formatInches(inches)}" of new snow at ${resort.name}`,
      summary: `${resort.name} reported ${formatInches(inches)}" of new snow in the 24 hours to ${updated}. Live cams and the full snow report: ${link}`,
      link,
    });
  }

  const byStorm = new Map<string, FeedForecastLog>();
  for (const log of forecastLogs) {
    const key = log.storm_start_date ?? log.alert_date;
    if (!key) continue;
    const current = byStorm.get(key);
    if (!current || log.new_snow_inches > current.new_snow_inches || (log.new_snow_inches === current.new_snow_inches && log.alert_date > current.alert_date)) {
      byStorm.set(key, log);
    }
  }
  for (const [start, log] of byStorm) {
    const updated = log.sent_at ?? `${log.alert_date}T13:00:00.000Z`;
    entries.push({
      id: `${TAG_PREFIX}:${resort.slug}:forecast:${start}`,
      kind: "forecast",
      resort,
      inches: log.new_snow_inches,
      date: start,
      updated,
      title: `${formatInches(log.new_snow_inches)}" forecast at ${resort.name} from ${start}`,
      summary: `The forecast read on ${log.alert_date} had ${formatInches(log.new_snow_inches)}" of snow at ${resort.name} over up to three days starting ${start}. Forecasts change; check the live report: ${link}`,
      link,
    });
  }

  return entries.sort((a, b) => (a.updated < b.updated ? 1 : a.updated > b.updated ? -1 : a.id.localeCompare(b.id)));
}

// ── Atom ─────────────────────────────────────────────────────

export function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export interface AtomFeedInput {
  id: string;
  title: string;
  subtitle?: string;
  selfUrl: string;
  alternateUrl: string;
  /** ISO timestamp, from the data. */
  updated: string;
  entries: readonly PowderFeedEntry[];
}

export function buildAtomFeed(input: AtomFeedInput): string {
  const entries = input.entries
    .map(
      (entry) => `  <entry>
    <id>${xmlEscape(entry.id)}</id>
    <title>${xmlEscape(entry.title)}</title>
    <updated>${xmlEscape(entry.updated)}</updated>
    <published>${xmlEscape(entry.updated)}</published>
    <link rel="alternate" type="text/html" href="${xmlEscape(entry.link)}"/>
    <category term="${entry.kind}"/>
    <category term="${xmlEscape(entry.resort.slug)}" label="${xmlEscape(entry.resort.name)}"/>
    <summary type="text">${xmlEscape(entry.summary)}</summary>
  </entry>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>${xmlEscape(input.id)}</id>
  <title>${xmlEscape(input.title)}</title>
${input.subtitle ? `  <subtitle>${xmlEscape(input.subtitle)}</subtitle>\n` : ""}  <updated>${xmlEscape(input.updated)}</updated>
  <link rel="self" type="application/atom+xml" href="${xmlEscape(input.selfUrl)}"/>
  <link rel="alternate" type="text/html" href="${xmlEscape(input.alternateUrl)}"/>
  <author><name>PeakCam</name><uri>${SITE_URL}</uri></author>
  <generator uri="${SITE_URL}">PeakCam</generator>
  <rights>PeakCam (https://www.peakcam.io). Attribution required.</rights>
${entries}
</feed>
`;
}

// ── iCalendar ────────────────────────────────────────────────

export interface StormWindowEvent {
  /** Stable per (resort, window start). */
  uid: string;
  resort: FeedResort;
  /** YYYY-MM-DD, inclusive. */
  start: string;
  /** Days the window spans (1–3). */
  days: number;
  inches: number;
  /** ISO timestamp the forecast was read. */
  stamp: string;
}

export function addDays(day: string, days: number): string {
  const t = Date.parse(`${day}T00:00:00Z`);
  return new Date(t + days * 86_400_000).toISOString().slice(0, 10);
}

export function stormWindowEvent(
  resort: FeedResort,
  window: { stormStartDate: string; forecastDays: number; snowInches: number },
  stamp: string,
): StormWindowEvent {
  return {
    uid: `powder-${resort.slug}-${window.stormStartDate}@peakcam.io`,
    resort,
    start: window.stormStartDate,
    days: Math.max(1, Math.min(3, Math.round(window.forecastDays) || 1)),
    inches: window.snowInches,
    stamp,
  };
}

/** `\`, `;`, `,` and newlines per RFC 5545 §3.3.11. */
export function icsEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Folds a content line at 75 octets (RFC 5545 §3.1), CRLF + one space. */
export function foldIcsLine(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let chunk = "";
  let chunkBytes = 0;
  for (const char of line) {
    const size = Buffer.byteLength(char, "utf8");
    const limit = out.length === 0 ? 75 : 74;
    if (chunkBytes + size > limit) {
      out.push(chunk);
      chunk = "";
      chunkBytes = 0;
    }
    chunk += char;
    chunkBytes += size;
  }
  if (chunk) out.push(chunk);
  return out.join("\r\n ");
}

function icsStamp(iso: string): string {
  const d = new Date(iso);
  const safe = Number.isNaN(d.getTime()) ? new Date(0) : d;
  return safe.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function icsDate(day: string): string {
  return day.replace(/-/g, "");
}

export interface IcsCalendarInput {
  name: string;
  description?: string;
  events: readonly StormWindowEvent[];
}

export function buildIcsCalendar(input: IcsCalendarInput): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//PeakCam//Powder Alerts//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsEscape(input.name)}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT6H",
    "X-PUBLISHED-TTL:PT6H",
  ];
  if (input.description) lines.push(`X-WR-CALDESC:${icsEscape(input.description)}`);
  const sorted = [...input.events].sort((a, b) => a.start.localeCompare(b.start) || a.uid.localeCompare(b.uid));
  for (const event of sorted) {
    const link = resortUrl(event.resort.slug);
    lines.push(
      "BEGIN:VEVENT",
      `UID:${icsEscape(event.uid)}`,
      `DTSTAMP:${icsStamp(event.stamp)}`,
      `DTSTART;VALUE=DATE:${icsDate(event.start)}`,
      `DTEND;VALUE=DATE:${icsDate(addDays(event.start, event.days))}`,
      `SUMMARY:${icsEscape(`${formatInches(event.inches)}" forecast: ${event.resort.name}`)}`,
      `DESCRIPTION:${icsEscape(
        `PeakCam forecast read ${event.stamp.slice(0, 10)}: about ${formatInches(event.inches)}" of snow at ${event.resort.name} over ${event.days} day${event.days === 1 ? "" : "s"} from ${event.start}. Forecasts change; check the live report and cams: ${link}`,
      )}`,
      `URL:${icsEscape(link)}`,
      "CATEGORIES:POWDER",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldIcsLine).join("\r\n") + "\r\n";
}

// ── Response headers ─────────────────────────────────────────

/**
 * Header set for the public feed. Kept inline for now; swap for
 * lib/public-api/headers.ts once lane 2's shared helper lands on main.
 */
export function publicFeedHeaders(contentType: string): Record<string, string> {
  return {
    "Content-Type": contentType,
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, s-maxage=900, stale-while-revalidate=3600",
    "X-Attribution": "PeakCam (https://www.peakcam.io)",
  };
}

/** Per-subscriber feeds carry a capability token in the URL: never cached, never indexed. */
export function privateFeedHeaders(contentType: string): Record<string, string> {
  return {
    "Content-Type": contentType,
    "Cache-Control": "private, no-store",
    "X-Robots-Tag": "noindex, nofollow",
    "X-Attribution": "PeakCam (https://www.peakcam.io)",
  };
}

export const ATOM_CONTENT_TYPE = "application/atom+xml; charset=utf-8";
export const ICS_CONTENT_TYPE = "text/calendar; charset=utf-8";

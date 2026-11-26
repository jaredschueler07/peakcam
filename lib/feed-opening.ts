// ─────────────────────────────────────────────────────────────
// Feed-detected season openings.
//
// WHY. The conditions contract (lib/conditions-contract.ts deriveStatus)
// lets the operator feed decide only the resort's current local day. Outside
// the hours the feed decides (before first chair, when a feed lists the day's
// lifts as "scheduled" or flags them "open" at 06:05; between 08:00 and the
// first lift actually turning; a closed midweek day) the opening dates decide,
// and a resort whose projected date has passed without a hand-entered
// `confirmed_open` reads UNKNOWN. On 2026-11-26 Big Sky, Crested Butte and
// Park City read UNKNOWN from 06:05 MT until about 09:05, and Alta from 08:05
// to 09:35, the morning after each ran lifts all day on its Nov 25 opening.
//
// WHAT. scripts/operator-sync.ts calls detectFeedOpening after each run and,
// when it finds a sustained, plausible lift day, stores that day in
// `resort_openings.feed_open` (migration 037). lib/openings.ts openingStatus
// then treats the season as started from that day, exactly like a passed
// `confirmed_open`, so the morning "scheduled" readings open the resort and a
// 0-open core-hours reading reads CLOSED_TODAY instead of UNKNOWN.
//
// EMAIL. `feed_open` is never read by the opening-day email cron
// (app/api/alerts/trigger reads `confirmed_open` only), so a feed-detected
// opening sends nothing, glitch or not. See isOpeningToday in lib/openings.ts.
//
// GUARDS (the Beaver Creek glitch of 2026-11-23, which PR #168 already keeps
// out of the status, must not become a stored opening either):
//   1. Sustained: at least MIN_OPEN_READINGS readings on the same local day,
//      each taken at or after FIRST_CHAIR_HOUR, show a lift open, and the
//      first and last of them are at least MIN_OPEN_SPAN_MINUTES apart (two
//      consecutive 30-minute syncs).
//   2. Before the date on file (a confirmed date still ahead, or a projection
//      still ahead), an early opening must look like one: every open reading
//      below PRE_SEASON_IMPLAUSIBLE_OPEN_SHARE of the lifts, at least
//      EARLY_MIN_LIFTS_OPEN lifts at some point (one lift turning ahead of
//      the date is as likely a town gondola or a staff lift as an opening:
//      Telluride's feed showed 1 of 17 all morning on 2026-11-26, nine days
//      before its projection), and the stricter EARLY_MIN_OPEN_READINGS /
//      EARLY_MIN_OPEN_SPAN_MINUTES. Beaver Creek showed 24–25 of 25 for 60
//      minutes: refused on both counts.
//   3. Only a Northern row of the current season, never when a confirmed or
//      feed opening on or before that day is already on file, and only for a
//      day no more than one day back (the sync reads the last 30 h).
// Pure: no I/O, the clock is passed in. lib/feed-opening.test.ts covers it.
// ─────────────────────────────────────────────────────────────

import { FIRST_CHAIR_HOUR, localHour, type OperatorReading } from "./operator-day";
import { localDay } from "./resort-timezone";
import { CURRENT_SEASON, type ResortOpening } from "./openings";

/** Readings with a lift open, at or after first chair, on one local day. */
export const MIN_OPEN_READINGS = 2;
/** First to last of those readings, in minutes: two consecutive 30-minute syncs. */
export const MIN_OPEN_SPAN_MINUTES = 30;
/** Before the date on file the evidence must hold for longer. */
export const EARLY_MIN_OPEN_READINGS = 4;
export const EARLY_MIN_OPEN_SPAN_MINUTES = 90;
/** …and more than a single lift. */
export const EARLY_MIN_LIFTS_OPEN = 2;
/**
 * The same share lib/conditions-contract.ts uses: a feed that flips most of a
 * resort's lifts to open before opening day is staged or glitching. Kept as
 * its own constant here so this module stays free of the contract's imports;
 * lib/feed-opening.test.ts pins the two equal.
 */
export const EARLY_OPEN_MAX_SHARE = 0.8;

export type FeedOpeningOpening = Pick<ResortOpening, "season" | "projected_open" | "confirmed_open" | "closing_date"> & {
  feed_open?: string | null;
};

export interface FeedOpening {
  /** YYYY-MM-DD at the resort: the day the feed showed lifts running. */
  day: string;
  /** Open readings that day at or after first chair. */
  readings: number;
  firstAt: string;
  lastAt: string;
  /** Highest open count among them, and the resort's lift total when the feed gave one. */
  maxOpen: number;
  liftsTotal: number | null;
  /** True when the day is before the opening date on file (an early opening). */
  early: boolean;
}

export interface FeedOpeningInput {
  readings: readonly OperatorReading[];
  /** The resort's row in resort_openings; null when it has none. */
  opening: FeedOpeningOpening | null;
  timeZone: string;
  now: Date;
  /** Resorts south of the equator carry closing dates, not openings. */
  hemisphere: "north" | "south";
}

export type FeedOpeningVerdict =
  | { ok: true; opening: FeedOpening }
  | { ok: false; reason: string };

const n = (v: number | null | undefined): number => (v == null || !Number.isFinite(v) ? 0 : v);

function previousDay(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** The opening date on file that the feed day is measured against, if any. */
function dateOnFile(opening: FeedOpeningOpening): string | null {
  return opening.confirmed_open ?? opening.projected_open ?? null;
}

/**
 * The earliest local day in `readings` (today or yesterday at the resort)
 * on which the feed showed a sustained, plausible lift day that the openings
 * row does not already account for; else why not.
 */
export function detectFeedOpening(input: FeedOpeningInput): FeedOpeningVerdict {
  const { readings, opening, timeZone, now, hemisphere } = input;
  if (hemisphere !== "north") return { ok: false, reason: "southern-hemisphere resort" };
  if (!opening) return { ok: false, reason: "no resort_openings row to record it on" };
  if (opening.season !== CURRENT_SEASON) return { ok: false, reason: `openings row is for ${opening.season}, not ${CURRENT_SEASON}` };
  if (opening.closing_date && !opening.confirmed_open && !opening.projected_open) {
    return { ok: false, reason: "row carries only a closing date" };
  }

  const today = localDay(now, timeZone);
  const yesterday = previousDay(today);
  const byDay = new Map<string, { at: Date; r: OperatorReading }[]>();
  for (const r of readings) {
    const at = new Date(r.observedAt);
    if (!Number.isFinite(at.getTime()) || at.getTime() > now.getTime() + 5 * 60_000) continue;
    if (n(r.liftsOpen) <= 0 || localHour(at, timeZone) < FIRST_CHAIR_HOUR) continue;
    const day = localDay(at, timeZone);
    if (day !== today && day !== yesterday) continue;
    const list = byDay.get(day) ?? [];
    list.push({ at, r });
    byDay.set(day, list);
  }
  if (!byDay.size) return { ok: false, reason: "no reading at or after first chair showed a lift open" };

  const reasons: string[] = [];
  for (const day of [...byDay.keys()].sort()) {
    const already = [opening.confirmed_open, opening.feed_open ?? null].filter((d): d is string => !!d && d <= day);
    if (already.length) return { ok: false, reason: `season already started on ${already.sort()[0]}` };

    const list = byDay.get(day)!.sort((a, b) => a.at.getTime() - b.at.getTime());
    const onFile = dateOnFile(opening);
    const early = onFile != null && day < onFile;
    const minReadings = early ? EARLY_MIN_OPEN_READINGS : MIN_OPEN_READINGS;
    const minSpan = early ? EARLY_MIN_OPEN_SPAN_MINUTES : MIN_OPEN_SPAN_MINUTES;
    const spanMinutes = (list[list.length - 1].at.getTime() - list[0].at.getTime()) / 60_000;
    const totals = list.map(({ r }) => n(r.liftsTotal)).filter((t) => t > 0);
    const liftsTotal = totals.length ? Math.max(...totals) : null;
    const maxOpen = Math.max(...list.map(({ r }) => (n(r.liftsTotal) > 0 ? Math.min(n(r.liftsOpen), n(r.liftsTotal)) : n(r.liftsOpen))));

    if (list.length < minReadings || spanMinutes < minSpan) {
      reasons.push(`${day}: ${list.length} open reading(s) over ${Math.round(spanMinutes)} min, needs ${minReadings} over ${minSpan} min${early ? " before the date on file" : ""}`);
      continue;
    }
    if (early) {
      const implausible = list.some(({ r }) => n(r.liftsTotal) > 0 && n(r.liftsOpen) / n(r.liftsTotal) >= EARLY_OPEN_MAX_SHARE);
      if (implausible || liftsTotal == null || maxOpen < EARLY_MIN_LIFTS_OPEN) {
        reasons.push(
          liftsTotal == null
            ? `${day}: before the date on file ${onFile} and the feed gives no lift total to judge an early opening by`
            : implausible
            ? `${day}: ${maxOpen} of ${liftsTotal} lifts open before the date on file ${onFile}; a near-full count before opening day is a feed glitch, not an opening`
            : `${day}: only ${maxOpen} of ${liftsTotal} lifts open before the date on file ${onFile}; one lift ahead of the date is not taken as an opening`,
        );
        continue;
      }
    }
    return {
      ok: true,
      opening: { day, readings: list.length, firstAt: list[0].at.toISOString(), lastAt: list[list.length - 1].at.toISOString(), maxOpen, liftsTotal, early },
    };
  }
  return { ok: false, reason: reasons.join("; ") };
}

/** The `feed_open_evidence` text stored with the day: what the feed showed, in the resort's own clock. */
export function feedOpeningEvidence(found: FeedOpening, timeZone: string, sourceUrl: string | null): string {
  const clock = (iso: string) =>
    new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
  const lifts = found.liftsTotal != null ? `${found.maxOpen} of ${found.liftsTotal}` : `${found.maxOpen}`;
  return (
    `Operator lift feed showed lifts open on ${found.day}: up to ${lifts} in ${found.readings} readings from ${clock(found.firstAt)} to ${clock(found.lastAt)} resort time` +
    `${found.early ? " (before the opening date on file)" : ""}. Detected by operator-sync; no opening-day email is sent for this.` +
    `${sourceUrl ? ` Source: ${sourceUrl}` : ""}`
  );
}

// ─────────────────────────────────────────────────────────────
// Same-day opening email for a feed-detected opening — the pure half.
//
// scripts/operator-sync.ts stores `resort_openings.feed_open` when the
// operator lift feed shows a resort's first sustained lift day of the season
// (lib/feed-opening.ts holds the glitch guards). While that day is still the
// resort's local today, the sync asks app/api/alerts/feed-openings to send the
// usual opening-day email (sendOpeningDayEmail) to the resort's opening-alert
// subscribers. The route reads everything it acts on from the database; the
// call carries no resort list. This module decides, the route sends and logs.
//
// GUARDS, all here and all tested in feed-opening-email.test.ts:
//   1. Same day only. The stored feed_open must equal the resort's local
//      calendar day at send time, and the local clock must be before
//      LIFT_DAY_END_HOUR. An opening carried over from yesterday (found from
//      the next morning's readings), a backlog day, or a call that arrives
//      after the lifts close mails nobody, ever: a later run cannot make an
//      old day "today" again.
//   2. One path per opening. When a confirmed date on or before the feed day
//      is on file, the trigger cron's confirmed-date branch owns the email
//      and this path stays out; when the feed day came first, the cron skips
//      the later confirmed date (cronOpeningsToMail).
//   3. Once per resort per season. Both paths read the opening log for the
//      whole season (seasonLogStart), not just today, so a subscriber who had
//      an opening email for a resort this season never gets a second one.
//   4. Nothing a glitch can reach: feed_open is written only by the detector,
//      which refuses the Beaver Creek pattern, and only once per row.
// Pure: no I/O, the clock is passed in.
// ─────────────────────────────────────────────────────────────

import { CURRENT_SEASON } from "@/lib/openings";
import { LIFT_DAY_END_HOUR, localHour } from "@/lib/operator-day";
import { localDay, resortTimeZone } from "@/lib/resort-timezone";

export interface FeedOpeningMailResort {
  name: string;
  slug: string;
  state: string | null;
  country: string | null;
  lat: number | null;
  lng: number | null;
}

export interface FeedOpeningMailRow {
  resort_id: string;
  season: string;
  confirmed_open: string | null;
  feed_open: string | null;
  resorts: FeedOpeningMailResort | null;
}

export type FeedOpeningMailVerdict = { mail: true; timeZone: string } | { mail: false; reason: string };

/** Whether this row's feed opening may be mailed at `now`. Every "no" says why, for the run summary. */
export function feedOpeningMailVerdict(row: FeedOpeningMailRow, now: Date): FeedOpeningMailVerdict {
  if (!row.feed_open) return { mail: false, reason: "no feed opening on file" };
  if (row.season !== CURRENT_SEASON) return { mail: false, reason: `season ${row.season}, not ${CURRENT_SEASON}` };
  const resort = row.resorts;
  if (!resort) return { mail: false, reason: "resort row missing" };
  if (resort.lat != null && resort.lat < 0) return { mail: false, reason: "southern hemisphere" };
  if (row.confirmed_open && row.confirmed_open <= row.feed_open) {
    return { mail: false, reason: `confirmed date ${row.confirmed_open} owns the email` };
  }
  const timeZone = resortTimeZone({ state: resort.state ?? "", country: resort.country ?? "", lng: resort.lng ?? -105, lat: resort.lat });
  const today = localDay(now, timeZone);
  if (row.feed_open !== today) return { mail: false, reason: `feed opening ${row.feed_open} is not today (${today})` };
  if (localHour(now, timeZone) >= LIFT_DAY_END_HOUR) return { mail: false, reason: "after the lift day" };
  return { mail: true, timeZone };
}

/** The rows whose feed opening is mailable right now. */
export function feedOpeningsToMail<R extends FeedOpeningMailRow>(rows: readonly R[], now: Date): R[] {
  return rows.filter((row) => feedOpeningMailVerdict(row, now).mail);
}

/**
 * The trigger cron's confirmed-date rows, minus any resort whose season the
 * feed already started on an earlier day: that resort has been running lifts,
 * so an "opens today" email on the later confirmed date would be wrong (and
 * if the feed day was mailed, a second one).
 */
export function cronOpeningsToMail<R extends { feed_open?: string | null }>(rows: readonly R[], today: string): R[] {
  return rows.filter((row) => !row.feed_open || row.feed_open >= today);
}

/**
 * First day of the opening-email dedupe window for a Northern season
 * ("2026-27" → "2026-07-01"). Opening emails go out from October to
 * December, so July 1 sits well clear of both ends of the season.
 */
export function seasonLogStart(season: string = CURRENT_SEASON): string {
  const match = /^(\d{4})-\d{2}$/.exec(season);
  if (!match) throw new Error(`unexpected season ${season}`);
  return `${match[1]}-07-01`;
}

/** The UTC days either side of `now`: every resort's local today falls in this range. */
export function feedOpeningQueryDays(now: Date): { from: string; to: string } {
  const day = (offset: number) => new Date(now.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
  return { from: day(-1), to: day(1) };
}

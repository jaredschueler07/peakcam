// ─────────────────────────────────────────────────────────────
// What an operator's lift feed said over one resort-local day.
//
// scripts/operator-sync.ts appends a reading per resort every 30 minutes
// through the lift day. The newest reading alone misleads at both ends of the
// day: before the first chair it shows 0 open, and after the last chair it
// shows 0 open again. This module reads the whole local day instead. Pure:
// the hub tables (lib/hub-lifts.ts) and the conditions contract
// (lib/conditions-contract.ts deriveStatus) both call summarizeOperatorDay,
// so a table and a resort page cannot disagree about the same feed.
//
// Rules, in order:
//   1. Any reading today with a lift open  → "operated": open for the rest of
//      the local day; the count quoted is the day's LATEST reading that
//      showed lifts open, with its time.
//   2. Else the newest reading lists lifts scheduled, and the local clock is
//      before LIFT_DAY_END_HOUR → "scheduled": opens today.
//   3. Else a reading taken inside core hours (CORE_HOURS_START..END, local)
//      showed 0 open and 0 scheduled → "closed". A 0/0 reading outside core
//      hours says nothing: many feeds have no "scheduled" state and read
//      0/0 every morning before opening.
//   4. Else null: the feed does not decide, the season dates do.
// Once today has any reading, today's readings alone decide.
//
// Carry-over: between local midnight and the day's first reading (the first
// sync is about 06:05 Mountain) today has no readings at all. If the previous
// local day had a reading with a lift open, that day's latest open count is
// carried, flagged `carried` and dated by its own reading, so callers label
// it with yesterday's date and never call it "today". Only one day back, and
// never a previous day that had no open lift.
// ─────────────────────────────────────────────────────────────

import { localDay } from "./resort-timezone";

/** A 0-open, 0-scheduled reading counts as "closed today" only from this local hour (inclusive)… */
export const CORE_HOURS_START = 10;
/** …to this local hour (exclusive). */
export const CORE_HOURS_END = 15;
/** From this local hour a "scheduled" lift that never opened is no longer "scheduled to open today". */
export const LIFT_DAY_END_HOUR = 16;
/** The zone used when a caller has none (the site's display convention is Mountain time). */
export const DEFAULT_OPERATOR_TIME_ZONE = "America/Denver";

/** One feed reading, reduced to what the day rules read. */
export interface OperatorReading {
  /** The feed's own timestamp (ISO). */
  observedAt: string;
  liftsOpen: number | null;
  liftsScheduled: number | null;
  liftsTotal: number | null;
}

export type OperatorDayState = "operated" | "scheduled" | "closed";

export interface OperatorDay {
  state: OperatorDayState;
  /** YYYY-MM-DD at the resort. */
  localDate: string;
  /** operated: lifts open in the day's latest open reading. closed: 0. scheduled: 0. */
  liftsOpen: number;
  liftsTotal: number | null;
  /** scheduled: lifts the newest reading lists as scheduled; otherwise null. */
  liftsScheduled: number | null;
  /** The reading the count comes from (operated: the latest with lifts open; scheduled: the newest; closed: the core-hours reading). */
  observedAt: string;
  /** The newest reading of the day, whatever it showed. */
  newestAt: string;
  /** operated only: true when the newest reading itself still shows lifts open. */
  current: boolean;
  /**
   * True when today has no reading yet and this is the previous local day's
   * last open count (`localDate` is then yesterday). Never say "today" about it.
   */
  carried: boolean;
}

const HOUR_FORMATS = new Map<string, Intl.DateTimeFormat>();

/** The 0–23 clock hour of `instant` in `timeZone`. */
export function localHour(instant: Date, timeZone: string): number {
  let fmt = HOUR_FORMATS.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", hourCycle: "h23" });
    HOUR_FORMATS.set(timeZone, fmt);
  }
  const hour = Number(fmt.formatToParts(instant).find((p) => p.type === "hour")?.value);
  return Number.isFinite(hour) ? hour % 24 : 0;
}

/** "15:05" in `timeZone`, for reason strings. */
export function localClock(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(instant);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${String(Number(part("hour")) % 24).padStart(2, "0")}:${part("minute")}`;
}

const n = (v: number | null | undefined): number => (v == null || !Number.isFinite(v) ? 0 : v);

/**
 * The day's verdict from the feed, or null when the feed does not decide
 * (no reading today, readings without lift counts, or only 0/0 readings
 * outside core hours).
 */
export function summarizeOperatorDay(readings: readonly OperatorReading[] | null | undefined, timeZone: string, now: Date): OperatorDay | null {
  const today = localDay(now, timeZone);
  const nowMs = now.getTime();
  const todays = (readings ?? [])
    .map((r) => ({ r, at: new Date(r.observedAt) }))
    .filter(({ at }) => Number.isFinite(at.getTime()) && at.getTime() <= nowMs + 5 * 60_000 && localDay(at, timeZone) === today)
    .sort((a, b) => a.at.getTime() - b.at.getTime());
  if (!todays.length) return carriedFromYesterday(readings ?? [], timeZone, now, today);

  const newest = todays[todays.length - 1];
  const newestAt = newest.at.toISOString();
  const totalOf = (r: OperatorReading) => (n(r.liftsTotal) > 0 ? n(r.liftsTotal) : null);

  for (let i = todays.length - 1; i >= 0; i--) {
    const { r, at } = todays[i];
    if (n(r.liftsOpen) > 0) {
      const total = totalOf(r);
      return {
        state: "operated",
        localDate: today,
        liftsOpen: total != null ? Math.min(n(r.liftsOpen), total) : n(r.liftsOpen),
        liftsTotal: total,
        liftsScheduled: null,
        observedAt: at.toISOString(),
        newestAt,
        current: i === todays.length - 1,
        carried: false,
      };
    }
  }

  if (n(newest.r.liftsScheduled) > 0 && localHour(now, timeZone) < LIFT_DAY_END_HOUR) {
    return { state: "scheduled", localDate: today, liftsOpen: 0, liftsTotal: totalOf(newest.r), liftsScheduled: n(newest.r.liftsScheduled), observedAt: newestAt, newestAt, current: false, carried: false };
  }

  for (let i = todays.length - 1; i >= 0; i--) {
    const { r, at } = todays[i];
    const hour = localHour(at, timeZone);
    if (hour >= CORE_HOURS_START && hour < CORE_HOURS_END && n(r.liftsTotal) > 0 && n(r.liftsScheduled) === 0) {
      return { state: "closed", localDate: today, liftsOpen: 0, liftsTotal: totalOf(r), liftsScheduled: null, observedAt: at.toISOString(), newestAt, current: false, carried: false };
    }
  }
  return null;
}

/** The calendar day before `day` (YYYY-MM-DD). */
function previousDay(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Today has no reading: the previous local day's latest open count, or null. */
function carriedFromYesterday(readings: readonly OperatorReading[], timeZone: string, now: Date, today: string): OperatorDay | null {
  const yesterday = previousDay(today);
  const rows = readings
    .map((r) => ({ r, at: new Date(r.observedAt) }))
    .filter(({ at }) => Number.isFinite(at.getTime()) && at.getTime() <= now.getTime() && localDay(at, timeZone) === yesterday)
    .sort((a, b) => a.at.getTime() - b.at.getTime());
  if (!rows.length) return null;
  const newestAt = rows[rows.length - 1].at.toISOString();
  for (let i = rows.length - 1; i >= 0; i--) {
    const { r, at } = rows[i];
    if (n(r.liftsOpen) > 0) {
      const total = n(r.liftsTotal) > 0 ? n(r.liftsTotal) : null;
      return {
        state: "operated",
        localDate: yesterday,
        liftsOpen: total != null ? Math.min(n(r.liftsOpen), total) : n(r.liftsOpen),
        liftsTotal: total,
        liftsScheduled: null,
        observedAt: at.toISOString(),
        newestAt,
        current: false,
        carried: true,
      };
    }
  }
  return null;
}

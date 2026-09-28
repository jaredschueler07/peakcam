// ─────────────────────────────────────────────────────────────
// Resort opening dates — types and pure helpers.
//
// Backed by the `resort_openings` table (migration 020, seeded from
// data/resort-openings.csv). Everything here is a pure function of its
// inputs: the page passes the render day in (see toPacificDay for which
// calendar day that is), dates are compared as YYYY-MM-DD strings
// (lexicographic order == chronological order for that shape), and
// formatting never consults the machine's locale or timezone — the page is
// ISR-rendered on a UTC server and must not disagree with itself between
// revalidations. lib/openings.test.ts covers every rule.
// ─────────────────────────────────────────────────────────────

import type { Resort } from "./types";

/** The `season` value the seed writes for Northern-hemisphere rows. */
export const CURRENT_SEASON = "2026-27";
/** How the season reads in copy (en dash, not hyphen). */
export const SEASON_LABEL = "2026–27";

export interface ResortOpening {
  id: string;
  resort_id: string;
  season: string;
  /** Third-party projection (OnTheSnow) or the resort's stated target. YYYY-MM-DD. */
  projected_open: string | null;
  /** The resort announced this date. The only field that triggers an opening-day email. */
  confirmed_open: string | null;
  /** End of the current season — Southern-hemisphere rows carry this instead of an opening. */
  closing_date: string | null;
  source_url: string | null;
  notes: string | null;
  updated_at: string;
}

export type OpeningStatus = "open" | "confirmed" | "projected" | "tba" | "closed";

/** The slice of a resort the table needs — `ResortWithData` satisfies it. */
export type OpeningResort = Pick<Resort, "id" | "name" | "slug" | "state" | "lat">;

export interface OpeningRow<R extends OpeningResort = OpeningResort> {
  resort: R;
  opening: ResortOpening | null;
  status: OpeningStatus;
}

export interface OpeningGroups<R extends OpeningResort = OpeningResort> {
  /** Northern resorts whose confirmed date has passed — spinning lifts. */
  open: OpeningRow<R>[];
  /** Announced by the resort, soonest first. */
  confirmed: OpeningRow<R>[];
  /** Projection only, soonest first. */
  projected: OpeningRow<R>[];
  /** No sourced date yet, alphabetical. */
  tba: OpeningRow<R>[];
  /** Every Southern-hemisphere resort: the Andes season is ending while the North waits. */
  closing: OpeningRow<R>[];
}

export interface OpeningSummary<R extends OpeningResort = OpeningResort> {
  /** Resorts with a confirmed date (already open or announced). */
  confirmed: number;
  projected: number;
  tba: number;
  open: number;
  /** The soonest confirmed future opening, else the soonest projection still ahead of today; null when neither exists. */
  nextToOpen: OpeningRow<R> | null;
}

// ── Dates ────────────────────────────────────────────────────

const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** True for a real calendar day written YYYY-MM-DD (rejects 2026-02-30). */
export function isIsoDay(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DAY_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/**
 * The calendar day a `Date` falls on in UTC, as YYYY-MM-DD — the "today" the
 * trigger cron uses (`new Date().toISOString().slice(0, 10)`) to decide which
 * resorts open today. A string is validated and passed through.
 *
 * The page does NOT read its day from this: it revalidates at any hour, and
 * from 00:00 UTC the UTC date is already tomorrow while it is still 4–7 pm
 * the evening before at every Northern resort in the catalogue — a
 * "Confirmed Nov 13" row would read "Open now" up to 16 hours before the
 * first chair. It uses toPacificDay instead; the two agree at the cron's
 * 13:00 UTC, so the page and the email never disagree about opening day.
 */
export function toIsoDay(value: Date | string): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new RangeError("toIsoDay: invalid Date");
    return value.toISOString().slice(0, 10);
  }
  if (!isIsoDay(value)) throw new RangeError(`toIsoDay: "${value}" is not a YYYY-MM-DD day`);
  return value;
}

/**
 * The wall clock /opening-dates reads its calendar day in. Every Northern
 * resort in the catalogue sits between UTC-5 (Vermont) and UTC-8 (Tahoe,
 * Mammoth, the Cascades), so the US Pacific day is the last of them to turn
 * over: a resort can never read "Open" before opening day has begun where
 * its lifts are, only up to three hours after. The Andes rows (UTC-3/-4) flip
 * to "closed" a few hours after their own midnight rather than at 9 pm on
 * the closing day itself.
 */
export const OPENINGS_TIME_ZONE = "America/Los_Angeles";

// en-CA is the locale whose numeric date is YYYY-MM-DD; the parts are still
// reassembled by type so the output never depends on the separator.
const PACIFIC_DAY_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: OPENINGS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * The calendar day a `Date` falls on in OPENINGS_TIME_ZONE, as YYYY-MM-DD —
 * the `today` the page hands to sortForTable/openingSummary. At the trigger
 * cron's 13:00 UTC this equals toIsoDay of the same instant (05:00 or 06:00
 * Pacific), which is what keeps the opening-day email and the "Open now"
 * group on the same date.
 */
export function toPacificDay(value: Date): string {
  if (Number.isNaN(value.getTime())) throw new RangeError("toPacificDay: invalid Date");
  const parts = PACIFIC_DAY_FORMAT.formatToParts(value);
  const part = (type: Intl.DateTimeFormatPart["type"]) => parts.find((p) => p.type === type)?.value ?? "";
  const day = `${part("year")}-${part("month")}-${part("day")}`;
  if (!isIsoDay(day)) throw new RangeError(`toPacificDay: Intl produced "${day}", not a YYYY-MM-DD day`);
  return day;
}

/** Whole days from `today` to `iso`; negative when `iso` is in the past. */
export function daysUntil(iso: string, today: Date | string): number {
  const to = Date.parse(`${toIsoDay(iso)}T00:00:00Z`);
  const from = Date.parse(`${toIsoDay(today)}T00:00:00Z`);
  return Math.round((to - from) / 86_400_000);
}

export type OpeningDateStyle = "short" | "weekday" | "long";

/**
 * "Nov 13" / "Fri, Nov 13" / "Friday, November 13, 2026". A pure function of
 * the ISO string — no `toLocaleDateString`, no timezone — so the ISR'd HTML
 * is identical on every machine. Anything that is not a YYYY-MM-DD day
 * renders as "" rather than "Invalid Date".
 */
export function formatOpeningDate(iso: string | null | undefined, style: OpeningDateStyle = "short"): string {
  if (!isIsoDay(iso)) return "";
  const [y, m, d] = iso.split("-").map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  switch (style) {
    case "long":
      return `${DAYS_LONG[weekday]}, ${MONTHS_LONG[m - 1]} ${d}, ${y}`;
    case "weekday":
      return `${DAYS_SHORT[weekday]}, ${MONTHS_SHORT[m - 1]} ${d}`;
    default:
      return `${MONTHS_SHORT[m - 1]} ${d}`;
  }
}

// ── Status ───────────────────────────────────────────────────

/**
 * What a row means on a given day. A confirmed date wins over everything
 * else; a closing date only matters when there is no confirmed opening in
 * play (the Andes rows, or a row that carries last season's closing date
 * alongside this season's announcement). A projection never becomes "open"
 * on its own — we do not know the lifts turned until the resort says so.
 */
export function openingStatus(row: ResortOpening | null | undefined, today: Date | string): OpeningStatus {
  if (!row) return "tba";
  const day = toIsoDay(today);

  if (row.confirmed_open) {
    if (day < row.confirmed_open) return "confirmed";
    if (row.closing_date && day > row.closing_date && row.closing_date >= row.confirmed_open) return "closed";
    return "open";
  }
  if (row.closing_date) {
    return day > row.closing_date ? "closed" : "open";
  }
  if (row.projected_open) return "projected";
  return "tba";
}

/** True on the one day the trigger cron should mail this resort's opening-day subscribers. */
export function isOpeningToday(row: Pick<ResortOpening, "confirmed_open">, today: Date | string): boolean {
  return row.confirmed_open !== null && row.confirmed_open === toIsoDay(today);
}

// ── Table order ──────────────────────────────────────────────

function byName<R extends OpeningResort>(a: OpeningRow<R>, b: OpeningRow<R>): number {
  return a.resort.name.localeCompare(b.resort.name, "en");
}

/** Ascending by an ISO day, nulls last, ties broken by name. */
function byDate<R extends OpeningResort>(pick: (row: OpeningRow<R>) => string | null) {
  return (a: OpeningRow<R>, b: OpeningRow<R>): number => {
    const da = pick(a);
    const db = pick(b);
    if (da && db && da !== db) return da < db ? -1 : 1;
    if (da && !db) return -1;
    if (!da && db) return 1;
    return byName(a, b);
  };
}

/**
 * Every active resort, joined to its opening row and bucketed for the page:
 * open → confirmed (soonest first) → projected (soonest first) → TBA
 * (alphabetical), with the Southern hemisphere in its own "closing" bucket
 * ordered by closing date (undated Andes resorts last). A resort with no row
 * is a TBA row, so the table always lists the whole catalogue.
 */
export function sortForTable<R extends OpeningResort>(
  rows: readonly ResortOpening[],
  resorts: readonly R[],
  today: Date | string,
): OpeningGroups<R> {
  const day = toIsoDay(today);
  const byResort = new Map(rows.map((row) => [row.resort_id, row]));
  const groups: OpeningGroups<R> = { open: [], confirmed: [], projected: [], tba: [], closing: [] };

  for (const resort of resorts) {
    const opening = byResort.get(resort.id) ?? null;
    const entry: OpeningRow<R> = { resort, opening, status: openingStatus(opening, day) };
    if (resort.lat < 0) {
      groups.closing.push(entry);
      continue;
    }
    switch (entry.status) {
      case "open":
        groups.open.push(entry);
        break;
      case "confirmed":
        groups.confirmed.push(entry);
        break;
      case "projected":
        groups.projected.push(entry);
        break;
      default:
        // "tba", and a Northern row whose only date is a past closing date —
        // neither says anything about when the lifts turn next.
        groups.tba.push(entry);
    }
  }

  groups.open.sort(byDate((r) => r.opening?.confirmed_open ?? null));
  groups.confirmed.sort(byDate((r) => r.opening?.confirmed_open ?? null));
  groups.projected.sort(byDate((r) => r.opening?.projected_open ?? null));
  groups.tba.sort(byName);
  groups.closing.sort(byDate((r) => r.opening?.closing_date ?? null));
  return groups;
}

/**
 * The numbers the page's summary chips show. `today` is the day `sortForTable`
 * bucketed with: the confirmed group only ever holds future dates, but the
 * projected group keeps every unconfirmed projection — a resort past its
 * projection with no announcement is still only "projected" — so the headline
 * "next to open" must skip projections that have already come and gone.
 */
export function openingSummary<R extends OpeningResort>(groups: OpeningGroups<R>, today: Date | string): OpeningSummary<R> {
  const day = toIsoDay(today);
  const nextProjected =
    groups.projected.find((r) => r.opening?.projected_open != null && r.opening.projected_open >= day) ?? null;
  return {
    confirmed: groups.confirmed.length + groups.open.length,
    projected: groups.projected.length,
    tba: groups.tba.length,
    open: groups.open.length,
    nextToOpen: groups.confirmed[0] ?? nextProjected,
  };
}

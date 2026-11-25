// ─────────────────────────────────────────────────────────────
// Lift counts for the hub and pass tables (/ski-cams/{hub},
// /snow-report/{hub}, /passes/{pass}).
//
// The tables rank resorts by a station's base depth, which early in the
// season reads 0 in. at resorts that are already running lifts on machine-made
// snow. This adds what the operator's own lift feed says beside it. Pure: the
// freshness rule is the conditions contract's (lib/conditions-contract.ts
// freshnessFor — an operator row older than 30 h is stale and shows nothing),
// the clock is passed in, and the text is dated by the feed's own timestamp.
//
// A count is what the operator's feed reported. Some feeds flip a lift to
// "open" with its posted hours, so the wording says "per the operator's
// feed" and never "confirmed".
// ─────────────────────────────────────────────────────────────

import type { ConditionRating, OperatorStatusRow } from "./types";
import { freshnessFor } from "./conditions-contract";
import { DEFAULT_OPERATOR_TIME_ZONE, summarizeOperatorDay, type OperatorReading } from "./operator-day";
import { operatorReportFromRow } from "./public-api/conditions";
import { formatMountainTime } from "./quotable";
import { resortTimeZone, type TimeZoneResort } from "./resort-timezone";

/**
 * One resort's lift status for today from a current operator feed, by the
 * day rules in lib/operator-day.ts (the same ones the conditions contract
 * uses):
 *   - `operated`: a reading today showed lifts open. The count is the day's
 *     latest reading that showed any open, and stays after the last chair.
 *   - `scheduled`: none confirmed open yet today; the newest reading lists
 *     lifts set to run (its scheduled count, plus lifts it flags open before
 *     first chair, lib/operator-day.ts FIRST_CHAIR_HOUR).
 * A resort the feed calls closed, or says nothing about today, is absent.
 */
export interface HubLifts {
  state: "operated" | "scheduled";
  open: number;
  total: number;
  /** `scheduled` only: lifts the feed lists as set to run today. */
  scheduled: number | null;
  /** The reading the count comes from: the feed's own timestamp (ISO). */
  observedAt: string;
  /** `operated`: whether the newest reading still shows lifts open. */
  current: boolean;
  /** True before the day's first reading: the count is the previous local day's last open reading (lib/operator-day.ts). */
  carried: boolean;
}

/** Keyed by resort id; a resort without a current feed is absent. */
export type HubLiftsIndex = Readonly<Record<string, HubLifts | undefined>>;

/** What the index needs to know of a resort: its id and where its clock is. */
export type HubLiftsResort = TimeZoneResort & { id: string };

/** Today's lift status from the row and its attached readings; null when the feed is stale, carries no counts, or does not say open or scheduled today. */
export function hubLiftsFromRow(
  row: OperatorStatusRow | null | undefined,
  now: Date,
  timeZone: string = DEFAULT_OPERATOR_TIME_ZONE,
  /** False when the resort has no confirmed opening date that has passed: a feed that only lists lifts as scheduled is then not shown (deriveStatus applies the same rule). */
  seasonOn: boolean = true,
): HubLifts | null {
  const report = operatorReportFromRow(row);
  if (!report) return null;
  const tier = freshnessFor("operator", report.observedAt, now).tier;
  if (tier !== "live" && tier !== "recent") return null;
  const readings: readonly OperatorReading[] = report.readings?.length
    ? report.readings
    : [{ observedAt: report.observedAt, liftsOpen: report.liftsOpen, liftsScheduled: report.liftsScheduled, liftsTotal: report.liftsTotal }];
  const day = summarizeOperatorDay(readings, timeZone, now);
  if (!day || day.state === "closed" || day.liftsTotal == null) return null;
  if (day.state === "scheduled" && !seasonOn) return null;
  return { state: day.state, open: day.liftsOpen, total: day.liftsTotal, scheduled: day.liftsScheduled, observedAt: day.observedAt, current: day.current, carried: day.carried };
}

export function buildHubLiftsIndex(
  operatorIndex: Readonly<Record<string, OperatorStatusRow>> | null | undefined,
  now: Date,
  resorts: readonly HubLiftsResort[] = [],
  /** Resort ids whose confirmed opening date has passed. Omitted: every resort is treated as in season (the behaviour before this parameter). */
  inSeason?: ReadonlySet<string> | null,
): Record<string, HubLifts> {
  const zones = new Map(resorts.map((r) => [r.id, resortTimeZone(r)]));
  const out: Record<string, HubLifts> = {};
  for (const [resortId, row] of Object.entries(operatorIndex ?? {})) {
    const lifts = hubLiftsFromRow(row, now, zones.get(resortId), inSeason ? inSeason.has(resortId) : true);
    if (lifts) out[resortId] = lifts;
  }
  return out;
}

/** True when a reading today showed at least one lift open: the tables show the "Open" chip. */
export function hasOpenLifts(lifts: HubLifts | null | undefined): boolean {
  return !!lifts && lifts.state === "operated" && lifts.open > 0;
}

/** True when no lift has opened yet today and the feed lists some as scheduled: the quieter "Opens today" chip. */
export function opensToday(lifts: HubLifts | null | undefined): boolean {
  return !!lifts && lifts.state === "scheduled" && (lifts.scheduled ?? 0) > 0;
}

/**
 * The cell text: "8 of 35" when lifts ran today, "4 set to run" before the
 * first chair on a feed that lists planned lifts, null (a dash) otherwise.
 * A feed that lists 0 open and none scheduled is a dash on purpose: before
 * opening day that number would label a pre-season resort "closed".
 */
export function liftsCellText(lifts: HubLifts | null | undefined): string | null {
  if (lifts && hasOpenLifts(lifts)) return `${lifts.open} of ${lifts.total}`;
  if (lifts && opensToday(lifts)) return `${lifts.scheduled} set to run`;
  return null;
}

/** The phone line under the resort name. */
export function liftsMobileText(lifts: HubLifts | null | undefined): string | null {
  if (lifts && hasOpenLifts(lifts)) return `${lifts.open} of ${lifts.total} lifts open`;
  if (lifts && opensToday(lifts)) return `${lifts.scheduled} ${lifts.scheduled === 1 ? "lift" : "lifts"} set to run today`;
  return null;
}

/** Screen-reader and title text for one row. */
export function liftsCellLabel(lifts: HubLifts, name: string): string {
  if (lifts.state === "scheduled") {
    return `${name}: ${lifts.scheduled} ${lifts.scheduled === 1 ? "lift" : "lifts"} set to run today per the operator's feed, none confirmed turning yet, read at ${formatMountainTime(lifts.observedAt)}`;
  }
  return `${name}: ${lifts.open} of ${lifts.total} lifts open per the operator's feed, read at ${formatMountainTime(lifts.observedAt)}${lifts.carried ? ", the last open reading before today's first chair" : lifts.current ? "" : "; the feed has shown none open since"}`;
}

/**
 * The dated line under a table, or null when no row shows a count. Dated by
 * the newest feed reading among the rows shown, never by the render.
 */
export function liftsFootnote(lifts: readonly (HubLifts | null | undefined)[]): string | null {
  const shown = lifts.filter((l): l is HubLifts => hasOpenLifts(l) || opensToday(l));
  if (!shown.length) return null;
  const newest = shown.map((l) => l.observedAt).sort().reverse()[0];
  const parts = [
    `Lift counts are what each operator's own feed reported: for each resort, its latest reading that showed lifts open, the newest of them at ${formatMountainTime(newest)}. A count stays after the lifts stop, until the feed's first reading of the resort's next day.`,
    `"Open" here means open per that feed; it is not a confirmation that a lift is turning.`,
  ];
  if (shown.some(opensToday)) parts.push(`"Opens today" means the feed lists lifts set to run today and none is confirmed turning yet; a feed that already marks lifts open before 8 a.m. resort time is read that way too.`);
  return parts.join(" ");
}

/**
 * The rating a hub table shows. A report without a base depth (a station
 * whose depth sensor returned nothing) still carries the engine's rating,
 * which rates the missing depth as "poor"; beside a dash that reads as a
 * verdict on snow nobody measured, so the table shows no rating instead.
 */
export function hubDisplayRating(rating: ConditionRating | null | undefined, baseDepth: number | string | null | undefined): ConditionRating | null {
  if (baseDepth == null) return null;
  return rating ?? null;
}

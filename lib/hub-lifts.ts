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
import { operatorReportFromRow } from "./public-api/conditions";
import { formatMountainTime } from "./quotable";

/** One resort's lift count from a current operator feed. */
export interface HubLifts {
  open: number;
  total: number;
  /** The feed's own timestamp for the lift status (ISO). */
  observedAt: string;
}

/** Keyed by resort id; a resort without a current feed is absent. */
export type HubLiftsIndex = Readonly<Record<string, HubLifts | undefined>>;

/** The row's lift count when the feed is current (live or recent) and carries counts; null otherwise. */
export function hubLiftsFromRow(row: OperatorStatusRow | null | undefined, now: Date): HubLifts | null {
  const report = operatorReportFromRow(row);
  if (!report) return null;
  const tier = freshnessFor("operator", report.observedAt, now).tier;
  if (tier !== "live" && tier !== "recent") return null;
  const { liftsOpen: open, liftsTotal: total } = report;
  if (open == null || total == null || total <= 0 || open < 0) return null;
  return { open: Math.min(open, total), total, observedAt: new Date(report.observedAt).toISOString() };
}

export function buildHubLiftsIndex(operatorIndex: Readonly<Record<string, OperatorStatusRow>> | null | undefined, now: Date): Record<string, HubLifts> {
  const out: Record<string, HubLifts> = {};
  for (const [resortId, row] of Object.entries(operatorIndex ?? {})) {
    const lifts = hubLiftsFromRow(row, now);
    if (lifts) out[resortId] = lifts;
  }
  return out;
}

/** True when the feed reports at least one lift open: the tables show the "Open" chip. */
export function hasOpenLifts(lifts: HubLifts | null | undefined): lifts is HubLifts {
  return !!lifts && lifts.open > 0;
}

/**
 * The cell text: "8 of 35" when lifts are open, null (a dash) otherwise. A
 * feed that lists 0 open lifts is shown as a dash on purpose: before opening
 * day that number would label a pre-season resort "closed".
 */
export function liftsCellText(lifts: HubLifts | null | undefined): string | null {
  return hasOpenLifts(lifts) ? `${lifts.open} of ${lifts.total}` : null;
}

/** Screen-reader and title text for one row. */
export function liftsCellLabel(lifts: HubLifts, name: string): string {
  return `${name}: ${lifts.open} of ${lifts.total} lifts open per the operator's feed, read at ${formatMountainTime(lifts.observedAt)}`;
}

/**
 * The dated line under a table, or null when no row shows a count. Dated by
 * the newest feed reading among the rows shown, never by the render.
 */
export function liftsFootnote(lifts: readonly (HubLifts | null | undefined)[]): string | null {
  const shown = lifts.filter(hasOpenLifts);
  if (!shown.length) return null;
  const newest = shown.map((l) => l.observedAt).sort().reverse()[0];
  return `Lift counts are what each operator's own feed reported, newest reading ${formatMountainTime(newest)}. "Open" here means open per that feed; it is not a confirmation that a lift is turning.`;
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

// ─────────────────────────────────────────────────────────────
// Conditions contract v2 (parity plan block P6).
//
// Every field an assistant reads about a resort's conditions is a `Field`:
// the value, where it came from, when it was observed, how much to trust it
// and a freshness tier with the age in hours. On top of the fields sit three
// derived facts: an operating `status` that never defaults to open, a
// `recommendableToday` verdict with its reasons, and a `depthDisagreement`
// block when the station and the operator disagree about the base.
//
// Pure: no clock (the caller passes `now`), no database, no Next.js. The
// serializer in lib/public-api/conditions.ts feeds it rows from the
// catalogue; lib/conditions-contract.test.ts pins every rule below.
//
// Sources. `snotel` is the resort's own NRCS station as written to the snow
// report; `station:<network>` is a reading from the P3 station layer
// (migration 026); `operator` is the resort's published report (lift status
// via Liftie, a confirmed opening date); `model` is a weather-model estimate
// (Open-Meteo); `profile` is a static catalogue fact (lift and run totals, a
// projected opening date); `derived` is computed by PeakCam from other
// fields; `none` means PeakCam has nothing for the field.
//
// Freshness tiers, by age against the source's own cadence:
//   live       ≤ 3 h old from a source that publishes at least hourly
//              (operator feed, NWS / ECCC / BC ASWS observations)
//   recent     ≤ 30 h old otherwise: a daily station reading inside its
//              cadence, an hourly source between 3 and 30 h, a static
//              profile fact (which carries no age)
//   estimated  a model value ≤ 30 h old, whatever its exact age
//   stale      older than 30 h, any source
//   unknown    no value, no source or no observation time
//
// Confidence is 0–1 and starts from the source (SNOTEL 0.9, other stations
// 0.8, operator 0.7, profile 0.6, derived 0.6, model 0.5, none 0); a stale
// value is halved and an unknown one is 0. Derived fields take the lowest
// confidence of their inputs.
// ─────────────────────────────────────────────────────────────

import type { ResortOpening } from "./openings";
import { openingStatus } from "./openings";
import { DEFAULT_OPERATOR_TIME_ZONE, localClock, summarizeOperatorDay, type OperatorDay, type OperatorReading } from "./operator-day";

export const CONDITIONS_SCHEMA_VERSION = "1.0.0";

export const FIELD_SOURCES = [
  "snotel",
  "station:snotel",
  "station:ghcn",
  "station:nws",
  "station:bc_asws",
  "station:eccc",
  "operator",
  "model",
  "profile",
  "derived",
  "none",
] as const;
export type FieldSource = (typeof FIELD_SOURCES)[number];

export const FRESHNESS_TIERS = ["live", "recent", "estimated", "stale", "unknown"] as const;
export type FreshnessTier = (typeof FRESHNESS_TIERS)[number];

export const RESORT_STATUSES = ["OPEN", "CLOSED_TODAY", "PRE_SEASON", "OFF_SEASON", "UNKNOWN"] as const;
export type ResortStatus = (typeof RESORT_STATUSES)[number];

export interface Freshness {
  tier: FreshnessTier;
  /** Hours between the observation and `now`, one decimal; null without an observation time. */
  ageHours: number | null;
}

export interface Field<T> {
  value: T | null;
  source: FieldSource;
  /** ISO-8601 instant the value was observed or published; null for static facts and empty fields. */
  observedAt: string | null;
  /** 0–1. */
  confidence: number;
  freshness: Freshness;
}

// ── Thresholds ───────────────────────────────────────────────

export const FRESHNESS_LIVE_MAX_HOURS = 3;
export const FRESHNESS_RECENT_MAX_HOURS = 30;
/** Sources that publish at least hourly, so a reading under 3 h old is "live". */
export const HOURLY_SOURCES: ReadonlySet<FieldSource> = new Set<FieldSource>(["operator", "station:nws", "station:bc_asws", "station:eccc"]);

export const BASE_CONFIDENCE: Record<FieldSource, number> = {
  snotel: 0.9,
  "station:snotel": 0.9,
  "station:ghcn": 0.8,
  "station:nws": 0.8,
  "station:bc_asws": 0.8,
  "station:eccc": 0.8,
  operator: 0.7,
  model: 0.5,
  profile: 0.6,
  derived: 0.6,
  none: 0,
};

/** Station and operator base depths that differ by more than this share of the larger one are flagged. */
export const DEPTH_DISAGREEMENT_RATIO = 0.3;

// ── Field helpers ────────────────────────────────────────────

const round1 = (v: number): number => Math.round(v * 10) / 10;
const round2 = (v: number): number => Math.round(v * 100) / 100;

export function ageHoursOf(observedAt: string | null | undefined, now: Date): number | null {
  if (!observedAt) return null;
  const ms = Date.parse(observedAt);
  if (Number.isNaN(ms)) return null;
  return round1(Math.max(0, now.getTime() - ms) / 3_600_000);
}

export function freshnessFor(source: FieldSource, observedAt: string | null | undefined, now: Date, hasValue = true): Freshness {
  if (!hasValue || source === "none") return { tier: "unknown", ageHours: ageHoursOf(observedAt, now) };
  if (source === "profile") return { tier: "recent", ageHours: null };
  const ageHours = ageHoursOf(observedAt, now);
  if (ageHours == null) return { tier: "unknown", ageHours: null };
  if (ageHours > FRESHNESS_RECENT_MAX_HOURS) return { tier: "stale", ageHours };
  if (source === "model") return { tier: "estimated", ageHours };
  if (ageHours <= FRESHNESS_LIVE_MAX_HOURS && HOURLY_SOURCES.has(source)) return { tier: "live", ageHours };
  return { tier: "recent", ageHours };
}

export function confidenceFor(source: FieldSource, tier: FreshnessTier, base: number = BASE_CONFIDENCE[source]): number {
  if (tier === "unknown") return 0;
  if (tier === "stale") return round2(base / 2);
  return round2(base);
}

export interface FieldOptions {
  /** Override the base confidence (derived fields pass the minimum of their inputs). */
  confidence?: number;
}

/** A populated field, or an empty one when `value` is null. */
export function field<T>(value: T | null | undefined, source: FieldSource, observedAt: string | null | undefined, now: Date, options: FieldOptions = {}): Field<T> {
  const present = value != null && !(typeof value === "number" && !Number.isFinite(value));
  if (!present) return noneField<T>();
  const freshness = freshnessFor(source, observedAt ?? null, now, true);
  return {
    value: value as T,
    source,
    observedAt: observedAt ? toIso(observedAt) : null,
    confidence: confidenceFor(source, freshness.tier, options.confidence),
    freshness,
  };
}

export function noneField<T>(): Field<T> {
  return { value: null, source: "none", observedAt: null, confidence: 0, freshness: { tier: "unknown", ageHours: null } };
}

function toIso(value: string): string | null {
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/** True when the field carries a value fresh enough to act on (live, recent or estimated). */
export function isCurrent<T>(f: Field<T>): boolean {
  return f.value != null && (f.freshness.tier === "live" || f.freshness.tier === "recent" || f.freshness.tier === "estimated");
}

// ── Operator report ──────────────────────────────────────────

/** The latest operator report for a resort (migration 032 `latest_operator_status`), already normalised. */
export interface OperatorReport {
  /** `liftie` today; other feeds later. */
  source: string;
  sourceId: string;
  /** The provider's own timestamp for the lift status. */
  observedAt: string;
  liftsOpen: number | null;
  liftsHold: number | null;
  liftsScheduled: number | null;
  liftsClosed: number | null;
  liftsTotal: number | null;
  trailsOpen: number | null;
  trailsTotal: number | null;
  baseDepthIn: number | null;
  surface: string | null;
  /** The operator's own published opening date, when the feed carries one. */
  openingDate: string | null;
  verified: boolean;
  /**
   * The feed's readings from the last 30 h, when the caller has them
   * (lib/supabase.ts attaches them to the latest row). The status rules read
   * the resort's whole local day from these; without them the report itself
   * is the only reading.
   */
  readings?: readonly OperatorReading[] | null;
}

// ── Status ───────────────────────────────────────────────────

export interface StatusInput {
  opening: ResortOpening | null;
  hemisphere: "north" | "south";
  /** YYYY-MM-DD, the resort's own calendar day (lib/resort-timezone.ts). */
  localDate: string;
  operator: OperatorReport | null;
  now: Date;
  /** The resort's IANA zone (lib/resort-timezone.ts), for the feed's local day and hours; Mountain time when absent. */
  timeZone?: string;
}

export interface StatusResult {
  status: ResortStatus;
  /** What the status rests on: `operator` (lift feed or confirmed date), `profile` (projection), `none`. */
  source: FieldSource;
  /**
   * `feed`: a fresh operator feed decided it (observedAt is the feed's time).
   * `date`: an opening or closing date against the resort's calendar day
   * decided it; that is a fact about today, not an observation, so
   * observedAt is null and the field reads `recent` with no age.
   * `none`: nothing usable.
   */
  basis: "feed" | "date" | "none";
  observedAt: string | null;
  reasons: string[];
  /** What the operator feed said over the resort's local day, when it decided the status (lib/operator-day.ts). */
  liftDay?: OperatorDay | null;
}

function count(n: number | null | undefined): number {
  return n == null || !Number.isFinite(n) ? 0 : n;
}

/**
 * The operating status, never defaulting to open:
 *
 * 1. A fresh operator feed decides first, read over the resort's local day
 *    (lib/operator-day.ts): any reading today with a lift open → OPEN for
 *    the rest of that day; else lifts scheduled in the newest reading (before
 *    the lift day ends) → OPEN, but only once a confirmed opening date has
 *    passed (a standing "scheduled" flag never opens a resort by itself);
 *    else a core-hours reading (10:00–15:00 local)
 *    with nothing open or scheduled while the season is on → CLOSED_TODAY.
 *    A 0/0 reading outside core hours, yesterday's readings and a feed with
 *    no lift data say nothing and fall through.
 * 2. Else the opening row: a confirmed date that has passed (and no closing
 *    date behind it) → OPEN; a confirmed or projected date still ahead →
 *    PRE_SEASON; a closing date that has passed → OFF_SEASON; a projection
 *    that has come and gone without confirmation → UNKNOWN.
 * 3. Nothing on file → UNKNOWN. The calendar alone never opens a resort.
 */
export function deriveStatus(input: StatusInput): StatusResult {
  const { opening, localDate, operator, now } = input;
  const reasons: string[] = [];
  const seasonWord = input.hemisphere === "south" ? "Southern-hemisphere season" : "season";

  const openingState = openingStatus(opening, localDate);
  const seasonOn = openingState === "open";

  if (operator) {
    const fresh = freshnessFor("operator", operator.observedAt, now);
    const age = fresh.ageHours == null ? "" : ` (${fresh.ageHours} h old)`;
    if (fresh.tier === "live" || fresh.tier === "recent") {
      const timeZone = input.timeZone ?? DEFAULT_OPERATOR_TIME_ZONE;
      const readings: readonly OperatorReading[] = operator.readings?.length
        ? operator.readings
        : [{ observedAt: operator.observedAt, liftsOpen: operator.liftsOpen, liftsScheduled: operator.liftsScheduled, liftsTotal: operator.liftsTotal }];
      const day = summarizeOperatorDay(readings, timeZone, now);
      if (day?.state === "operated") {
        reasons.push(
          day.carried
            ? `operator feed${age}: no reading yet on ${localDate}; lifts ran on ${day.localDate}, ${day.liftsOpen} of ${day.liftsTotal ?? "?"} open at ${localClock(new Date(day.observedAt), timeZone)} resort time that day`
            : day.current
            ? `operator feed${age}: ${day.liftsOpen} of ${day.liftsTotal ?? "?"} lifts open`
            : `operator feed: lifts ran today, ${day.liftsOpen} of ${day.liftsTotal ?? "?"} open at ${localClock(new Date(day.observedAt), timeZone)} resort time; the newest reading${age} shows none open`,
        );
        return { status: "OPEN", source: "operator", basis: "feed", observedAt: day.newestAt, reasons, liftDay: day };
      }
      if (day?.state === "scheduled" && seasonOn) {
        reasons.push(`operator feed${age}: ${day.liftsScheduled} ${day.liftsScheduled === 1 ? "lift" : "lifts"} set to run today, none confirmed turning yet`);
        return { status: "OPEN", source: "operator", basis: "feed", observedAt: day.newestAt, reasons, liftDay: day };
      }
      if (day?.state === "scheduled") {
        // A "scheduled" flag alone is not an opening: Sun Valley's page listed
        // all 17 lifts as scheduled every day before its 2026-11-26 opening,
        // and Bogus Basin lists two non-lift rows that way on closed days.
        reasons.push(`operator feed${age}: ${day.liftsScheduled} ${day.liftsScheduled === 1 ? "lift" : "lifts"} listed as scheduled and none open; without a confirmed opening date that has passed, a scheduled flag does not open the resort, so the dates decide`);
      } else if (day?.state === "closed") {
        reasons.push(`operator feed: 0 of ${day.liftsTotal ?? "?"} lifts open and none scheduled at ${localClock(new Date(day.observedAt), timeZone)} resort time, and no reading today showed a lift open`);
        if (seasonOn) {
          reasons.push(`inside the ${seasonWord} per the confirmed opening date${opening?.confirmed_open ? ` ${opening.confirmed_open}` : ""}`);
          return { status: "CLOSED_TODAY", source: "operator", basis: "feed", observedAt: day.newestAt, reasons, liftDay: day };
        }
        // Not known to be in season: the feed agrees with the calendar below.
      } else if (count(operator.liftsTotal) > 0) {
        reasons.push(`operator feed${age}: no reading today shows a lift open or scheduled; outside core hours that does not mean closed, so the dates decide`);
      } else {
        reasons.push(`operator feed${age} carries no lift counts`);
      }
    } else {
      reasons.push(`operator feed is ${fresh.tier}${age}; not used`);
    }
  }

  if (!opening) {
    reasons.push("no opening date on file");
    return { status: "UNKNOWN", source: "none", basis: "none", observedAt: null, reasons };
  }
  switch (openingState) {
    case "open":
      reasons.push(
        opening.confirmed_open
          ? `confirmed opening date ${opening.confirmed_open} has passed${opening.closing_date ? `, closing ${opening.closing_date}` : ""}`
          : `inside the ${seasonWord} per the published closing date ${opening.closing_date}`,
      );
      return { status: "OPEN", source: "operator", basis: "date", observedAt: null, reasons };
    case "confirmed":
      reasons.push(`confirmed opening date ${opening.confirmed_open} is ahead of ${localDate}`);
      return { status: "PRE_SEASON", source: "operator", basis: "date", observedAt: null, reasons };
    case "projected": {
      const date = opening.projected_open!;
      if (date >= localDate) {
        reasons.push(`projected opening date ${date} (third-party estimate) is ahead of ${localDate}`);
        return { status: "PRE_SEASON", source: "profile", basis: "date", observedAt: null, reasons };
      }
      reasons.push(`projected opening date ${date} has passed without confirmation from the resort`);
      return { status: "UNKNOWN", source: "none", basis: "none", observedAt: null, reasons };
    }
    case "closed":
      reasons.push(`closing date ${opening.closing_date} has passed`);
      return { status: "OFF_SEASON", source: "operator", basis: "date", observedAt: null, reasons };
    default:
      reasons.push("no sourced opening or closing date for this season");
      return { status: "UNKNOWN", source: "none", basis: "none", observedAt: null, reasons };
  }
}

// ── Depth disagreement ───────────────────────────────────────

export interface DepthDisagreement {
  measuredIn: number;
  operatorIn: number;
  /** |measured − operator| as a percent of the larger value. */
  differencePct: number;
  preferred: "measured";
  note: string;
}

export function depthDisagreement(measuredIn: number | null | undefined, operatorIn: number | null | undefined): DepthDisagreement | null {
  if (measuredIn == null || operatorIn == null || !Number.isFinite(measuredIn) || !Number.isFinite(operatorIn)) return null;
  const larger = Math.max(Math.abs(measuredIn), Math.abs(operatorIn));
  if (larger === 0) return null;
  const ratio = Math.abs(measuredIn - operatorIn) / larger;
  if (ratio <= DEPTH_DISAGREEMENT_RATIO) return null;
  const differencePct = Math.round(ratio * 100);
  return {
    measuredIn,
    operatorIn,
    differencePct,
    preferred: "measured",
    note: `The station measures ${measuredIn} in and the operator reports ${operatorIn} in, ${differencePct} % apart; a station sits at one elevation and an operator picks its deepest stake. Quote the measured value and say which it is.`,
  };
}

// ── Contract ─────────────────────────────────────────────────

export const CONDITION_FIELD_NAMES = [
  "status",
  "seasonOpening",
  "seasonClosing",
  "baseDepthIn",
  "operatorBaseDepthIn",
  "newSnow24hIn",
  "newSnow48hIn",
  "sweIn",
  "liftsOpen",
  "liftsTotal",
  "runsOpen",
  "runsTotal",
  "surface",
  "snowQuality",
  "tempF",
  "windMph",
  "forecastNext48hCm",
  "percentOfNormal",
] as const;
export type ConditionFieldName = (typeof CONDITION_FIELD_NAMES)[number];

export type SnowQuality = "powder" | "packed" | "spring" | "ice";

export interface ConditionsContract {
  status: Field<ResortStatus>;
  recommendableToday: boolean;
  /** Why the status and the verdict came out as they did, in order. */
  reasons: string[];
  /**
   * The operator feed over the resort's local day, when it decided the
   * status: `operated` (lifts ran today; the count is the day's latest open
   * reading), `scheduled` (none open yet, some scheduled) or `closed`.
   * Null when the dates, not the feed, decided.
   */
  liftDay: OperatorDay | null;
  depthDisagreement: DepthDisagreement | null;
  seasonOpening: Field<string>;
  seasonClosing: Field<string>;
  baseDepthIn: Field<number>;
  operatorBaseDepthIn: Field<number>;
  newSnow24hIn: Field<number>;
  newSnow48hIn: Field<number>;
  sweIn: Field<number>;
  liftsOpen: Field<number>;
  liftsTotal: Field<number>;
  runsOpen: Field<number>;
  runsTotal: Field<number>;
  surface: Field<string>;
  snowQuality: Field<SnowQuality>;
  tempF: Field<number>;
  windMph: Field<number>;
  forecastNext48hCm: Field<number>;
  percentOfNormal: Field<number>;
}

/** The snow report row as the contract needs it (a `snow_reports` row fits). */
export interface ReportInput {
  source: "snotel" | "open_meteo" | "pipeline" | "manual" | "resort" | string;
  updated_at: string;
  base_depth: number | null;
  new_snow_24h: number | null;
  new_snow_48h: number | null;
  swe_in: number | null;
  /** Already clamped to the publishable band by the caller (lib/public-api/serialize.ts clampPctOfNormal). */
  pct_of_normal: number | null;
  auto_cond_rating?: string | null;
  /** Condition tags from the engine (`Powder Day`, `Spring Skiing`, `Icy`, …). */
  tags: string[];
}

/** One station-layer reading, the slice the contract reads (MeasuredNow from lib/public-api/schema.ts fits). */
export interface MeasuredInput {
  role: "summit" | "mid" | "base" | "approach";
  source: "snotel" | "ghcn" | "nws" | "bc_asws" | "eccc";
  observedAt: string;
  snowDepthIn: number | null;
  tempF: number | null;
  windMph: number | null;
}

export interface ConditionsInput {
  now: Date;
  /** YYYY-MM-DD in the resort's zone. */
  localDate: string;
  hemisphere: "north" | "south";
  report: ReportInput | null;
  /** True when the resort has an NRCS station (its report is a measurement). */
  hasStation: boolean;
  opening: ResortOpening | null;
  operator: OperatorReport | null;
  /** The resort's IANA zone; Mountain time when absent. */
  timeZone?: string;
  profile: { liftsTotal: number | null; runsTotal: number | null };
  measured: readonly MeasuredInput[];
  /** The P4 blend summary's next-48-hour total, cm, and the newest run's issue instant. */
  forecast: { next48hCm: number; issuedAt: string } | null;
}

/** Map a `snow_reports.source` onto a contract source. */
export function reportFieldSource(source: string | null | undefined, hasStation: boolean): FieldSource {
  switch (source) {
    case "snotel":
      return hasStation ? "snotel" : "derived";
    case "open_meteo":
      return "model";
    case "pipeline":
      return "derived";
    case "manual":
    case "resort":
      return "operator";
    default:
      return "none";
  }
}

export function snowQualityFromTags(tags: readonly string[]): SnowQuality | null {
  const lower = tags.map((t) => t.toLowerCase());
  if (lower.some((t) => t.includes("powder"))) return "powder";
  if (lower.some((t) => t.includes("spring"))) return "spring";
  if (lower.some((t) => t.includes("icy") || t.includes("ice"))) return "ice";
  if (lower.some((t) => t.includes("packed") || t.includes("groomed"))) return "packed";
  return null;
}

const ROLE_ORDER: MeasuredInput["role"][] = ["summit", "mid", "base", "approach"];

/** The highest station with a value for `key`, as a field sourced to its network. */
function stationField(measured: readonly MeasuredInput[], key: "tempF" | "windMph", now: Date): Field<number> {
  const rows = [...measured].filter((m) => m[key] != null).sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role));
  const pick = rows[0];
  if (!pick) return noneField<number>();
  return field(pick[key], `station:${pick.source}` as FieldSource, pick.observedAt, now);
}

export interface RecommendInput {
  status: Field<ResortStatus>;
  baseDepthIn: Field<number>;
  operatorBaseDepthIn: Field<number>;
  newSnow24hIn: Field<number>;
  rating: string | null;
}

/**
 * True only when the resort is OPEN on a usable source and PeakCam has a
 * current base depth to stand on; a poor rating withholds the recommendation.
 * Every input to the verdict is spelled out in `reasons`.
 */
export function recommendToday(input: RecommendInput): { value: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const { status } = input;
  if (status.value !== "OPEN") {
    reasons.push(`status is ${status.value ?? "UNKNOWN"}`);
    return { value: false, reasons };
  }
  const base =
    isCurrent(input.baseDepthIn) && (input.baseDepthIn.value ?? 0) > 0
      ? input.baseDepthIn
      : isCurrent(input.operatorBaseDepthIn) && (input.operatorBaseDepthIn.value ?? 0) > 0
        ? input.operatorBaseDepthIn
        : null;
  if (!base) {
    const primaryEmpty = input.baseDepthIn.value == null || input.baseDepthIn.value <= 0;
    const operatorEmpty = input.operatorBaseDepthIn.value == null || input.operatorBaseDepthIn.value <= 0;
    const staleField = input.baseDepthIn.value != null && input.baseDepthIn.value > 0
      ? input.baseDepthIn
      : input.operatorBaseDepthIn.value != null && input.operatorBaseDepthIn.value > 0
        ? input.operatorBaseDepthIn
        : null;
    reasons.push(
      primaryEmpty && operatorEmpty
        ? "no base depth on file"
        : `base depth is ${staleField!.freshness.tier}`,
    );
    return { value: false, reasons };
  }
  reasons.push(`base ${base.value} in (${base.source}, ${base.freshness.tier}${base.freshness.ageHours != null ? `, ${base.freshness.ageHours} h old` : ""})`);
  if (isCurrent(input.newSnow24hIn)) reasons.push(`${input.newSnow24hIn.value} in of new snow in 24 h (${input.newSnow24hIn.source})`);
  if (input.rating === "poor") {
    reasons.push("PeakCam rating is poor");
    return { value: false, reasons };
  }
  return { value: true, reasons };
}

export function buildConditions(input: ConditionsInput): ConditionsContract {
  const { now, report, opening, operator, hasStation } = input;
  const reportSource = reportFieldSource(report?.source, hasStation);
  const reportAt = report?.updated_at ?? null;
  const rf = <T>(value: T | null | undefined): Field<T> => field<T>(value, reportSource, reportAt, now);

  const operatorAt = operator?.observedAt ?? null;
  const of = <T>(value: T | null | undefined): Field<T> => field<T>(value, "operator", operatorAt, now);

  const statusResult = deriveStatus({ opening, hemisphere: input.hemisphere, localDate: input.localDate, operator, now, timeZone: input.timeZone });
  const status: Field<ResortStatus> =
    statusResult.basis === "feed"
      ? field<ResortStatus>(statusResult.status, statusResult.source, statusResult.observedAt, now)
      : statusResult.basis === "date"
        ? // A date against today's calendar is a current fact with no observation time, like a profile value.
          { value: statusResult.status, source: statusResult.source, observedAt: null, confidence: round2(BASE_CONFIDENCE[statusResult.source]), freshness: { tier: "recent", ageHours: null } }
        : { ...noneField<ResortStatus>(), value: "UNKNOWN", source: "none" };

  const openingAt = opening?.updated_at ?? null;
  const seasonOpening: Field<string> = opening?.confirmed_open
    ? field(opening.confirmed_open, "operator", openingAt, now)
    : opening?.projected_open
      ? field(opening.projected_open, "profile", openingAt, now)
      : noneField<string>();
  const seasonClosing: Field<string> = opening?.closing_date ? field(opening.closing_date, "operator", openingAt, now) : noneField<string>();

  const baseDepthIn = rf<number>(report?.base_depth);
  const operatorBaseDepthIn = of<number>(operator?.baseDepthIn);
  const newSnow24hIn = rf<number>(report?.new_snow_24h);
  const newSnow48hIn = rf<number>(report?.new_snow_48h);
  const sweIn = rf<number>(report?.swe_in);
  const percentOfNormal = report ? field<number>(report.pct_of_normal, hasStation ? "derived" : "none", reportAt, now, { confidence: Math.min(BASE_CONFIDENCE.derived, BASE_CONFIDENCE[reportSource]) }) : noneField<number>();

  const liftsOpen = of<number>(operator?.liftsOpen);
  const liftsTotal: Field<number> = operator?.liftsTotal != null ? of<number>(operator.liftsTotal) : field<number>(input.profile.liftsTotal, "profile", null, now);
  const runsOpen = of<number>(operator?.trailsOpen);
  const runsTotal: Field<number> = operator?.trailsTotal != null ? of<number>(operator.trailsTotal) : field<number>(input.profile.runsTotal, "profile", null, now);
  const surface = of<string>(operator?.surface);

  const quality = report ? snowQualityFromTags(report.tags) : null;
  const snowQuality = quality ? field<SnowQuality>(quality, "derived", reportAt, now, { confidence: Math.min(BASE_CONFIDENCE.derived, BASE_CONFIDENCE[reportSource]) }) : noneField<SnowQuality>();

  const tempF = stationField(input.measured, "tempF", now);
  const windMph = stationField(input.measured, "windMph", now);
  const forecastNext48hCm = input.forecast ? field<number>(input.forecast.next48hCm, "model", input.forecast.issuedAt, now) : noneField<number>();

  const disagreement = depthDisagreement(baseDepthIn.source === "snotel" ? baseDepthIn.value : null, operatorBaseDepthIn.value);
  const verdict = recommendToday({ status, baseDepthIn, operatorBaseDepthIn, newSnow24hIn, rating: report?.auto_cond_rating ?? null });
  const reasons = [...statusResult.reasons, ...verdict.reasons];
  if (disagreement) reasons.push(`station and operator base depths disagree by ${disagreement.differencePct} %; the measured value leads`);

  return {
    status,
    recommendableToday: verdict.value,
    reasons,
    liftDay: statusResult.liftDay ?? null,
    depthDisagreement: disagreement,
    seasonOpening,
    seasonClosing,
    baseDepthIn,
    operatorBaseDepthIn,
    newSnow24hIn,
    newSnow48hIn,
    sweIn,
    liftsOpen,
    liftsTotal,
    runsOpen,
    runsTotal,
    surface,
    snowQuality,
    tempF,
    windMph,
    forecastNext48hCm,
    percentOfNormal,
  };
}

/** `{ fieldName: tier }` for the envelope's `meta.freshness`. */
export function freshnessMap(contract: ConditionsContract): Record<ConditionFieldName, FreshnessTier> {
  const out = {} as Record<ConditionFieldName, FreshnessTier>;
  for (const name of CONDITION_FIELD_NAMES) out[name] = (contract[name] as Field<unknown>).freshness.tier;
  return out;
}

/** The newest observation instant across the populated fields, or null. */
export function newestObservation(contract: ConditionsContract): string | null {
  let best: string | null = null;
  for (const name of CONDITION_FIELD_NAMES) {
    const at = (contract[name] as Field<unknown>).observedAt;
    if (at && (!best || at > best)) best = at;
  }
  return best;
}

/** Human wording for a status value. */
export const STATUS_LABELS: Record<ResortStatus, string> = {
  OPEN: "Open",
  CLOSED_TODAY: "Closed today",
  PRE_SEASON: "Pre-season",
  OFF_SEASON: "Off season",
  UNKNOWN: "Status unknown",
};

/**
 * What the status chip prints. `data.status` stays OPEN while the operator's
 * feed only lists lifts as planned for today (liftDay.state "scheduled": no
 * reading has shown one turning, lib/operator-day.ts); the chip then reads
 * "Opens today" in the outlined style the hub tables use, so the resort page
 * and its hub row say the same thing. Every other case is the plain label.
 */
export function statusChipDisplay(
  status: ResortStatus,
  liftDayState?: string | null,
): { label: string; variant: "status" | "opens-today" } {
  if (status === "OPEN" && liftDayState === "scheduled") return { label: "Opens today", variant: "opens-today" };
  return { label: STATUS_LABELS[status], variant: "status" };
}

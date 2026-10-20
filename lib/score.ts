// ─────────────────────────────────────────────────────────────
// PeakCam Snow Score (parity plan block P7).
//
// One 0–100 number per resort per day, made of five named components whose
// maximums add to 100. Every component returns the points it earned, its
// maximum, a one-line basis an assistant can quote, and the source the
// points rest on, so "why 72" is always answerable. The score is
// algorithmic: a fixed function of measured and modelled inputs, never an
// editorial call, and `scoredBy` says so on every row and document.
//
//   depthVsNormal    30  snowpack against the station's own 1991–2020 median
//                        (SWE, the engine's % of normal); without a normal,
//                        the base depth on a fixed scale, capped at 27
//   recentSnow7d     25  measured or modelled new snow over the last 7 days
//   forecast7d       20  the P4 blend's next-7-day total (median of models)
//   snowQuality      15  days since the last snow day × recent high
//                        temperature × the engine's surface tags
//   operatingStatus  10  the P6 derived status: OPEN full, PRE_SEASON and
//                        CLOSED_TODAY half, OFF_SEASON and UNKNOWN none
//
// The scales are anchored on lib/conditions-engine.ts RATING_THRESHOLDS so
// the score and the four-tier rating agree on what counts as a lot of snow:
// 6 in in 24 h (the engine's "great" line) is half marks for recent snow and
// for the forecast, 12 in in 48 h (the other "great" line) earns most of
// the recent-snow points, 100 % of normal (the engine's "good" line) earns
// 80 % of the depth points and 70 % (its "fair" line) half. The score's own
// four-tier label (`rating`) uses the same great / good / fair / poor words
// as `cond_rating`, cut at SCORE_RATING_LADDER, so every rating consumer
// can read a score row; the engine keeps writing `cond_rating` itself.
//
// Pure: no clock, no database, no Next.js. scripts/score-sync.ts feeds it
// rows; lib/score.test.ts pins the weights, the ladder and every scale.
// ─────────────────────────────────────────────────────────────

import { RATING_THRESHOLDS } from "./conditions-engine";
import type { ResortStatus } from "./conditions-contract";
import { SNOW_DAY_MIN_IN, addDays, daysBetween, deriveNewSnow, normalizeRows, type DailyRow } from "./snow-history";
import type { ConditionRating } from "./types";

export const SCORE_VERSION = "score-v1";
export const SCORED_BY = "algorithmic" as const;
/** Days of history the sparkline and the score-components document carry. */
export const SCORE_HISTORY_DAYS = 30;

export const SCORE_COMPONENT_IDS = ["depthVsNormal", "recentSnow7d", "forecast7d", "snowQuality", "operatingStatus"] as const;
export type ScoreComponentId = (typeof SCORE_COMPONENT_IDS)[number];

export const SCORE_WEIGHTS: Record<ScoreComponentId, number> = {
  depthVsNormal: 30,
  recentSnow7d: 25,
  forecast7d: 20,
  snowQuality: 15,
  operatingStatus: 10,
};

export const SCORE_COMPONENT_LABELS: Record<ScoreComponentId, string> = {
  depthVsNormal: "Depth vs normal",
  recentSnow7d: "New snow, 7 days",
  forecast7d: "Forecast, 7 days",
  snowQuality: "Snow quality",
  operatingStatus: "Operating status",
};

/** Score at or above each cutoff earns the label; below `fair` is `poor`. */
export const SCORE_RATING_LADDER = { great: 75, good: 55, fair: 35 } as const;

export type ScoreSource = "snotel" | "model" | "operator" | "profile" | "derived" | "none";
/** Where a snow report's numbers come from, as the depth and recent-snow components label them. */
export type ReportScoreSource = "snotel" | "model" | "operator" | "derived" | "none";

export interface ScoreComponent {
  points: number;
  max: number;
  /** One line a reader or an assistant can quote: what the points rest on. */
  basis: string;
  source: ScoreSource;
}

export type ScoreComponents = Record<ScoreComponentId, ScoreComponent>;

export interface ScoreInput {
  /** YYYY-MM-DD the score is for. */
  date: string;
  depth: {
    baseDepthIn: number | null;
    /** Publishable percent of normal (lib/resort-copy.ts rule), null when withheld or without a station. */
    pctOfNormal: number | null;
    source: ReportScoreSource;
  };
  recent: {
    /** Sum of daily new snow over the 7 days ending on `date`; null without daily rows. */
    newSnow7dIn: number | null;
    newSnow24hIn: number | null;
    newSnow48hIn: number | null;
    /** Days since the last day with at least SNOW_DAY_MIN_IN; null without rows. */
    daysSinceSnow: number | null;
    source: ReportScoreSource;
  };
  forecast: {
    /** The blend's next-7-day total, inches. */
    total7dIn: number;
    modelCount: number;
  } | null;
  quality: {
    /** Highest daily high over the 3 days ending on `date`, °F; null when unknown. */
    tempMaxF3d: number | null;
    tempSource: "snotel" | "model" | "none";
    /** Engine tags from the report's conditions string (`Powder Day`, `Icy`, `Spring Skiing`, `Rain at Base`). */
    tags: readonly string[];
  };
  status: {
    value: ResortStatus;
    source: "operator" | "profile" | "none";
  };
}

export interface ScoreResult {
  date: string;
  score: number;
  rating: ConditionRating;
  components: ScoreComponents;
  scoredBy: typeof SCORED_BY;
  version: typeof SCORE_VERSION;
}

// ── Helpers ──────────────────────────────────────────────────

const round1 = (v: number): number => Math.round(v * 10) / 10;

/** Piecewise-linear interpolation through sorted anchors; clamped at both ends. */
export function interpolate(x: number, anchors: ReadonlyArray<readonly [number, number]>): number {
  if (!Number.isFinite(x)) return 0;
  if (x <= anchors[0][0]) return anchors[0][1];
  for (let i = 1; i < anchors.length; i++) {
    const [x0, y0] = anchors[i - 1];
    const [x1, y1] = anchors[i];
    if (x <= x1) return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
  }
  return anchors[anchors.length - 1][1];
}

function inches(v: number): string {
  const r = round1(v);
  return `${Number.isInteger(r) ? r : r.toFixed(1)} in.`;
}

const SOURCE_WORD: Record<ReportScoreSource, string> = { snotel: "SNOTEL", model: "model estimate", operator: "resort-reported", derived: "PeakCam blend", none: "none" };

// ── Scales (anchored on RATING_THRESHOLDS) ───────────────────

const T = RATING_THRESHOLDS;

/** % of normal → points: the engine's fair line (70 %) is half, its good line (100 %) is 80 %, 125 % is full. */
export const DEPTH_PCT_ANCHORS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [T.fair.pctOfNormal, SCORE_WEIGHTS.depthVsNormal * 0.5],
  [T.good.pctOfNormal, SCORE_WEIGHTS.depthVsNormal * 0.8],
  [125, SCORE_WEIGHTS.depthVsNormal],
];

/** Base depth without a normal: the fair / good minimum depths, then 60 in earns 27 of 30 (never full without a normal). */
export const DEPTH_NO_NORMAL_CAP = 27;
export const DEPTH_IN_ANCHORS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [T.fair.minDepth, 12],
  [T.good.minDepth, 15],
  [60, DEPTH_NO_NORMAL_CAP],
];

/** New snow over 7 days: the engine's 24 h great line (6 in) is 10, its 48 h great line (12 in) 17, 24 in full. */
export const RECENT_ANCHORS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [T.great.newSnow24h, 10],
  [T.great.newSnow48h, 17],
  [T.great.newSnow48h * 2, SCORE_WEIGHTS.recentSnow7d],
];

/** Forecast over 7 days: 6 in is half, 12 in is 16, 20 in full. */
export const FORECAST_ANCHORS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [T.great.newSnow24h, 10],
  [T.great.newSnow48h, 16],
  [20, SCORE_WEIGHTS.forecast7d],
];

/** Snow-quality factors; the product × 15 is the component. */
export const QUALITY_FRESHNESS: ReadonlyArray<readonly [number, number]> = [
  [1, 1],
  [3, 0.85],
  [7, 0.65],
  [14, 0.45],
  [30, 0.3],
];
export const QUALITY_TEMP_F: ReadonlyArray<readonly [number, number]> = [
  [32, 1],
  [40, 0.85],
  [50, 0.6],
  [60, 0.4],
];
export const QUALITY_TAG_FACTORS: ReadonlyArray<readonly [string, number]> = [
  ["rain at base", 0.5],
  ["icy", 0.6],
  ["spring skiing", 0.75],
];
/** A "Powder Day" tag keeps the freshness factor at least this high. */
export const POWDER_TAG_FLOOR = 0.9;
/** Unknown freshness (no daily rows) with no new snow in the report. */
export const QUALITY_UNKNOWN_FRESHNESS = 0.5;
/** Unknown temperature: a small discount, not a penalty. */
export const QUALITY_UNKNOWN_TEMP = 0.9;

export const STATUS_POINTS: Record<ResortStatus, number> = {
  OPEN: SCORE_WEIGHTS.operatingStatus,
  CLOSED_TODAY: SCORE_WEIGHTS.operatingStatus / 2,
  PRE_SEASON: SCORE_WEIGHTS.operatingStatus / 2,
  OFF_SEASON: 0,
  UNKNOWN: 0,
};

const STATUS_WORD: Record<ResortStatus, string> = {
  OPEN: "open",
  CLOSED_TODAY: "closed today",
  PRE_SEASON: "pre-season",
  OFF_SEASON: "closed for the season",
  UNKNOWN: "status unknown",
};

// ── Components ───────────────────────────────────────────────

export function depthComponent(d: ScoreInput["depth"]): ScoreComponent {
  const max = SCORE_WEIGHTS.depthVsNormal;
  if (d.pctOfNormal != null && d.source === "snotel") {
    return {
      points: round1(interpolate(d.pctOfNormal, DEPTH_PCT_ANCHORS)),
      max,
      basis: `snowpack ${Math.round(d.pctOfNormal)}% of the station's 1991–2020 median for today (SNOTEL)${d.baseDepthIn != null ? `, base ${inches(d.baseDepthIn)}` : ""}`,
      source: "snotel",
    };
  }
  if (d.baseDepthIn != null && d.source !== "none") {
    return {
      points: round1(interpolate(d.baseDepthIn, DEPTH_IN_ANCHORS)),
      max,
      basis: `base ${inches(d.baseDepthIn)} (${SOURCE_WORD[d.source]}); no station normal to compare with, so 60 in. earns ${DEPTH_NO_NORMAL_CAP} of ${max}`,
      source: d.source,
    };
  }
  return { points: 0, max, basis: "no base depth on file", source: "none" };
}

export function recentSnowComponent(r: ScoreInput["recent"]): ScoreComponent {
  const max = SCORE_WEIGHTS.recentSnow7d;
  if (r.source === "none") return { points: 0, max, basis: "no snow report", source: "none" };
  const total = r.newSnow7dIn ?? r.newSnow48hIn ?? r.newSnow24hIn;
  if (total == null) return { points: 0, max, basis: "no new-snow values in the report", source: "none" };
  const window = r.newSnow7dIn != null ? "the last 7 days" : r.newSnow48hIn != null ? "the last 48 h (no daily rows yet)" : "the last 24 h (no daily rows yet)";
  return {
    points: round1(interpolate(Math.max(0, total), RECENT_ANCHORS)),
    max,
    basis: `${inches(Math.max(0, total))} of new snow in ${window} (${SOURCE_WORD[r.source]})`,
    source: r.source,
  };
}

export function forecastComponent(f: ScoreInput["forecast"]): ScoreComponent {
  const max = SCORE_WEIGHTS.forecast7d;
  if (!f) return { points: 0, max, basis: "no stored forecast run", source: "none" };
  return {
    points: round1(interpolate(Math.max(0, f.total7dIn), FORECAST_ANCHORS)),
    max,
    basis: `${inches(Math.max(0, f.total7dIn))} forecast over the next 7 days (median of ${f.modelCount} model${f.modelCount === 1 ? "" : "s"}, Open-Meteo)`,
    source: "model",
  };
}

export function snowQualityComponent(q: ScoreInput["quality"], r: ScoreInput["recent"], d: ScoreInput["depth"]): ScoreComponent {
  const max = SCORE_WEIGHTS.snowQuality;
  if (r.source === "none" && d.source === "none") return { points: 0, max, basis: "no snow report", source: "none" };
  const lower = q.tags.map((t) => t.toLowerCase());
  const powder = lower.some((t) => t.includes("powder"));
  const parts: string[] = [];

  let fresh: number;
  if (r.daysSinceSnow != null) {
    fresh = interpolate(r.daysSinceSnow, QUALITY_FRESHNESS);
    parts.push(r.daysSinceSnow <= 1 ? "snow within the last day" : `${r.daysSinceSnow} days since the last snow day`);
  } else if ((r.newSnow24hIn ?? 0) > 0) {
    fresh = 1;
    parts.push("new snow in the last 24 h");
  } else {
    fresh = QUALITY_UNKNOWN_FRESHNESS;
    parts.push("days since snow unknown");
  }
  if (powder) fresh = Math.max(fresh, POWDER_TAG_FLOOR);

  let temp: number;
  if (q.tempMaxF3d != null) {
    temp = interpolate(q.tempMaxF3d, QUALITY_TEMP_F);
    parts.push(`3-day high ${Math.round(q.tempMaxF3d)}°F (${SOURCE_WORD[q.tempSource]})`);
  } else {
    temp = QUALITY_UNKNOWN_TEMP;
    parts.push("temperature unknown");
  }

  let tag = 1;
  for (const [needle, factor] of QUALITY_TAG_FACTORS) {
    if (lower.some((t) => t.includes(needle))) {
      tag = Math.min(tag, factor);
      parts.push(`tag "${needle}"`);
    }
  }
  if (powder) parts.push('tag "powder day"');

  return { points: round1(max * fresh * temp * tag), max, basis: parts.join(", "), source: "derived" };
}

export function statusComponent(s: ScoreInput["status"]): ScoreComponent {
  const max = SCORE_WEIGHTS.operatingStatus;
  const sourceWord = s.source === "operator" ? "operator feed or confirmed date" : s.source === "profile" ? "projected date" : "nothing on file";
  return { points: STATUS_POINTS[s.value], max, basis: `${STATUS_WORD[s.value]} (${sourceWord})`, source: s.source };
}

// ── Score ────────────────────────────────────────────────────

export function scoreRating(score: number): ConditionRating {
  if (score >= SCORE_RATING_LADDER.great) return "great";
  if (score >= SCORE_RATING_LADDER.good) return "good";
  if (score >= SCORE_RATING_LADDER.fair) return "fair";
  return "poor";
}

export function computeScore(input: ScoreInput): ScoreResult {
  const components: ScoreComponents = {
    depthVsNormal: depthComponent(input.depth),
    recentSnow7d: recentSnowComponent(input.recent),
    forecast7d: forecastComponent(input.forecast),
    snowQuality: snowQualityComponent(input.quality, input.recent, input.depth),
    operatingStatus: statusComponent(input.status),
  };
  const sum = SCORE_COMPONENT_IDS.reduce((s, id) => s + components[id].points, 0);
  const score = Math.max(0, Math.min(100, Math.round(sum)));
  return { date: input.date, score, rating: scoreRating(score), components, scoredBy: SCORED_BY, version: SCORE_VERSION };
}

// ── Inputs from stored rows ──────────────────────────────────

/** The slice of a `snow_reports` row the score reads. */
export interface ScoreReportRow {
  source: string;
  updated_at: string;
  base_depth: number | string | null;
  new_snow_24h: number | string | null;
  new_snow_48h: number | string | null;
  /** Already clamped to the publishable band by the caller. */
  pct_of_normal: number | null;
  tags: readonly string[];
}

/** A `snowpack_daily` row with the temperature columns the quality component reads. */
export interface ScoreDailyRow extends DailyRow {
  tempMaxF: number | null;
}

export interface ScoreRowInput {
  date: string;
  hasStation: boolean;
  report: ScoreReportRow | null;
  /** Daily rows on or before `date` (any order; extra rows are ignored). */
  daily: readonly ScoreDailyRow[];
  /** The summit blend for `date`, when a run was stored: next-7-day total in cm and the model count, plus the first day's high in °C. */
  forecast: { total7dCm: number; modelCount: number; tempMaxC: number | null } | null;
  status: ScoreInput["status"];
}

const num = (v: number | string | null | undefined): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export const cmToIn = (cm: number): number => round1(cm / 2.54);
const cToF = (c: number): number => Math.round((c * 9) / 5 + 32);

/** Sum of daily new snow in [from, to], null when no row in the window carries a value. */
export function sumNewSnow(rows: readonly DailyRow[], from: string, to: string): number | null {
  let total: number | null = null;
  for (const r of rows) {
    if (r.date < from || r.date > to || r.newSnowIn == null) continue;
    total = (total ?? 0) + r.newSnowIn;
  }
  return total == null ? null : round1(total);
}

/** Days from the last snow day (≥ SNOW_DAY_MIN_IN) on or before `date`; null when no row says. */
export function daysSinceSnowDay(rows: readonly DailyRow[], date: string): number | null {
  let last: string | null = null;
  let any = false;
  for (const r of rows) {
    if (r.date > date || r.newSnowIn == null) continue;
    any = true;
    if (r.newSnowIn >= SNOW_DAY_MIN_IN && (last == null || r.date > last)) last = r.date;
  }
  if (!any) return null;
  // No snow day on record inside the rows: as old as the oldest row says, at least.
  if (last == null) {
    const oldest = rows.filter((r) => r.date <= date && r.newSnowIn != null).map((r) => r.date).sort()[0];
    return oldest ? Math.max(daysBetween(oldest, date), 0) : null;
  }
  return Math.max(daysBetween(last, date), 0);
}

/** Highest daily high over the 3 days ending on `date`, °F. */
export function tempMax3d(rows: readonly ScoreDailyRow[], date: string): number | null {
  const from = addDays(date, -2);
  let best: number | null = null;
  for (const r of rows) {
    if (r.date < from || r.date > date || r.tempMaxF == null) continue;
    if (best == null || r.tempMaxF > best) best = r.tempMaxF;
  }
  return best;
}

/** Build the scorer's input for one day from stored rows. Pure; the sync job and the backfill share it. */
export function buildScoreInput(row: ScoreRowInput): ScoreInput {
  const { date, report, hasStation } = row;
  const reportSource = reportScoreSource(report?.source, hasStation);
  const daily = deriveNewSnow(normalizeRows(row.daily.filter((r) => r.date <= date)));
  const tempRows = row.daily.filter((r) => r.date <= date);
  // Only snotel-sync writes daily temperatures; model resorts fall back to the blend's first-day high.
  const stationTemp = tempMax3d(tempRows, date);
  const tempMaxF3d = stationTemp ?? (row.forecast?.tempMaxC != null ? cToF(row.forecast.tempMaxC) : null);
  return {
    date,
    depth: {
      baseDepthIn: num(report?.base_depth),
      pctOfNormal: report?.pct_of_normal ?? null,
      source: reportSource,
    },
    recent: {
      newSnow7dIn: sumNewSnow(daily, addDays(date, -6), date),
      newSnow24hIn: num(report?.new_snow_24h),
      newSnow48hIn: num(report?.new_snow_48h),
      daysSinceSnow: daysSinceSnowDay(daily, date),
      source: reportSource,
    },
    forecast: row.forecast ? { total7dIn: cmToIn(row.forecast.total7dCm), modelCount: row.forecast.modelCount } : null,
    quality: {
      tempMaxF3d,
      tempSource: stationTemp != null ? "snotel" : row.forecast?.tempMaxC != null ? "model" : "none",
      tags: report?.tags ?? [],
    },
    status: row.status,
  };
}

/** Map a `snow_reports.source` onto the score's report source (the same split lib/conditions-contract.ts makes). */
export function reportScoreSource(source: string | null | undefined, hasStation: boolean): ReportScoreSource {
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

// ── Stored rows → components (read path) ─────────────────────

/** Parse a `resort_scores.components` jsonb back into typed components; unknown or malformed ids are rebuilt as empty. */
export function parseStoredComponents(raw: unknown): ScoreComponents {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out = {} as ScoreComponents;
  for (const id of SCORE_COMPONENT_IDS) {
    const c = obj[id] as Partial<ScoreComponent> | undefined;
    const points = typeof c?.points === "number" && Number.isFinite(c.points) ? c.points : 0;
    out[id] = {
      points,
      max: SCORE_WEIGHTS[id],
      basis: typeof c?.basis === "string" ? c.basis : "not recorded",
      source: isSource(c?.source) ? c.source : "none",
    };
  }
  return out;
}

function isSource(v: unknown): v is ScoreSource {
  return v === "snotel" || v === "model" || v === "operator" || v === "profile" || v === "derived" || v === "none";
}

/** Short clauses for the tagline, strongest component first; empty components are skipped. */
export function componentClauses(components: ScoreComponents): string[] {
  return SCORE_COMPONENT_IDS.filter((id) => components[id].source !== "none")
    .sort((a, b) => components[b].points / components[b].max - components[a].points / components[a].max)
    .map((id) => `${SCORE_COMPONENT_LABELS[id].toLowerCase()} ${components[id].points} of ${components[id].max}`);
}

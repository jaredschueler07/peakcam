// ─────────────────────────────────────────────────────────────
// Percent-of-normal leaderboard (/snow-report/percent-of-normal).
//
// Everything the page shows is derived here from the resort list and one
// clock read, so the whole page is a function of its inputs and the data
// rules are unit-tested without a database (lib/percent-of-normal.test.ts).
// The ranking itself is lib/quotable.ts rankPctOfNormal, which applies the
// one publishable rule in lib/resort-copy.ts publishablePctOfNormal: a
// SNOTEL-fed report, inside the 10–300 band, with at least 2 in. of snow
// water equivalent. Nothing outside that rule can reach the page.
// ─────────────────────────────────────────────────────────────

import { isOffSeason } from "./map-utils";
import {
  pctOfNormalSentence,
  rankPctOfNormal,
  type PctOfNormalEntry,
  type Quotable,
  type QuotableResort,
} from "./quotable";
import { PCT_OF_NORMAL_MAX, PCT_OF_NORMAL_MIN, PCT_OF_NORMAL_MIN_SWE_IN } from "./resort-copy";

/**
 * Where the season is, as far as this page is concerned. SNOTEL is a US
 * network, so every station here is in the Northern hemisphere and one
 * month split (lib/map-utils.ts isOffSeason, Nov–Apr in season) covers all
 * of them.
 *
 * - "pre-season": off-season months and nothing publishable yet.
 * - "early": in-season months but still nothing publishable (a dry start).
 * - "season": at least one resort is rankable.
 */
export type PctOfNormalPhase = "pre-season" | "early" | "season";

export interface PctOfNormalPage {
  /** Publishable rows, deepest relative to normal first. */
  ranked: PctOfNormalEntry[];
  /** The dated, quotable sentence for the top of the page. */
  sentence: Quotable;
  /** ISO timestamp the page's data is good as of (the sentence's); null with no reports. */
  asOf: string | null;
  /** Resorts whose latest report is a SNOTEL station reading — the pool the ranking draws from. */
  stationFedCount: number;
  phase: PctOfNormalPhase;
}

// Northern-hemisphere reference for the season split (same constant as
// /opening-dates and /alerts): far enough north that the month split is
// unambiguous, and every SNOTEL station is north of it in spirit.
const NORTHERN_REFERENCE_LAT = 45;

export function countStationFed(resorts: readonly QuotableResort[]): number {
  return resorts.filter((r) => r.snotel_station_id && r.snow_report?.source === "snotel").length;
}

/** Everything the leaderboard page renders, from the resort list and one clock read. */
export function buildPctOfNormalPage(resorts: readonly QuotableResort[], now: Date): PctOfNormalPage {
  const ranked = rankPctOfNormal(resorts);
  const sentence = pctOfNormalSentence(resorts, now);
  const stationFedCount = countStationFed(resorts);
  const phase: PctOfNormalPhase = ranked.length
    ? "season"
    : isOffSeason(NORTHERN_REFERENCE_LAT, now)
      ? "pre-season"
      : "early";
  return { ranked, sentence, asOf: sentence.asOf, stationFedCount, phase };
}

/**
 * The one-paragraph explanation of the rule, written once so the page, the
 * meta description and any agent surface quote the same thresholds. Reads
 * the constants rather than restating them, so a change to the band in
 * lib/resort-copy.ts changes this copy too.
 */
export const PCT_OF_NORMAL_RULE =
  `Percent of normal compares a station's snow water equivalent (SWE) with its own 1991–2020 median for ` +
  `today's date in the water year. A resort is listed only when its latest report is a SNOTEL station reading, ` +
  `the station holds at least ${PCT_OF_NORMAL_MIN_SWE_IN} in. of SWE, and the figure falls between ` +
  `${PCT_OF_NORMAL_MIN}% and ${PCT_OF_NORMAL_MAX}%. Early and late in the season the median is close to zero, ` +
  `so a dusting can read as 900% of normal; those numbers are withheld rather than ranked.`;

/** Season-aware lead copy under the sentence. */
export function phaseCopy(phase: PctOfNormalPhase, stationFedCount: number): string {
  switch (phase) {
    case "pre-season":
      return (
        `It is early in the water year and the ${stationFedCount} SNOTEL-fed resorts PeakCam tracks have not yet ` +
        `banked the ${PCT_OF_NORMAL_MIN_SWE_IN} in. of snow water equivalent this table needs. The leaderboard fills in as ` +
        `November storms arrive; until then the snow report and the opening-dates table are the better reads.`
      );
    case "early":
      return (
        `The season is under way but none of the ${stationFedCount} SNOTEL-fed resorts has reached ` +
        `${PCT_OF_NORMAL_MIN_SWE_IN} in. of snow water equivalent yet, so there is nothing honest to rank. ` +
        `Check back after the next storm cycle.`
      );
    case "season":
      return (
        `Ranked deepest relative to normal first. Every row is a measured station reading; resorts on ` +
        `weather-model estimates, and stations below ${PCT_OF_NORMAL_MIN_SWE_IN} in. of SWE, are left out on purpose.`
      );
  }
}

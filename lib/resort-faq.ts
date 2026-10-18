// ─────────────────────────────────────────────────────────────
// Resort FAQ: the question set behind the visible "Frequently asked" block
// and the FAQPage JSON-LD on /resorts/[slug] (parity plan P2).
//
// Identity questions first (where, how high, how big, when does it open, how
// much snow in a typical season, which pass, base depth today), then the
// operational ones lib/resort-copy.ts already wrote (webcams, provenance,
// conditions, lifts). Every answer is a function of data the page already
// holds; a question whose data is missing is dropped, never answered with a
// placeholder. Pure — `now` is passed in — and unit-tested without a database
// in lib/resort-faq.test.ts.
// ─────────────────────────────────────────────────────────────

import type { ResortWithData } from "./types";
import { buildResortFaq, locationSentence, publishablePctOfNormal, type ResortFaqItem } from "./resort-copy";
import { formatOpeningDate, toPacificDay, type ResortOpening } from "./openings";
import { formatMountainTime, sourceLabel, type StationInfo } from "./quotable";
import {
  formatAcres,
  formatFeet,
  formatInches,
  formatMiles,
  hasSize,
  passList,
  profileNumber,
  profilePasses,
  resolveVerticalFt,
  type ElevationPair,
  type ResortProfile,
} from "./resort-profile";

export type { ResortFaqItem };

/** What the normals table says about a station's typical winter. */
export interface StationNormalsSummary {
  /** Highest 1991–2020 median snow depth across the water year, inches. */
  peakMedianDepthIn: number;
  /** Day of the water year (1 = Oct 1) that median peak falls on. */
  peakDayOfWaterYear: number;
  /** Highest median snow water equivalent, inches, when the table has it. */
  peakMedianSweIn?: number | null;
}

export interface ResortFaqExtras {
  /** Base/summit elevation (profile columns, else resort_metadata). */
  elevation?: ElevationPair | null;
  /** This resort's `resort_openings` row. */
  opening?: ResortOpening | null;
  /** 30-year normals summary for the assigned station. */
  normals?: StationNormalsSummary | null;
  /** NRCS station name and elevation, for the base-depth answer. */
  station?: StationInfo | null;
}

/** Hard ceiling on the visible list; the identity questions come first so they survive the cut. */
export const MAX_FAQ_ITEMS = 9;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Mar 28" for a day of the water year (1 = Oct 1), on a non-leap reference year. */
export function waterYearDayLabel(dayOfWaterYear: number): string {
  const d = new Date(Date.UTC(2001, 9, 1) + (Math.max(1, Math.round(dayOfWaterYear)) - 1) * 86_400_000);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

function coords(lat: number, lng: number): string {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lng >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(2)}° ${ns}, ${Math.abs(lng).toFixed(2)}° ${ew}`;
}

function inchesWord(n: number): string {
  return `${Number.isInteger(n) ? n : Math.round(n * 10) / 10} ${n === 1 ? "inch" : "inches"}`;
}

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

// ── Identity questions ───────────────────────────────────────

function whereQuestion(resort: ResortWithData): ResortFaqItem {
  return {
    question: `Where is ${resort.name}?`,
    answer: `${locationSentence(resort)} Coordinates: ${coords(resort.lat, resort.lng)}.`,
  };
}

function howHighQuestion(resort: ResortWithData, profile: ResortProfile, elevation: ElevationPair): ResortFaqItem | null {
  const vertical = resolveVerticalFt(profile, elevation);
  const parts: string[] = [];
  if (elevation.summitFt != null && elevation.baseFt != null) {
    parts.push(`${resort.name} runs from a base at ${formatFeet(elevation.baseFt)} to a summit at ${formatFeet(elevation.summitFt)}`);
  } else if (elevation.summitFt != null) {
    parts.push(`${resort.name}'s summit is at ${formatFeet(elevation.summitFt)}`);
  } else if (elevation.baseFt != null) {
    parts.push(`${resort.name}'s base sits at ${formatFeet(elevation.baseFt)}`);
  }
  if (vertical != null) parts.push(`${parts.length ? "a" : `${resort.name} has a`} vertical drop of ${formatFeet(vertical)}`);
  if (!parts.length) return null;
  return { question: `How high is ${resort.name}?`, answer: `${parts.join(", ")}.` };
}

function howBigQuestion(resort: ResortWithData, profile: ResortProfile): ResortFaqItem | null {
  if (!hasSize(profile)) return null;
  const runs = profileNumber(profile.runs_total);
  const lifts = profileNumber(profile.lifts_total);
  const acres = profileNumber(profile.skiable_acres);
  const longest = profileNumber(profile.longest_run_mi);
  const clauses: string[] = [];
  if (acres != null) clauses.push(`${formatAcres(acres)} of skiable terrain`);
  if (runs != null) clauses.push(plural(Math.round(runs), "named run"));
  if (lifts != null) clauses.push(plural(Math.round(lifts), "lift"));
  const list = clauses.length === 1 ? clauses[0] : `${clauses.slice(0, -1).join(", ")} and ${clauses[clauses.length - 1]}`;
  let answer = `${resort.name} has ${list}, as published by the resort.`;
  if (longest != null) answer += ` The longest run is ${formatMiles(longest)}.`;
  return { question: `How big is ${resort.name}?`, answer };
}

function seasonLabelFor(opening: ResortOpening): string {
  // "2026-27" → "2026–27"; a Southern row's single year passes through.
  return opening.season.replace(/^(\d{4})-(\d{2})$/, "$1–$2");
}

function whenOpenQuestion(resort: ResortWithData, opening: ResortOpening | null | undefined, now: Date): ResortFaqItem | null {
  if (!opening) return null;
  const today = toPacificDay(now);
  const season = seasonLabelFor(opening);
  const question = `When does ${resort.name} open for the ${season} season?`;
  if (opening.confirmed_open) {
    const date = formatOpeningDate(opening.confirmed_open, "long");
    if (!date) return null;
    const past = opening.confirmed_open <= today;
    let answer = past
      ? `${resort.name} opened for the ${season} season on ${date}, a date the resort announced.`
      : `${resort.name} has announced it will open for the ${season} season on ${date}.`;
    if (opening.closing_date && opening.closing_date >= opening.confirmed_open) {
      const close = formatOpeningDate(opening.closing_date, "long");
      if (close) answer += ` The season is scheduled to close on ${close}.`;
    }
    return { question, answer };
  }
  if (opening.projected_open) {
    const date = formatOpeningDate(opening.projected_open, "long");
    if (!date) return null;
    const past = opening.projected_open < today;
    const answer = past
      ? `${resort.name} was projected to open for the ${season} season around ${date}; the resort has not published a confirmed date, so PeakCam does not report it as open.`
      : `${resort.name} is projected to open for the ${season} season around ${date}. That is a projection, not an announcement; PeakCam marks the date confirmed when the resort says so.`;
    return { question, answer };
  }
  if (opening.closing_date) {
    const close = formatOpeningDate(opening.closing_date, "long");
    if (!close) return null;
    const past = opening.closing_date < today;
    return {
      question: `When is the ${season} season at ${resort.name}?`,
      answer: past
        ? `${resort.name}'s ${season} season closed on ${close}. The next season's dates are listed once the resort announces them.`
        : `${resort.name}'s ${season} season runs until ${close}, the closing date the resort has published.`,
    };
  }
  return null;
}

function typicalSnowQuestion(
  resort: ResortWithData,
  profile: ResortProfile,
  normals: StationNormalsSummary | null | undefined,
  station: StationInfo | null | undefined,
): ResortFaqItem | null {
  const sentences: string[] = [];
  const annual = profileNumber(profile.annual_snowfall_in);
  if (annual != null) {
    sentences.push(`${resort.name} reports an average of ${formatInches(annual)} of snowfall a season (resort-published figure).`);
  }
  if (normals && Number.isFinite(normals.peakMedianDepthIn) && normals.peakMedianDepthIn > 0) {
    const where = station?.name ? `the ${station.name} NRCS station${station.elevationFt != null ? ` (${formatFeet(station.elevationFt)})` : ""}` : "the assigned NRCS station";
    sentences.push(
      `At ${where}, the 1991–2020 median snow depth peaks at ${inchesWord(Math.round(normals.peakMedianDepthIn))} around ${waterYearDayLabel(normals.peakDayOfWaterYear)}; that is depth on the ground at one elevation, not seasonal snowfall.`,
    );
  }
  if (!sentences.length) return null;
  return { question: `How much snow does ${resort.name} get in a typical season?`, answer: sentences.join(" ") };
}

function passQuestion(resort: ResortWithData, profile: ResortProfile): ResortFaqItem | null {
  const passes = profilePasses(profile.passes);
  if (!passes.length) return null;
  const list = passList(passes);
  return {
    question: `Which ski pass covers ${resort.name}?`,
    answer: `${resort.name} is on the ${list}${passes.length === 1 ? "" : " passes"}, per the ${passes.length === 1 ? "pass's" : "passes'"} published resort lists. Blackout days and partner-day limits vary by pass tier; check the pass site before you go.`,
  };
}

function baseDepthQuestion(resort: ResortWithData, station: StationInfo | null | undefined): ResortFaqItem | null {
  const snow = resort.snow_report;
  if (!snow || snow.base_depth == null || !Number.isFinite(Number(snow.base_depth))) return null;
  const when = formatMountainTime(snow.updated_at);
  if (!when) return null;
  const base = Number(snow.base_depth);
  const n24 = snow.new_snow_24h == null ? null : Number(snow.new_snow_24h);
  const sentences: string[] = [];
  if (snow.source === "snotel") {
    const where = station?.name ? ` at the ${station.name} station${station.elevationFt != null ? ` (${formatFeet(station.elevationFt)})` : ""}` : "";
    sentences.push(`As of ${when}, the SNOTEL sensor${where} measures a ${inchesWord(base)} base at ${resort.name}.`);
  } else {
    sentences.push(`As of ${when}, the latest report for ${resort.name} puts the base at ${inchesWord(base)} (${sourceLabel(snow.source)}).`);
  }
  if (n24 != null && Number.isFinite(n24) && n24 > 0) sentences.push(`${inchesWord(n24)} of new snow fell in the last 24 hours.`);
  const pct = publishablePctOfNormal(snow, Boolean(resort.snotel_station_id));
  if (pct != null) sentences.push(`Snow water equivalent is ${pct}% of the station's 1991–2020 median for today's date.`);
  return { question: `What is the base depth at ${resort.name} today?`, answer: sentences.join(" ") };
}

// ── Assembly ─────────────────────────────────────────────────

/** Questions from lib/resort-copy.ts this module supersedes (same subject, dated answer here). */
const SUPERSEDED = /^How much snow does .* have right now\?$/;

function rank(item: ResortFaqItem): number {
  if (/^Does .* have live webcams\?$/.test(item.question)) return 0;
  if (/snow data come from\?$/.test(item.question)) return 1;
  return 2;
}

/**
 * The full FAQ for a resort page, identity questions first, capped at
 * MAX_FAQ_ITEMS. Never returns an entry with an empty question or answer.
 */
export function buildResortFaqPage(resort: ResortWithData, now: Date, extras: ResortFaqExtras = {}): ResortFaqItem[] {
  const profile: ResortProfile = resort;
  const elevation: ElevationPair = extras.elevation ?? { baseFt: null, summitFt: null };
  const identity: Array<ResortFaqItem | null> = [
    whereQuestion(resort),
    howHighQuestion(resort, profile, elevation),
    howBigQuestion(resort, profile),
    whenOpenQuestion(resort, extras.opening, now),
    typicalSnowQuestion(resort, profile, extras.normals, extras.station),
    passQuestion(resort, profile),
    baseDepthQuestion(resort, extras.station),
  ];
  // Operational questions, provenance promoted: "where does the data come
  // from" is the one answer engines ask before quoting a number, so it must
  // survive the MAX_FAQ_ITEMS cut ahead of the conditions and lift entries.
  const operational = buildResortFaq(resort, now)
    .filter((item) => !SUPERSEDED.test(item.question))
    .sort((a, b) => rank(a) - rank(b));
  const seen = new Set<string>();
  const out: ResortFaqItem[] = [];
  for (const item of [...identity, ...operational]) {
    if (!item || !item.question.trim() || !item.answer.trim()) continue;
    if (seen.has(item.question)) continue;
    seen.add(item.question);
    out.push(item);
    if (out.length >= MAX_FAQ_ITEMS) break;
  }
  return out;
}

/** FAQPage JSON-LD for a list, or null when there is nothing to publish. */
export function faqPageLd(faq: readonly ResortFaqItem[]): Record<string, unknown> | null {
  if (!faq.length) return null;
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map((f) => ({
      "@type": "Question",
      name: f.question,
      acceptedAnswer: { "@type": "Answer", text: f.answer },
    })),
  };
}


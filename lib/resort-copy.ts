import type { ResortWithData } from "@/lib/types";
import { isOffSeason } from "@/lib/map-utils";
import { parseConditions } from "@/lib/format";

/**
 * Data-derived prose for resort pages: an "about" paragraph and a FAQ block
 * synthesized from live DB fields. Pure functions — the page passes `now` so
 * output is deterministic per render and testable.
 *
 * Rules that keep this from reading as generated filler:
 * - Every sentence carries a fact from the database. No sentence exists only
 *   to pad ("nestled in the heart of...", "offers something for everyone").
 * - Missing data drops the sentence; it is never papered over with vagueness.
 * - Provenance is branched, not blurred: a resort with an assigned NRCS
 *   station (SNOTEL or SCAN) gets sensor wording; a resort without one
 *   (snotel_station_id null → scripts/model-sync.ts, Open-Meteo) says its
 *   numbers are model estimates. Claiming SNOTEL for Whistler is how a site
 *   loses an answer engine's trust.
 */

export interface ResortFaqItem {
  question: string;
  answer: string;
}

const COUNTRY_NAMES: Record<string, string> = {
  US: "the United States",
  CA: "Canada",
  CL: "Chile",
  AR: "Argentina",
};

/** Only the codes present in data/resorts.csv; unknown codes pass through. */
const STATE_NAMES: Record<string, string> = {
  AK: "Alaska", AZ: "Arizona", CA: "California", CO: "Colorado", ID: "Idaho",
  ME: "Maine", MI: "Michigan", MN: "Minnesota", MT: "Montana", NH: "New Hampshire",
  NM: "New Mexico", NV: "Nevada", NY: "New York", OR: "Oregon", PA: "Pennsylvania",
  UT: "Utah", VT: "Vermont", WA: "Washington", WI: "Wisconsin", WY: "Wyoming",
  BC: "British Columbia", AB: "Alberta", ON: "Ontario", QC: "Quebec",
};

const inches = (n: number) => `${n} ${n === 1 ? "inch" : "inches"}`;

/** Geographic features take "the" ("the Wasatch Range"); places don't ("Summit County", "Lake Tahoe"). */
const REGION_NEEDS_THE =
  /\b(Mountains?|Range|Rockies|Sierra|Andes|Cascades|Adirondacks|Catskills|Berkshires|Poconos|Wasatch|Lake District)\b/;

function regionPhrase(region: string): string {
  return REGION_NEEDS_THE.test(region) ? `the ${region}` : region;
}

function locationSentence(resort: ResortWithData): string {
  const countryName = COUNTRY_NAMES[resort.country] ?? resort.country;
  // Andes rows store the country name in `state`; saying it twice reads as a
  // mail-merge bug ("Central Andes, Chile, Chile").
  if (resort.state === countryName || resort.state === resort.country) {
    return `${resort.name} is a ski resort in ${regionPhrase(resort.region)}, ${countryName}.`;
  }
  const stateName = STATE_NAMES[resort.state] ?? resort.state;
  // "the Colorado Rockies, Colorado" repeats itself — the region already
  // places the resort when it contains the state's name.
  if (resort.region.includes(stateName)) {
    return `${resort.name} is a ski resort in ${regionPhrase(resort.region)}.`;
  }
  return `${resort.name} is a ski resort in ${regionPhrase(resort.region)}, ${stateName}.`;
}

function hasStation(resort: ResortWithData): boolean {
  return Boolean(resort.snotel_station_id);
}

function trendPhrase(trend: string | null | undefined): string | null {
  switch (trend) {
    case "rising":
      return "the snowpack has been building over the past week";
    case "falling":
      return "the snowpack has been shrinking over the past week";
    case "stable":
      return "the snowpack has held steady over the past week";
    default:
      return null;
  }
}

/**
 * Percent-of-normal compares SWE against the station's 1991–2020 median for
 * this day of the water year. Early and late season the median is near zero
 * and the ratio explodes (400% of nothing) — suppress it outside a sane band.
 */
function pctOfNormalSentence(resort: ResortWithData): string | null {
  const pct = resort.snow_report?.pct_of_normal;
  if (!hasStation(resort) || pct == null || pct < 10 || pct > 300) return null;
  return `Snow water equivalent is ${pct}% of this station's 1991–2020 median for today's date.`;
}

export function buildAboutParagraphs(resort: ResortWithData, now: Date): string[] {
  const snow = resort.snow_report;
  const offSeason = isOffSeason(resort.lat, now);
  const camCount = resort.cams.filter((c) => c.is_active).length;

  const p1: string[] = [locationSentence(resort)];
  const camClause =
    camCount > 0 ? `${camCount} webcam${camCount === 1 ? "" : "s"} here, plus ` : "";
  if (hasStation(resort)) {
    p1.push(
      `PeakCam tracks ${camClause}snow depth from the assigned NRCS station, updated every six hours.`,
    );
  } else {
    p1.push(
      camCount > 0
        ? `PeakCam tracks ${camCount} webcam${camCount === 1 ? "" : "s"} here. Snow figures on this page are weather-model estimates, not ground-sensor readings.`
        : `Snow figures on this page are weather-model estimates, not ground-sensor readings.`,
    );
  }

  const p2: string[] = [];
  if (offSeason) {
    // isOffSeason is a blunt Nov–Apr / May–Oct hemisphere split. A mountain
    // spinning lifts in May (Mammoth, Killington) can still show a real base,
    // so the wording defers to the data instead of denying it.
    p2.push(
      `PeakCam treats this as the off-season here; if the mountain is still operating, the numbers and cams above are the thing to trust.`,
    );
  } else if (snow) {
    if (snow.base_depth != null) {
      p2.push(`The measured base depth is ${inches(snow.base_depth)}.`);
    }
    if (snow.new_snow_24h != null && snow.new_snow_24h > 0) {
      p2.push(`${inches(snow.new_snow_24h)} of new snow fell in the last 24 hours.`);
    }
    const pctSentence = pctOfNormalSentence(resort);
    if (pctSentence) p2.push(pctSentence);
    const trend = trendPhrase(snow.trend_7d);
    if (trend) p2.push(`Sensor history shows ${trend}.`);
    if (snow.trails_open != null && snow.trails_total != null) {
      const noun = snow.trails_total === 1 ? "trail" : "trails";
      p2.push(`Resort-reported: ${snow.trails_open} of ${snow.trails_total} ${noun} open.`);
    }
  }

  return [p1.join(" "), p2.join(" ")].filter((p) => p.length > 0);
}

export function buildResortFaq(resort: ResortWithData, now: Date): ResortFaqItem[] {
  const snow = resort.snow_report;
  const offSeason = isOffSeason(resort.lat, now);
  const camCount = resort.cams.filter((c) => c.is_active).length;
  const station = hasStation(resort);
  const faq: ResortFaqItem[] = [];

  // Q1 — snow right now. The question every answer engine gets asked.
  if (offSeason) {
    const baseNote =
      snow?.base_depth != null && snow.base_depth >= 20
        ? ` The latest reading still shows a ${inches(snow.base_depth)} base — if lifts are running late-season, that number is current.`
        : "";
    faq.push({
      question: `How much snow does ${resort.name} have right now?`,
      answer: `${resort.name} is outside its usual season, so current readings reflect off-season conditions.${baseNote} PeakCam updates this page year-round.`,
    });
  } else if (snow?.base_depth != null) {
    const sentences = [`${resort.name} has a measured base depth of ${inches(snow.base_depth)}.`];
    if (snow.new_snow_24h != null && snow.new_snow_24h > 0) {
      sentences.push(`${inches(snow.new_snow_24h)} fell in the last 24 hours.`);
    }
    const pctSentence = pctOfNormalSentence(resort);
    if (pctSentence) sentences.push(pctSentence);
    sentences.push(
      station
        ? `The reading comes from the assigned NRCS station and updates every six hours.`
        : `The figures are weather-model estimates, updated every six hours.`,
    );
    faq.push({
      question: `How much snow does ${resort.name} have right now?`,
      answer: sentences.join(" "),
    });
  }

  // Q2 — webcams. `embed_type` mixes live video, refreshing stills, and
  // link-outs; "streams" would oversell the stills.
  if (camCount > 0) {
    const liveVideo = resort.cams.filter(
      (c) => c.is_active && (c.embed_type === "youtube" || c.embed_type === "iframe"),
    ).length;
    const kind =
      liveVideo === camCount
        ? "live video"
        : liveVideo > 0
          ? "a mix of live video and refreshing stills"
          : "regularly refreshing stills";
    faq.push({
      question: `Does ${resort.name} have live webcams?`,
      answer: `Yes — this page has ${camCount} webcam${camCount === 1 ? "" : "s"} for ${resort.name} (${kind}), free and without an account.`,
    });
  }

  // Q3 — conditions today, only when a real narrative exists. A bare tag list
  // ("powder,fresh") parses to a null narrative and is never published here.
  const { narrative } = parseConditions(snow?.conditions);
  if (!offSeason && narrative) {
    faq.push({
      question: `What are the ski conditions at ${resort.name} today?`,
      answer: narrative,
    });
  }

  // Q4 — lifts/trails. Not on the sensor path, so it is labeled as the
  // resort's own count, and the verb agrees when the count is 1.
  if (!offSeason && snow?.lifts_open != null && snow?.lifts_total != null) {
    const liftNoun = snow.lifts_total === 1 ? "lift" : "lifts";
    const trails =
      snow.trails_open != null && snow.trails_total != null
        ? ` and ${snow.trails_open} of ${snow.trails_total} ${snow.trails_total === 1 ? "trail" : "trails"}`
        : "";
    const verb = snow.lifts_total === 1 && !trails ? "is" : "are";
    faq.push({
      question: `How many lifts are running at ${resort.name}?`,
      answer: `Resort-reported: ${snow.lifts_open} of ${snow.lifts_total} ${liftNoun}${trails} ${verb} open at ${resort.name}.`,
    });
  }

  // Q5 — data provenance: the answer engines' "cite your source" question.
  faq.push(
    station
      ? {
          question: `Where does ${resort.name}'s snow data come from?`,
          answer: `From the NRCS snow-telemetry station assigned to ${resort.name}. PeakCam syncs it every six hours and runs range and spike quality checks. When at least two unflagged on-mountain user reports land within 24 hours, they can move the condition rating by one tier — they never change the depth number. Sensor readings can differ from the resort's own report, which usually quotes the upper mountain.`,
        }
      : {
          question: `Where does ${resort.name}'s snow data come from?`,
          answer: `${resort.name} has no NRCS telemetry station, so depth and new-snow figures here are weather-model estimates (Open-Meteo), updated every six hours. They are a good storm signal but will not match an on-the-ground measurement exactly.`,
        },
  );

  return faq;
}

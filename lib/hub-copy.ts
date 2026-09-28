import type { Cam, ConditionRating, ResortWithData } from "@/lib/types";
import { isOffSeason } from "@/lib/map-utils";
import { POPULAR_RANK } from "@/lib/popular-resorts";
import { hubSummary, stateLabel, type Hub, type HubSummary } from "@/lib/hubs";

/**
 * Data-derived copy and page-model helpers for the /ski-cams hub pages
 * (growth-audit §2.3 A/B): the `<meta name="description">`, the "about"
 * paragraphs, the three FAQ answers, the table order and the featured-cam
 * pick. Pure functions over the resort list the ISR page already holds — the
 * page passes `now` in, so output is deterministic per render and testable
 * under plain node:test (lib/hub-copy.test.ts).
 *
 * The rules are lib/resort-copy.ts's, applied to a group:
 * - Every sentence carries a number or a name from the database. Nothing
 *   exists only to pad.
 * - Missing data drops the sentence; it is never papered over.
 * - Provenance is counted, not blurred: a hub says how many of its resorts
 *   read from an NRCS station and how many are weather-model estimates.
 * - Off-season (isOffSeason on the hub's own hemisphere) the live numbers
 *   read as a dead listing, so the copy points at the coming season instead
 *   and only surfaces a base that is still worth reporting.
 *
 * The two hand-written blocks — HUB_EDITORIAL and the opening windows — are
 * evergreen on purpose: no snow numbers, no dates that rot, "usually" and
 * "typically" where the truth varies by year.
 */

export interface HubFaqItem {
  question: string;
  answer: string;
}

/** Google cuts descriptions at roughly 155–160 characters; the test holds every hub at this line. */
export const META_DESCRIPTION_MAX = 160;

/** Reference latitude for an empty hub — far enough north that isOffSeason's month split is unambiguous. */
const NORTHERN_REFERENCE_LAT = 45;

const inches = (n: number) => `${n} ${n === 1 ? "inch" : "inches"}`;
const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

// ── Ordering ─────────────────────────────────────────────────────────────────

/** Lower-case, accent-stripped text so "Las Leñas" sorts with the L's on every machine. */
function fold(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function compareName(a: string, b: string): number {
  const fa = fold(a);
  const fb = fold(b);
  if (fa !== fb) return fa < fb ? -1 : 1;
  return a === b ? 0 : a < b ? -1 : 1;
}

const RATING_RANK: Record<ConditionRating, number> = { great: 3, good: 2, fair: 1, poor: 0 };

function ratingRank(rating: unknown): number {
  return typeof rating === "string" && rating in RATING_RANK ? RATING_RANK[rating as ConditionRating] : -1;
}

function popularRank(slug: string): number {
  return POPULAR_RANK[slug] ?? Number.MAX_SAFE_INTEGER;
}

function baseDepth(resort: ResortWithData): number {
  const value = resort.snow_report?.base_depth;
  return value != null && Number.isFinite(value) ? value : -1;
}

/**
 * Table order for a hub page: deepest base first, resorts with no report
 * last, ties broken by name so the order never flips between renders.
 */
export function sortHubTable<T extends Pick<ResortWithData, "name" | "snow_report">>(resorts: readonly T[]): T[] {
  return [...resorts].sort(
    (a, b) => (b.snow_report?.base_depth ?? -1) - (a.snow_report?.base_depth ?? -1) || compareName(a.name, b.name),
  );
}

/**
 * The resorts a description names, most recognisable first: the curated
 * POPULAR_SLUGS order, then the resorts with the most cams, then alphabetical.
 */
function rankForNames(resorts: readonly ResortWithData[]): ResortWithData[] {
  return [...resorts].sort(
    (a, b) =>
      popularRank(a.slug) - popularRank(b.slug) ||
      activeCams(b).length - activeCams(a).length ||
      compareName(a.name, b.name),
  );
}

// ── Season ───────────────────────────────────────────────────────────────────

/** Mean latitude of the hub — every hub is one hemisphere, so this only decides north vs south. */
export function hubLatitude(resorts: readonly Pick<ResortWithData, "lat">[]): number {
  if (resorts.length === 0) return NORTHERN_REFERENCE_LAT;
  return resorts.reduce((sum, resort) => sum + resort.lat, 0) / resorts.length;
}

export function hubOffSeason(resorts: readonly Pick<ResortWithData, "lat">[], now: Date): boolean {
  return isOffSeason(hubLatitude(resorts), now);
}

/**
 * The season a hub is waiting for while hubOffSeason() is true. Northern hubs
 * sit out May–Oct ahead of a "2026–27" winter; Andes seasons run May–Oct
 * inside one calendar year, so a Nov–Apr off-season precedes "2027". Same
 * rule as lib/resort-copy.ts, on the hub's latitude.
 */
export function upcomingHubSeasonLabel(resorts: readonly Pick<ResortWithData, "lat">[], now: Date): string {
  const year = now.getFullYear();
  if (hubLatitude(resorts) >= 0) return `${year}–${String((year + 1) % 100).padStart(2, "0")}`;
  return String(now.getMonth() + 1 >= 11 ? year + 1 : year);
}

// ── Counting ─────────────────────────────────────────────────────────────────

function activeCams(resort: Pick<ResortWithData, "cams">): Cam[] {
  return resort.cams.filter((cam) => cam.is_active);
}

export interface HubCamStats {
  /** Resorts with at least one active cam. */
  withCams: number;
  /** Active cams across the hub. */
  total: number;
  /** Active cams that are live video (youtube or iframe) rather than stills or link-outs. */
  liveVideo: number;
}

export function hubCamStats(resorts: readonly Pick<ResortWithData, "cams">[]): HubCamStats {
  let withCams = 0;
  let total = 0;
  let liveVideo = 0;
  for (const resort of resorts) {
    const cams = activeCams(resort);
    if (cams.length > 0) withCams += 1;
    total += cams.length;
    liveVideo += cams.filter((cam) => cam.embed_type === "youtube" || cam.embed_type === "iframe").length;
  }
  return { withCams, total, liveVideo };
}

export interface HubProvenance {
  /** Resorts with an assigned NRCS SNOTEL/SCAN station (scripts/snotel-sync.ts). */
  sensor: number;
  /** Resorts fed by the Open-Meteo model (scripts/model-sync.ts). */
  model: number;
  /** True when no resort in the hub is in the United States — the NRCS network stops at the border. */
  outsideUs: boolean;
}

export function hubProvenance(resorts: readonly Pick<ResortWithData, "snotel_station_id" | "country">[]): HubProvenance {
  const sensor = resorts.filter((resort) => Boolean(resort.snotel_station_id)).length;
  return {
    sensor,
    model: resorts.length - sensor,
    outsideUs: resorts.length > 0 && resorts.every((resort) => resort.country !== "US"),
  };
}

/**
 * Label for the summary strip's timestamp. "Sensor" is only honest when every
 * resort reads from an NRCS station; a hub of Open-Meteo resorts (Chile) is a
 * model sync, and a mixed hub gets the neutral word.
 */
export function hubSyncLabel(resorts: readonly Pick<ResortWithData, "snotel_station_id" | "country">[]): string {
  const { sensor, model } = hubProvenance(resorts);
  if (sensor > 0 && model === 0) return "Last sensor sync";
  if (sensor === 0 && model > 0) return "Last model sync";
  return "Last data sync";
}

// ── Featured cams ────────────────────────────────────────────────────────────

export interface FeaturedHubCam {
  resort: ResortWithData;
  cam: Cam;
}

/** A YouTube cam the tile can actually play: active, not health-disabled, with a real 11-char id. */
function isPlayableYoutube(cam: Cam): boolean {
  return cam.embed_type === "youtube" && cam.is_active && !cam.auto_disabled && /^[\w-]{11}$/.test(cam.youtube_id ?? "");
}

/**
 * The first playable YouTube cam of the best-rated resorts, `limit` tiles.
 * Best rating first, then deepest base, then the curated popular order, then
 * name — so an off-season hub (every resort "poor", every base 0) still
 * features Vail and Breckenridge rather than whoever sorts first
 * alphabetically. Resorts without a YouTube cam are skipped, not counted.
 */
export function featuredHubCams(resorts: readonly ResortWithData[], limit = 3): FeaturedHubCam[] {
  const ranked = [...resorts].sort(
    (a, b) =>
      ratingRank(b.cond_rating) - ratingRank(a.cond_rating) ||
      baseDepth(b) - baseDepth(a) ||
      popularRank(a.slug) - popularRank(b.slug) ||
      compareName(a.name, b.name),
  );
  const featured: FeaturedHubCam[] = [];
  for (const resort of ranked) {
    const cam = resort.cams.find(isPlayableYoutube);
    if (!cam) continue;
    featured.push({ resort, cam });
    if (featured.length >= limit) break;
  }
  return featured;
}

// ── Phrasing ─────────────────────────────────────────────────────────────────

/**
 * Geographic features take "the" ("the Wasatch Range", "the Appalachians");
 * places don't ("Summit County", "Lake Tahoe", "Big Cottonwood Canyon").
 * Plural "Mountains" only: "Rib Mountain" is a place, not a range.
 */
const REGION_NEEDS_THE =
  /\b(Mountains|Range|Rockies|Sierra|Andes|Cascades|Adirondacks|Catskills|Berkshires|Poconos|Wasatch|Lake District|Sangre de Cristo|Appalachians|Highlands|Peaks|Valley|Kingdom|Shore|Peninsula|Mesa|Thompson-Okanagan)\b/;

function regionPhrase(region: string): string {
  return REGION_NEEDS_THE.test(region) ? `the ${region}` : region;
}

/**
 * "in Colorado", "around Lake Tahoe", "on Mt. Hood", "in the Green Mountains"
 * — the locative every paragraph and answer reuses, so a region hub never
 * reads "in Lake Tahoe".
 */
export function inHub(hub: Hub): string {
  if (hub.kind !== "region") return `in ${hub.label}`;
  if (/^Lake\b/.test(hub.label)) return `around ${hub.label}`;
  if (/^(Mt\.?|Mount)\s/.test(hub.label)) return `on ${hub.label}`;
  return `in ${regionPhrase(hub.label)}`;
}

/** "Colorado ski resorts" / "Lake Tahoe ski resorts" — the noun phrase for questions and counts. */
function hubResortsNoun(hub: Hub): string {
  return `${hub.label} ski resort`;
}

/**
 * `<title>` per growth-audit §2.3: state-family hubs promise "Resorts Live",
 * region hubs are the shorter head-term form. `absolute` at the call site so
 * the root "%s | PeakCam" template does not add the brand twice.
 */
export function hubTitle(hub: Hub, count: number): string {
  const resorts = plural(count, "Resort");
  return hub.kind === "region"
    ? `${hub.label} Ski Webcams & Snow Report — ${resorts} | PeakCam`
    : `${hub.label} Ski Resort Webcams & Snow Report — ${resorts} Live | PeakCam`;
}

/** The share-card title: the same promise without the count or the brand. */
export function hubShareTitle(hub: Hub): string {
  return hub.kind === "region"
    ? `${hub.label} Ski Webcams & Snow Report`
    : `${hub.label} Ski Resort Webcams & Snow Report`;
}

// ── Meta description ─────────────────────────────────────────────────────────

/**
 * Appends resort names to `lead` one at a time while the whole description
 * stays within META_DESCRIPTION_MAX, then closes the clause. With no room for
 * even one name the clause is dropped rather than cut mid-word. "and more"
 * only appears when names were left out.
 */
function fitNames(lead: string, tail: string, names: readonly string[], total: number): string {
  const compose = (shown: readonly string[]) =>
    shown.length === 0
      ? `${lead}.`
      : `${lead}: ${shown.join(", ")}${shown.length < total ? " and more" : ""}.`;
  const shown: string[] = [];
  for (const name of names) {
    if (`${compose([...shown, name])}${tail}`.length > META_DESCRIPTION_MAX) break;
    shown.push(name);
  }
  return `${compose(shown)}${tail}`;
}

/**
 * `<meta name="description">` for a hub page. Off-season the numbers are all
 * zero and would read as a dead listing, so the copy names the recognisable
 * resorts and the coming season; in season it leads with the deepest base
 * when that fits. Same wording rules as buildResortMetaDescription, ≤160
 * chars for every hub in data/resorts.csv (lib/hub-copy.test.ts).
 */
export function buildHubMetaDescription(hub: Hub, resorts: readonly ResortWithData[], now: Date): string {
  const n = resorts.length;
  const names = rankForNames(resorts).map((resort) => resort.name);
  const hasCams = hubCamStats(resorts).total > 0;

  if (hubOffSeason(resorts, now)) {
    const lead = hasCams
      ? `${hub.label} ski resort webcams and snow report — ${plural(n, "resort")}`
      : `${hub.label} ski resort snow report and conditions — ${plural(n, "resort")}`;
    const tail = ` Opens ${upcomingHubSeasonLabel(resorts, now)} — first snow and forecasts on PeakCam.`;
    return fitNames(lead, tail, names, n);
  }

  const lead = hasCams
    ? `Live webcams and snow conditions for ${plural(n, hubResortsNoun(hub))}`
    : `Snow conditions for ${plural(n, hubResortsNoun(hub))}`;
  const promise = " Base depth, new snow, forecasts, free powder alerts.";
  const deepest = hubSummary(resorts).deepestBase;
  const deepestSentence = deepest ? ` Deepest base ${deepest.value}″ at ${deepest.name}.` : "";
  // The number beats the name list when both cannot fit.
  const tail = `${lead}.${deepestSentence}${promise}`.length <= META_DESCRIPTION_MAX ? `${deepestSentence}${promise}` : promise;
  return fitNames(lead, tail, names, n);
}

// ── About paragraphs ─────────────────────────────────────────────────────────

interface RegionCount {
  label: string;
  count: number;
}

/** Distinct regions in the hub, biggest first, ties alphabetical. Blank regions are dropped. */
function regionBreakdown(resorts: readonly ResortWithData[]): RegionCount[] {
  const counts = new Map<string, number>();
  for (const resort of resorts) {
    const region = (resort.region ?? "").trim();
    if (!region) continue;
    counts.set(region, (counts.get(region) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || compareName(a.label, b.label));
}

/** Distinct `state` values in the hub, biggest first, as "10 in California". */
function stateBreakdown(resorts: readonly ResortWithData[]): RegionCount[] {
  const counts = new Map<string, number>();
  for (const resort of resorts) {
    const state = (resort.state ?? "").trim();
    if (!state) continue;
    counts.set(state, (counts.get(state) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([code, count]) => ({ label: stateLabel(code), count }))
    .sort((a, b) => b.count - a.count || compareName(a.label, b.label));
}

function joinList(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

const REGIONS_SHOWN = 4;

/** Sentence 1 of paragraph 1: how many resorts, and how they spread across regions or states. */
function coverageSentence(hub: Hub, resorts: readonly ResortWithData[]): string {
  const n = resorts.length;
  if (n === 1) {
    const only = resorts[0];
    const region = (only.region ?? "").trim();
    const where = region ? `, in ${regionPhrase(region)}` : "";
    return `PeakCam tracks one ski resort ${inHub(hub)}: ${only.name}${where}.`;
  }

  if (hub.kind === "region") {
    const states = stateBreakdown(resorts);
    if (states.length > 1) {
      const parts = states.map((state) => `${state.count} in ${state.label}`);
      return `PeakCam tracks ${plural(n, "ski resort")} ${inHub(hub)}, spanning ${joinList(parts)}.`;
    }
    const state = states[0]?.label;
    const place = state && !hub.label.includes(state) ? `${inHub(hub)}, ${state}` : inHub(hub);
    return `PeakCam tracks ${plural(n, "ski resort")} ${place}.`;
  }

  const regions = regionBreakdown(resorts);
  if (regions.length === 0) return `PeakCam tracks ${plural(n, "ski resort")} ${inHub(hub)}.`;
  if (regions.length === 1) {
    return `PeakCam tracks ${plural(n, "ski resort")} ${inHub(hub)}, all of them in ${regionPhrase(regions[0].label)}.`;
  }
  const shown = regions.slice(0, REGIONS_SHOWN).map((region) => `${region.label} (${region.count})`);
  // A complete list gets a proper "A, B and C"; a truncated one ends "…, C and others".
  const list = regions.length > REGIONS_SHOWN ? `${shown.join(", ")} and others` : joinList(shown);
  return `PeakCam tracks ${plural(n, "ski resort")} ${inHub(hub)} across ${regions.length} regions: ${list}.`;
}

/** Sentence 2 of paragraph 1: webcam coverage, counted from active cams only. */
function camsSentence(resorts: readonly ResortWithData[]): string {
  const n = resorts.length;
  const { withCams, total } = hubCamStats(resorts);
  if (total === 0) return "None of them has a working webcam feed on PeakCam yet; the snow data is tracked all the same.";
  if (n === 1) return `It has ${plural(total, "live webcam")} on PeakCam.`;
  if (total === 1) return `${withCams} of them has a live webcam on PeakCam.`;
  if (withCams === n) return `Every one of them has live webcams on PeakCam — ${plural(total, "cam")} in all.`;
  return `${withCams} of them ${withCams === 1 ? "has" : "have"} live webcams on PeakCam — ${plural(total, "cam")} in all.`;
}

/** Paragraph 2: where the numbers come from, counted, never blurred. */
function provenanceParagraph(hub: Hub, resorts: readonly ResortWithData[]): string {
  const n = resorts.length;
  const { sensor, model, outsideUs } = hubProvenance(resorts);
  if (n === 0) return "";

  if (model === 0) {
    const subject = n === 1 ? "It has" : `All ${n} have`;
    return `${subject} an assigned NRCS SNOTEL or SCAN station, so the base depth and new-snow figures here are sensor readings — synced every six hours and run through range and spike checks — rather than numbers copied from resort marketing.`;
  }

  if (sensor === 0) {
    const subject = n === 1 ? `${resorts[0].name} has no` : `None of the ${plural(n, hubResortsNoun(hub))} has an`;
    const why = outsideUs ? " — the network only covers the United States" : "";
    return `${subject} NRCS telemetry station${why}, so every snow figure on this page is a weather-model estimate (Open-Meteo), updated every six hours. That is a good storm signal, not an on-the-ground measurement, and each resort page says so.`;
  }

  return `${sensor} of the ${n} have an assigned NRCS SNOTEL or SCAN station, so their base depth and new snow are sensor readings synced every six hours; the other ${model} ${model === 1 ? "has" : "have"} no station nearby and ${model === 1 ? "uses" : "use"} weather-model estimates (Open-Meteo) instead — each resort page says which.`;
}

/** The shallowest resort still reporting a base above zero, when it differs from the deepest. */
function shallowestReporting(resorts: readonly ResortWithData[]): { name: string; value: number } | null {
  let best: { name: string; value: number } | null = null;
  for (const resort of resorts) {
    const value = resort.snow_report?.base_depth;
    if (value == null || !Number.isFinite(value) || value <= 0) continue;
    if (!best || value < best.value || (value === best.value && compareName(resort.name, best.name) < 0)) {
      best = { name: resort.name, value };
    }
  }
  return best;
}

/** Paragraph 3: the live numbers in season, honest off-season copy otherwise. */
function numbersParagraph(hub: Hub, resorts: readonly ResortWithData[], summary: HubSummary, now: Date): string {
  const n = resorts.length;
  const sentences: string[] = [];

  if (hubOffSeason(resorts, now)) {
    const noBase = resorts.filter((resort) => !(resort.snow_report?.base_depth ?? 0)).length;
    const count = noBase === n ? (n === 1 ? "it reports no base" : "every resort reports no base") : `${noBase} of ${n} resorts report no base`;
    sentences.push(`PeakCam treats this as the off-season ${inHub(hub)}: ${count}, and the ${upcomingHubSeasonLabel(resorts, now)} season is next.`);
    if (summary.deepestBase && summary.deepestBase.value >= 20) {
      sentences.push(
        `The latest reading still shows ${inches(summary.deepestBase.value)} at ${summary.deepestBase.name} — if lifts are turning late-season, that number is current.`,
      );
    }
    sentences.push("Cams, snow reports and powder alerts keep running year-round.");
    return sentences.join(" ");
  }

  const deepest = summary.deepestBase;
  if (deepest) {
    const shallowest = shallowestReporting(resorts);
    const contrast =
      shallowest && shallowest.name !== deepest.name
        ? `; the shallowest reporting resort is ${shallowest.name} at ${inches(shallowest.value)}.`
        : ".";
    sentences.push(`Right now the deepest base ${inHub(hub)} is ${inches(deepest.value)} at ${deepest.name}${contrast}`);
  }
  const most = summary.mostNewSnow24h;
  if (most) {
    // Always the name: after the "shallowest" clause an "It" would point at
    // the wrong resort.
    const verb = deepest && most.name === deepest.name ? "also picked up" : "picked up";
    const superlative = n > 1 ? `, the most ${inHub(hub)}` : "";
    sentences.push(`${most.name} ${verb} ${inches(most.value)} in the last 24 hours${superlative}.`);
  }
  const great = resorts.filter((resort) => resort.cond_rating === "great").length;
  const good = resorts.filter((resort) => resort.cond_rating === "good").length;
  if (great + good > 0) {
    const parts: string[] = [];
    if (great > 0) parts.push(`great at ${plural(great, "resort")}`);
    if (good > 0) parts.push(`good at ${plural(good, "resort")}`);
    sentences.push(`Conditions rate ${joinList(parts)}.`);
  }
  if (sentences.length === 0) {
    sentences.push(`No ${hubResortsNoun(hub)} is reporting a measurable base right now; readings refresh every six hours.`);
  }
  return sentences.join(" ");
}

/**
 * Two to three paragraphs for the hub page's "About" block. Paragraph 1 is
 * coverage (count, regions or states, cams), paragraph 2 is provenance, and
 * paragraph 3 is the live numbers — or the off-season note. Empty paragraphs
 * are dropped, never padded.
 */
export function buildHubParagraphs(hub: Hub, resorts: readonly ResortWithData[], now: Date): string[] {
  if (resorts.length === 0) return [];
  const summary = hubSummary(resorts);
  return [
    `${coverageSentence(hub, resorts)} ${camsSentence(resorts)}`,
    provenanceParagraph(hub, resorts),
    numbersParagraph(hub, resorts, summary, now),
  ].filter((paragraph) => paragraph.length > 0);
}

// ── Opening windows (evergreen) ──────────────────────────────────────────────

/**
 * Typical opening windows by `resorts.state` value, written to stay true from
 * one season to the next: "usually" / "typically", named resorts only where
 * the pattern is well established, no dates. The live projected/confirmed
 * dates live on /opening-dates; this is the answer to the evergreen question.
 * lib/hub-copy.test.ts checks every key is a state in data/resorts.csv.
 */
export const STATE_OPENING_WINDOWS: Readonly<Record<string, string>> = {
  CO: "Colorado resorts usually open between mid-October and late November: Arapahoe Basin, Keystone and Loveland race to open a run or two on snowmaking in October, most of the state opens through November, and everyone is running by mid-December.",
  UT: "Utah resorts typically open in the second half of November — the Cottonwood Canyon resorts (Alta, Snowbird, Brighton, Solitude) often lead, with Park City and Deer Valley following around Thanksgiving.",
  CA: "California's season usually starts at Mammoth in early-to-mid November; the Lake Tahoe resorts typically follow between mid-November and early December, and the Southern California areas open on snowmaking, often in late November or December.",
  VT: "Killington usually opens the East's season in late October or early November on snowmaking; most Vermont resorts follow between mid-November and early December.",
  NH: "New Hampshire resorts typically open between mid-November and early December, snowmaking permitting, with the larger White Mountains areas usually first.",
  WA: "Washington resorts typically open from late November into early December and depend on natural snowfall — the Cascades rely far less on snowmaking than the Rockies, so a dry November pushes openings back.",
  OR: "Timberline on Mt. Hood often has Oregon's earliest lift-served skiing, sometimes in November; Mt. Bachelor, Mt. Hood Meadows and Skibowl typically open between late November and early December.",
  ID: "Idaho resorts typically open between late November and early December, with Sun Valley and Schweitzer usually targeting Thanksgiving weekend.",
  MT: "Montana resorts typically open between late November and early December; Big Sky usually targets Thanksgiving weekend and Whitefish follows in early December.",
  WY: "Jackson Hole usually opens around Thanksgiving weekend, with Snow King in town following in early December.",
  NM: "New Mexico resorts typically open between mid-November and mid-December; Taos Ski Valley and Ski Santa Fe usually target Thanksgiving weekend.",
  NV: "The Nevada side of Lake Tahoe — Mt. Rose and Diamond Peak — typically opens between mid-November and mid-December, storm and snowmaking permitting.",
  NY: "New York resorts typically open between mid-November and early December on snowmaking — Whiteface and Gore in the Adirondacks, and Hunter, Windham and Belleayre in the Catskills.",
  MI: "Michigan resorts typically open between late November and mid-December on snowmaking, as soon as nights stay cold.",
  MN: "Minnesota resorts typically open between late November and mid-December on snowmaking.",
  WI: "Wisconsin resorts typically open between late November and mid-December on snowmaking.",
  ME: "Sunday River and Sugarloaf typically open between early and late November on snowmaking — Sunday River is often among the first lifts to turn in the East.",
  MA: "Massachusetts resorts typically open between late November and mid-December on snowmaking.",
  PA: "Pennsylvania resorts typically open between late November and mid-December, almost entirely on snowmaking.",
  WV: "Snowshoe typically opens around Thanksgiving weekend on snowmaking, weather permitting.",
  MD: "Wisp typically opens between late November and mid-December on snowmaking.",
  VA: "Wintergreen typically opens in December on snowmaking, once nights stay cold in the Blue Ridge.",
  AZ: "Arizona Snowbowl typically opens between mid-November and mid-December, depending on the first real storms over the San Francisco Peaks.",
  BC: "Whistler Blackcomb usually opens in the second half of November; Big White and Sun Peaks typically follow from late November into early December.",
  Chile: "Chilean resorts typically open between mid-June and early July — the Central Andes resorts above Santiago (Portillo, Valle Nevado, La Parva, El Colorado) usually first — and the season runs to late September or early October.",
  Argentina: "Argentine resorts typically open between mid-June and early July — Cerro Catedral, Chapelco and Las Leñas usually in the second half of June — and close between late September and mid-October.",
};

/**
 * Region-hub overrides, keyed by hub slug. A region without an entry uses its
 * primary state's window. lib/hub-copy.test.ts checks every key is a region
 * hub (≥ REGION_HUB_MIN_COUNT resorts) in data/resorts.csv.
 */
export const REGION_OPENING_WINDOWS: Readonly<Record<string, string>> = {
  "lake-tahoe": "Lake Tahoe resorts typically open between mid-November and early December — the snowmaking-equipped mountains (Boreal, Palisades Tahoe, Northstar, Heavenly) usually lead — and ski into April.",
  "summit-county": "Summit County is where North America's season usually starts: Arapahoe Basin and Keystone race to open on snowmaking in October, with Breckenridge and Copper Mountain following in early-to-mid November.",
  "green-mountains": STATE_OPENING_WINDOWS.VT,
  "white-mountains": STATE_OPENING_WINDOWS.NH,
  "cascade-range": "Cascade resorts typically open from late November into early December and depend on natural snowfall rather than snowmaking, so a dry November can push openings back.",
  "southern-california": "Southern California resorts open on snowmaking as soon as nights stay cold, typically in late November or December; seasons are short and storm-driven.",
  "central-andes": "The Central Andes season typically runs from mid-to-late June to late September or early October, with Portillo and Valle Nevado usually opening first.",
  "argentine-lake-district": "Argentine Lake District resorts typically open between mid-June and early July and close between late September and mid-October; Cerro Catedral usually leads.",
  "wasatch-range": "Wasatch resorts typically open in the second half of November — Park City and Deer Valley usually around Thanksgiving weekend.",
  "sangre-de-cristo": "Taos Ski Valley, Ski Santa Fe and Red River typically open around Thanksgiving weekend, snowmaking permitting.",
  "san-juan-mountains": "Wolf Creek has opened on natural snow as early as mid-October; Purgatory and Telluride typically open around Thanksgiving weekend.",
  "mt-hood": "Timberline often has Oregon's earliest lift-served skiing, sometimes in November; Mt. Hood Meadows and Skibowl typically open between late November and mid-December.",
  "elk-mountains": "Aspen Snowmass and Crested Butte typically open around Thanksgiving weekend; Sunlight usually follows in December.",
  "central-sierra": "Central Sierra resorts — Bear Valley, Dodge Ridge, China Peak — typically open between late November and mid-December, storm permitting.",
  catskills: "Hunter, Windham and Belleayre typically open between mid-November and early December on snowmaking.",
};

/**
 * The evergreen opening-window sentence for a hub: the region override, then
 * the state's window (a region hub's primary state), then a hemisphere
 * default so a newly imported state never gets an empty answer.
 */
export function hubOpeningWindow(hub: Hub, resorts: readonly Pick<ResortWithData, "lat">[]): string {
  if (hub.kind === "region") {
    const own = REGION_OPENING_WINDOWS[hub.slug];
    if (own) return own;
    const primary = hub.stateCodes[0];
    if (primary && STATE_OPENING_WINDOWS[primary]) return STATE_OPENING_WINDOWS[primary];
  } else if (STATE_OPENING_WINDOWS[hub.key]) {
    return STATE_OPENING_WINDOWS[hub.key];
  }
  return hubLatitude(resorts) >= 0
    ? `${hub.label} resorts typically open between late November and mid-December, depending on snowmaking temperatures and early storms.`
    : `${hub.label} resorts typically open between mid-June and early July and close in late September or early October.`;
}

// ── FAQ ──────────────────────────────────────────────────────────────────────

/**
 * The three questions from growth-audit §2.3, answered from the data. Every
 * answer names the place, so it stands alone in an answer engine's snippet.
 */
export function buildHubFaq(hub: Hub, resorts: readonly ResortWithData[], now: Date): HubFaqItem[] {
  const n = resorts.length;
  const noun = hubResortsNoun(hub);
  const summary = hubSummary(resorts);
  const offSeason = hubOffSeason(resorts, now);
  const faq: HubFaqItem[] = [];

  // Q1 — most snow. The question every answer engine gets asked about a state.
  const q1 = `Which ${noun} has the most snow right now?`;
  if (offSeason) {
    const stillShowing =
      summary.deepestBase && summary.deepestBase.value >= 20
        ? ` The latest reading still shows ${inches(summary.deepestBase.value)} at ${summary.deepestBase.name} — if lifts are turning late-season, that number is current.`
        : "";
    faq.push({
      question: q1,
      answer: `${hub.label} is in the off-season, so current readings show little or no snow at any resort.${stillShowing} The ${upcomingHubSeasonLabel(resorts, now)} season is next — PeakCam's free powder alerts email you the morning a resort you follow gets fresh snow.`,
    });
  } else if (summary.deepestBase) {
    const deepest = summary.deepestBase;
    const deepestResort = resorts.find((resort) => resort.slug === deepest.slug);
    const sentences = [`${deepest.name} has the deepest base ${inHub(hub)} right now at ${inches(deepest.value)}.`];
    const most = summary.mostNewSnow24h;
    if (most) {
      sentences.push(
        most.name === deepest.name
          ? `It also picked up ${inches(most.value)} in the last 24 hours.`
          : `${most.name} picked up ${inches(most.value)} in the last 24 hours, the most ${inHub(hub)}.`,
      );
    }
    sentences.push(
      deepestResort?.snotel_station_id
        ? "That reading comes from the resort's assigned NRCS station and updates every six hours."
        : "That figure is a weather-model estimate, updated every six hours.",
    );
    sentences.push(`PeakCam ranks all ${plural(n, noun)} by base depth on this page.`);
    faq.push({ question: q1, answer: sentences.join(" ") });
  } else {
    faq.push({
      question: q1,
      answer: `No ${noun} is reporting a measurable base right now. PeakCam re-checks every six hours and ranks all ${plural(n, noun)} by base depth on this page as soon as the numbers move.`,
    });
  }

  // Q2 — webcams. `embed_type` mixes live video, refreshing stills and
  // link-outs; "streams" would oversell the stills.
  const { withCams, total, liveVideo } = hubCamStats(resorts);
  const kind =
    liveVideo === total ? "all live video" : liveVideo > 0 ? "a mix of live video and refreshing stills" : "regularly refreshing stills";
  const q2 = `How many ski resorts ${inHub(hub)} have live webcams?`;
  if (total === 0) {
    faq.push({
      question: q2,
      answer: `None of the ${plural(n, noun)} on PeakCam has a working webcam feed right now; their snow reports still update every six hours.`,
    });
  } else if (n === 1) {
    faq.push({
      question: q2,
      answer: `${resorts[0].name}, the one ${noun} on PeakCam, has ${plural(total, "live webcam")} (${kind}). ${total === 1 ? "It is free to watch and needs" : "They are free to watch and need"} no account.`,
    });
  } else {
    const have = withCams === 1 ? "has" : "have";
    const webcams = total === 1 ? "a live webcam" : "live webcams";
    faq.push({
      question: q2,
      answer: `${withCams} of the ${plural(n, noun)} on PeakCam ${have} ${webcams} — ${plural(total, "cam")} in total, ${kind}. All of them are free to watch and need no account.`,
    });
  }

  // Q3 — opening. Evergreen answer; the live dates are on /opening-dates.
  faq.push({
    question: `When do ${noun}s open?`,
    answer: `${hubOpeningWindow(hub, resorts)} Projected and confirmed dates for every resort are on PeakCam's opening dates page, and a free opening-day alert emails you the morning a resort you follow opens.`,
  });

  return faq;
}

// ── Editorial ────────────────────────────────────────────────────────────────

/**
 * Hand-written intros for the hubs that carry the search volume, keyed by hub
 * slug and shown above the data-derived paragraphs. Same editorial rules as
 * data/resort-editorial.ts: evergreen only, no snow numbers, every sentence
 * something a skier would tell a friend, widely established facts only.
 */
export const HUB_EDITORIAL: Readonly<Record<string, string>> = {
  colorado:
    "Colorado has more high-altitude lift-served skiing than any other state. The I-70 corridor from Loveland Pass to Vail puts a dozen major resorts within two hours of Denver, while the San Juans and Elk Mountains hold the steeper, quieter mountains a long way from the interstate. The snow is famously dry and light, base elevations sit above 8,000 feet almost everywhere, and the season bookends the continent: Arapahoe Basin and Keystone race to open in October, and A-Basin often spins into June.",
  california:
    "California skiing is two different worlds. Lake Tahoe — Palisades Tahoe, Heavenly, Northstar, Kirkwood and a ring of smaller hills — sits on the Sierra crest and takes the brunt of Pacific storms, so the snow arrives in big, wet, multi-foot dumps rather than daily refills. Mammoth, in the Eastern Sierra, is higher and drier and runs one of the longest seasons in the country, while the Southern California areas above Los Angeles ski on snowmaking and the occasional storm within sight of the desert.",
  utah:
    "Utah's claim to the greatest snow on Earth rests on the Wasatch Range, where storms crossing the Great Salt Lake stack light, dry powder onto the Cottonwood Canyons — Alta and Snowbird in Little Cottonwood, Brighton and Solitude in Big Cottonwood — at around 500 inches a year. Park City and Deer Valley sit a ridge over with more sun and less snow; Snowbasin and Powder Mountain to the north catch the same storms with far fewer people. Every one of them is within about an hour of Salt Lake City's airport.",
  vermont:
    "Vermont is the East's ski heartland: the Green Mountains run the length of the state, and Killington, Stowe, Sugarbush, Jay Peak, Mad River Glen and a dozen others are strung along them. Eastern snow is a different sport — natural snowfall is real, and Jay Peak routinely leads the East, but freeze-thaw cycles and rain events mean snowmaking and grooming decide more days than storms do, and the classic narrow, winding New England trails punish anyone expecting Colorado's width.",
  chile:
    "Chile holds most of South America's serious skiing, and it happens during the northern summer — the season runs roughly June to early October. The Central Andes above Santiago (Portillo, Valle Nevado, La Parva, El Colorado) are high, treeless and dry, with resorts sitting near or above 10,000 feet; further south, the volcano resorts — Nevados de Chillán, Corralco, Villarrica, Osorno — ski through forest and old lava fields with heavier snowfall and more weather.",
  argentina:
    "Argentina's ski season runs June to October, mirroring Chile's across the Andes. Cerro Catedral above Bariloche is the largest resort on the continent, and the Argentine Lake District around it — Chapelco, Cerro Bayo, Perito Moreno — skis through lenga forest with the lakes in view. Las Leñas, isolated in Mendoza province, is the country's big-mountain legend, and Cerro Castor in Ushuaia is the southernmost ski resort in the world, with some of the most reliable snow in the Andes.",
};

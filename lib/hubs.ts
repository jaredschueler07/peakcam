import type { ConditionRating, SnowReport } from "@/lib/types";

/**
 * Hub grouping for the /ski-cams pages (growth-audit §2.3 A/B/C) and the
 * resort page's "More in {State}" link. Pure functions over the resort list
 * the ISR pages already hold — no fetching, no Date.now, no locale.
 *
 * Two hub families share one URL namespace, `/ski-cams/<slug>`:
 * - state hubs: one per distinct `resorts.state`. That column holds a US
 *   postal code ("CO"), a Canadian province code ("BC") or, for the Andes
 *   rows, the country name itself ("Chile", "Argentina") — `stateHub()`
 *   labels each kind correctly and slugs the *label* ("colorado", "chile",
 *   "british-columbia"), never the code.
 * - region hubs: one per distinct `resorts.region` with at least
 *   REGION_HUB_MIN_COUNT resorts. Regions cross state lines (Lake Tahoe is
 *   CA + NV, Cascade Range is OR + WA), so a region hub carries `stateCodes`
 *   rather than belonging to one state.
 *
 * Because both families live under one path segment, `resolveHub()` looks up
 * states first and `hubSlugCollisions()` exists so lib/hubs.test.ts can
 * assert the two never share a slug for the values in data/resorts.csv.
 *
 * STATE_NAMES here is the canonical code → name table. lib/resort-copy.ts and
 * components/browse/BrowsePage.tsx carry private copies that predate it; when
 * those files are next touched they should import this one.
 */

export const HUB_BASE_PATH = "/ski-cams";

/** A region needs this many resorts before it earns a hub page. */
export const REGION_HUB_MIN_COUNT = 3;

export type StateHubKind = "state" | "country" | "province";
export type HubKind = StateHubKind | "region";

export interface StateHub {
  /** The raw `resorts.state` value ("CO", "BC", "Chile") — use it for `?state=` filters. */
  key: string;
  /** URL segment under HUB_BASE_PATH: slugified label, so "colorado", not "co". */
  slug: string;
  /** "Colorado", "British Columbia", "Chile". */
  label: string;
  kind: StateHubKind;
}

export interface RegionHub {
  /** Canonical `resorts.region` spelling (the most common one when rows disagree). */
  key: string;
  slug: string;
  label: string;
  kind: "region";
  /** `resorts.state` values the region spans, most resorts first: Lake Tahoe → ["CA", "NV"]. */
  stateCodes: string[];
}

export type Hub = StateHub | RegionHub;

/** The subset of a resort row the grouping needs; ResortWithData satisfies it. */
export interface HubResortLike {
  slug: string;
  name: string;
  state: string | null;
  region: string | null;
}

export interface StateGroup<T extends HubResortLike = HubResortLike> {
  hub: StateHub;
  /** Sorted by name (accent-folded) so the table order is stable across renders. */
  resorts: T[];
  count: number;
}

export interface RegionGroup<T extends HubResortLike = HubResortLike> {
  hub: RegionHub;
  resorts: T[];
  count: number;
}

export type ResolvedHub<T extends HubResortLike = HubResortLike> =
  | { kind: StateHubKind; hub: StateHub; resorts: T[]; count: number }
  | { kind: "region"; hub: RegionHub; resorts: T[]; count: number };

export interface HubSlugCollision {
  slug: string;
  state: StateHub;
  region: RegionHub;
}

// ── Names ────────────────────────────────────────────────────────────────────

const US_STATE_NAMES: Record<string, string> = {
  AK: "Alaska", AZ: "Arizona", CA: "California", CO: "Colorado", ID: "Idaho",
  MA: "Massachusetts", MD: "Maryland", ME: "Maine", MI: "Michigan", MN: "Minnesota",
  MT: "Montana", NC: "North Carolina", NH: "New Hampshire", NM: "New Mexico",
  NV: "Nevada", NY: "New York", OR: "Oregon", PA: "Pennsylvania", UT: "Utah",
  VA: "Virginia", VT: "Vermont", WA: "Washington", WI: "Wisconsin",
  WV: "West Virginia", WY: "Wyoming",
};

const CA_PROVINCE_NAMES: Record<string, string> = {
  AB: "Alberta", BC: "British Columbia", ON: "Ontario", QC: "Quebec",
};

/**
 * Code → full name for every US state and Canadian province the catalogue
 * uses or is likely to. Country-name values ("Chile") are not here on purpose:
 * they are already labels and pass through `stateLabel()` unchanged.
 */
export const STATE_NAMES: Record<string, string> = { ...US_STATE_NAMES, ...CA_PROVINCE_NAMES };

const US_STATE_CODES = new Set(Object.keys(US_STATE_NAMES));
const CA_PROVINCE_CODES = new Set(Object.keys(CA_PROVINCE_NAMES));

/**
 * Trims and upper-cases two-letter codes ("co" → "CO") while leaving country
 * names alone ("Chile" stays "Chile"). Every state lookup goes through this so
 * grouping, labels and neighbour lookups agree on the key.
 */
function normaliseStateCode(code: string | null | undefined): string {
  const trimmed = (code ?? "").trim();
  return /^[A-Za-z]{2}$/.test(trimmed) ? trimmed.toUpperCase() : trimmed;
}

/** Full name for a `resorts.state` value; unknown values pass through as-is. */
export function stateLabel(code: string): string {
  const key = normaliseStateCode(code);
  return STATE_NAMES[key] ?? key;
}

/**
 * US codes are states, Canadian codes are provinces, and anything that is not
 * a two-letter code is a country name stored in `state` (the Andes rows). An
 * unknown two-letter code is assumed to be a US state so a new import never
 * mislabels Vermont's neighbour as a country.
 */
export function stateHubKind(code: string): StateHubKind {
  const key = normaliseStateCode(code);
  if (CA_PROVINCE_CODES.has(key)) return "province";
  if (US_STATE_CODES.has(key) || /^[A-Z]{2}$/.test(key)) return "state";
  return "country";
}

// ── Slugs & paths ────────────────────────────────────────────────────────────

/** Lower-case, accent-stripped text for slugs and stable sort keys. */
function fold(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * URL segment for a hub: ASCII-folded ("Nevados de Chillán" → "nevados-de-
 * chillan", "Ñuble Andes" → "nuble-andes"), "&" spelled out so "Alta &
 * Snowbird" reads in the URL, every other run of non-alphanumerics collapsed
 * to one dash, no leading or trailing dash.
 */
export function slugifyHub(name: string): string {
  return fold(name)
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function hubPath(hub: Pick<Hub, "slug">): string {
  return `${HUB_BASE_PATH}/${hub.slug}`;
}

export function stateHub(code: string): StateHub {
  const key = normaliseStateCode(code);
  const label = STATE_NAMES[key] ?? key;
  return { key, slug: slugifyHub(label), label, kind: stateHubKind(key) };
}

/** "/ski-cams/colorado" for "CO", "/ski-cams/chile" for "Chile". */
export function stateHubPath(code: string): string {
  return hubPath(stateHub(code));
}

/** "/ski-cams/lake-tahoe" for "Lake Tahoe". Existence is not checked — see `groupByRegion`. */
export function regionHubPath(region: string): string {
  return `${HUB_BASE_PATH}/${slugifyHub(region)}`;
}

// ── Ordering ─────────────────────────────────────────────────────────────────

/**
 * Deterministic text order that ignores accents and case ("Las Leñas" sorts
 * with the L's, not after "Zermatt"), with the raw strings as a tiebreak so
 * two spellings never compare equal.
 */
function compareText(a: string, b: string): number {
  const fa = fold(a);
  const fb = fold(b);
  if (fa !== fb) return fa < fb ? -1 : 1;
  return a === b ? 0 : a < b ? -1 : 1;
}

function byName<T extends { name: string }>(a: T, b: T): number {
  return compareText(a.name, b.name);
}

function byCountThenLabel<G extends { count: number; hub: { label: string } }>(a: G, b: G): number {
  return b.count - a.count || compareText(a.hub.label, b.hub.label);
}

/** Highest count wins; ties go to the alphabetically-first key. */
function mostCommon(counts: Map<string, number>): string {
  let best: string | null = null;
  let bestCount = -1;
  for (const [value, count] of counts) {
    if (count > bestCount || (count === bestCount && best !== null && compareText(value, best) < 0)) {
      best = value;
      bestCount = count;
    }
  }
  return best ?? "";
}

// ── Grouping ─────────────────────────────────────────────────────────────────

/**
 * One group per distinct `state`, biggest first (ties alphabetical by label).
 * Rows with a blank state are dropped rather than grouped under "".
 */
export function groupByState<T extends HubResortLike>(resorts: readonly T[]): StateGroup<T>[] {
  const groups = new Map<string, StateGroup<T>>();
  for (const resort of resorts) {
    const key = normaliseStateCode(resort.state);
    if (!key) continue;
    let group = groups.get(key);
    if (!group) {
      group = { hub: stateHub(key), resorts: [], count: 0 };
      groups.set(key, group);
    }
    group.resorts.push(resort);
    group.count += 1;
  }
  for (const group of groups.values()) group.resorts.sort(byName);
  return [...groups.values()].sort(byCountThenLabel);
}

/**
 * One group per distinct region slug with at least `minCount` resorts,
 * biggest first. Grouping by slug rather than raw text means "Mt. Hood" and
 * "Mt Hood" land in one hub; the label is the most common spelling.
 */
export function groupByRegion<T extends HubResortLike>(
  resorts: readonly T[],
  minCount: number = REGION_HUB_MIN_COUNT,
): RegionGroup<T>[] {
  interface Bucket {
    resorts: T[];
    spellings: Map<string, number>;
    states: Map<string, number>;
  }
  const buckets = new Map<string, Bucket>();
  for (const resort of resorts) {
    const region = (resort.region ?? "").trim();
    const slug = slugifyHub(region);
    if (!slug) continue;
    let bucket = buckets.get(slug);
    if (!bucket) {
      bucket = { resorts: [], spellings: new Map(), states: new Map() };
      buckets.set(slug, bucket);
    }
    bucket.resorts.push(resort);
    bucket.spellings.set(region, (bucket.spellings.get(region) ?? 0) + 1);
    const state = normaliseStateCode(resort.state);
    if (state) bucket.states.set(state, (bucket.states.get(state) ?? 0) + 1);
  }

  const groups: RegionGroup<T>[] = [];
  for (const [slug, bucket] of buckets) {
    if (bucket.resorts.length < minCount) continue;
    const label = mostCommon(bucket.spellings);
    const stateCodes = [...bucket.states.entries()]
      .sort((a, b) => b[1] - a[1] || compareText(a[0], b[0]))
      .map(([code]) => code);
    groups.push({
      hub: { key: label, slug, label, kind: "region", stateCodes },
      resorts: bucket.resorts.sort(byName),
      count: bucket.resorts.length,
    });
  }
  return groups.sort(byCountThenLabel);
}

/** Every hub that gets a page — the input to generateStaticParams and the /ski-cams index. */
export function listHubs<T extends HubResortLike>(
  resorts: readonly T[],
  minCount: number = REGION_HUB_MIN_COUNT,
): { states: StateGroup<T>[]; regions: RegionGroup<T>[] } {
  return { states: groupByState(resorts), regions: groupByRegion(resorts, minCount) };
}

/** Region hubs that include at least one resort from `code` — the "regions in this state" links. */
export function regionHubsForState<T extends HubResortLike>(
  code: string,
  resorts: readonly T[],
  minCount: number = REGION_HUB_MIN_COUNT,
): RegionGroup<T>[] {
  const key = normaliseStateCode(code);
  return groupByRegion(resorts, minCount).filter((group) => group.hub.stateCodes.includes(key));
}

/**
 * The hub behind a `/ski-cams/[hub]` segment, or null for a 404. States are
 * checked first so a region that happens to share a slug can never shadow
 * one; `hubSlugCollisions()` reports when that fallback is actually in play.
 * Regions below `minCount` do not resolve — they have no page.
 */
export function resolveHub<T extends HubResortLike>(
  slug: string,
  resorts: readonly T[],
  minCount: number = REGION_HUB_MIN_COUNT,
): ResolvedHub<T> | null {
  const wanted = slugifyHub(slug);
  if (!wanted) return null;
  const state = groupByState(resorts).find((group) => group.hub.slug === wanted);
  if (state) return { kind: state.hub.kind, hub: state.hub, resorts: state.resorts, count: state.count };
  const region = groupByRegion(resorts, minCount).find((group) => group.hub.slug === wanted);
  if (region) return { kind: "region", hub: region.hub, resorts: region.resorts, count: region.count };
  return null;
}

/**
 * Region slugs that would collide with a state slug. Checked against every
 * region by default (minCount 1), not just the ones with pages, so a region
 * cannot start shadowing a state the day it gains its third resort.
 */
export function hubSlugCollisions<T extends HubResortLike>(
  resorts: readonly T[],
  minCount = 1,
): HubSlugCollision[] {
  const states = new Map(groupByState(resorts).map((group) => [group.hub.slug, group.hub] as const));
  const collisions: HubSlugCollision[] = [];
  for (const group of groupByRegion(resorts, minCount)) {
    const state = states.get(group.hub.slug);
    if (state) collisions.push({ slug: group.hub.slug, state, region: group.hub });
  }
  return collisions;
}

// ── Summary strip ────────────────────────────────────────────────────────────

/** A resort singled out by the summary strip, with the number that earned it. */
export interface HubResortStat {
  slug: string;
  name: string;
  value: number;
}

export interface HubSummary {
  count: number;
  /** Largest `base_depth` above zero, or null when nothing is reporting a base. */
  deepestBase: HubResortStat | null;
  /** Largest `new_snow_24h` above zero, or null when nothing fell. */
  mostNewSnow24h: HubResortStat | null;
  /** Best `cond_rating` across the hub (great > good > fair > poor). */
  bestRating: ConditionRating | null;
  /** Latest `snow_report.updated_at` as the original ISO string — the hub's dateModified. */
  newestReportAt: string | null;
}

/** The subset of a resort row the summary needs; ResortWithData satisfies it. */
export interface HubSummaryResortLike {
  slug: string;
  name: string;
  cond_rating: ConditionRating | null;
  snow_report: Pick<SnowReport, "base_depth" | "new_snow_24h" | "updated_at"> | null;
}

const RATING_RANK: Record<ConditionRating, number> = { great: 3, good: 2, fair: 1, poor: 0 };
const RATINGS = new Set<string>(Object.keys(RATING_RANK));

/** Guards against whatever the DB actually holds — the column is text with a CHECK, not an enum in JS. */
function isRating(value: unknown): value is ConditionRating {
  return typeof value === "string" && RATINGS.has(value);
}

/**
 * Highest positive value wins; ties go to the alphabetically-first resort so
 * the strip never flips between renders. Zero is excluded on purpose: an
 * off-season hub full of 0″ bases has no "deepest base", and saying so beats
 * headlining "0″ at Vail".
 */
function maxStat<T extends HubSummaryResortLike>(
  resorts: readonly T[],
  pick: (resort: T) => number | null | undefined,
): HubResortStat | null {
  let best: HubResortStat | null = null;
  for (const resort of resorts) {
    const value = pick(resort);
    if (value == null || !Number.isFinite(value) || value <= 0) continue;
    if (!best || value > best.value || (value === best.value && compareText(resort.name, best.name) < 0)) {
      best = { slug: resort.slug, name: resort.name, value };
    }
  }
  return best;
}

export function hubSummary<T extends HubSummaryResortLike>(resorts: readonly T[]): HubSummary {
  let bestRating: ConditionRating | null = null;
  let newest: { iso: string; ms: number } | null = null;

  for (const resort of resorts) {
    const rating = resort.cond_rating;
    if (isRating(rating) && (!bestRating || RATING_RANK[rating] > RATING_RANK[bestRating])) {
      bestRating = rating;
    }
    const iso = resort.snow_report?.updated_at;
    if (iso) {
      const ms = Date.parse(iso);
      if (Number.isFinite(ms) && (!newest || ms > newest.ms)) newest = { iso, ms };
    }
  }

  return {
    count: resorts.length,
    deepestBase: maxStat(resorts, (resort) => resort.snow_report?.base_depth),
    mostNewSnow24h: maxStat(resorts, (resort) => resort.snow_report?.new_snow_24h),
    bestRating,
    newestReportAt: newest?.iso ?? null,
  };
}

// ── Neighbours ───────────────────────────────────────────────────────────────

/**
 * Hand-kept adjacency for the "nearby states" links, restricted to values
 * that appear in data/resorts.csv so every link has a hub behind it. Order is
 * display order (the skiing neighbour first). Mostly shared borders, with
 * two deliberate ski-market exceptions: VT↔ME (New England reads as one
 * market) and MI↔MN (Upper Midwest, across Lake Superior). The map must stay
 * symmetric — lib/hubs.test.ts checks.
 */
const NEIGHBOURS: Record<string, readonly string[]> = {
  CO: ["UT", "WY", "NM"],
  UT: ["CO", "ID", "WY", "NV", "AZ"],
  WY: ["CO", "UT", "ID", "MT"],
  NM: ["CO", "AZ"],
  AZ: ["NM", "UT", "NV", "CA"],
  NV: ["CA", "UT", "AZ", "OR", "ID"],
  CA: ["NV", "OR", "AZ"],
  OR: ["WA", "CA", "ID", "NV"],
  WA: ["OR", "ID", "BC"],
  ID: ["WA", "OR", "MT", "WY", "UT", "NV", "BC"],
  MT: ["ID", "WY", "BC"],
  BC: ["WA", "ID", "MT"],
  VT: ["NH", "NY", "ME", "MA"],
  NH: ["VT", "ME", "MA"],
  ME: ["NH", "VT"],
  MA: ["VT", "NH", "NY"],
  NY: ["VT", "MA", "PA"],
  PA: ["NY", "MD", "WV"],
  MD: ["PA", "WV", "VA"],
  WV: ["MD", "VA", "PA"],
  VA: ["WV", "MD"],
  MI: ["WI", "MN"],
  WI: ["MI", "MN"],
  MN: ["WI", "MI"],
  Chile: ["Argentina"],
  Argentina: ["Chile"],
};

/** Neighbouring `resorts.state` values for `code`, or [] for a state with no entry. */
export function neighbouringStates(code: string): string[] {
  return [...(NEIGHBOURS[normaliseStateCode(code)] ?? [])];
}

/**
 * `neighbouringStates` filtered to states that actually have resorts in
 * `resorts`, as ready-to-link hubs — so a hand-map entry never becomes a
 * link to a hub that generateStaticParams did not emit.
 */
export function neighbouringStateHubs<T extends HubResortLike>(code: string, resorts: readonly T[]): StateHub[] {
  const present = new Map(groupByState(resorts).map((group) => [group.hub.key, group.hub] as const));
  const hubs: StateHub[] = [];
  for (const neighbour of neighbouringStates(code)) {
    const hub = present.get(neighbour);
    if (hub) hubs.push(hub);
  }
  return hubs;
}

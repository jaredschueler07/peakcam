// ─────────────────────────────────────────────────────────────
// Resort profile: the identity fields the parity plan's P0 migration adds to
// `resorts` (runs, lifts, acres, vertical, annual snowfall, longest run,
// passes, trail map, Wikidata id, elevations, description).
//
// Pure. Every function here tolerates a row that predates the migration —
// the fields are optional on `Resort` and absent ones simply produce nothing:
// no additionalProperty row, no sameAs entry, no sentence. That is what lets
// this ship before the columns exist and stay correct once they do.
// ─────────────────────────────────────────────────────────────

import type { Resort, ResortDescriptionSource, SeasonPass } from "./types";

/** The profile slice of a resort row, every field optional. */
export type ResortProfile = Pick<
  Resort,
  | "runs_total"
  | "lifts_total"
  | "skiable_acres"
  | "vertical_ft"
  | "annual_snowfall_in"
  | "longest_run_mi"
  | "description"
  | "description_source"
  | "trail_map_url"
  | "wikidata_id"
  | "aliases"
  | "passes"
  | "elevation_base_ft"
  | "elevation_summit_ft"
>;

export const SEASON_PASSES: readonly SeasonPass[] = ["ikon", "epic", "mountain-collective", "indy", "power"];

/** How each pass reads in copy. */
export const PASS_LABELS: Record<SeasonPass, string> = {
  ikon: "Ikon Pass",
  epic: "Epic Pass",
  "mountain-collective": "Mountain Collective",
  indy: "Indy Pass",
  power: "Power Pass",
};

export const DESCRIPTION_SOURCES: readonly ResortDescriptionSource[] = ["operator", "editor", "generated"];

/** How a description's provenance reads in the visible label and the markdown alternate. */
export const DESCRIPTION_SOURCE_LABELS: Record<ResortDescriptionSource, string> = {
  operator: "operator",
  editor: "editor",
  generated: "generated",
};

export function isSeasonPass(value: unknown): value is SeasonPass {
  return typeof value === "string" && (SEASON_PASSES as readonly string[]).includes(value);
}

export function isDescriptionSource(value: unknown): value is ResortDescriptionSource {
  return typeof value === "string" && (DESCRIPTION_SOURCES as readonly string[]).includes(value);
}

/** A finite, positive number or null — Postgres numerics can arrive as strings through PostgREST. */
export function profileNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** The passes a row names, validated and deduplicated in canonical order. */
export function profilePasses(value: unknown): SeasonPass[] {
  if (!Array.isArray(value)) return [];
  const set = new Set(value.filter(isSeasonPass));
  return SEASON_PASSES.filter((p) => set.has(p));
}

/** "Ikon Pass and Mountain Collective" / "Ikon Pass, Epic Pass and Indy Pass". */
export function passList(passes: readonly SeasonPass[]): string {
  const labels = passes.map((p) => PASS_LABELS[p]);
  if (labels.length <= 1) return labels[0] ?? "";
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

const INT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const ONE_DECIMAL = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

export function formatFeet(value: number): string {
  return `${INT.format(Math.round(value))} ft`;
}

export function formatAcres(value: number): string {
  return `${INT.format(Math.round(value))} acres`;
}

export function formatInches(value: number): string {
  return `${ONE_DECIMAL.format(value)} in`;
}

export function formatMiles(value: number): string {
  return `${ONE_DECIMAL.format(value)} mi`;
}

export interface ElevationPair {
  baseFt: number | null;
  summitFt: number | null;
}

/**
 * Base and summit elevation from the profile columns, falling back to the
 * `resort_metadata` row the public API already reads. The profile wins when
 * both exist because the importer records its source.
 */
export function resolveElevation(profile: ResortProfile, metadata?: ElevationPair | null): ElevationPair {
  return {
    baseFt: profileNumber(profile.elevation_base_ft) ?? metadata?.baseFt ?? null,
    summitFt: profileNumber(profile.elevation_summit_ft) ?? metadata?.summitFt ?? null,
  };
}

/** Vertical drop: the stated figure, else summit minus base when both are known and the difference is positive. */
export function resolveVerticalFt(profile: ResortProfile, elevation: ElevationPair): number | null {
  const stated = profileNumber(profile.vertical_ft);
  if (stated != null) return stated;
  if (elevation.baseFt != null && elevation.summitFt != null && elevation.summitFt > elevation.baseFt) {
    return elevation.summitFt - elevation.baseFt;
  }
  return null;
}

export interface PropertyValueLd {
  "@type": "PropertyValue";
  name: string;
  value: number;
  unitText: string;
}

export interface PassPropertyLd {
  "@type": "PropertyValue";
  name: "Season passes";
  value: string;
}

/**
 * `SkiResort.additionalProperty` rows — only for values the row actually
 * carries. The names match what other ski-resort pages emit so an answer
 * engine comparing resorts sees the same vocabulary.
 */
export function profileAdditionalProperties(
  profile: ResortProfile,
  elevation: ElevationPair,
): Array<PropertyValueLd | PassPropertyLd> {
  const rows: Array<PropertyValueLd | PassPropertyLd> = [];
  const vertical = resolveVerticalFt(profile, elevation);
  if (vertical != null) rows.push({ "@type": "PropertyValue", name: "Vertical drop", value: vertical, unitText: "ft" });
  const snowfall = profileNumber(profile.annual_snowfall_in);
  if (snowfall != null) rows.push({ "@type": "PropertyValue", name: "Average annual snowfall", value: snowfall, unitText: "in" });
  const longest = profileNumber(profile.longest_run_mi);
  if (longest != null) rows.push({ "@type": "PropertyValue", name: "Longest run", value: longest, unitText: "mi" });
  const acres = profileNumber(profile.skiable_acres);
  if (acres != null) rows.push({ "@type": "PropertyValue", name: "Skiable terrain", value: acres, unitText: "acres" });
  const runs = profileNumber(profile.runs_total);
  if (runs != null) rows.push({ "@type": "PropertyValue", name: "Runs", value: runs, unitText: "runs" });
  const lifts = profileNumber(profile.lifts_total);
  if (lifts != null) rows.push({ "@type": "PropertyValue", name: "Lifts", value: lifts, unitText: "lifts" });
  const passes = profilePasses(profile.passes);
  if (passes.length) rows.push({ "@type": "PropertyValue", name: "Season passes", value: passes.map((p) => PASS_LABELS[p]).join(", ") });
  return rows;
}

const WIKIDATA_ID = /^Q\d+$/;

export function wikidataUrl(id: string | null | undefined): string | null {
  return id && WIKIDATA_ID.test(id) ? `https://www.wikidata.org/wiki/${id}` : null;
}

/**
 * `sameAs` for the SkiResort node: the operator's site, its socials and the
 * Wikidata item, each only when present, deduplicated, in that order.
 */
export function profileSameAs(
  resort: Pick<Resort, "website_url" | "x_url" | "facebook_url" | "instagram_url" | "wikidata_id">,
): string[] {
  const out: string[] = [];
  for (const url of [resort.website_url, resort.x_url, resort.facebook_url, resort.instagram_url, wikidataUrl(resort.wikidata_id)]) {
    if (url && !out.includes(url)) out.push(url);
  }
  return out;
}

export interface ResortDescription {
  text: string;
  source: ResortDescriptionSource;
}

/** The stored description with a valid source, or null — a description without a source is not published. */
export function profileDescription(profile: ResortProfile): ResortDescription | null {
  const text = profile.description?.trim();
  if (!text) return null;
  const source = isDescriptionSource(profile.description_source) ? profile.description_source : null;
  if (!source) return null;
  return { text, source };
}

/** True when the row carries any sizing figure worth a "how big" answer. */
export function hasSize(profile: ResortProfile): boolean {
  return [profile.runs_total, profile.lifts_total, profile.skiable_acres].some((v) => profileNumber(v) != null);
}

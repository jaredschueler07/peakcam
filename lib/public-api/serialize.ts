// ─────────────────────────────────────────────────────────────
// Public API v1 — serializers.
//
// Pure functions from the read path's `ResortWithData` (plus the optional
// opening row and elevation that getAllResorts() does not carry) to the wire
// shapes in schema.ts. No Supabase, no Next.js: the /api/v1 routes, the
// Sprint 4 markdown alternates and the Sprint 5 MCP tools all call these with
// whatever they fetched, and the tests build fixtures by hand.
// ─────────────────────────────────────────────────────────────

import type { Cam, Resort, ResortWithData, SnowReport } from "@/lib/types";
import { SITE_URL } from "@/lib/site";
import { cameraPreview } from "@/lib/cam-preview";
import { camDisplayName } from "@/lib/cam-name";
import { conditionsNarrative } from "@/lib/resort-copy";
import { openingStatus, toPacificDay, type ResortOpening } from "@/lib/openings";
import { PUBLIC_API_ATTRIBUTION, PUBLIC_API_LICENSE_URL } from "./headers";
import type {
  CamListPublic,
  CamPublic,
  Measurement,
  MeasurementSource,
  PowderEntryPublic,
  PowderListPublic,
  PowderWindow,
  ResortLightPublic,
  ResortListPublic,
  ResortPass,
  ResortProfilePublic,
  ResortPublic,
  SeasonPublic,
  SeasonStatus,
  Station,
  TrendMeasurement,
} from "./schema";
import { STATION_INDEX, type StationMeta } from "../stations";

// ── Options ──────────────────────────────────────────────────

export interface ResortElevation {
  baseFt: number | null;
  summitFt?: number | null;
}

export interface SerializeOptions {
  /** The instant the document is rendered for; defaults to `new Date()`. Pass it in tests. */
  now?: Date;
  /** The resort's `resort_openings` row (migration 020), if the caller fetched it. */
  opening?: ResortOpening | null;
  /** `resort_metadata` elevations, if the caller fetched them. */
  elevation?: ResortElevation | null;
  /** Origin for canonical and API URLs. Defaults to the production www host. */
  baseUrl?: string;
  /** Station metadata override; defaults to the bundled NRCS index. */
  stations?: Record<string, StationMeta>;
}

export type { StationMeta };

/**
 * NRCS station names/elevations for every triplet the catalogue references,
 * trimmed from data/snotel_stations.json (17 MB, too large to ship in a
 * route). Regenerate when a resort gets a new station:
 *   node -e 'const a=require("./data/snotel_stations.json");…' — see PR #78.
 * Shared with the resort page sentence through lib/stations.ts.
 */
const STATIONS: Record<string, StationMeta> = STATION_INDEX;

// ── Helpers ──────────────────────────────────────────────────

/** Normalise a Postgres timestamptz / any date string to an ISO-8601 UTC instant, or null. */
export function toIsoInstant(value: string | null | undefined): string | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

function latestInstant(values: Array<string | null | undefined>): string | null {
  let best: number | null = null;
  for (const v of values) {
    if (!v) continue;
    const ms = Date.parse(v);
    if (!Number.isNaN(ms) && (best === null || ms > best)) best = ms;
  }
  return best === null ? null : new Date(best).toISOString();
}

const KNOWN_SOURCES = new Set<MeasurementSource>(["snotel", "open_meteo", "pipeline", "manual", "resort"]);

function reportSource(report: SnowReport | null): MeasurementSource | null {
  if (!report?.source) return null;
  return KNOWN_SOURCES.has(report.source as MeasurementSource) ? (report.source as MeasurementSource) : null;
}

export function resortCanonicalUrl(slug: string, baseUrl: string = SITE_URL): string {
  return `${baseUrl}/resorts/${slug}`;
}

export function resortApiUrl(slug: string, baseUrl: string = SITE_URL): string {
  return `${baseUrl}/api/v1/resorts/${slug}`;
}

function stationFor(resort: ResortWithData, stations: Record<string, StationMeta>): Station | undefined {
  const id = resort.snotel_station_id;
  if (!id) return undefined;
  const meta = stations[id];
  return { id, name: meta?.name ?? null, elevationFt: meta?.elevationFt ?? null };
}

/** Percent-of-normal band outside which the ratio is noise (lib/resort-copy.ts uses the same). */
export const PCT_OF_NORMAL_MIN = 10;
export const PCT_OF_NORMAL_MAX = 300;
/** Below this much SWE the median is near zero and the ratio is meaningless. */
export const PCT_OF_NORMAL_MIN_SWE_IN = 2;

/**
 * Null outside the 10–300 % band or when SWE is under 2 in, and null without
 * a station (the Open-Meteo path never has normals; a stray value would be a
 * pipeline artefact).
 */
export function clampPctOfNormal(
  pct: number | null | undefined,
  swe: number | null | undefined,
  hasStation: boolean,
): number | null {
  if (!hasStation || pct == null || !Number.isFinite(pct)) return null;
  if (swe == null || swe < PCT_OF_NORMAL_MIN_SWE_IN) return null;
  if (pct < PCT_OF_NORMAL_MIN || pct > PCT_OF_NORMAL_MAX) return null;
  return pct;
}

/** `"tag1,tag2||narrative"` → tags; a string with no `||` is all tags. */
export function conditionsTags(conditions: string | null | undefined): string[] {
  if (!conditions) return [];
  const head = conditions.includes("||") ? conditions.split("||")[0] : conditions;
  return head
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

// ── Snow ─────────────────────────────────────────────────────

function measurement(
  value: number | null | undefined,
  unit: Measurement["unit"],
  report: SnowReport | null,
  station: Station | undefined,
): Measurement {
  const source = reportSource(report);
  const m: Measurement = {
    value: value == null || !Number.isFinite(value) ? null : value,
    unit,
    source,
    measuredAt: toIsoInstant(report?.updated_at),
  };
  // Station provenance only when the value really came off the sensor.
  if (station && source === "snotel") m.station = station;
  return m;
}

export function serializeSnow(resort: ResortWithData, options: SerializeOptions = {}): ResortPublic["snow"] {
  const report = resort.snow_report;
  if (!report) return null;
  const station = stationFor(resort, options.stations ?? STATIONS);
  const source = reportSource(report);
  const trend: TrendMeasurement = {
    value: report.trend_7d ?? null,
    source,
    measuredAt: toIsoInstant(report.updated_at),
  };
  if (station && source === "snotel") trend.station = station;

  return {
    baseDepth: measurement(report.base_depth, "in", report, station),
    newSnow24h: measurement(report.new_snow_24h, "in", report, station),
    newSnow48h: measurement(report.new_snow_48h, "in", report, station),
    swe: measurement(report.swe_in, "in", report, station),
    pctOfNormal: measurement(
      clampPctOfNormal(report.pct_of_normal, report.swe_in, Boolean(resort.snotel_station_id)),
      "percent",
      report,
      station,
    ),
    trend7d: trend,
    outlook: report.outlook ?? null,
    rating: report.auto_cond_rating ?? resort.cond_rating ?? null,
    tags: conditionsTags(report.conditions),
    narrative: conditionsNarrative(report.conditions),
    reportedAt: toIsoInstant(report.updated_at),
    source,
  };
}

// ── Season ───────────────────────────────────────────────────

export function serializeSeason(resort: ResortWithData, options: SerializeOptions = {}): SeasonPublic {
  const now = options.now ?? new Date();
  const asOf = toPacificDay(now);
  const row = options.opening ?? null;
  const raw = openingStatus(row, asOf);

  // The openings helper distinguishes confirmed/projected/tba; the API
  // collapses to what an agent can act on. A projection that has come and
  // gone says nothing about whether lifts turned, so it stays "unknown".
  let status: SeasonStatus;
  switch (raw) {
    case "open":
      status = "open";
      break;
    case "closed":
    case "confirmed":
      status = "closed";
      break;
    default:
      status = "unknown";
  }

  const openDate = row?.confirmed_open ?? row?.projected_open ?? null;
  const openDateKind = row?.confirmed_open ? "confirmed" : row?.projected_open ? "projected" : null;

  return {
    status,
    openDate,
    openDateKind,
    closingDate: row?.closing_date ?? null,
    seasonLabel: row?.season ?? null,
    hemisphere: resort.lat < 0 ? "south" : "north",
    asOf,
    source: "resort_openings",
    sourceUrl: row?.source_url ?? null,
  };
}

// ── Cams ─────────────────────────────────────────────────────

/**
 * Health → `live`. Null until the health check has run once; false when the
 * last probe failed (any consecutive failure) or the cam was auto-disabled.
 */
export function camLive(cam: Pick<Cam, "auto_disabled" | "consecutive_failures" | "last_checked_at">): boolean | null {
  if (cam.auto_disabled) return false;
  if (!cam.last_checked_at) return null;
  return (cam.consecutive_failures ?? 0) === 0;
}

function camSourceUrl(cam: Cam): string | null {
  if (cam.embed_type === "youtube" && cam.youtube_id) return `https://www.youtube.com/watch?v=${cam.youtube_id}`;
  return cam.embed_url ?? null;
}

export function serializeCam(cam: Cam, resort: Pick<ResortWithData, "slug">, options: SerializeOptions = {}): CamPublic {
  const preview = cameraPreview(cam);
  return {
    id: cam.id,
    name: camDisplayName(cam),
    elevation: cam.elevation ?? null,
    live: camLive(cam),
    lastCheckedAt: toIsoInstant(cam.last_checked_at),
    stillUrl: preview?.src ?? null,
    // Only our own capture job knows when the frame was taken; a provider
    // snapshot's age is unknown and must not be dressed up as a timestamp.
    capturedAt: preview ? toIsoInstant(preview.capturedAt) : null,
    embedType: cam.embed_type,
    pageUrl: resortCanonicalUrl(resort.slug, options.baseUrl),
    sourceUrl: camSourceUrl(cam),
    // Migration 025 metadata; null until the cam audit (P8) classifies the cam.
    kind: cam.kind ?? null,
    credit: cam.credit ?? null,
    sourceTermsUrl: cam.source_terms_url ?? null,
  };
}

// ── Profile ──────────────────────────────────────────────────

const finiteOrNull = (v: number | null | undefined): number | null => (v == null || !Number.isFinite(v) ? null : v);

/**
 * Migration 025 profile columns straight off the resort row. Every field is
 * null (or an empty list) until the importer / P2 enrichment fills it; the
 * object itself is always present so "not known" is explicit, per the
 * contract rules at the top of schema.ts.
 */
export function serializeProfile(resort: Resort): ResortProfilePublic {
  return {
    runsTotal: finiteOrNull(resort.runs_total),
    liftsTotal: finiteOrNull(resort.lifts_total),
    skiableAcres: finiteOrNull(resort.skiable_acres),
    verticalFt: finiteOrNull(resort.vertical_ft),
    annualSnowfallIn: finiteOrNull(resort.annual_snowfall_in),
    longestRunMi: finiteOrNull(resort.longest_run_mi),
    description: resort.description ?? null,
    descriptionSource: resort.description ? (resort.description_source ?? null) : null,
    trailMapUrl: resort.trail_map_url ?? null,
    wikidataId: resort.wikidata_id ?? null,
    aliases: Array.isArray(resort.aliases) ? resort.aliases.filter((a): a is string => typeof a === "string" && a.length > 0) : [],
    passes: Array.isArray(resort.passes) ? resort.passes.filter((p): p is ResortPass => KNOWN_PASSES.has(p)) : [],
  };
}

const KNOWN_PASSES = new Set<ResortPass>(["ikon", "epic", "mountain-collective", "indy", "power"]);

/**
 * Base / summit elevation: the explicit option (resort_metadata, the legacy
 * home) wins when the caller passed one, else the resort row's own columns
 * (migration 025, the canonical home going forward).
 */
export function resolveElevation(resort: Resort, options: SerializeOptions = {}): { baseFt: number | null; summitFt: number | null } {
  return {
    baseFt: finiteOrNull(options.elevation?.baseFt) ?? finiteOrNull(resort.elevation_base_ft),
    summitFt: finiteOrNull(options.elevation?.summitFt) ?? finiteOrNull(resort.elevation_summit_ft),
  };
}

function activeCams(resort: ResortWithData): Cam[] {
  return resort.cams.filter((c) => c.is_active);
}

export function serializeCams(resort: ResortWithData, options: SerializeOptions = {}): CamListPublic {
  const cams = activeCams(resort).map((cam) => serializeCam(cam, resort, options));
  return {
    slug: resort.slug,
    name: resort.name,
    canonicalUrl: resortCanonicalUrl(resort.slug, options.baseUrl),
    cams,
    attribution: PUBLIC_API_ATTRIBUTION,
    license: PUBLIC_API_LICENSE_URL,
    updatedAt: latestInstant(cams.flatMap((c) => [c.lastCheckedAt, c.capturedAt])),
  };
}

// ── Resort ───────────────────────────────────────────────────

export function serializeResort(resort: ResortWithData, options: SerializeOptions = {}): ResortPublic {
  const snow = serializeSnow(resort, options);
  const cams = activeCams(resort).map((cam) => serializeCam(cam, resort, options));
  const elevation = resolveElevation(resort, options);
  return {
    slug: resort.slug,
    name: resort.name,
    canonicalUrl: resortCanonicalUrl(resort.slug, options.baseUrl),
    apiUrl: resortApiUrl(resort.slug, options.baseUrl),
    location: {
      state: resort.state,
      region: resort.region,
      country: resort.country,
      lat: resort.lat,
      lon: resort.lng,
      baseElevationFt: elevation.baseFt,
      summitElevationFt: elevation.summitFt,
    },
    profile: serializeProfile(resort),
    snow,
    season: serializeSeason(resort, options),
    cams,
    websiteUrl: resort.website_url ?? null,
    attribution: PUBLIC_API_ATTRIBUTION,
    license: PUBLIC_API_LICENSE_URL,
    updatedAt: latestInstant([snow?.reportedAt, ...cams.flatMap((c) => [c.lastCheckedAt, c.capturedAt])]),
  };
}

export function serializeResortLight(resort: ResortWithData, options: SerializeOptions = {}): ResortLightPublic {
  const report = resort.snow_report;
  const cams = activeCams(resort);
  return {
    slug: resort.slug,
    name: resort.name,
    canonicalUrl: resortCanonicalUrl(resort.slug, options.baseUrl),
    apiUrl: resortApiUrl(resort.slug, options.baseUrl),
    location: {
      state: resort.state,
      region: resort.region,
      country: resort.country,
      lat: resort.lat,
      lon: resort.lng,
    },
    snow: report
      ? {
          baseDepth: report.base_depth ?? null,
          newSnow24h: report.new_snow_24h ?? null,
          newSnow48h: report.new_snow_48h ?? null,
          unit: "in",
          source: reportSource(report),
          measuredAt: toIsoInstant(report.updated_at),
        }
      : null,
    rating: report?.auto_cond_rating ?? resort.cond_rating ?? null,
    seasonStatus: serializeSeason(resort, options).status,
    camCount: cams.length,
    liveCamCount: cams.filter((c) => camLive(c) === true).length,
  };
}

export function serializeResortList(
  resorts: readonly ResortWithData[],
  options: SerializeOptions & { openings?: ReadonlyMap<string, ResortOpening> } = {},
): ResortListPublic {
  const now = options.now ?? new Date();
  const rows = [...resorts]
    .sort((a, b) => a.name.localeCompare(b.name, "en"))
    .map((r) => serializeResortLight(r, { ...options, now, opening: options.openings?.get(r.id) ?? null }));
  return {
    count: rows.length,
    resorts: rows,
    attribution: PUBLIC_API_ATTRIBUTION,
    license: PUBLIC_API_LICENSE_URL,
    generatedAt: now.toISOString(),
  };
}

// ── Powder ───────────────────────────────────────────────────

export interface PowderFilters {
  /** Which measured window ranks first; the other breaks ties. Default 24h. */
  window?: PowderWindow;
  /** Case-insensitive `resorts.state` match ("CO", "bc", "Chile"). */
  state?: string | null;
  /** Keep resorts whose primary-window total is at least this many inches. */
  minInches?: number | null;
  /** Keep only reports from this source (`snotel` = measured only). */
  source?: MeasurementSource | null;
  /** Cap on results after ranking. */
  limit?: number | null;
}

/**
 * Resorts ranked by measured new snow: the primary window descending, the
 * other window as tiebreak, then base depth, then name. Resorts with no
 * report or a null primary value are left out — "0 in" is a measurement,
 * "unknown" is not a ranking.
 */
export function rankPowder(
  resorts: readonly ResortWithData[],
  filters: PowderFilters = {},
  options: SerializeOptions = {},
): PowderListPublic {
  const now = options.now ?? new Date();
  const window: PowderWindow = filters.window ?? "24h";
  const state = filters.state?.trim().toLowerCase() || null;
  const minInches = filters.minInches != null && Number.isFinite(filters.minInches) ? filters.minInches : null;
  const source = filters.source ?? null;
  const primaryOf = (r: SnowReport) => (window === "24h" ? r.new_snow_24h : r.new_snow_48h);
  const secondaryOf = (r: SnowReport) => (window === "24h" ? r.new_snow_48h : r.new_snow_24h);

  const candidates = resorts.filter((resort) => {
    const report = resort.snow_report;
    if (!report) return false;
    if (state && resort.state.trim().toLowerCase() !== state) return false;
    if (source && reportSource(report) !== source) return false;
    const primary = primaryOf(report);
    if (primary == null || !Number.isFinite(primary)) return false;
    if (minInches != null && primary < minInches) return false;
    return true;
  });

  const num = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? -Infinity : v);
  candidates.sort((a, b) => {
    const ra = a.snow_report!;
    const rb = b.snow_report!;
    return (
      num(primaryOf(rb)) - num(primaryOf(ra)) ||
      num(secondaryOf(rb)) - num(secondaryOf(ra)) ||
      num(rb.base_depth) - num(ra.base_depth) ||
      a.name.localeCompare(b.name, "en")
    );
  });

  const limited = filters.limit != null && filters.limit > 0 ? candidates.slice(0, filters.limit) : candidates;
  const stations = options.stations ?? STATIONS;
  const results: PowderEntryPublic[] = limited.map((resort, i) => {
    const report = resort.snow_report!;
    const station = stationFor(resort, stations);
    return {
      rank: i + 1,
      slug: resort.slug,
      name: resort.name,
      canonicalUrl: resortCanonicalUrl(resort.slug, options.baseUrl),
      apiUrl: resortApiUrl(resort.slug, options.baseUrl),
      state: resort.state,
      country: resort.country,
      newSnow24h: measurement(report.new_snow_24h, "in", report, station),
      newSnow48h: measurement(report.new_snow_48h, "in", report, station),
      baseDepth: measurement(report.base_depth, "in", report, station),
    };
  });

  return {
    window,
    filters: { state: filters.state?.trim() || null, minInches, source },
    count: results.length,
    results,
    attribution: PUBLIC_API_ATTRIBUTION,
    license: PUBLIC_API_LICENSE_URL,
    generatedAt: now.toISOString(),
  };
}

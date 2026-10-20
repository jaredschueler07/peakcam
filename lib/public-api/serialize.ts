// ─────────────────────────────────────────────────────────────
// Public API v1 — serializers.
//
// Pure functions from the read path's `ResortWithData` (plus the optional
// opening row and elevation that getAllResorts() does not carry) to the wire
// shapes in schema.ts. No Supabase, no Next.js: the /api/v1 routes, the
// Sprint 4 markdown alternates and the Sprint 5 MCP tools all call these with
// whatever they fetched, and the tests build fixtures by hand.
// ─────────────────────────────────────────────────────────────

import type { Cam, OperatorStatusRow, Resort, ResortStationJoined, ResortWithData, SnowReport } from "@/lib/types";
import { SITE_URL } from "@/lib/site";
import { cameraPreview } from "@/lib/cam-preview";
import { camDisplayName } from "@/lib/cam-name";
import { conditionsNarrative } from "@/lib/resort-copy";
import { openingStatus, toPacificDay, type ResortOpening } from "@/lib/openings";
import { PUBLIC_API_ATTRIBUTION, PUBLIC_API_LICENSE_URL } from "./headers";
import { resortTabUrl } from "@/lib/resort-pages";
import type { CamTimelapses } from "@/lib/cam-timelapse";
import type {
  CamListPublic,
  CamPublic,
  CamTimelapsePublic,
  CamTimelapsesPublic,
  TimelapseListPublic,
  Measurement,
  MeasurementSource,
  MeasuredNowPublic,
  ObservationStationPublic,
  StationSourcePublic,
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
import { STATION_SOURCES } from "../stations/index";

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
  /**
   * The resort's station-layer rows (migration 026, `getResortStationsIndex`).
   * Omitted → `stations` / `measuredNow` are left off the document, which is
   * how a database without the station layer reads; an empty array → the
   * layer is live and this resort has no station within 25 km.
   */
  observationStations?: ResortStationJoined[] | null;
  /** The newest operator report (migration 032, P6), read by the conditions contract; the resort document ignores it. */
  operator?: OperatorStatusRow | null;
  /**
   * Rendered timelapse clips per cam (migrations 025 + 031,
   * `getResortTimelapses`). Omitted → cam objects carry no `timelapses`
   * key (the P0 contract makes it optional); an array, even empty → every
   * cam carries one, empty for cams without a clip.
   */
  timelapses?: CamTimelapses[] | null;
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
    // Rendered clips (P8 block 2): only when the caller loaded them.
    ...(options.timelapses ? { timelapses: clipsForCam(options.timelapses, cam.id) } : {}),
  };
}

/** The flat clip list for one cam: the current 24 h clip first, then the storm reels. */
function clipsForCam(all: readonly CamTimelapses[], camId: string): CamTimelapsePublic[] {
  const own = all.find((t) => t.camId === camId);
  if (!own) return [];
  return [...(own.current ? [own.current] : []), ...own.storms];
}

/**
 * /api/v1/resorts/{slug}/timelapses: every clip per cam, links only. The
 * per-cam entries follow the resort's cam order and skip cams without a
 * clip; `available` is false when the caller could not read the clip table
 * (migration 031 not applied), which is different from "no clips yet".
 */
export function serializeTimelapses(resort: ResortWithData, options: SerializeOptions = {}): TimelapseListPublic {
  const cams = activeCams(resort);
  const all = options.timelapses ?? null;
  const webcamsUrl = resortTabUrl(resort.slug, "webcams", options.baseUrl);
  const entries: CamTimelapsesPublic[] = [];
  for (const cam of cams) {
    const own = all?.find((t) => t.camId === cam.id);
    if (!own || (!own.current && !own.storms.length)) continue;
    entries.push({
      camId: cam.id,
      camName: camDisplayName(cam),
      pageUrl: `${webcamsUrl}#cam-${cam.id}`,
      kind: cam.kind ?? null,
      credit: cam.credit ?? null,
      current: own.current,
      storms: own.storms,
    });
  }
  const clips = entries.flatMap((e) => [...(e.current ? [e.current] : []), ...e.storms]);
  const storms = entries.flatMap((e) => e.storms.map((s) => ({ ...s, camId: e.camId, camName: e.camName })));
  const lastStorm = storms.sort((a, b) => (b.stormDate ?? "").localeCompare(a.stormDate ?? "") || Date.parse(b.renderedAt) - Date.parse(a.renderedAt))[0] ?? null;
  const note = !all
    ? "Timelapse clips are not served by this deployment yet."
    : clips.length
      ? "Clips are PeakCam renders of its own archived frames of operator-permitted cams (7 fps, 720p max, at most 3 MB); rights stay with the operator. The 24 h clip is replaced every render; storm reels are kept a year. Link them, do not describe them unseen."
      : "No clips yet: the resort's cams may be player-only (no archiving permission) or the archive has fewer than a dozen frames in the last 24 hours.";
  return {
    slug: resort.slug,
    name: resort.name,
    canonicalUrl: resortCanonicalUrl(resort.slug, options.baseUrl),
    webcamsUrl,
    available: all != null,
    clipCount: clips.length,
    newestRenderedAt: latestInstant(clips.map((c) => c.renderedAt)),
    lastStorm,
    cams: entries,
    note,
    attribution: PUBLIC_API_ATTRIBUTION,
    license: PUBLIC_API_LICENSE_URL,
    updatedAt: latestInstant(clips.map((c) => c.renderedAt)),
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

// ── Stations (migration 026) ─────────────────────────────────

const KNOWN_STATION_SOURCES = new Set<StationSourcePublic>(["snotel", "ghcn", "nws", "bc_asws", "eccc"]);

export interface StationsPublic {
  stations: ObservationStationPublic[];
  measuredNow: MeasuredNowPublic[];
}

/**
 * The station layer for one resort: every linked station, and the newest
 * observation for each station that has one. Rows whose `source` is not one
 * the API documents (a future network) are listed under `stations` but carry
 * no `measuredNow` entry, so the enum stays truthful.
 */
export function serializeStations(rows: readonly ResortStationJoined[], now: Date): StationsPublic {
  const sorted = [...rows].sort((a, b) => a.rank - b.rank);
  const stations: ObservationStationPublic[] = sorted.map((r) => ({
    id: r.station.id,
    source: r.station.source,
    sourceId: r.station.source_id,
    name: r.station.name,
    kind: r.station.kind,
    role: r.role,
    lat: r.station.lat,
    lon: r.station.lng,
    elevationFt: r.station.elevation_ft,
    distanceKm: r.distance_km,
    rank: r.rank,
  }));
  const measuredNow: MeasuredNowPublic[] = [];
  for (const r of sorted) {
    const latest = r.latest;
    const source = r.station.source as StationSourcePublic;
    if (!latest || !KNOWN_STATION_SOURCES.has(source)) continue;
    const observedAt = toIsoInstant(latest.observed_at);
    if (!observedAt) continue;
    measuredNow.push({
      stationId: r.station.id,
      role: r.role,
      source,
      sourceId: r.station.source_id,
      name: r.station.name,
      elevationFt: r.station.elevation_ft,
      distanceKm: r.distance_km,
      observedAt,
      ageMinutes: Math.max(0, Math.round((now.getTime() - Date.parse(observedAt)) / 60_000)),
      snowDepthIn: finite(latest.snow_depth_in),
      sweIn: finite(latest.swe_in),
      newSnowIn: finite(latest.new_snow_in),
      tempF: finite(latest.temp_f),
      windMph: finite(latest.wind_mph),
      attribution: STATION_SOURCES[source].attribution,
    });
  }
  return { stations, measuredNow };
}

const finite = (v: number | null | undefined): number | null => (v == null || !Number.isFinite(v) ? null : v);

// ── Resort ───────────────────────────────────────────────────

export function serializeResort(resort: ResortWithData, options: SerializeOptions = {}): ResortPublic {
  const snow = serializeSnow(resort, options);
  const cams = activeCams(resort).map((cam) => serializeCam(cam, resort, options));
  const elevation = resolveElevation(resort, options);
  const stationLayer = options.observationStations ? serializeStations(options.observationStations, options.now ?? new Date()) : null;
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
    ...(stationLayer ?? {}),
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

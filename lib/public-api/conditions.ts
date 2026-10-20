// ─────────────────────────────────────────────────────────────
// Public API v1 — the conditions contract v2 envelope (P6).
//
// `serializeConditions()` turns the catalogue rows for one resort (snow
// report, opening row, station layer, the latest operator report, the stored
// forecast) into the versioned document served at
// /api/v1/resorts/{slug}/conditions and inside the MCP
// get_resort_conditions result. Pure: the rules live in
// lib/conditions-contract.ts, the clock is passed in, and the tests build
// fixtures by hand.
// ─────────────────────────────────────────────────────────────

import type { OperatorStatusRow, ResortWithData } from "@/lib/types";
import type { StoredForecast } from "@/lib/forecast/store";
import {
  CONDITIONS_SCHEMA_VERSION,
  CONDITION_FIELD_NAMES,
  buildConditions,
  freshnessMap,
  newestObservation,
  type ConditionsContract,
  type FieldSource,
  type OperatorReport,
} from "@/lib/conditions-contract";
import { resortLocalDay, resortTimeZone } from "@/lib/resort-timezone";
import { conditionsStatusSentence } from "@/lib/quotable";
import { PUBLIC_API_ATTRIBUTION, PUBLIC_API_LICENSE_URL } from "./headers";
import { schemaUrl } from "./json-schemas";
import { blendForPoint } from "./forecast";
import { conditionsTags, resortApiUrl, resortCanonicalUrl, serializeSnow, serializeStations, type SerializeOptions } from "./serialize";
import type { MeasuredNowPublic, ResortConditionsPublic } from "./schema";

export interface ConditionsSerializeOptions extends SerializeOptions {
  /** The newest `operator_status` row for the resort (migration 031), when the caller fetched one. */
  operator?: OperatorStatusRow | null;
  /** The stored multi-model runs (migration 027); the summit blend's next-48-h total feeds `forecastNext48hCm`. */
  forecast?: StoredForecast | null;
}

const num = (v: number | string | null | undefined): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** A `latest_operator_status` row → the contract's operator report. */
export function operatorReportFromRow(row: OperatorStatusRow | null | undefined): OperatorReport | null {
  if (!row || !row.observed_at) return null;
  return {
    source: row.source,
    sourceId: row.source_id,
    observedAt: row.observed_at,
    liftsOpen: num(row.lifts_open),
    liftsHold: num(row.lifts_hold),
    liftsScheduled: num(row.lifts_scheduled),
    liftsClosed: num(row.lifts_closed),
    liftsTotal: num(row.lifts_total),
    trailsOpen: num(row.trails_open),
    trailsTotal: num(row.trails_total),
    baseDepthIn: num(row.base_depth_in),
    surface: row.surface ?? null,
    openingDate: row.opening_date ?? null,
    verified: Boolean(row.verified),
  };
}

const SOURCE_RANK: FieldSource[] = ["snotel", "station:snotel", "station:ghcn", "station:nws", "station:bc_asws", "station:eccc", "operator", "derived", "model", "profile", "none"];

function sourcesUsed(contract: ConditionsContract): FieldSource[] {
  const used = new Set<FieldSource>();
  for (const name of CONDITION_FIELD_NAMES) {
    const source = contract[name].source;
    if (source !== "none") used.add(source);
  }
  return [...used].sort((a, b) => SOURCE_RANK.indexOf(a) - SOURCE_RANK.indexOf(b));
}

/** The contract for one resort, without the envelope (the page and the markdown alternate use this). */
export function buildResortConditions(resort: ResortWithData, options: ConditionsSerializeOptions = {}): { contract: ConditionsContract; measuredNow: MeasuredNowPublic[]; timeZone: string; localDate: string; now: Date } {
  const now = options.now ?? new Date();
  const timeZone = resortTimeZone(resort);
  const localDate = resortLocalDay(resort, now);
  const snow = serializeSnow(resort, options);
  const report = resort.snow_report;
  const measuredNow = options.observationStations ? serializeStations(options.observationStations, now).measuredNow : [];
  const blended = options.forecast ? blendForPoint(options.forecast, "summit") : null;
  const contract = buildConditions({
    now,
    localDate,
    hemisphere: resort.lat < 0 ? "south" : "north",
    report: report
      ? {
          source: report.source,
          updated_at: report.updated_at,
          base_depth: num(report.base_depth),
          new_snow_24h: num(report.new_snow_24h),
          new_snow_48h: num(report.new_snow_48h),
          swe_in: num(report.swe_in),
          // Already clamped to the publishable band by the serializer.
          pct_of_normal: snow?.pctOfNormal.value ?? null,
          auto_cond_rating: report.auto_cond_rating ?? resort.cond_rating ?? null,
          tags: conditionsTags(report.conditions),
        }
      : null,
    hasStation: Boolean(resort.snotel_station_id),
    opening: options.opening ?? null,
    operator: operatorReportFromRow(options.operator),
    profile: { liftsTotal: num(resort.lifts_total), runsTotal: num(resort.runs_total) },
    measured: measuredNow.map((m) => ({ role: m.role, source: m.source, observedAt: m.observedAt, snowDepthIn: m.snowDepthIn, tempF: m.tempF, windMph: m.windMph })),
    forecast: blended ? { next48hCm: blended.blend.next48hCm, issuedAt: blended.issuedAt } : null,
  });
  return { contract, measuredNow, timeZone, localDate, now };
}

export function serializeConditions(resort: ResortWithData, options: ConditionsSerializeOptions = {}): ResortConditionsPublic {
  const { contract, measuredNow, timeZone, localDate, now } = buildResortConditions(resort, options);
  return {
    schemaVersion: CONDITIONS_SCHEMA_VERSION,
    schemaUrl: schemaUrl("ResortConditions", options.baseUrl),
    slug: resort.slug,
    name: resort.name,
    canonicalUrl: resortCanonicalUrl(resort.slug, options.baseUrl),
    apiUrl: resortApiUrl(resort.slug, options.baseUrl),
    sentence: conditionsStatusSentence(resort.name, contract, localDate).text,
    meta: {
      generatedAt: now.toISOString(),
      resolvedAt: now.toISOString(),
      timeZone,
      localDate,
      newestObservationAt: newestObservation(contract),
      freshness: freshnessMap(contract),
      sources: sourcesUsed(contract),
    },
    data: contract,
    measuredNow,
    attribution: PUBLIC_API_ATTRIBUTION,
    license: PUBLIC_API_LICENSE_URL,
  };
}

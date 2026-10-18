// ─────────────────────────────────────────────────────────────
// Public API v1 — the wire contract, as zod 4 schemas.
//
// One schema per published shape; `serialize.ts` produces values that parse
// against them (the tests assert this) and `openapi.ts` turns the registry
// into components/schemas via `z.toJSONSchema`. Sprint 4 (markdown
// alternates) and Sprint 5 (MCP `structuredContent`/`outputSchema`) import
// the schemas and the inferred types from here, nothing else.
//
// Contract rules:
// - Every snow number is a Measurement with its own `source`/`measuredAt`
//   even though one snow_reports row carries one source today, so a later
//   split (SNOTEL depth + model forecast in one report) is additive.
// - `null` means "not known"; a field is never omitted to mean that.
// - Dates are ISO-8601 UTC instants; `season.*Date` and `season.asOf` are
//   plain YYYY-MM-DD days.
// ─────────────────────────────────────────────────────────────

import { z } from "zod";

export const PUBLIC_API_VERSION = "1.0.0";

/** Everything zod knows about is registered here so openapi.ts can emit $refs by id. */
export const publicApiRegistry = z.registry<{ id: string; description?: string }>();

export const MeasurementSourceSchema = z
  .enum(["snotel", "open_meteo", "pipeline", "manual", "resort"])
  .register(publicApiRegistry, {
    id: "MeasurementSource",
    description:
      "Where a snow number came from. `snotel`: NRCS SNOTEL/SCAN station telemetry, quality-controlled. `open_meteo`: weather-model estimate for resorts without a station. `pipeline`: PeakCam multi-source blend. `manual`/`resort`: hand-entered or resort-published.",
  });

export const StationSchema = z
  .object({
    id: z.string().describe("NRCS station triplet, e.g. `602:CO:SNTL`."),
    name: z.string().nullable().describe("NRCS station name."),
    elevationFt: z.number().nullable().describe("Station elevation in feet. Measurements describe this elevation, not the resort's summit."),
  })
  .register(publicApiRegistry, { id: "Station", description: "The NRCS sensor a measurement was read from." });

export const MeasurementUnitSchema = z.enum(["in", "percent"]);

export const MeasurementSchema = z
  .object({
    value: z.number().nullable().describe("Null when not reported or suppressed as unreliable."),
    unit: MeasurementUnitSchema,
    source: MeasurementSourceSchema.nullable(),
    measuredAt: z.string().nullable().describe("ISO-8601 instant the report carrying this value was written."),
    station: StationSchema.optional().describe("Present only for station-sourced values."),
  })
  .register(publicApiRegistry, { id: "Measurement", description: "A snow number with its provenance." });

export const SnowTrendSchema = z.enum(["rising", "falling", "stable"]);

export const TrendMeasurementSchema = z
  .object({
    value: SnowTrendSchema.nullable().describe("Direction of snow-water-equivalent change over the last 7 days."),
    source: MeasurementSourceSchema.nullable(),
    measuredAt: z.string().nullable(),
    station: StationSchema.optional(),
  })
  .register(publicApiRegistry, { id: "TrendMeasurement" });

export const ConditionRatingSchema = z.enum(["great", "good", "fair", "poor"]);
export const SnowOutlookSchema = z.enum(["more_snow", "stable", "warming", "melt_risk"]);

export const SnowSchema = z
  .object({
    baseDepth: MeasurementSchema.describe("Snow depth at the station or model point, inches."),
    newSnow24h: MeasurementSchema.describe("New snow in the last 24 hours, inches."),
    newSnow48h: MeasurementSchema.describe("New snow in the last 48 hours, inches."),
    swe: MeasurementSchema.describe("Snow water equivalent, inches."),
    pctOfNormal: MeasurementSchema.describe(
      "SWE as a percentage of the station's 1991–2020 median for this day of the water year. Null when there is no station, when SWE is under 2 in, or outside the 10–300 % band where the ratio is meaningful.",
    ),
    trend7d: TrendMeasurementSchema,
    outlook: SnowOutlookSchema.nullable().describe("Derived short-term outlook from the conditions engine."),
    rating: ConditionRatingSchema.nullable().describe("PeakCam's overall conditions rating."),
    tags: z.array(z.string()).describe("Condition tags from the conditions engine, e.g. `powder`."),
    narrative: z.string().nullable().describe("One-paragraph plain-language conditions summary, when the report carries one."),
    reportedAt: z.string().nullable().describe("ISO-8601 instant of the latest report."),
    source: MeasurementSourceSchema.nullable().describe("Source of the latest report as a whole (the per-field `source` values agree with it today)."),
  })
  .register(publicApiRegistry, { id: "Snow", description: "The latest snow report, per field with provenance." });

export const SeasonStatusSchema = z.enum(["open", "closed", "unknown"]);
export const HemisphereSchema = z.enum(["north", "south"]);

export const SeasonSchema = z
  .object({
    status: SeasonStatusSchema.describe(
      "`open` once a resort-confirmed opening date has passed (or a Southern-hemisphere season is still inside its closing date); `closed` before a confirmed opening date or after a closing date; `unknown` when PeakCam has only a projection or no date.",
    ),
    openDate: z.string().nullable().describe("YYYY-MM-DD opening date for the current season, confirmed or projected."),
    openDateKind: z.enum(["confirmed", "projected"]).nullable().describe("Whether `openDate` was announced by the resort or is a third-party projection."),
    closingDate: z.string().nullable().describe("YYYY-MM-DD; mainly Southern-hemisphere rows."),
    seasonLabel: z.string().nullable().describe("The season the dates belong to, e.g. `2026-27`."),
    hemisphere: HemisphereSchema,
    asOf: z.string().describe("The YYYY-MM-DD day (US Pacific) the status was evaluated for."),
    source: z.literal("resort_openings"),
    sourceUrl: z.string().nullable().describe("Where the date was sourced from, when recorded."),
  })
  .register(publicApiRegistry, { id: "Season" });

export const EmbedTypeSchema = z.enum(["youtube", "iframe", "image", "link"]);

export const CamSchema = z
  .object({
    id: z.string().describe("Stable cam id (UUID)."),
    name: z.string(),
    elevation: z.string().nullable().describe("Operator-stated elevation label as published, e.g. `11,000 ft`."),
    live: z
      .boolean()
      .nullable()
      .describe("True when the last health check succeeded, false when the feed is failing or auto-disabled, null when PeakCam has never checked it. Health, not proof of a live broadcast."),
    lastCheckedAt: z.string().nullable(),
    stillUrl: z.string().nullable().describe("A still image for the cam: the operator's own snapshot when it publishes one, else PeakCam's last captured frame. Null for players with no still."),
    capturedAt: z
      .string()
      .nullable()
      .describe("When `stillUrl` was captured by PeakCam. Null for operator-published stills, whose age PeakCam does not know."),
    embedType: EmbedTypeSchema,
    pageUrl: z.string().describe("The PeakCam page that plays this cam."),
    sourceUrl: z.string().nullable().describe("The operator's stream or page. Attribution and rights belong to the operator."),
  })
  .register(publicApiRegistry, { id: "Cam" });

export const LocationSchema = z
  .object({
    state: z.string().describe("US state / CA province code, or the country name for Andes resorts."),
    region: z.string(),
    country: z.string().describe("ISO 3166-1 alpha-2."),
    lat: z.number(),
    lon: z.number(),
    baseElevationFt: z.number().nullable(),
  })
  .register(publicApiRegistry, { id: "Location" });

export const ResortSchema = z
  .object({
    slug: z.string(),
    name: z.string(),
    canonicalUrl: z.string().describe("The resort's PeakCam page. Cite this."),
    apiUrl: z.string(),
    location: LocationSchema,
    snow: SnowSchema.nullable().describe("Null when the resort has never had a snow report."),
    season: SeasonSchema,
    cams: z.array(CamSchema),
    websiteUrl: z.string().nullable(),
    attribution: z.string(),
    license: z.string().describe("URL of the terms that govern reuse."),
    updatedAt: z.string().nullable().describe("Newest instant among the snow report and cam checks/captures."),
  })
  .register(publicApiRegistry, { id: "Resort", description: "Full resort document: location, latest snow report with provenance, season status and cams." });

export const ResortLightSchema = z
  .object({
    slug: z.string(),
    name: z.string(),
    canonicalUrl: z.string(),
    apiUrl: z.string(),
    location: LocationSchema.omit({ baseElevationFt: true }),
    snow: z
      .object({
        baseDepth: z.number().nullable(),
        newSnow24h: z.number().nullable(),
        newSnow48h: z.number().nullable(),
        unit: z.literal("in"),
        source: MeasurementSourceSchema.nullable(),
        measuredAt: z.string().nullable(),
      })
      .nullable(),
    rating: ConditionRatingSchema.nullable(),
    seasonStatus: SeasonStatusSchema,
    camCount: z.number().int(),
    liveCamCount: z.number().int().describe("Cams whose last health check passed."),
  })
  .register(publicApiRegistry, { id: "ResortLight", description: "List-row view of a resort." });

export const ResortListSchema = z
  .object({
    count: z.number().int(),
    resorts: z.array(ResortLightSchema),
    attribution: z.string(),
    license: z.string(),
    generatedAt: z.string(),
  })
  .register(publicApiRegistry, { id: "ResortList" });

export const CamListSchema = z
  .object({
    slug: z.string(),
    name: z.string(),
    canonicalUrl: z.string(),
    cams: z.array(CamSchema),
    attribution: z.string(),
    license: z.string(),
    updatedAt: z.string().nullable(),
  })
  .register(publicApiRegistry, { id: "CamList" });

export const PowderWindowSchema = z.enum(["24h", "48h"]);

export const PowderEntrySchema = z
  .object({
    rank: z.number().int(),
    slug: z.string(),
    name: z.string(),
    canonicalUrl: z.string(),
    apiUrl: z.string(),
    state: z.string(),
    country: z.string(),
    newSnow24h: MeasurementSchema,
    newSnow48h: MeasurementSchema,
    baseDepth: MeasurementSchema,
  })
  .register(publicApiRegistry, { id: "PowderEntry" });

export const PowderListSchema = z
  .object({
    window: PowderWindowSchema,
    filters: z.object({
      state: z.string().nullable(),
      minInches: z.number().nullable(),
      source: MeasurementSourceSchema.nullable(),
    }),
    count: z.number().int(),
    results: z.array(PowderEntrySchema),
    attribution: z.string(),
    license: z.string(),
    generatedAt: z.string(),
  })
  .register(publicApiRegistry, { id: "PowderList" });

export const ApiErrorSchema = z
  .object({
    error: z.string(),
    detail: z.string().optional(),
    status: z.number().int(),
  })
  .register(publicApiRegistry, { id: "Error" });

export type MeasurementSource = z.infer<typeof MeasurementSourceSchema>;
export type Station = z.infer<typeof StationSchema>;
export type Measurement = z.infer<typeof MeasurementSchema>;
export type TrendMeasurement = z.infer<typeof TrendMeasurementSchema>;
export type SnowPublic = z.infer<typeof SnowSchema>;
export type SeasonPublic = z.infer<typeof SeasonSchema>;
export type SeasonStatus = z.infer<typeof SeasonStatusSchema>;
export type CamPublic = z.infer<typeof CamSchema>;
export type LocationPublic = z.infer<typeof LocationSchema>;
export type ResortPublic = z.infer<typeof ResortSchema>;
export type ResortLightPublic = z.infer<typeof ResortLightSchema>;
export type ResortListPublic = z.infer<typeof ResortListSchema>;
export type CamListPublic = z.infer<typeof CamListSchema>;
export type PowderWindow = z.infer<typeof PowderWindowSchema>;
export type PowderEntryPublic = z.infer<typeof PowderEntrySchema>;
export type PowderListPublic = z.infer<typeof PowderListSchema>;
export type ApiError = z.infer<typeof ApiErrorSchema>;

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
import { ASK_INTENTS } from "@/lib/ask/intents";

export const PUBLIC_API_VERSION = "1.1.0";

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

// ── Parity data model (migrations 025–028) ───────────────────
//
// Shapes for data the P2–P8 blocks will fill. They are on the contract now
// so OpenAPI, the markdown alternates and the MCP output schemas can grow
// without a breaking change; every field that may be empty today is nullable
// and every collection that is not yet served is `.optional()` on its parent.

export const CamKindSchema = z
  .enum(["summit", "mid", "base", "snow-stake", "village", "approach"])
  .register(publicApiRegistry, {
    id: "CamKind",
    description: "What the cam looks at. `approach` is a road / access cam.",
  });

export const CamTimelapseSchema = z
  .object({
    id: z.string(),
    window: z.string().describe("Which clip: `24h` (rolling day), `storm` (one storm, see `stormDate`), or another label."),
    url: z.string().describe("Public MP4 URL."),
    frames: z.number().int().nullable(),
    renderedAt: z.string().describe("ISO-8601 instant the clip was rendered."),
    stormDate: z.string().nullable().describe("YYYY-MM-DD of the storm a `storm` clip covers."),
  })
  .register(publicApiRegistry, { id: "CamTimelapse", description: "A rendered timelapse clip for a cam." });

export const ResortPassSchema = z.enum(["ikon", "epic", "mountain-collective", "indy", "power"]);
export const DescriptionSourceSchema = z.enum(["operator", "generated", "editor"]);

export const ResortProfileSchema = z
  .object({
    runsTotal: z.number().int().nullable(),
    liftsTotal: z.number().int().nullable(),
    skiableAcres: z.number().nullable(),
    verticalFt: z.number().int().nullable(),
    annualSnowfallIn: z.number().nullable().describe("Operator-stated average annual snowfall, inches."),
    longestRunMi: z.number().nullable(),
    description: z.string().nullable(),
    descriptionSource: DescriptionSourceSchema.nullable().describe(
      "`operator`: the resort's own copy. `generated`: a model-written draft, labelled as such on the page. `editor`: hand-written by PeakCam.",
    ),
    trailMapUrl: z.string().nullable().describe("The operator's trail map (linked, never copied)."),
    wikidataId: z.string().nullable(),
    aliases: z.array(z.string()).describe("Other names the resort is known by, e.g. `A-Basin`."),
    passes: z.array(ResortPassSchema).describe("Multi-resort passes the resort is on."),
  })
  .register(publicApiRegistry, {
    id: "ResortProfile",
    description: "Static identity facts about the resort. Null fields are not yet known to PeakCam.",
  });

export const StationKindSchema = z
  .enum(["snotel", "scan", "nws_obs", "metar", "ghcn", "bc_asws", "eccc", "road_cam"])
  .register(publicApiRegistry, { id: "StationKind", description: "The observation network a station belongs to." });

export const StationRoleSchema = z.enum(["summit", "mid", "base", "approach"]);

export const ObservationStationSchema = z
  .object({
    id: z.string().describe("PeakCam station id (UUID)."),
    source: z.string().describe("Provider, e.g. `nrcs`, `nws`, `eccc`, `udot`."),
    sourceId: z.string().describe("The provider's own identifier (SNOTEL triplet, ICAO code, GHCN id)."),
    name: z.string().nullable(),
    kind: StationKindSchema,
    role: StationRoleSchema.describe("Where the station sits relative to the resort."),
    lat: z.number().nullable(),
    lon: z.number().nullable(),
    elevationFt: z.number().nullable(),
    distanceKm: z.number().nullable().describe("Great-circle distance from the resort's coordinates."),
    rank: z.number().int().describe("1 = the preferred station for its role."),
  })
  .register(publicApiRegistry, {
    id: "ObservationStation",
    description: "A station (of any network) that serves this resort. Distinct from `Station`, which is the NRCS sensor behind a Measurement.",
  });

export const StationSourceSchema = z
  .enum(["snotel", "ghcn", "nws", "bc_asws", "eccc"])
  .register(publicApiRegistry, {
    id: "StationSource",
    description:
      "Observation network. `snotel`: USDA NRCS SNOTEL/SCAN, daily, depth + SWE. `ghcn`: NOAA NCEI GHCN-Daily cooperative observers, daily, depth + new snow. `nws`: NOAA NWS hourly surface observations (METAR and mesonet), temperature + wind. `bc_asws`: BC River Forecast Centre automated snow stations, hourly. `eccc`: Environment and Climate Change Canada hourly observations.",
  });

export const MeasuredNowSchema = z
  .object({
    stationId: z.string().describe("PeakCam station id; joins `stations[]`."),
    role: StationRoleSchema.describe("summit / mid / base by the station's elevation against the resort's vertical."),
    source: StationSourceSchema,
    sourceId: z.string().describe("The provider's own station id, e.g. `AMB`, `1308:UT:SNTL`, `USC00420072`."),
    name: z.string().nullable(),
    elevationFt: z.number().nullable().describe("Station elevation. Every value below describes this elevation."),
    distanceKm: z.number().nullable().describe("Great-circle distance from the resort's coordinates."),
    observedAt: z.string().describe("ISO-8601 instant of the observation; a daily value is stamped at the end of its UTC day."),
    ageMinutes: z.number().int().describe("Minutes between `observedAt` and `generatedAt`. Daily sources read 1,440 or more; hourly sources under 120 when live."),
    snowDepthIn: z.number().nullable(),
    sweIn: z.number().nullable(),
    newSnowIn: z.number().nullable().describe("New snow over the provider's own period (24 h for daily sources), inches. Null for hourly sources, which do not measure it."),
    tempF: z.number().nullable(),
    windMph: z.number().nullable(),
    attribution: z.string().describe("The credit line the provider's terms ask for."),
  })
  .register(publicApiRegistry, {
    id: "MeasuredNow",
    description:
      "The latest observation from one of the resort's stations, with its role and provenance. There is no freezing-level field: the networks PeakCam reads do not publish one.",
  });

export const ForecastPointSchema = z.enum(["summit", "base"]);

export const ForecastDailySchema = z
  .object({
    date: z.string().describe("YYYY-MM-DD, local to the resort."),
    snowfallCm: z.number().nullable(),
    snowfallLo: z.number().nullable().describe("Low end of the spread across models / members; null for a single model."),
    snowfallHi: z.number().nullable(),
    tempMax: z.number().nullable().describe("°C as the models report it."),
    tempMin: z.number().nullable(),
    precipProb: z.number().nullable().describe("0–100."),
    windGust: z.number().nullable().describe("km/h."),
    weatherCode: z.number().int().nullable().describe("WMO weather interpretation code."),
  })
  .register(publicApiRegistry, { id: "ForecastDaily", description: "One forecast day." });

export const ForecastRunSchema = z
  .object({
    id: z.string(),
    point: ForecastPointSchema,
    model: z.string().describe("Model id as the provider names it, or `blend` for PeakCam's skill-weighted blend."),
    issuedAt: z.string(),
    horizonDays: z.number().int(),
    days: z.array(ForecastDailySchema),
  })
  .register(publicApiRegistry, { id: "ForecastRun", description: "One model run for one point, with its daily values." });

export const ForecastScoreSchema = z
  .object({
    model: z.string(),
    periodDays: z.number().int().describe("Trailing verification window, days."),
    day1Mae: z.number().nullable().describe("Mean absolute error of the day-1 snowfall forecast, cm."),
    day3Mae: z.number().nullable(),
    day7Mae: z.number().nullable(),
    samples: z.number().int().nullable(),
    biasRatio: z.number().nullable().describe("Sum(forecast) / sum(observed); above 1 means the model over-forecasts snow."),
    computedAt: z.string(),
  })
  .register(publicApiRegistry, { id: "ForecastScore", description: "How a model has verified at this resort." });

export const ScoreComponentsSchema = z
  .record(z.string(), z.number().nullable())
  .register(publicApiRegistry, {
    id: "ScoreComponents",
    description: "Named contributions to the score, e.g. `{\"newSnow24h\": 32, \"baseDepth\": 18}`.",
  });

export const ResortScoreSchema = z
  .object({
    date: z.string().describe("YYYY-MM-DD the score is for."),
    score: z.number().int().min(0).max(100),
    rating: ConditionRatingSchema.nullable(),
    components: ScoreComponentsSchema,
    scoredBy: z.string().nullable().describe("Scorer version, e.g. `score-v1`."),
  })
  .register(publicApiRegistry, { id: "ResortScore", description: "PeakCam's 0–100 conditions score with its components." });

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
    kind: CamKindSchema.nullable().describe("What the cam looks at. Null when not classified."),
    credit: z.string().nullable().describe("Attribution line to show with the frame. Null means credit the resort."),
    sourceTermsUrl: z.string().nullable().describe("The operator's terms governing reuse of this feed, when known."),
    timelapses: z.array(CamTimelapseSchema).optional().describe("Rendered clips, once PeakCam renders them for this cam."),
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
    summitElevationFt: z.number().nullable(),
  })
  .register(publicApiRegistry, { id: "Location" });

export const ResortSchema = z
  .object({
    slug: z.string(),
    name: z.string(),
    canonicalUrl: z.string().describe("The resort's PeakCam page. Cite this."),
    apiUrl: z.string(),
    location: LocationSchema,
    profile: ResortProfileSchema,
    snow: SnowSchema.nullable().describe("Null when the resort has never had a snow report."),
    season: SeasonSchema,
    cams: z.array(CamSchema),
    stations: z.array(ObservationStationSchema).optional().describe("Observation stations serving the resort, once the station layer is live."),
    measuredNow: z.array(MeasuredNowSchema).optional().describe("Latest observation per station, once the station layer is live."),
    forecast: z.array(ForecastRunSchema).optional().describe("Latest run per model and point, once stored forecasts are live."),
    forecastScores: z.array(ForecastScoreSchema).optional().describe("Per-model verification at this resort, once computed."),
    score: ResortScoreSchema.nullable().optional().describe("Today's 0–100 score, once the scorer is live."),
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
    location: LocationSchema.omit({ baseElevationFt: true, summitElevationFt: true }),
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

// ── Sprint P9: search index, status, batch, ask ──────────────

export const SearchIndexEntrySchema = z
  .object({
    slug: z.string(),
    name: z.string(),
    aliases: z.array(z.string()).describe("Lowercase ASCII phrases the ask router also accepts for this resort: nicknames and the name minus generic suffixes. Empty when none."),
    state: z.string().describe("US state / CA province code, or the country name for Andes resorts."),
    country: z.string().describe("ISO 3166-1 alpha-2."),
    lat: z.number(),
    lon: z.number(),
    canonicalUrl: z.string(),
  })
  .register(publicApiRegistry, { id: "SearchIndexEntry" });

export const SearchIndexSchema = z
  .object({
    count: z.number().int(),
    resorts: z.array(SearchIndexEntrySchema).describe("Alphabetical by name."),
    attribution: z.string(),
    license: z.string(),
    generatedAt: z.string(),
  })
  .register(publicApiRegistry, { id: "SearchIndex", description: "Every active resort's slug, name, aliases and coordinates, for client-side matching. Cached a day." });

export const StatusLevelSchema = z.enum(["ok", "degraded"]);

export const StatusSchema = z
  .object({
    status: StatusLevelSchema.describe("`degraded` when any check below is failing; the HTTP status stays 200 so the body can be read."),
    generatedAt: z.string(),
    checks: z.object({
      snowReports: z.object({
        status: StatusLevelSchema,
        resorts: z.number().int().describe("Active resorts in the catalogue."),
        reporting: z.number().int().describe("Resorts with at least one snow report."),
        newestReportAt: z.string().nullable().describe("Newest `latest_snow_reports.updated_at` across the catalogue."),
        ageHours: z.number().nullable().describe("Hours since `newestReportAt`. The sync jobs run every 6 h, so above 12 h is degraded."),
        staleResorts: z.number().int().describe("Reporting resorts whose latest report is older than 24 h."),
        bySource: z.record(z.string(), z.number().int()).describe("Reporting resorts per `source` (`snotel`, `open_meteo`, …)."),
      }),
      cams: z.object({
        status: StatusLevelSchema,
        total: z.number().int(),
        live: z.number().int().describe("Last health check passed."),
        down: z.number().int(),
        unchecked: z.number().int(),
        liveRatio: z.number().nullable().describe("live / (live + down); null when nothing has been checked. Below 0.9 is degraded."),
        newestCheckAt: z.string().nullable(),
      }),
    }),
    thresholds: z.object({
      reportMaxAgeHours: z.number(),
      camLiveMinRatio: z.number(),
    }),
    issues: z.array(z.string()).describe("One sentence per failing check; empty when `ok`."),
    attribution: z.string(),
  })
  .register(publicApiRegistry, { id: "Status", description: "Service status derived from the data itself: snow-report freshness and cam health." });

export const BatchRequestSchema = z
  .object({
    requests: z
      .array(z.object({ path: z.string().describe("A GET path under /api/v1, with its query string, e.g. `/api/v1/resorts/alta`.") }))
      .min(1)
      .max(10),
  })
  .register(publicApiRegistry, { id: "BatchRequest" });

export const BatchResultSchema = z
  .object({
    path: z.string(),
    status: z.number().int().describe("The HTTP status that path would have answered on its own."),
    body: z.unknown().describe("That route's JSON body (its documented schema), or its error envelope."),
  })
  .register(publicApiRegistry, { id: "BatchResult" });

export const BatchResponseSchema = z
  .object({
    count: z.number().int(),
    results: z.array(BatchResultSchema).describe("In request order."),
    attribution: z.string(),
    license: z.string(),
    generatedAt: z.string(),
  })
  .register(publicApiRegistry, { id: "BatchResponse" });

export const AskIntentSchema = z.enum(ASK_INTENTS).register(publicApiRegistry, {
  id: "AskIntent",
  description: "What the router decided the question asks for. `unknown` means it declined to guess.",
});

export const AskResortRefSchema = z
  .object({ slug: z.string(), name: z.string(), canonicalUrl: z.string() })
  .register(publicApiRegistry, { id: "AskResortRef" });

export const AskAnswerSchema = z
  .object({
    question: z.string(),
    answerable: z.boolean().describe("False when the router found no resort or no intent it could serve; `data` is then null and `suggestions` says what to ask."),
    intent: AskIntentSchema,
    tool: z.string().nullable().describe("The PeakCam MCP tool whose result is in `data`."),
    arguments: z.record(z.string(), z.unknown()).nullable().describe("The arguments that tool was called with, so the call can be repeated over MCP."),
    resort: AskResortRefSchema.nullable().describe("The resort the question named (the first, for a comparison)."),
    resorts: z.array(AskResortRefSchema).describe("Every resort the question named, in order."),
    place: z.object({ state: z.string().nullable(), country: z.string().nullable() }).nullable(),
    sentence: z.string().describe("A dated, source-labelled sentence that can be quoted verbatim."),
    asOf: z.string().nullable().describe("ISO instant of the newest report the sentence used; null when it used none."),
    data: z.unknown().nullable().describe("The tool's structured result (its documented `outputSchema`), or null."),
    citations: z.array(z.string()).describe("PeakCam URLs to cite, the resort page first."),
    suggestions: z.array(z.string()).describe("Questions the router can answer, offered when it could not answer this one."),
    attribution: z.string(),
    license: z.string(),
    generatedAt: z.string(),
  })
  .register(publicApiRegistry, { id: "AskAnswer", description: "A deterministic answer: the tool result the question routed to plus a quotable sentence. No language model is involved." });

export type MeasurementSource = z.infer<typeof MeasurementSourceSchema>;
export type Station = z.infer<typeof StationSchema>;
export type Measurement = z.infer<typeof MeasurementSchema>;
export type TrendMeasurement = z.infer<typeof TrendMeasurementSchema>;
export type SnowPublic = z.infer<typeof SnowSchema>;
export type SeasonPublic = z.infer<typeof SeasonSchema>;
export type SeasonStatus = z.infer<typeof SeasonStatusSchema>;
export type CamPublic = z.infer<typeof CamSchema>;
export type CamKind = z.infer<typeof CamKindSchema>;
export type CamTimelapsePublic = z.infer<typeof CamTimelapseSchema>;
export type ResortProfilePublic = z.infer<typeof ResortProfileSchema>;
export type ResortPass = z.infer<typeof ResortPassSchema>;
export type ObservationStationPublic = z.infer<typeof ObservationStationSchema>;
export type MeasuredNowPublic = z.infer<typeof MeasuredNowSchema>;
export type StationSourcePublic = z.infer<typeof StationSourceSchema>;
export type ForecastDailyPublic = z.infer<typeof ForecastDailySchema>;
export type ForecastRunPublic = z.infer<typeof ForecastRunSchema>;
export type ForecastScorePublic = z.infer<typeof ForecastScoreSchema>;
export type ScoreComponents = z.infer<typeof ScoreComponentsSchema>;
export type ResortScorePublic = z.infer<typeof ResortScoreSchema>;
export type LocationPublic = z.infer<typeof LocationSchema>;
export type ResortPublic = z.infer<typeof ResortSchema>;
export type ResortLightPublic = z.infer<typeof ResortLightSchema>;
export type ResortListPublic = z.infer<typeof ResortListSchema>;
export type CamListPublic = z.infer<typeof CamListSchema>;
export type PowderWindow = z.infer<typeof PowderWindowSchema>;
export type PowderEntryPublic = z.infer<typeof PowderEntrySchema>;
export type PowderListPublic = z.infer<typeof PowderListSchema>;
export type ApiError = z.infer<typeof ApiErrorSchema>;
export type SearchIndexEntryPublic = z.infer<typeof SearchIndexEntrySchema>;
export type SearchIndexPublic = z.infer<typeof SearchIndexSchema>;
export type StatusPublic = z.infer<typeof StatusSchema>;
export type BatchRequestPublic = z.infer<typeof BatchRequestSchema>;
export type BatchResponsePublic = z.infer<typeof BatchResponseSchema>;
export type AskAnswerPublic = z.infer<typeof AskAnswerSchema>;
export type AskResortRef = z.infer<typeof AskResortRefSchema>;

// ── P5: season history, season stats, monthly climatology, leaderboards ──
//
// Shapes for /api/v1/resorts/{slug}/history, /season-stats, /monthly and
// /api/v1/leaderboards/{kind}, computed by lib/snow-history.ts,
// lib/season-stats.ts and lib/leaderboards.ts from `snowpack_daily` and
// the normals tables (migration 030). Daily new snow is the positive
// day-over-day change in station depth: a measured floor on what fell.

export const SeasonRefSchema = z
  .object({
    key: z.number().int().describe("Water year for the Northern hemisphere (Oct 2026 → 2027); calendar year for the Southern."),
    label: z.string().describe("`2026-27` (North) or `2026` (South)."),
    startDate: z.string().describe("YYYY-MM-DD the season starts: Oct 1 (North) or Apr 1 (South)."),
  })
  .register(publicApiRegistry, { id: "SeasonRef", description: "Which season a number belongs to." });

export const HistorySourceSchema = z
  .enum(["snotel", "open_meteo"])
  .describe("`snotel`: daily NRCS station readings, quality-controlled. `open_meteo`: weather-model daily values for resorts without a station.");

export const SeasonCurvePointSchema = z
  .object({
    dayOfSeason: z.number().int().describe("1 = the season's first day."),
    date: z.string().describe("YYYY-MM-DD."),
    cumulativeIn: z.number().describe("Measured new snow since the season start, inches; days with no reading add nothing."),
    snowDepthIn: z.number().nullable().describe("Depth at the station that day; null when not measured."),
  })
  .register(publicApiRegistry, { id: "SeasonCurvePoint" });

export const NormalBandPointSchema = z
  .object({
    dayOfSeason: z.number().int(),
    meanIn: z.number().describe("Mean cumulative new snow by this day over the 30 most recent complete winters."),
    p25In: z.number(),
    p75In: z.number(),
    recentMeanIn: z.number().nullable().describe("The same mean over the 10 most recent complete winters."),
  })
  .register(publicApiRegistry, { id: "NormalBandPoint" });

export const SeasonCurveSchema = z
  .object({
    points: z.array(SeasonCurvePointSchema).describe("One per day from the season start through `asOf`."),
    band: z.array(NormalBandPointSchema).describe("Days 1–273 (through June 30); empty for resorts without a station normal."),
    normalYears: z.number().int().nullable().describe("Winters behind the 30-winter band."),
    recentYears: z.number().int().nullable(),
  })
  .register(publicApiRegistry, { id: "SeasonCurve" });

export const EnsoPhaseSchema = z.enum(["el-nino", "la-nina", "neutral"]);

export const EnsoSeasonSchema = z
  .object({
    phase: EnsoPhaseSchema,
    oni: z.number().describe("NOAA Oceanic Niño Index, DJF anomaly in °C."),
    label: z.string(),
  })
  .register(publicApiRegistry, { id: "EnsoSeason", description: "The winter's ENSO phase from NOAA's ONI table (DJF ≥ 0.5 El Niño, ≤ −0.5 La Niña)." });

export const StormSchema = z
  .object({
    totalIn: z.number(),
    start: z.string().describe("YYYY-MM-DD."),
    end: z.string(),
    days: z.number().int().describe("Consecutive days with at least 1 in of new snow."),
  })
  .register(publicApiRegistry, { id: "Storm" });

export const DeepestBaseSchema = z
  .object({ depthIn: z.number(), date: z.string().describe("YYYY-MM-DD the depth was first reached.") })
  .register(publicApiRegistry, { id: "DeepestBase" });

export const PastSeasonSchema = z
  .object({
    season: SeasonRefSchema,
    totalIn: z.number().describe("Measured new snow over the season (through June 30 in the North)."),
    snowDays: z.number().int().describe("Days with at least 1 in."),
    powderDays: z.number().int().describe("Days at or above `powderDayThresholdIn`."),
    daysMeasured: z.number().int(),
    maxStorm: StormSchema.nullable(),
    deepestBase: DeepestBaseSchema.nullable(),
    weeklyCumulativeIn: z.array(z.number()).describe("Cumulative new snow at the end of each 7-day week from the season start; 52 entries."),
    percentOfNormal: z.number().nullable().describe("Season total as a percent of the 30-winter mean season; null without a normal."),
    enso: EnsoSeasonSchema.nullable(),
  })
  .register(publicApiRegistry, { id: "PastSeason" });

export const ResortHistorySchema = z
  .object({
    slug: z.string(),
    name: z.string(),
    canonicalUrl: z.string().describe("The resort's PeakCam page."),
    pageUrl: z.string().describe("The history page this document backs."),
    apiUrl: z.string(),
    source: HistorySourceSchema.nullable(),
    station: StationSchema.nullable(),
    hemisphere: HemisphereSchema,
    season: SeasonRefSchema.describe("The season in progress."),
    asOf: z.string().nullable().describe("YYYY-MM-DD of the newest daily reading this season; null before the first."),
    powderDayThresholdIn: z.number(),
    curve: SeasonCurveSchema,
    pastSeasons: z.array(PastSeasonSchema).describe("Up to ten seasons before the current one, newest first; seasons with no rows are omitted."),
    attribution: z.string(),
    license: z.string(),
    generatedAt: z.string(),
  })
  .register(publicApiRegistry, { id: "ResortHistory", description: "The current season's cumulative snowfall curve against the station's normal band, plus ten past seasons." });

export const PercentOfNormalToDateSchema = z
  .object({
    thirtyYear: z.number().nullable().describe("Season-to-date snowfall as a percent of the 30-winter mean by this day; null without a normal."),
    recentDecade: z.number().nullable().describe("The same against the 10 most recent winters."),
    normalToDateIn: z.number().nullable(),
    recentNormalToDateIn: z.number().nullable(),
    normalYears: z.number().int().nullable(),
    recentYears: z.number().int().nullable(),
    baselineNote: z.string().nullable().describe("Set when the two baselines differ by more than 10 %; quote it with the percent."),
  })
  .register(publicApiRegistry, { id: "PercentOfNormalToDate" });

export const LastYearComparisonSchema = z
  .object({
    season: SeasonRefSchema,
    seasonToDateIn: z.number().describe("Cumulative snowfall by the same day of season last year."),
    baseOnSameDayIn: z.number().nullable(),
    powderDays: z.number().int(),
    diffIn: z.number().describe("This season minus last season, inches."),
    pctOfLastYear: z.number().nullable(),
  })
  .register(publicApiRegistry, { id: "LastYearComparison" });

export const SeasonTrendSchema = z
  .object({
    last7In: z.number(),
    prior7In: z.number(),
    direction: z.enum(["rising", "falling", "steady"]),
  })
  .register(publicApiRegistry, { id: "SeasonTrend" });

export const SeasonStatsSchema = z
  .object({
    slug: z.string(),
    name: z.string(),
    canonicalUrl: z.string(),
    pageUrl: z.string(),
    apiUrl: z.string(),
    source: HistorySourceSchema.nullable(),
    station: StationSchema.nullable(),
    hemisphere: HemisphereSchema,
    season: SeasonRefSchema,
    dayOfSeason: z.number().int(),
    asOf: z.string().nullable().describe("YYYY-MM-DD of the newest daily reading this season."),
    seasonToDateIn: z.number(),
    daysMeasured: z.number().int(),
    snowDays: z.number().int(),
    powderDays: z.number().int(),
    powderDayThresholdIn: z.number(),
    currentBaseIn: z.number().nullable(),
    deepestBase: DeepestBaseSchema.nullable(),
    percentOfNormal: PercentOfNormalToDateSchema,
    lastYear: LastYearComparisonSchema.nullable(),
    trend: SeasonTrendSchema,
    sentence: z.string().describe("A dated sentence that can be quoted verbatim."),
    attribution: z.string(),
    license: z.string(),
    generatedAt: z.string(),
  })
  .register(publicApiRegistry, { id: "SeasonStats", description: "Season-to-date snowfall, powder days, base and percent of normal on two baselines, with the same day last year." });

export const MonthWindowStatsSchema = z
  .object({
    avgSnowfallIn: z.number().nullable(),
    avgSnowDays: z.number().nullable(),
    avgDepthIn: z.number().nullable(),
    maxStormIn: z.number().nullable(),
    maxStormStart: z.string().nullable(),
    maxStormEnd: z.string().nullable(),
    yearsTracked: z.number().int(),
  })
  .register(publicApiRegistry, { id: "MonthWindowStats" });

export const MonthClimatologySchema = z
  .object({
    month: z.number().int().min(1).max(12),
    label: z.string(),
    thirtyYear: MonthWindowStatsSchema.describe("The 30 most recent complete winters."),
    recentDecade: MonthWindowStatsSchema.describe("The 10 most recent complete winters."),
    recentVsThirtyPct: z.number().nullable().describe("Recent-decade average snowfall as a percent of the 30-winter average."),
    baselineNote: z.string().nullable(),
  })
  .register(publicApiRegistry, { id: "MonthClimatology" });

export const MonthlyClimatologySchema = z
  .object({
    slug: z.string(),
    name: z.string(),
    canonicalUrl: z.string(),
    pageUrl: z.string(),
    apiUrl: z.string(),
    station: StationSchema.nullable(),
    available: z.boolean().describe("False for resorts without a station normal; `months` is then empty."),
    note: z.string(),
    months: z.array(MonthClimatologySchema).describe("In season order (October first in the North)."),
    attribution: z.string(),
    license: z.string(),
    generatedAt: z.string(),
  })
  .register(publicApiRegistry, { id: "MonthlyClimatology", description: "Average snowfall, snow days, depth and biggest storm per month at the resort's station, on 30-winter and recent-decade baselines." });

export const LeaderboardKindSchema = z
  .enum(["best-powder-this-week", "season-powder-days", "deepest-base", "season-snowfall"])
  .register(publicApiRegistry, { id: "LeaderboardKind" });

export const LeaderboardEntrySchema = z
  .object({
    rank: z.number().int(),
    slug: z.string(),
    name: z.string(),
    canonicalUrl: z.string(),
    state: z.string(),
    country: z.string(),
    value: z.number().describe("The ranked number."),
    unit: z.enum(["in", "days"]),
    source: MeasurementSourceSchema,
    station: StationSchema.nullable(),
    measuredAt: z.string().nullable().describe("ISO instant the value is dated to."),
    detail: z.object({ label: z.string(), value: z.string() }).nullable().describe("A second number for context (base, season total, powder days)."),
  })
  .register(publicApiRegistry, { id: "LeaderboardEntry" });

export const LeaderboardSchema = z
  .object({
    kind: LeaderboardKindSchema,
    title: z.string(),
    description: z.string(),
    rule: z.string().describe("The ranking rule in words."),
    season: SeasonRefSchema.describe("The Northern-hemisphere season the season-bound boards count from."),
    weekStart: z.string().describe("YYYY-MM-DD the 7-day window starts (best-powder-this-week)."),
    filters: z.object({ state: z.string().nullable(), source: MeasurementSourceSchema.nullable() }),
    count: z.number().int(),
    totalMatching: z.number().int(),
    pool: z.number().int().describe("Resorts considered after the filters."),
    asOf: z.string().nullable(),
    sentence: z.string().describe("The dated, quotable summary sentence."),
    unavailable: z.boolean().describe("True when the season aggregates could not be read; `results` is then empty."),
    results: z.array(LeaderboardEntrySchema),
    pageUrl: z.string(),
    attribution: z.string(),
    license: z.string(),
    generatedAt: z.string(),
  })
  .register(publicApiRegistry, { id: "Leaderboard", description: "One of the four season leaderboards, ranked and dated." });

export type SeasonRefPublic = z.infer<typeof SeasonRefSchema>;
export type ResortHistoryPublic = z.infer<typeof ResortHistorySchema>;
export type PastSeasonPublic = z.infer<typeof PastSeasonSchema>;
export type SeasonStatsPublic = z.infer<typeof SeasonStatsSchema>;
export type MonthClimatologyPublic = z.infer<typeof MonthClimatologySchema>;
export type MonthlyClimatologyPublic = z.infer<typeof MonthlyClimatologySchema>;
export type LeaderboardPublic = z.infer<typeof LeaderboardSchema>;
export type LeaderboardEntryPublic = z.infer<typeof LeaderboardEntrySchema>;

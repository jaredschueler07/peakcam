// ─────────────────────────────────────────────────────────────
// MCP server — the nineteen read-only tools, as pure builders.
//
// `buildTools(data)` returns tool definitions over an injected McpDataSource
// so lib/mcp/server.test.ts can run every tool against fixtures with no
// network. Each handler returns both a short, dated, source-labelled
// markdown `content` block and a `structuredContent` document built from
// the Sprint 3 serializer (lib/public-api/serialize.ts) whose shape is the
// tool's zod `outputSchema`. An unknown slug is an `isError` result that
// lists close matches so the model can retry without a second lookup.
// ─────────────────────────────────────────────────────────────

import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/server";
import type { ResortWithData, WeatherPeriod } from "@/lib/types";
import type { PublicApiCatalog } from "@/lib/public-api/data";
import { SITE_URL } from "@/lib/site";
import { stateHubPath, stateLabel } from "@/lib/hubs";
import { KEEPER_MIN_SNOW_24H_IN, MAX_TIMELINE_HOURS, clampHours, type CamTimelineFrame } from "@/lib/cam-timeline";
import { PCT_OF_NORMAL_RULE, buildPctOfNormalPage } from "@/lib/percent-of-normal";
import { answerQuestion } from "@/lib/ask/answer";
import { MAX_QUESTION_LENGTH } from "@/lib/ask/router";

import {
  AskAnswerSchema,
  CamListSchema,
  ForecastBlendDaySchema,
  ForecastCreditSchema,
  ForecastScoreSchema,
  ForecastSummarySchema,
  ForecastTruthBasisSchema,
  MeasuredNowSchema,
  MeasurementSourceSchema,
  ObservationStationSchema,
  PowderListSchema,
  PowderWindowSchema,
  ResortLightSchema,
  ResortSchema,
  SeasonSchema,
  StationSchema,
  type MeasurementSource,
} from "@/lib/public-api/schema";
import {
  camLive,
  rankPowder,
  resortApiUrl,
  resortCanonicalUrl,
  serializeCams,
  serializeResort,
  serializeResortLight,
  serializeSeason,
  serializeSnow,
  serializeStations,
} from "@/lib/public-api/serialize";
import { STATION_SOURCES } from "@/lib/stations/index";
import {
  camLine,
  camsSection,
  formatInches,
  formatInstant,
  formatMeasurement,
  formatStation,
  resortMarkdown,
  seasonSummary,
  snowStation,
  sourceLabel,
} from "@/lib/public-api/markdown";
import { FORECAST_CREDITS, blendForPoint, serializeBlendDays, serializeForecastAccuracy, serializeSummary, type AccuracyInput } from "@/lib/public-api/forecast";
import { OPEN_METEO_ATTRIBUTION, OPEN_METEO_LICENSE, modelLabel } from "@/lib/forecast/open-meteo-models";
import { runsForPoint, type StoredForecast } from "@/lib/forecast/store";
import { cmToInches } from "@/lib/open-meteo";
import type { McpDataSource } from "./types";
import { PEAKCAM_TOOL_NAMES, type PeakCamToolName } from "./tool-names";
import { buildHistoryTools, readHistory } from "./tools-history";
import { hemisphereOf, seasonOf, type SeasonRef } from "@/lib/snow-history";
import {
  closeMatches,
  diceSimilarity,
  editDistance,
  findResort,
  isValidSlug,
  matchResorts,
  normalizeText,
  sameCode,
  scoreResort,
  serializeOptionsFor,
  type MatchFilters,
} from "./catalog";

export { PEAKCAM_TOOL_NAMES, type PeakCamToolName };
export { closeMatches, diceSimilarity, editDistance, findResort, isValidSlug, matchResorts, normalizeText, scoreResort, serializeOptionsFor, type MatchFilters };

// ── Limits ───────────────────────────────────────────────────

/** Cams per tool payload; the page URL carries the rest. */
export const MAX_CAMS = 12;
/** `snowpack_daily` rows per get_snow_history call. */
export const MAX_HISTORY_DAYS = 30;
export const MAX_SEARCH_RESULTS = 20;
export const MAX_POWDER_RESULTS = 25;
export const MAX_COMPARE = 6;
export const MAX_OPENING_ROWS = 150;
export const MAX_PCT_ROWS = 50;
/** Archived frames per cam in a get_cam_timeline payload (links only). */
export const MAX_TIMELINE_FRAMES_PER_CAM = 8;
/** Cams per get_cam_timeline payload for a whole resort. */
export const MAX_TIMELINE_CAMS = 12;

// ── Definition shape ─────────────────────────────────────────

export interface ToolDefinition<I extends z.ZodObject = z.ZodObject, O extends z.ZodObject = z.ZodObject> {
  name: PeakCamToolName;
  title: string;
  description: string;
  inputSchema: I;
  outputSchema: O;
  handler: (args: z.output<I>) => Promise<CallToolResult>;
}

function defineTool<I extends z.ZodObject, O extends z.ZodObject>(def: ToolDefinition<I, O>): ToolDefinition<I, O> {
  return def;
}

function ok(markdown: string, structured: Record<string, unknown>): CallToolResult {
  return { content: [{ type: "text", text: markdown }], structuredContent: structured };
}

function err(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

// ── Catalogue helpers (lib/mcp/catalog.ts) ───────────────────

export function notFoundResult(catalog: PublicApiCatalog, slug: string): CallToolResult {
  const close = closeMatches(catalog.resorts, slug);
  const hint = close.length ? ` Did you mean: ${close.map((r) => `${r.slug} (${r.name})`).join(", ")}?` : "";
  return err(`No active resort with slug "${slug}".${hint} Use search_resorts to look a resort up by name.`);
}

type Resolved = { ok: true; resort: ResortWithData } | { ok: false; result: CallToolResult };

function resolve(catalog: PublicApiCatalog, slug: string): Resolved {
  const resort = findResort(catalog, slug);
  return resort ? { ok: true, resort } : { ok: false, result: notFoundResult(catalog, slug) };
}

// ── Shared schema fragments ──────────────────────────────────

const SlugInput = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(100)
  .describe("PeakCam resort slug, lowercase kebab-case, e.g. `breckenridge` or `ski-portillo`. Get it from search_resorts.");

const StateInput = z
  .string()
  .trim()
  .min(2)
  .max(40)
  .optional()
  .describe("US state or Canadian province code (`CO`, `UT`, `BC`), or for the Andes the country name PeakCam lists (`Chile`, `Argentina`). Case-insensitive.");

const CountryInput = z
  .string()
  .trim()
  .length(2)
  .toUpperCase()
  .optional()
  .describe("ISO 3166-1 alpha-2 country code: `US`, `CA`, `CL` or `AR`.");

const ISO_INSTANT = z.string().describe("ISO-8601 UTC instant the result was generated.");

const sourceNote =
  "Sources: `snotel` = measured at a USDA NRCS SNOTEL station near the resort (station elevation, not the summit), `open_meteo` = weather-model estimate for resorts without a station.";

// ── Builders ─────────────────────────────────────────────────

function lightRow(index: number, r: ReturnType<typeof serializeResortLight>): string {
  const snow = r.snow
    ? `24 h ${formatInches(r.snow.newSnow24h)} · base ${formatInches(r.snow.baseDepth)} · ${sourceLabel(r.snow.source, true)}${r.snow.measuredAt ? ` ${formatInstant(r.snow.measuredAt)}` : ""}`
    : "no snow report";
  return `${index + 1}. **${r.name}** (\`${r.slug}\`, ${r.location.state}, ${r.location.country}) — ${snow} · season ${r.seasonStatus} · ${r.liveCamCount}/${r.camCount} cams live · ${r.canonicalUrl}`;
}

export function buildTools(data: McpDataSource): ToolDefinition[] {
  const searchResorts = defineTool({
    name: "search_resorts",
    title: "Search resorts",
    description:
      "Find PeakCam resorts by name (or part of one, or a region) and get their slugs with a one-line snow summary each. Call this first when the user names a resort; then use the slug with the other tools. Covers about 150 resorts in the US, Canada, Chile and Argentina.",
    inputSchema: z.object({
      query: z.string().trim().min(1).max(80).describe("Resort name or fragment, e.g. `vail`, `big sky`, `portillo`, `tahoe`. Also matches region names."),
      state: StateInput,
      country: CountryInput,
      limit: z.number().int().min(1).max(MAX_SEARCH_RESULTS).default(10).describe(`Rows to return, 1–${MAX_SEARCH_RESULTS}.`),
    }),
    outputSchema: z.object({
      query: z.string(),
      count: z.number().int(),
      resorts: z.array(ResortLightSchema),
      generatedAt: ISO_INSTANT,
    }),
    async handler({ query, state, country, limit }) {
      const catalog = await data.catalog();
      const hits = matchResorts(catalog.resorts, query, { state, country, limit });
      const rows = hits.map((r) => serializeResortLight(r, serializeOptionsFor(catalog, r)));
      const where = [state ? `in ${state}` : null, country ? `(${country})` : null].filter(Boolean).join(" ");
      const lines = rows.length
        ? [
            `Resorts matching "${query}"${where ? ` ${where}` : ""} (${rows.length}), as of ${formatInstant(catalog.now.toISOString())}:`,
            "",
            ...rows.map((r, i) => lightRow(i, r)),
            "",
            "Next: get_resort_conditions(slug) for the full report, get_resort_cams(slug) for the webcams.",
          ]
        : [
            `No PeakCam resort matches "${query}"${where ? ` ${where}` : ""}. Try a shorter name or a different spelling; find_powder and get_opening_dates list resorts without a name.`,
          ];
      return ok(lines.join("\n"), { query, count: rows.length, resorts: rows, generatedAt: catalog.now.toISOString() });
    },
  });

  const getResortConditions = defineTool({
    name: "get_resort_conditions",
    title: "Resort conditions",
    description:
      "The latest snow report for one resort with provenance: new snow 24 h / 48 h, base depth, snow water equivalent, percent of normal, 7-day trend, rating, season status, plus a cam summary and the canonical PeakCam URL to cite. " +
      sourceNote,
    inputSchema: z.object({ slug: SlugInput }),
    outputSchema: ResortSchema,
    async handler({ slug }) {
      const catalog = await data.catalog();
      const hit = resolve(catalog, slug);
      if (!hit.ok) return hit.result;
      const doc = serializeResort(hit.resort, serializeOptionsFor(catalog, hit.resort));
      const trimmed = { ...doc, cams: doc.cams.slice(0, MAX_CAMS) };
      return ok(resortMarkdown(doc, { cams: "count" }), trimmed);
    },
  });

  const getResortCams = defineTool({
    name: "get_resort_cams",
    title: "Resort webcams",
    description:
      "The resort's webcams as links: PeakCam page URL, the operator's stream or page URL, a still-image URL when one exists, and health (live / down / unchecked, from PeakCam's probe, not proof of a live broadcast). Frames are never returned inline.",
    inputSchema: z.object({ slug: SlugInput }),
    outputSchema: CamListSchema,
    async handler({ slug }) {
      const catalog = await data.catalog();
      const hit = resolve(catalog, slug);
      if (!hit.ok) return hit.result;
      const doc = serializeCams(hit.resort, serializeOptionsFor(catalog, hit.resort));
      const live = doc.cams.filter((c) => c.live === true).length;
      const lines = [
        `# ${doc.name} webcams (${doc.cams.length}, ${live} live) — ${doc.canonicalUrl}`,
        "",
        ...camsSection(doc.cams, doc.canonicalUrl, MAX_CAMS),
        "",
        `Health as of the last PeakCam probe; operators own the streams. Updated ${formatInstant(doc.updatedAt)}.`,
      ];
      return ok(lines.join("\n"), { ...doc, cams: doc.cams.slice(0, MAX_CAMS) });
    },
  });

  const findPowder = defineTool({
    name: "find_powder",
    title: "Find powder",
    description:
      "Rank resorts by new snow in the last 24 or 48 hours, optionally within one state/province and above a minimum. Pass sourceOnly=\"snotel\" to answer \"where did it snow most, measured only\" with station data alone. Resorts with no report are left out; zero inches is a measurement. " +
      sourceNote,
    inputSchema: z.object({
      window: PowderWindowSchema.default("24h").describe("Which window ranks first; the other breaks ties."),
      state: StateInput,
      minInches: z.number().min(0).max(500).optional().describe("Keep only resorts with at least this many inches in the window."),
      sourceOnly: z.enum(["snotel"]).optional().describe("`snotel` keeps only station-measured reports and drops model estimates."),
      limit: z.number().int().min(1).max(MAX_POWDER_RESULTS).default(10).describe(`Rows to return, 1–${MAX_POWDER_RESULTS}.`),
    }),
    outputSchema: PowderListSchema,
    async handler({ window, state, minInches, sourceOnly, limit }) {
      const catalog = await data.catalog();
      const doc = rankPowder(
        catalog.resorts,
        { window, state: state ?? null, minInches: minInches ?? null, source: (sourceOnly as MeasurementSource | undefined) ?? null, limit },
        { now: catalog.now },
      );
      const filters = [
        state ? `in ${state}` : null,
        minInches != null ? `at least ${formatInches(minInches)}` : null,
        sourceOnly ? "SNOTEL-measured only" : null,
      ].filter(Boolean);
      const primary = window === "24h" ? "newSnow24h" : "newSnow48h";
      const secondary = window === "24h" ? "newSnow48h" : "newSnow24h";
      const lines = [
        `Most new snow, last ${window}${filters.length ? ` (${filters.join(", ")})` : ""}, as of ${formatInstant(doc.generatedAt)}:`,
        "",
        ...(doc.results.length
          ? doc.results.map((r) => {
              const m = r[primary];
              const station = formatStation(m.station);
              return `${r.rank}. **${r.name}** (\`${r.slug}\`, ${r.state}, ${r.country}) — ${formatMeasurement(m)} in ${window} · ${window === "24h" ? "48 h" : "24 h"} ${formatMeasurement(r[secondary])} · base ${formatMeasurement(r.baseDepth)} · ${sourceLabel(m.source)}${station ? ` (${station})` : ""}, ${formatInstant(m.measuredAt)} · ${r.canonicalUrl}`;
            })
          : ["No resort passed these filters. Loosen minInches or drop the state filter; it may also simply not have snowed."]),
        "",
        "Cite each resort's PeakCam URL; label SNOTEL numbers as measured and Open-Meteo numbers as estimates.",
      ];
      return ok(lines.join("\n"), doc);
    },
  });

  const CompareEntrySchema = ResortSchema.omit({ cams: true }).extend({
    camCount: z.number().int(),
    liveCamCount: z.number().int(),
  });

  const compareResorts = defineTool({
    name: "compare_resorts",
    title: "Compare resorts",
    description: `Side-by-side latest snow, season status and cam counts for 2–${MAX_COMPARE} resorts. Every slug must resolve; an unknown one returns suggestions.`,
    inputSchema: z.object({
      slugs: z.array(SlugInput).min(2).max(MAX_COMPARE).describe(`2–${MAX_COMPARE} resort slugs.`),
    }),
    outputSchema: z.object({
      count: z.number().int(),
      resorts: z.array(CompareEntrySchema),
      generatedAt: ISO_INSTANT,
    }),
    async handler({ slugs }) {
      const catalog = await data.catalog();
      const unique = [...new Set(slugs)];
      const missing = unique.filter((s) => !findResort(catalog, s));
      if (missing.length) {
        const hints = missing.map((s) => {
          const close = closeMatches(catalog.resorts, s, 3);
          return `"${s}"${close.length ? ` (did you mean ${close.map((r) => r.slug).join(", ")}?)` : ""}`;
        });
        return err(`Unknown resort slug${missing.length > 1 ? "s" : ""}: ${hints.join("; ")}. Use search_resorts to find slugs.`);
      }
      if (unique.length < 2) return err("compare_resorts needs at least two different slugs.");
      const entries = unique.map((s) => {
        const resort = findResort(catalog, s)!;
        const doc = serializeResort(resort, serializeOptionsFor(catalog, resort));
        const { cams, ...rest } = doc;
        return { ...rest, camCount: cams.length, liveCamCount: cams.filter((c) => c.live === true).length };
      });
      const header = "| Resort | 24 h | 48 h | Base | SWE % normal | Rating | Season | Source | Cams live |";
      const rows = entries.map((e) => {
        const s = e.snow;
        return `| [${e.name}](${e.canonicalUrl}) | ${formatMeasurement(s?.newSnow24h)} | ${formatMeasurement(s?.newSnow48h)} | ${formatMeasurement(s?.baseDepth)} | ${formatMeasurement(s?.pctOfNormal)} | ${s?.rating ?? "n/a"} | ${e.season.status} | ${s ? `${sourceLabel(s.source, true)} ${formatInstant(s.reportedAt)}` : "none"} | ${e.liveCamCount}/${e.camCount} |`;
      });
      const lines = [
        `Comparison as of ${formatInstant(catalog.now.toISOString())}:`,
        "",
        header,
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
        ...rows,
        "",
        "SNOTEL = station-measured; model = Open-Meteo estimate. SWE % normal is null without a station or when SWE is under 2 in.",
      ];
      return ok(lines.join("\n"), { count: entries.length, resorts: entries, generatedAt: catalog.now.toISOString() });
    },
  });

  const NarrativePeriodSchema = z.object({
    dow: z.string(),
    date: z.string().nullable(),
    shortForecast: z.string(),
    condition: z.string(),
    highF: z.number(),
    lowF: z.number().nullable(),
    snowInches: z.number().describe("From the blend when one is stored for that date, else the keyword estimate (see snowSource)."),
    snowSource: z.enum(["blend", "nws_keyword", "open_meteo"]),
    precipProbability: z.number().nullable(),
    windMph: z.number().nullable(),
    windDirection: z.string().nullable(),
    feelsLikeF: z.number().nullable(),
  });

  const getForecast = defineTool({
    name: "get_forecast",
    title: "Resort forecast",
    description:
      "Fourteen-day blended snow forecast for a resort: per day the median snowfall across the weather models that reach that day (ECMWF IFS, GFS, GEM, ICON, JMA, Météo-France, UKMO; NBM and HRRR added for US points), the 25th/75th percentile band as snowfallLoIn/snowfallHiIn, and modelCount so you can weigh a far-out two-model day against a near-term nine-model one. `summary` has next 48 h, 7- and 14-day totals and the peak day. US resorts also get the National Weather Service text narrative (`periods`), with its snow amounts replaced by the blend. Weather data by Open-Meteo.com (CC BY 4.0): quote the credit. `available: false` when no model run is stored yet.",
    inputSchema: z.object({
      slug: SlugInput,
      point: z.enum(["summit", "base"]).default("summit").describe("Which elevation's blend. Falls back to the other point with a note when the asked one has no runs."),
    }),
    outputSchema: z.object({
      slug: z.string(),
      name: z.string(),
      canonicalUrl: z.string(),
      forecastUrl: z.string().describe("The REST document with every model run."),
      provider: z.enum(["blend", "nws", "none"]).describe("`blend`: stored multi-model blend; `nws`: NWS narrative only, snow amounts are keyword estimates; `none`: nothing available."),
      available: z.boolean(),
      note: z.string().nullable(),
      point: z.enum(["summit", "base"]).nullable(),
      issuedAt: z.string().nullable().describe("Newest model issue instant among the runs blended."),
      modelCount: z.number().int().describe("Models contributing to the first day."),
      models: z.array(z.string()),
      summary: ForecastSummarySchema.nullable(),
      days: z.array(ForecastBlendDaySchema).describe("Up to 14 blended days."),
      periods: z.array(NarrativePeriodSchema).describe("NWS daily narrative for US resorts (up to 5 days); empty elsewhere or when NWS does not answer."),
      credits: z.array(ForecastCreditSchema),
      generatedAt: ISO_INSTANT,
    }),
    async handler({ slug, point }) {
      const catalog = await data.catalog();
      const hit = resolve(catalog, slug);
      if (!hit.ok) return hit.result;
      const resort = hit.resort;
      const canonicalUrl = resortCanonicalUrl(resort.slug);
      const base = {
        slug: resort.slug,
        name: resort.name,
        canonicalUrl,
        forecastUrl: `${resortApiUrl(resort.slug)}/forecast`,
        credits: FORECAST_CREDITS,
        generatedAt: catalog.now.toISOString(),
      };

      let stored: StoredForecast | null = null;
      try {
        stored = await data.forecastRuns(resort.id);
      } catch {
        stored = null;
      }
      const blended = blendForPoint(stored, point);
      const days = blended ? serializeBlendDays(blended.blend) : [];
      const summary = blended ? serializeSummary(blended.blend, blended.point, blended.issuedAt) : null;
      const blendByDate = Object.fromEntries(days.map((d) => [d.date, d.snowfallIn]));

      let periods: WeatherPeriod[] | null = null;
      if (resort.country === "US") {
        try {
          periods = await data.forecast(resort, blended ? blendByDate : null);
        } catch {
          periods = null;
        }
      }
      const narrative = (periods ?? []).map((p) => ({
        dow: p.dow,
        date: p.date ?? null,
        shortForecast: p.shortForecast,
        condition: p.condition,
        highF: p.high,
        lowF: p.low,
        snowInches: p.snowInches,
        snowSource: p.snowSource ?? "nws_keyword",
        precipProbability: p.precipProbability,
        windMph: p.windSpeed,
        windDirection: p.windDirection,
        feelsLikeF: p.feelsLike,
      }));

      if (!blended && narrative.length === 0) {
        const note =
          resort.country === "US"
            ? "No stored model run for this resort yet and the National Weather Service did not answer; try again in a few minutes."
            : "No stored model run for this resort yet; the forecast job writes one every 6 hours.";
        return ok(`No forecast for ${resort.name}: ${note} Conditions and cams: ${canonicalUrl}`, {
          ...base, provider: "none", available: false, note, point: null, issuedAt: null, modelCount: 0, models: [], summary: null, days: [], periods: [],
        });
      }

      const provider = blended ? "blend" : "nws";
      const note = !blended
        ? "No stored model run yet: snow amounts in `periods` are keyword estimates from the NWS wording, not quantitative."
        : blended.point !== point
          ? `No ${point} point for this resort; showing ${blended.point}.`
          : null;
      const lines: string[] = [`# ${resort.name} forecast — ${canonicalUrl}`, ""];
      if (blended && summary) {
        lines.push(
          `**${summary.total7dIn} in next 7 days, ${summary.total14dIn} in over 14** (${blended.point}, blend of ${summary.models.length} models issued ${formatInstant(summary.issuedAt)}${summary.peak ? `; peak ${summary.peak.in} in on ${summary.peak.date}` : ""}).`,
          "",
          "| Date | Snow (in) | Band (25–75 %) | Models | High / Low °F | Weather |",
          "| --- | --- | --- | --- | --- | --- |",
          ...days.map((d) => `| ${d.date} | ${d.snowfallIn} | ${d.snowfallLoIn}–${d.snowfallHiIn} | ${d.modelCount} | ${d.tempMaxF ?? "–"} / ${d.tempMinF ?? "–"} | ${d.condition} |`),
          "",
        );
      }
      if (narrative.length) {
        lines.push(
          `NWS narrative${blended ? " (snow amounts from the blend)" : " (snow amounts are keyword estimates)"}:`,
          "",
          ...narrative.map((p) => `- ${p.dow}${p.date ? ` ${p.date}` : ""}: ${p.shortForecast}, high ${p.highF}${p.lowF != null ? ` / low ${p.lowF}` : ""} °F${p.snowInches ? `, ~${p.snowInches} in` : ""}`),
          "",
        );
      }
      lines.push(`${OPEN_METEO_ATTRIBUTION} (${OPEN_METEO_LICENSE}). Every model run: ${base.forecastUrl}`);
      return ok(lines.join("\n"), {
        ...base,
        provider,
        available: true,
        note,
        point: blended?.point ?? null,
        issuedAt: blended?.issuedAt ?? null,
        modelCount: blended?.blend.modelCount ?? 0,
        models: blended?.blend.models ?? [],
        summary,
        days,
        periods: narrative,
      });
    },
  });

  const compareModels = defineTool({
    name: "compare_models",
    title: "Compare forecast models",
    description:
      "How each weather model has verified at a resort over the trailing 90 days, graded against measured snow (SNOTEL depth change, clipped at zero), and what each model says for the next 7 days right now. Per model: rank, mean absolute error at day 1/3/7 (cm), bias ratio (total forecast over total measured; above 1 over-forecasts), samples, plus the current 7-day total and horizon. `truthBasis` and `measuredDays` say what the grading rested on; a resort with no measured series has no scores. The PeakCam blend is graded by the same rule and appears as `blend`.",
    inputSchema: z.object({ slug: SlugInput }),
    outputSchema: z.object({
      slug: z.string(),
      name: z.string(),
      canonicalUrl: z.string(),
      accuracyUrl: z.string(),
      periodDays: z.number().int(),
      truthBasis: ForecastTruthBasisSchema,
      measuredDays: z.number().int(),
      station: StationSchema.nullable(),
      scoredPoint: z.enum(["summit", "base"]).nullable(),
      bestModel: z.string().nullable(),
      scores: z.array(ForecastScoreSchema).describe("Ranked; empty until the scorer has measured days."),
      outlook: z
        .array(
          z.object({
            model: z.string(),
            label: z.string(),
            point: z.enum(["summit", "base"]),
            issuedAt: z.string(),
            horizonDays: z.number().int(),
            total7dIn: z.number(),
            total7dCm: z.number(),
          }),
        )
        .describe("The newest stored run per model: what each says for the next 7 days."),
      blendTotal7dIn: z.number().nullable(),
      note: z.string().nullable(),
      credits: z.array(ForecastCreditSchema),
      generatedAt: ISO_INSTANT,
    }),
    async handler({ slug }) {
      const catalog = await data.catalog();
      const hit = resolve(catalog, slug);
      if (!hit.ok) return hit.result;
      const resort = hit.resort;
      const canonicalUrl = resortCanonicalUrl(resort.slug);
      let accuracy: AccuracyInput = { scores: [], measuredDays: 0, truthBasis: "none" };
      try {
        accuracy = await data.forecastAccuracy(resort);
      } catch {
        /* no scores: the document says so */
      }
      let stored: StoredForecast | null = null;
      try {
        stored = await data.forecastRuns(resort.id);
      } catch {
        stored = null;
      }
      const doc = serializeForecastAccuracy(resort, accuracy, { now: catalog.now });
      const picked = runsForPoint(stored, "summit");
      const outlook = picked.runs
        .map((run) => {
          const cm = Math.round(run.daily.slice(0, 7).reduce((s, d) => s + (d.snowfallCm ?? 0), 0) * 10) / 10;
          return { model: run.model, label: modelLabel(run.model), point: run.point, issuedAt: run.issuedAt, horizonDays: run.horizonDays, total7dIn: Math.round(cmToInches(cm) * 10) / 10, total7dCm: cm };
        })
        .sort((a, b) => b.total7dIn - a.total7dIn);
      const blended = blendForPoint(stored, "summit");
      const blendTotal7dIn = blended ? Math.round(cmToInches(blended.blend.total7dCm) * 10) / 10 : null;
      const note =
        doc.models.length === 0
          ? accuracy.truthBasis === "none"
            ? "No measured snow series at this resort, so no model is graded here; the outlook still shows what each model says."
            : `Scores arrive once the daily scorer has measured days to grade (${accuracy.measuredDays} so far).`
          : null;
      const lines = [
        `# ${resort.name}: forecast models — ${canonicalUrl}`,
        "",
        doc.models.length
          ? `Graded against ${doc.truthBasis === "snotel" ? "SNOTEL-measured 24 h snow" : doc.truthBasis === "ghcn" ? "station-measured new snow" : "no measured series"} on ${doc.measuredDays} days of the last ${doc.periodDays}${doc.station?.name ? ` (${doc.station.name})` : ""}; best: ${doc.bestModel}.`
          : note ?? "",
        "",
        ...(doc.models.length
          ? [
              "| Rank | Model | Day-1 MAE cm | Day-3 | Day-7 | Bias | Days |",
              "| --- | --- | --- | --- | --- | --- | --- |",
              ...doc.models.map((m) => `| ${m.rank} | ${modelLabel(m.model)} | ${m.day1Mae ?? "–"} | ${m.day3Mae ?? "–"} | ${m.day7Mae ?? "–"} | ${m.biasRatio ?? "–"} | ${m.samples ?? "–"} |`),
              "",
            ]
          : []),
        ...(outlook.length
          ? [
              `Next 7 days by model (${picked.point}${blendTotal7dIn != null ? `; blend ${blendTotal7dIn} in` : ""}):`,
              "",
              ...outlook.map((o) => `- ${o.label}: ${o.total7dIn} in (${o.horizonDays}-day horizon, issued ${formatInstant(o.issuedAt)})`),
              "",
            ]
          : ["No stored model run yet.", ""]),
        `${OPEN_METEO_ATTRIBUTION} (${OPEN_METEO_LICENSE}). Detail: ${resortApiUrl(resort.slug)}/forecast-accuracy`,
      ];
      return ok(lines.join("\n"), {
        slug: resort.slug,
        name: resort.name,
        canonicalUrl,
        accuracyUrl: `${resortApiUrl(resort.slug)}/forecast-accuracy`,
        periodDays: doc.periodDays,
        truthBasis: doc.truthBasis,
        measuredDays: doc.measuredDays,
        station: doc.station,
        scoredPoint: doc.scoredPoint,
        bestModel: doc.bestModel,
        scores: doc.models,
        outlook,
        blendTotal7dIn,
        note,
        credits: FORECAST_CREDITS,
        generatedAt: catalog.now.toISOString(),
      });
    },
  });

  const HistoryRowSchema = z.object({
    date: z.string().describe("YYYY-MM-DD, station-local day."),
    snowDepthIn: z.number().nullable(),
    sweIn: z.number().nullable().describe("Snow water equivalent, inches."),
    precipAccumIn: z.number().nullable().describe("Water-year precipitation accumulation, inches."),
    tempMaxF: z.number().nullable(),
    tempMinF: z.number().nullable(),
    qcFlag: z.string().describe("`valid`, `suspect`, `missing` or `corrected` from PeakCam's quality control."),
  });

  const getSnowHistory = defineTool({
    name: "get_snow_history",
    title: "Snow history",
    description: `Daily snow depth, snow water equivalent, precipitation accumulation and temperatures for the last 1–${MAX_HISTORY_DAYS} days at the resort's station (SNOTEL where there is one, Open-Meteo model otherwise), newest first. Use it for \"how has the base changed this week\" questions. Pass \`season\` (\`2024-25\`, or \`current\`) for a whole season's daily depth and new-snow rows instead of the last N days; get_season_stats summarises a season.`,
    inputSchema: z.object({
      slug: SlugInput,
      days: z.number().int().min(1).max(MAX_HISTORY_DAYS).default(14).describe(`Days back, 1–${MAX_HISTORY_DAYS}. Ignored when \`season\` is set.`),
      season: z
        .string()
        .trim()
        .regex(/^(current|\d{4}(-\d{2})?)$/)
        .optional()
        .describe("A season label (`2024-25` for the Northern water year, `2026` for an Andes resort) or `current`: returns every daily row of that season, oldest first, with daily new snow."),
    }),
    outputSchema: z.object({
      slug: z.string(),
      name: z.string(),
      canonicalUrl: z.string(),
      source: MeasurementSourceSchema.nullable(),
      station: StationSchema.nullable(),
      days: z.number().int(),
      season: z.string().nullable().describe("The season label when `season` was asked for; null for a last-N-days read."),
      count: z.number().int(),
      rows: z.array(HistoryRowSchema.extend({ newSnowIn: z.number().nullable().optional().describe("Daily new snow (positive depth change), season reads only.") })),
      generatedAt: ISO_INSTANT,
    }),
    async handler({ slug, days, season }) {
      const catalog = await data.catalog();
      const hit = resolve(catalog, slug);
      if (!hit.ok) return hit.result;
      const resort = hit.resort;
      const options = serializeOptionsFor(catalog, resort);
      let seasonRef: SeasonRef | null = null;
      let rows: Array<{ date: string; snowDepthIn: number | null; sweIn: number | null; precipAccumIn: number | null; tempMaxF: number | null; tempMinF: number | null; qcFlag: string; newSnowIn?: number | null }>;
      let raw: Awaited<ReturnType<typeof data.snowHistory>> = [];
      if (season) {
        const hemisphere = hemisphereOf(resort.lat);
        const today = catalog.now.toISOString().slice(0, 10);
        seasonRef = season === "current" ? seasonOf(today, hemisphere) : seasonOf(hemisphere === "south" ? `${season.slice(0, 4)}-06-01` : `${season.slice(0, 4)}-12-01`, hemisphere);
        const history = await readHistory(data, resort);
        if (!history) return err("Season history is not available right now (the daily archive could not be read). Try days instead of season.");
        const start = seasonRef.startDate;
        const nextStart = `${Number(start.slice(0, 4)) + 1}${start.slice(4)}`;
        rows = history.rows
          .filter((r) => r.date >= start && r.date < nextStart)
          .map((r) => ({ date: r.date, snowDepthIn: r.snowDepthIn, sweIn: r.sweIn, precipAccumIn: null, tempMaxF: null, tempMinF: null, qcFlag: r.qcFlag, newSnowIn: r.newSnowIn }));
      } else {
        raw = await data.snowHistory(resort.id, days);
        rows = raw
          .slice(0, days)
          .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
          .map((r) => ({
            date: r.date,
            snowDepthIn: r.snow_depth_in,
            sweIn: r.swe_in,
            precipAccumIn: r.precip_accum_in,
            tempMaxF: r.temp_max_f,
            tempMinF: r.temp_min_f,
            qcFlag: r.qc_flag,
          }));
      }
      const source: MeasurementSource | null = raw[0]
        ? raw[0].station_id === "open-meteo"
          ? "open_meteo"
          : "snotel"
        : resort.snotel_station_id
          ? "snotel"
          : rows.length
            ? "open_meteo"
            : null;
      const station = source === "snotel" ? snowStation(serializeSnow(resort, options)) : null;
      const canonicalUrl = serializeResortLight(resort, options).canonicalUrl;
      const newest = seasonRef ? rows[rows.length - 1] : rows[0];
      const oldest = seasonRef ? rows[0] : rows[rows.length - 1];
      const change =
        newest && oldest && newest !== oldest && newest.snowDepthIn != null && oldest.snowDepthIn != null
          ? ` Depth ${oldest.date} → ${newest.date}: ${formatInches(oldest.snowDepthIn)} → ${formatInches(newest.snowDepthIn)} (${newest.snowDepthIn - oldest.snowDepthIn >= 0 ? "+" : ""}${newest.snowDepthIn - oldest.snowDepthIn} in).`
          : "";
      const stationText = formatStation(station);
      const seasonTotal = seasonRef ? rows.reduce((s, r) => s + (r.newSnowIn ?? 0), 0) : 0;
      const lines = [
        seasonRef
          ? `# ${resort.name} season ${seasonRef.label} daily history (${rows.length} rows from ${seasonRef.startDate}, ${sourceLabel(source)}${stationText ? `, station ${stationText}` : ""}) — ${canonicalUrl}/history`
          : `# ${resort.name} snow history, last ${days} days (${rows.length} rows, ${sourceLabel(source)}${stationText ? `, station ${stationText}` : ""}) — ${canonicalUrl}`,
        "",
        ...(rows.length
          ? seasonRef
            ? [
                `Measured snowfall over the season: ${formatInches(Math.round(seasonTotal * 10) / 10)} (sum of daily depth increases). Oldest first; the table is capped at 60 rows, the structured result carries all ${rows.length}.`,
                "",
                "| Date | Depth | New snow | SWE | QC |",
                "| --- | --- | --- | --- | --- |",
                ...rows.slice(0, 60).map((r) => `| ${r.date} | ${formatInches(r.snowDepthIn)} | ${formatInches(r.newSnowIn ?? null)} | ${formatInches(r.sweIn)} | ${r.qcFlag} |`),
                "",
                `Season summary: get_season_stats("${resort.slug}"). Page: ${canonicalUrl}/history`,
              ]
            : [
                "| Date | Depth | SWE | Precip accum | Max / Min °F | QC |",
                "| --- | --- | --- | --- | --- | --- |",
                ...rows.map(
                  (r) =>
                    `| ${r.date} | ${formatInches(r.snowDepthIn)} | ${formatInches(r.sweIn)} | ${formatInches(r.precipAccumIn)} | ${r.tempMaxF ?? "–"} / ${r.tempMinF ?? "–"} | ${r.qcFlag} |`,
                ),
                "",
                `Newest first.${change}`,
              ]
          : [seasonRef ? `No daily rows on file for season ${seasonRef.label}.` : "No daily rows on file for this resort yet."]),
      ];
      return ok(lines.join("\n"), { slug: resort.slug, name: resort.name, canonicalUrl, source, station, days: seasonRef ? rows.length : days, season: seasonRef?.label ?? null, count: rows.length, rows, generatedAt: catalog.now.toISOString() });
    },
  });

  const OpeningEntrySchema = z.object({
    slug: z.string(),
    name: z.string(),
    canonicalUrl: z.string(),
    state: z.string(),
    country: z.string(),
    season: SeasonSchema,
  });

  const getOpeningDates = defineTool({
    name: "get_opening_dates",
    title: "Opening dates",
    description:
      "Season opening and closing dates with status (open / closed / unknown) for every resort, or those in one state/province, soonest opening first. Confirmed dates come from the resort; projected ones are third-party estimates.",
    inputSchema: z.object({
      state: StateInput,
      limit: z.number().int().min(1).max(MAX_OPENING_ROWS).default(50).describe(`Rows to return, 1–${MAX_OPENING_ROWS}.`),
    }),
    outputSchema: z.object({
      asOf: z.string().describe("YYYY-MM-DD (US Pacific) the statuses were evaluated for."),
      filters: z.object({ state: z.string().nullable() }),
      count: z.number().int(),
      totalMatching: z.number().int().describe("Resorts that matched before `limit` was applied."),
      resorts: z.array(OpeningEntrySchema),
      generatedAt: ISO_INSTANT,
    }),
    async handler({ state, limit }) {
      const catalog = await data.catalog();
      const matched = catalog.resorts
        .filter((r) => !state || sameCode(r.state, state))
        .map((r) => {
          const options = serializeOptionsFor(catalog, r);
          return {
            slug: r.slug,
            name: r.name,
            canonicalUrl: serializeResortLight(r, options).canonicalUrl,
            state: r.state,
            country: r.country,
            season: serializeSeason(r, options),
          };
        })
        .sort((a, b) => {
          const da = a.season.openDate ?? a.season.closingDate ?? "9999";
          const db = b.season.openDate ?? b.season.closingDate ?? "9999";
          return da < db ? -1 : da > db ? 1 : a.name.localeCompare(b.name, "en");
        });
      const rows = matched.slice(0, limit);
      const asOf = rows[0]?.season.asOf ?? serializeSeason(catalog.resorts[0] ?? ({ lat: 0 } as ResortWithData), { now: catalog.now }).asOf;
      const lines = [
        `Season dates${state ? ` for ${state}` : ""} as of ${asOf} (${rows.length}${matched.length > rows.length ? ` of ${matched.length}` : ""}):`,
        "",
        ...(rows.length
          ? rows.map((r) => `- **${r.name}** (\`${r.slug}\`, ${r.state}): ${seasonSummary(r.season)}${r.season.sourceUrl ? ` · source ${r.season.sourceUrl}` : ""} · ${r.canonicalUrl}`)
          : [`No resorts${state ? ` in ${state}` : ""}.`]),
        "",
        "`confirmed` = announced by the resort; `projected` = third-party estimate; `unknown` = no usable date on file.",
      ];
      return ok(lines.join("\n"), {
        asOf,
        filters: { state: state ?? null },
        count: rows.length,
        totalMatching: matched.length,
        resorts: rows,
        generatedAt: catalog.now.toISOString(),
      });
    },
  });

  // ── P9 block 1: tools over data already in production ────────

  const ProfileLocationSchema = z.object({
    region: z.string(),
    state: z.string().describe("Code as stored (`CO`, `BC`) or the country name for Andes resorts."),
    stateLabel: z.string().describe("Spelled out (`Colorado`, `British Columbia`, `Chile`)."),
    country: z.string().describe("ISO 3166-1 alpha-2."),
    lat: z.number(),
    lon: z.number(),
    baseElevationFt: z.number().nullable(),
    summitElevationFt: z.number().nullable(),
  });

  const getResortProfile = defineTool({
    name: "get_resort_profile",
    title: "Resort profile",
    description:
      "Who and where a resort is, without the snow numbers: location and elevations, website and social links, PeakCam's cam page, the SNOTEL station its numbers come from (if any), season status, cam counts, and every URL PeakCam publishes for it (page, JSON, markdown, Atom feed, state hub). Use get_resort_conditions for today's snow.",
    inputSchema: z.object({ slug: SlugInput }),
    outputSchema: z.object({
      slug: z.string(),
      name: z.string(),
      canonicalUrl: z.string().describe("The resort's PeakCam page. Cite this."),
      urls: z.object({
        api: z.string(),
        markdown: z.string().describe("The page as markdown (also the MCP resource peakcam://resorts/{slug})."),
        cams: z.string().describe("JSON cam list."),
        powderFeed: z.string().describe("Per-resort Atom feed of powder events."),
        stateHub: z.string().describe("PeakCam's webcam hub for the resort's state, province or country."),
      }),
      location: ProfileLocationSchema,
      websiteUrl: z.string().nullable().describe("The operator's site."),
      camPageUrl: z.string().nullable().describe("The operator's own webcam page, when PeakCam records one."),
      socials: z.object({ x: z.string().nullable(), facebook: z.string().nullable(), instagram: z.string().nullable() }),
      station: StationSchema.nullable().describe("The NRCS station PeakCam reads for this resort; null means model estimates."),
      dataSource: MeasurementSourceSchema.nullable().describe("Source of the latest snow report, so you know which label to use."),
      season: SeasonSchema,
      camCount: z.number().int(),
      liveCamCount: z.number().int(),
      generatedAt: ISO_INSTANT,
    }),
    async handler({ slug }) {
      const catalog = await data.catalog();
      const hit = resolve(catalog, slug);
      if (!hit.ok) return hit.result;
      const resort = hit.resort;
      const options = serializeOptionsFor(catalog, resort);
      const snow = serializeSnow(resort, options);
      const station = snowStation(snow) ?? (resort.snotel_station_id ? { id: resort.snotel_station_id, name: null, elevationFt: null } : null);
      const canonicalUrl = resortCanonicalUrl(resort.slug);
      const doc = {
        slug: resort.slug,
        name: resort.name,
        canonicalUrl,
        urls: {
          api: resortApiUrl(resort.slug),
          markdown: `${canonicalUrl}/index.md`,
          cams: `${resortApiUrl(resort.slug)}/cams`,
          powderFeed: `${canonicalUrl}/powder.xml`,
          stateHub: `${SITE_URL}${stateHubPath(resort.state)}`,
        },
        location: {
          region: resort.region,
          state: resort.state,
          stateLabel: stateLabel(resort.state),
          country: resort.country,
          lat: resort.lat,
          lon: resort.lng,
          baseElevationFt: options.elevation?.baseFt ?? null,
          summitElevationFt: options.elevation?.summitFt ?? null,
        },
        websiteUrl: resort.website_url,
        camPageUrl: resort.cam_page_url,
        socials: { x: resort.x_url, facebook: resort.facebook_url, instagram: resort.instagram_url },
        station,
        dataSource: snow?.source ?? null,
        season: serializeSeason(resort, options),
        camCount: resort.cams.length,
        liveCamCount: resort.cams.filter((c) => camLive(c) === true).length,
        generatedAt: catalog.now.toISOString(),
      };
      const elev = doc.location.baseElevationFt != null || doc.location.summitElevationFt != null
        ? ` Elevation: base ${doc.location.baseElevationFt?.toLocaleString("en-US") ?? "n/a"} ft, summit ${doc.location.summitElevationFt?.toLocaleString("en-US") ?? "n/a"} ft.`
        : "";
      const stationText = formatStation(station);
      const lines = [
        `# ${resort.name} — ${canonicalUrl}`,
        "",
        `${doc.location.region}, ${doc.location.stateLabel}, ${doc.location.country} (${resort.lat}, ${resort.lng}).${elev}`,
        `Season: ${seasonSummary(doc.season)}`,
        `Snow data: ${stationText ? `SNOTEL station ${stationText}` : "weather-model estimates (no station assigned)"}.`,
        `Cams: ${doc.camCount} (${doc.liveCamCount} live).${resort.cam_page_url ? ` Operator cam page: ${resort.cam_page_url}` : ""}`,
        resort.website_url ? `Website: ${resort.website_url}` : "Website: not on file",
        `Socials: ${[resort.x_url, resort.facebook_url, resort.instagram_url].filter(Boolean).join(", ") || "none on file"}`,
        "",
        `JSON ${doc.urls.api} · markdown ${doc.urls.markdown} · Atom ${doc.urls.powderFeed} · hub ${doc.urls.stateHub}`,
      ];
      return ok(lines.join("\n"), doc);
    },
  });

  const PctEntrySchema = z.object({
    rank: z.number().int(),
    slug: z.string(),
    name: z.string(),
    canonicalUrl: z.string(),
    state: z.string(),
    pctOfNormal: z.number().describe("SWE as a percent of the station's 1991–2020 median for today's date in the water year."),
    sweIn: z.number().describe("Snow water equivalent at the station, inches."),
    station: StationSchema.nullable(),
    measuredAt: z.string().describe("ISO instant of the report."),
  });

  const getPercentOfNormal = defineTool({
    name: "get_percent_of_normal",
    title: "Percent of normal",
    description:
      "SNOTEL-fed resorts ranked by snowpack relative to normal: snow water equivalent against the station's own 1991–2020 median for today's date, deepest first, optionally within one state. Only measured station readings qualify, inside the 10–300 % band and above 2 in of SWE; early-season noise is withheld, not ranked. Same data as https://www.peakcam.io/snow-report/percent-of-normal.",
    inputSchema: z.object({
      state: StateInput,
      limit: z.number().int().min(1).max(MAX_PCT_ROWS).default(10).describe(`Rows to return, 1–${MAX_PCT_ROWS}.`),
    }),
    outputSchema: z.object({
      asOf: z.string().nullable().describe("ISO instant of the newest report the ranking used."),
      phase: z.enum(["pre-season", "early", "season"]).describe("`pre-season`/`early`: nothing rankable yet, see `sentence` for why."),
      sentence: z.string().describe("The dated, quotable summary sentence."),
      rule: z.string().describe("The publishable-value rule, in words."),
      filters: z.object({ state: z.string().nullable() }),
      stationFedCount: z.number().int().describe("Resorts whose latest report is a SNOTEL reading (the pool)."),
      count: z.number().int(),
      totalMatching: z.number().int(),
      results: z.array(PctEntrySchema),
      pageUrl: z.string(),
      generatedAt: ISO_INSTANT,
    }),
    async handler({ state, limit }) {
      const catalog = await data.catalog();
      const pool = catalog.resorts.filter((r) => !state || sameCode(r.state, state));
      const page = buildPctOfNormalPage(pool, catalog.now);
      const bySlug = new Map(pool.map((r) => [r.slug, r]));
      const results = page.ranked.slice(0, limit).map((e, i) => {
        const resort = bySlug.get(e.slug)!;
        const station = snowStation(serializeSnow(resort, serializeOptionsFor(catalog, resort)));
        return {
          rank: i + 1,
          slug: e.slug,
          name: e.name,
          canonicalUrl: resortCanonicalUrl(e.slug),
          state: resort.state,
          pctOfNormal: e.pct,
          sweIn: e.sweIn,
          station,
          measuredAt: new Date(e.updatedAt).toISOString(),
        };
      });
      const lines = [
        `Snowpack percent of normal${state ? ` in ${stateLabel(state)}` : ""} (${results.length}${page.ranked.length > results.length ? ` of ${page.ranked.length}` : ""} rankable; ${page.stationFedCount} SNOTEL-fed resorts in the pool):`,
        "",
        page.sentence.text,
        "",
        ...(results.length
          ? results.map((r) => `${r.rank}. **${r.name}** (\`${r.slug}\`, ${r.state}) — ${r.pctOfNormal} % of normal, SWE ${formatInches(r.sweIn)}${formatStation(r.station) ? ` at ${formatStation(r.station)}` : ""}, ${formatInstant(r.measuredAt)} · ${r.canonicalUrl}`)
          : ["Nothing to rank yet."]),
        "",
        PCT_OF_NORMAL_RULE,
        `Page: ${SITE_URL}/snow-report/percent-of-normal`,
      ];
      return ok(lines.join("\n"), {
        asOf: page.asOf,
        phase: page.phase,
        sentence: page.sentence.text,
        rule: PCT_OF_NORMAL_RULE,
        filters: { state: state ?? null },
        stationFedCount: page.stationFedCount,
        count: results.length,
        totalMatching: page.ranked.length,
        results,
        pageUrl: `${SITE_URL}/snow-report/percent-of-normal`,
        generatedAt: catalog.now.toISOString(),
      });
    },
  });

  const RegionSchema = z.object({
    state: z.string().describe("The value to pass as `state` to other tools."),
    label: z.string(),
    country: z.string(),
    resorts: z.number().int(),
    reporting: z.number().int().describe("Resorts with a snow report."),
    measured: z.number().int().describe("Resorts whose latest report is a SNOTEL station reading."),
    cams: z.number().int().describe("Active cams."),
    liveCams: z.number().int(),
    hubUrl: z.string().describe("PeakCam's webcam hub page for the region."),
  });

  const listRegions = defineTool({
    name: "list_regions",
    title: "List regions",
    description:
      "Every state, province and country PeakCam covers, with resort, reporting, measured (SNOTEL) and cam counts and the hub page URL. Call it to learn the valid `state` values for find_powder, get_opening_dates and get_percent_of_normal, or to answer \"where does PeakCam have data\".",
    inputSchema: z.object({}),
    outputSchema: z.object({
      totalResorts: z.number().int(),
      countries: z.array(z.object({ country: z.string(), resorts: z.number().int() })),
      regions: z.array(RegionSchema).describe("Most resorts first."),
      generatedAt: ISO_INSTANT,
    }),
    async handler() {
      const catalog = await data.catalog();
      const groups = new Map<string, ResortWithData[]>();
      for (const r of catalog.resorts) {
        const list = groups.get(r.state) ?? [];
        list.push(r);
        groups.set(r.state, list);
      }
      const regions = [...groups.entries()]
        .map(([state, rows]) => ({
          state,
          label: stateLabel(state),
          country: rows[0].country,
          resorts: rows.length,
          reporting: rows.filter((r) => r.snow_report).length,
          measured: rows.filter((r) => r.snow_report?.source === "snotel").length,
          cams: rows.reduce((n, r) => n + r.cams.length, 0),
          liveCams: rows.reduce((n, r) => n + r.cams.filter((c) => camLive(c) === true).length, 0),
          hubUrl: `${SITE_URL}${stateHubPath(state)}`,
        }))
        .sort((a, b) => b.resorts - a.resorts || a.label.localeCompare(b.label, "en"));
      const byCountry = new Map<string, number>();
      for (const r of catalog.resorts) byCountry.set(r.country, (byCountry.get(r.country) ?? 0) + 1);
      const countries = [...byCountry.entries()].map(([country, resorts]) => ({ country, resorts })).sort((a, b) => b.resorts - a.resorts);
      const lines = [
        `PeakCam covers ${catalog.resorts.length} resorts in ${regions.length} states, provinces and countries (${countries.map((c) => `${c.country} ${c.resorts}`).join(", ")}), as of ${formatInstant(catalog.now.toISOString())}:`,
        "",
        "| State | Resorts | Reporting | SNOTEL-measured | Cams live/total | Hub |",
        "| --- | --- | --- | --- | --- | --- |",
        ...regions.map((r) => `| ${r.label} (\`${r.state}\`, ${r.country}) | ${r.resorts} | ${r.reporting} | ${r.measured} | ${r.liveCams}/${r.cams} | ${r.hubUrl} |`),
        "",
        "Pass the code in backticks as `state` to find_powder, get_opening_dates or get_percent_of_normal.",
      ];
      return ok(lines.join("\n"), { totalResorts: catalog.resorts.length, countries, regions, generatedAt: catalog.now.toISOString() });
    },
  });

  const AlertChannelSchema = z.object({
    kind: z.enum(["email", "webhook", "atom", "ical", "resort_atom"]),
    title: z.string(),
    how: z.string().describe("What a person or agent does to use it."),
    url: z.string().nullable().describe("Where to go, or a URL template."),
    authentication: z.string(),
  });

  const getAlertOptions = defineTool({
    name: "get_alert_options",
    title: "Alert options",
    description:
      "How to be told when it snows, without this server writing anything: the powder-alert threshold and schedule, the e-mail, webhook (Standard Webhooks, signed), Atom and iCal channels, the per-resort public Atom feed, the webhook payload contract, and the manage page where a person registers a destination. Pass a slug to get that resort's feed URL.",
    inputSchema: z.object({
      slug: SlugInput.optional().describe("Optional: a resort slug, to fill in its public Atom feed URL."),
    }),
    outputSchema: z.object({
      thresholdInches: z.number().describe("New snow in 24 h (measured) or storm total (forecast) that fires an alert."),
      schedule: z.string(),
      manageUrl: z.string().describe("Where a person subscribes and registers webhooks; e-mail verified, no password."),
      channels: z.array(AlertChannelSchema),
      resortFeed: z.object({ slug: z.string(), name: z.string(), atomUrl: z.string() }).nullable(),
      webhook: z.object({
        headers: z.array(z.string()),
        signature: z.string(),
        payloadExample: z.record(z.string(), z.unknown()),
        retries: z.string(),
        docsUrl: z.string(),
      }),
      writes: z.literal(false).describe("This tool never subscribes anyone; it only explains how."),
      generatedAt: ISO_INSTANT,
    }),
    async handler({ slug }) {
      const catalog = await data.catalog();
      let resortFeed: { slug: string; name: string; atomUrl: string } | null = null;
      if (slug) {
        const hit = resolve(catalog, slug);
        if (!hit.ok) return hit.result;
        resortFeed = { slug: hit.resort.slug, name: hit.resort.name, atomUrl: `${resortCanonicalUrl(hit.resort.slug)}/powder.xml` };
      }
      const manageUrl = `${SITE_URL}/alerts/manage`;
      const channels = [
        { kind: "email" as const, title: "E-mail powder alerts", how: `Subscribe at ${SITE_URL}/alerts with an e-mail address and the resorts to follow; a verification link activates it.`, url: `${SITE_URL}/alerts`, authentication: "e-mail verification; a capability link manages the subscription" },
        { kind: "webhook" as const, title: "Signed webhook", how: "On the manage page, add a destination URL. Each alert is POSTed as JSON and signed per Standard Webhooks; the secret is shown once.", url: manageUrl, authentication: "webhook-signature (HMAC-SHA256) on every delivery" },
        { kind: "atom" as const, title: "Subscriber Atom feed", how: "The manage page shows a private Atom URL carrying this subscriber's alerts; paste it into any feed reader or poller.", url: `${SITE_URL}/alerts/feed/{manage_token}`, authentication: "capability token in the URL" },
        { kind: "ical" as const, title: "Subscriber iCal feed", how: "The same URL with ?format=ics is a calendar of forecast storm windows for the followed resorts.", url: `${SITE_URL}/alerts/feed/{manage_token}?format=ics`, authentication: "capability token in the URL" },
        { kind: "resort_atom" as const, title: "Public per-resort Atom feed", how: "No account: one entry when a resort's report crosses the threshold or a storm is logged. Poll it or wire it to a routine.", url: resortFeed?.atomUrl ?? `${SITE_URL}/resorts/{slug}/powder.xml`, authentication: "none" },
      ];
      const payloadExample = {
        type: "powder.alert",
        resort: { slug: "alta", name: "Alta Ski Area", url: `${SITE_URL}/resorts/alta` },
        inches: 11,
        kind: "measured",
        measuredAt: "2026-12-01T12:30:00.000Z",
        url: `${SITE_URL}/resorts/alta`,
        threshold: 8,
      };
      const doc = {
        thresholdInches: 8,
        schedule: "Checked once a day at 13:00 UTC (06:00 Mountain) against the latest measured report and the Open-Meteo forecast.",
        manageUrl,
        channels,
        resortFeed,
        webhook: {
          headers: ["webhook-id", "webhook-timestamp", "webhook-signature"],
          signature: "v1,<base64(HMAC-SHA256(secret, \"<id>.<timestamp>.<raw body>\"))> — the secret is the base64 part after whsec_; reject timestamps more than 5 minutes off.",
          payloadExample,
          retries: "Three attempts per event (1 s, then 5 s), 5 s timeout each; a destination is disabled after ten consecutive failed runs.",
          docsUrl: `${SITE_URL}/connect#agents`,
        },
        writes: false as const,
        generatedAt: catalog.now.toISOString(),
      };
      const lines = [
        "# Getting told when it snows (PeakCam powder alerts)",
        "",
        `Threshold ${doc.thresholdInches} in in 24 h (measured) or as a storm total (forecast); ${doc.schedule}`,
        `Manage page (subscribe, add webhooks, copy feeds): ${manageUrl}`,
        "",
        ...channels.map((c) => `- **${c.title}** (${c.kind}) — ${c.how} URL: ${c.url} · auth: ${c.authentication}`),
        "",
        `Webhook deliveries carry ${doc.webhook.headers.join(", ")}; verify with any Standard Webhooks library. Payload example: \`${JSON.stringify(payloadExample)}\`.`,
        "",
        "This tool writes nothing: a person registers destinations on the manage page.",
      ];
      return ok(lines.join("\n"), doc);
    },
  });

  const TimelineFrameSchema = z.object({
    url: z.string().describe("Public image URL of the archived frame. Link it; do not describe it unseen."),
    capturedAt: z.string().describe("ISO instant PeakCam captured it."),
    snow24hAtCapture: z.number().nullable().describe("The resort's 24 h new-snow number when the frame was taken."),
    keeper: z.boolean().describe(`True when captured during a storm (≥ ${KEEPER_MIN_SNOW_24H_IN} in in 24 h); kept a year instead of 30 days.`),
  });

  const getCamTimeline = defineTool({
    name: "get_cam_timeline",
    title: "Cam timeline",
    description:
      `Archived still frames for a resort's webcams (or one cam) over the last 1–${MAX_TIMELINE_HOURS} hours, as links with capture times, plus the newest storm frame on tape per cam. Only cams whose operator allows archiving appear; PeakCam captures every 6 hours. Use it for "what did it look like this morning" or "show me the last storm". Frames are never returned inline.`,
    inputSchema: z.object({
      slug: SlugInput,
      camId: z.string().uuid().optional().describe("Optional: one cam's id from get_resort_cams; default is every archived cam at the resort."),
      hours: z.number().int().min(1).max(MAX_TIMELINE_HOURS).default(24).describe(`Window, 1–${MAX_TIMELINE_HOURS} hours.`),
    }),
    outputSchema: z.object({
      slug: z.string(),
      name: z.string(),
      canonicalUrl: z.string(),
      hours: z.number().int(),
      camCount: z.number().int().describe("Cams with at least one frame in the result."),
      frameCount: z.number().int(),
      newestCapturedAt: z.string().nullable(),
      lastStorm: TimelineFrameSchema.extend({ camId: z.string(), camName: z.string() }).nullable().describe("Newest storm frame across the resort, any age."),
      cams: z.array(
        z.object({
          camId: z.string(),
          camName: z.string(),
          pageUrl: z.string(),
          frames: z.array(TimelineFrameSchema).describe(`Oldest first, at most ${MAX_TIMELINE_FRAMES_PER_CAM}, all inside the window.`),
          lastStorm: TimelineFrameSchema.nullable(),
        }),
      ),
      note: z.string(),
      generatedAt: ISO_INSTANT,
    }),
    async handler({ slug, camId, hours }) {
      const catalog = await data.catalog();
      const hit = resolve(catalog, slug);
      if (!hit.ok) return hit.result;
      const resort = hit.resort;
      const h = clampHours(hours);
      if (camId && !resort.cams.some((c) => c.id === camId)) {
        return err(`Cam ${camId} is not an active cam at ${resort.name}. get_resort_cams(\"${resort.slug}\") lists its cams and ids.`);
      }
      let frames: CamTimelineFrame[] | null;
      try {
        frames = await data.camStills(camId ? { camId } : { resortId: resort.id }, h);
      } catch {
        frames = null;
      }
      const canonicalUrl = resortCanonicalUrl(resort.slug);
      const since = catalog.now.getTime() - h * 3_600_000;
      const camOrder = resort.cams.map((c) => c.id);
      const byCam = new Map<string, CamTimelineFrame[]>();
      for (const f of frames ?? []) {
        const list = byCam.get(f.camId) ?? [];
        list.push(f);
        byCam.set(f.camId, list);
      }
      const strip = (f: CamTimelineFrame) => ({ url: f.url, capturedAt: f.capturedAt, snow24hAtCapture: f.snow24hAtCapture, keeper: f.keeper });
      const cams = [...byCam.entries()]
        .sort((a, b) => camOrder.indexOf(a[0]) - camOrder.indexOf(b[0]))
        .slice(0, MAX_TIMELINE_CAMS)
        .map(([id, list]) => {
          const cam = resort.cams.find((c) => c.id === id);
          const newestFirst = [...list].sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt));
          const inWindow = newestFirst.filter((f) => Date.parse(f.capturedAt) >= since);
          const keeper = newestFirst.find((f) => f.keeper) ?? null;
          return {
            camId: id,
            camName: cam?.name ?? id,
            pageUrl: `${canonicalUrl}#cam-${id}`,
            frames: inWindow.slice(0, MAX_TIMELINE_FRAMES_PER_CAM).reverse().map(strip),
            lastStorm: keeper ? strip(keeper) : null,
          };
        })
        .filter((c) => c.frames.length || c.lastStorm);
      const all = cams.flatMap((c) => c.frames.map((f) => f.capturedAt));
      const newestCapturedAt = all.length ? all.sort().at(-1)! : null;
      const storms = cams.filter((c) => c.lastStorm).map((c) => ({ ...c.lastStorm!, camId: c.camId, camName: c.camName }));
      const lastStorm = storms.sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt))[0] ?? null;
      const frameCount = cams.reduce((n, c) => n + c.frames.length, 0);
      const note = frames === null
        ? "The frame archive was unavailable for this request; live cams are on the resort page."
        : frameCount || lastStorm
          ? "Frames are PeakCam captures of operator-permitted cams; rights stay with the operator. Link them, do not describe them unseen."
          : "No archived frames for this window: the resort's cams may be player-only (no archiving permission) or the archive has not run yet.";
      const lines = [
        `# ${resort.name} cam timeline, last ${h} h (${frameCount} frames from ${cams.filter((c) => c.frames.length).length} cams) — ${canonicalUrl}`,
        "",
        ...(cams.length
          ? cams.flatMap((c) => [
              `## ${c.camName}`,
              ...c.frames.map((f) => `- ${formatInstant(f.capturedAt)} — ${f.url}${f.keeper ? " (storm)" : ""}${f.snow24hAtCapture != null ? ` · 24 h ${formatInches(f.snow24hAtCapture)} at capture` : ""}`),
              c.lastStorm ? `- last storm on tape: ${formatInstant(c.lastStorm.capturedAt)} — ${c.lastStorm.url}` : "- no storm frame on tape",
              "",
            ])
          : [note, ""]),
        note,
      ];
      return ok(lines.join("\n"), {
        slug: resort.slug,
        name: resort.name,
        canonicalUrl,
        hours: h,
        camCount: cams.filter((c) => c.frames.length).length,
        frameCount,
        newestCapturedAt,
        lastStorm,
        cams,
        note,
        generatedAt: catalog.now.toISOString(),
      });
    },
  });

  // ── get_stations (station layer, migration 026) ───────────
  const ROLE_WORD = { summit: "Summit", mid: "Mid-mountain", base: "Base", approach: "Approach" } as const;
  const ageWord = (minutes: number) => (minutes < 60 ? `${minutes} min ago` : minutes < 2880 ? `${Math.round(minutes / 60)} h ago` : `${Math.round(minutes / 1440)} d ago`);

  const getStations = defineTool({
    name: "get_stations",
    title: "Nearby stations",
    description:
      "What the instruments near one resort measured, by elevation band (summit / mid / base): up to three stations within 25 km with the network named (SNOTEL, GHCN-Daily, NWS, BC ASWS, ECCC), elevation, distance, the time of the reading and its age, snow depth, new snow, SWE, temperature and wind. Daily networks carry depth; hourly ones carry temperature and wind. Use it for \"what is it like at the top right now\" and \"how old is that number\" questions; the snow report itself comes from get_resort_conditions.",
    inputSchema: z.object({ slug: SlugInput }),
    outputSchema: z.object({
      slug: z.string(),
      name: z.string(),
      canonicalUrl: z.string(),
      available: z.boolean().describe("False when the station layer is not populated for this deployment yet."),
      count: z.number().int(),
      stations: z.array(ObservationStationSchema),
      measuredNow: z.array(MeasuredNowSchema),
      sources: z.array(z.object({ source: z.string(), label: z.string(), attribution: z.string(), termsUrl: z.string() })),
      generatedAt: ISO_INSTANT,
    }),
    async handler({ slug }) {
      const catalog = await data.catalog();
      const hit = resolve(catalog, slug);
      if (!hit.ok) return hit.result;
      const resort = hit.resort;
      const options = serializeOptionsFor(catalog, resort);
      const canonicalUrl = resortCanonicalUrl(resort.slug);
      const rows = options.observationStations;
      const layer = rows ? serializeStations(rows, catalog.now) : { stations: [], measuredNow: [] };
      const used = [...new Set(layer.measuredNow.map((m) => m.source))];
      const sources = used.map((source) => ({ source, label: STATION_SOURCES[source].label, attribution: STATION_SOURCES[source].attribution, termsUrl: STATION_SOURCES[source].termsUrl }));
      const lines = [`# ${resort.name}: nearby stations, as of ${formatInstant(catalog.now.toISOString())} — ${canonicalUrl}`, ""];
      if (!rows) {
        lines.push("The station layer is not populated for this deployment yet; get_resort_conditions carries the SNOTEL or model report.");
      } else if (!layer.measuredNow.length) {
        lines.push(`No observation station within 25 km of ${resort.name} is on file. get_resort_conditions carries the resort's snow report.`);
      } else {
        lines.push("| Band | Station | Network | Elev | Dist | Depth | New | SWE | Temp | Wind | Read |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
        for (const m of layer.measuredNow) {
          lines.push(
            `| ${ROLE_WORD[m.role]} | ${m.name ?? m.sourceId} (\`${m.sourceId}\`) | ${STATION_SOURCES[m.source].label} | ${m.elevationFt != null ? `${m.elevationFt.toLocaleString("en-US")} ft` : "–"} | ${m.distanceKm != null ? `${m.distanceKm.toFixed(1)} km` : "–"} | ${formatInches(m.snowDepthIn)} | ${formatInches(m.newSnowIn)} | ${formatInches(m.sweIn)} | ${m.tempF != null ? `${m.tempF} °F` : "–"} | ${m.windMph != null ? `${m.windMph} mph` : "–"} | ${formatInstant(m.observedAt)} (${ageWord(m.ageMinutes)}) |`,
          );
        }
        lines.push("", "Each row is one sensor at its own elevation, not a mountain average. Daily networks are stamped at the end of their day; an hourly row older than a few hours means the sensor has gone quiet.", "", `Attribution: ${sources.map((s) => s.attribution).join("; ")}.`);
      }
      return ok(lines.join("\n"), {
        slug: resort.slug,
        name: resort.name,
        canonicalUrl,
        available: rows != null,
        count: layer.stations.length,
        stations: layer.stations,
        measuredNow: layer.measuredNow,
        sources,
        generatedAt: catalog.now.toISOString(),
      });
    },
  });

  const baseTools = [
    searchResorts,
    getResortConditions,
    getResortCams,
    findPowder,
    compareResorts,
    getForecast,
    getSnowHistory,
    getOpeningDates,
    getResortProfile,
    getPercentOfNormal,
    listRegions,
    getAlertOptions,
    getCamTimeline,
    getStations,
    compareModels,
  ] as unknown as ToolDefinition[];

  const ask = defineTool({
    name: "ask",
    title: "Ask PeakCam",
    description:
      "One natural-language question in, one tool result out, deterministically: the router resolves the resort by name or nickname, picks an intent from the wording (snow, open/closed, forecast, cams, history, compare, where did it snow, percent of normal, profile, regions, alerts) and calls the matching tool. Returns the tool's data, the resort, citation URLs and a dated sentence to quote. Answers `answerable: false` with suggestions rather than guessing. No language model is involved.",
    inputSchema: z.object({
      question: z.string().trim().min(1).max(MAX_QUESTION_LENGTH).describe(`The question as the user asked it, up to ${MAX_QUESTION_LENGTH} characters, e.g. "is Alta open" or "where did it snow most in Colorado".`),
    }),
    outputSchema: AskAnswerSchema,
    async handler({ question }) {
      const answer = await answerQuestion({ tools: baseTools, data }, question, { via: "mcp", ipHash: null });
      const lines = [
        answer.sentence,
        "",
        answer.tool ? `Routed to ${answer.tool}(${JSON.stringify(answer.arguments)}) — intent ${answer.intent}.` : `Not answerable (${answer.intent}).`,
        answer.citations.length ? `Cite: ${answer.citations.join(", ")}` : "",
        answer.suggestions.length ? `Try: ${answer.suggestions.slice(0, 3).map((s) => `"${s}"`).join(" · ")}` : "",
      ].filter((l, i, arr) => l !== "" || (i > 0 && arr[i - 1] !== ""));
      return answer.answerable
        ? ok(lines.join("\n"), answer as unknown as Record<string, unknown>)
        : { content: [{ type: "text", text: lines.join("\n") }], structuredContent: answer as unknown as Record<string, unknown> };
    },
  });

  // P5: season stats, monthly climatology and the leaderboards, after `ask`
  // so the name tuple's order is the registration order.
  const historyTools = buildHistoryTools(data) as unknown as ToolDefinition[];

  return [...baseTools, ask as unknown as ToolDefinition, ...historyTools];
}

export { camLine };

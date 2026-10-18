// ─────────────────────────────────────────────────────────────
// MCP server — the nine read-only tools, as pure builders.
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
import {
  CamListSchema,
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
  rankPowder,
  serializeCams,
  serializeResort,
  serializeResortLight,
  serializeSeason,
  serializeSnow,
  serializeStations,
  type ResortElevation,
  type SerializeOptions,
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
import type { McpDataSource } from "./types";

// ── Limits ───────────────────────────────────────────────────

/** Cams per tool payload; the page URL carries the rest. */
export const MAX_CAMS = 12;
/** `snowpack_daily` rows per get_snow_history call. */
export const MAX_HISTORY_DAYS = 30;
export const MAX_SEARCH_RESULTS = 20;
export const MAX_POWDER_RESULTS = 25;
export const MAX_COMPARE = 6;
export const MAX_OPENING_ROWS = 150;

export const PEAKCAM_TOOL_NAMES = [
  "search_resorts",
  "get_resort_conditions",
  "get_resort_cams",
  "find_powder",
  "compare_resorts",
  "get_forecast",
  "get_snow_history",
  "get_opening_dates",
  "get_stations",
] as const;
export type PeakCamToolName = (typeof PEAKCAM_TOOL_NAMES)[number];

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

// ── Catalogue helpers ────────────────────────────────────────

/**
 * Mirrors `optionsFor()` in lib/public-api/data.ts, which cannot be imported
 * here because that module pulls in next/cache and the Supabase client at
 * load time (the tests run without either). Keep the two in step.
 */
export function serializeOptionsFor(catalog: PublicApiCatalog, resort: ResortWithData): SerializeOptions {
  const row = catalog.elevations[resort.id];
  const elevation: ResortElevation | null = row ? { baseFt: row.base_ft, summitFt: row.summit_ft } : null;
  return {
    now: catalog.now,
    opening: catalog.openings.get(resort.id) ?? null,
    elevation,
    observationStations: catalog.stations ? (catalog.stations[resort.id] ?? []) : null,
  };
}

/** Lowercase ASCII words: strips accents and punctuation (`Mt. Bachelor` → `mt bachelor`). */
export function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function bigrams(value: string): Map<string, number> {
  const out = new Map<string, number>();
  const s = value.replace(/\s+/g, "");
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    out.set(g, (out.get(g) ?? 0) + 1);
  }
  return out;
}

/** Sørensen–Dice similarity on character bigrams, 0..1. Cheap typo tolerance. */
export function diceSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const ga = bigrams(a);
  const gb = bigrams(b);
  let overlap = 0;
  for (const [g, n] of ga) overlap += Math.min(n, gb.get(g) ?? 0);
  const total = [...ga.values()].reduce((s, n) => s + n, 0) + [...gb.values()].reduce((s, n) => s + n, 0);
  return total ? (2 * overlap) / total : 0;
}

/**
 * Optimal-string-alignment edit distance (insert, delete, substitute, swap
 * adjacent). Catches the transpositions bigrams miss (`vial` → `vail`).
 */
export function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) => [i, ...new Array<number>(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[m][n];
}

/** 0 = no match; 100 = exact name or slug. */
export function scoreResort(query: string, resort: ResortWithData): number {
  const q = normalizeText(query);
  if (!q) return 0;
  const name = normalizeText(resort.name);
  const slug = resort.slug.replace(/-/g, " ");
  if (q === name || q === slug) return 100;
  if (name.startsWith(q) || slug.startsWith(q)) return 85;
  if (name.includes(q) || slug.includes(q)) return 70;
  const haystack = `${name} ${slug} ${normalizeText(resort.region)} ${normalizeText(resort.state)} ${normalizeText(resort.country)}`;
  if (q.split(" ").every((t) => haystack.includes(t))) return 50;
  const sim = Math.max(diceSimilarity(q, name), diceSimilarity(q, slug));
  if (sim >= 0.45) return Math.round(sim * 40);
  // One edit per four characters, at least one: a typo, not a different resort.
  const budget = Math.max(1, Math.floor(Math.min(q.length, name.length) / 4));
  const distance = Math.min(editDistance(q, name), editDistance(q, slug));
  return distance <= budget ? 30 - distance * 5 : 0;
}

function sameCode(a: string | null | undefined, b: string | null | undefined): boolean {
  return normalizeText(a ?? "") === normalizeText(b ?? "");
}

export interface MatchFilters {
  state?: string | null;
  country?: string | null;
  limit?: number;
}

/** Resorts ranked by `scoreResort`, filtered by state/country, zero scores dropped. */
export function matchResorts(resorts: readonly ResortWithData[], query: string, filters: MatchFilters = {}): ResortWithData[] {
  const limit = filters.limit ?? 10;
  return resorts
    .filter((r) => (!filters.state || sameCode(r.state, filters.state)) && (!filters.country || sameCode(r.country, filters.country)))
    .map((r) => ({ r, score: scoreResort(query, r) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.r.name.localeCompare(b.r.name, "en"))
    .slice(0, limit)
    .map((x) => x.r);
}

/** Up to five resorts whose slug or name is close to a slug that did not resolve. */
export function closeMatches(resorts: readonly ResortWithData[], slug: string, limit = 5): ResortWithData[] {
  return matchResorts(resorts, slug.replace(/-/g, " "), { limit });
}

export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,99}$/.test(slug);
}

export function findResort(catalog: PublicApiCatalog, slug: string): ResortWithData | null {
  if (!isValidSlug(slug)) return null;
  return catalog.resorts.find((r) => r.slug === slug) ?? null;
}

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

  const ForecastPeriodSchema = z.object({
    dow: z.string().describe("`Today`, then three-letter weekday."),
    date: z.string().nullable().describe("YYYY-MM-DD when NWS supplies it."),
    shortForecast: z.string().describe("NWS short forecast text, e.g. `Snow Likely`."),
    condition: z.string().describe("PeakCam condition key derived from the text."),
    highF: z.number(),
    lowF: z.number().nullable(),
    snowInchesEstimate: z
      .number()
      .describe("Keyword heuristic from the forecast text (blizzard/heavy snow 8, snow 3, flurries 1, else 0). Not a quantitative forecast; say so when quoting it."),
    precipProbability: z.number().nullable().describe("Percent."),
    windMph: z.number().nullable(),
    windDirection: z.string().nullable(),
    feelsLikeF: z.number().nullable().describe("Wind-chill adjusted high."),
  });

  const getForecast = defineTool({
    name: "get_forecast",
    title: "Resort forecast",
    description:
      "Five-day National Weather Service forecast for a US resort (daily high/low, text forecast, precipitation chance, wind) with a rough snow estimate derived from the forecast wording. NWS covers US resorts only; Canadian and Andes resorts return available=false.",
    inputSchema: z.object({ slug: SlugInput }),
    outputSchema: z.object({
      slug: z.string(),
      name: z.string(),
      canonicalUrl: z.string(),
      provider: z.literal("nws"),
      available: z.boolean(),
      note: z.string().nullable(),
      periods: z.array(ForecastPeriodSchema),
      generatedAt: ISO_INSTANT,
    }),
    async handler({ slug }) {
      const catalog = await data.catalog();
      const hit = resolve(catalog, slug);
      if (!hit.ok) return hit.result;
      const resort = hit.resort;
      const base = {
        slug: resort.slug,
        name: resort.name,
        canonicalUrl: serializeResortLight(resort, serializeOptionsFor(catalog, resort)).canonicalUrl,
        provider: "nws" as const,
        generatedAt: catalog.now.toISOString(),
      };
      const unavailable = (note: string) =>
        ok(`No forecast for ${resort.name}: ${note} Conditions and cams: ${base.canonicalUrl}`, { ...base, available: false, note, periods: [] });
      if (resort.country !== "US") return unavailable("the National Weather Service covers US resorts only, and PeakCam has no forecast feed for other countries yet.");
      let periods: WeatherPeriod[] | null;
      try {
        periods = await data.forecast(resort);
      } catch {
        periods = null;
      }
      if (!periods?.length) return unavailable("the National Weather Service did not answer for this point; try again in a few minutes.");
      const out = periods.map((p) => ({
        dow: p.dow,
        date: p.date ?? null,
        shortForecast: p.shortForecast,
        condition: p.condition,
        highF: p.high,
        lowF: p.low,
        snowInchesEstimate: p.snowInches,
        precipProbability: p.precipProbability,
        windMph: p.windSpeed,
        windDirection: p.windDirection,
        feelsLikeF: p.feelsLike,
      }));
      const lines = [
        `# ${resort.name} forecast (NWS, fetched ${formatInstant(base.generatedAt)}) — ${base.canonicalUrl}`,
        "",
        "| Day | Forecast | High / Low °F | Precip % | Wind | Snow est. |",
        "| --- | --- | --- | --- | --- | --- |",
        ...out.map(
          (p) =>
            `| ${p.dow}${p.date ? ` ${p.date}` : ""} | ${p.shortForecast} | ${p.highF} / ${p.lowF ?? "–"} | ${p.precipProbability ?? "–"} | ${p.windMph != null ? `${p.windMph} mph${p.windDirection ? ` ${p.windDirection}` : ""}` : "–"} | ${p.snowInchesEstimate ? `~${p.snowInchesEstimate} in` : "–"} |`,
        ),
        "",
        "Snow estimates are keyword heuristics from the NWS wording, not quantitative precipitation forecasts. Source: api.weather.gov.",
      ];
      return ok(lines.join("\n"), { ...base, available: true, note: null, periods: out });
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
    description: `Daily snow depth, snow water equivalent, precipitation accumulation and temperatures for the last 1–${MAX_HISTORY_DAYS} days at the resort's station (SNOTEL where there is one, Open-Meteo model otherwise), newest first. Use it for \"how has the base changed this week\" questions.`,
    inputSchema: z.object({
      slug: SlugInput,
      days: z.number().int().min(1).max(MAX_HISTORY_DAYS).default(14).describe(`Days back, 1–${MAX_HISTORY_DAYS}.`),
    }),
    outputSchema: z.object({
      slug: z.string(),
      name: z.string(),
      canonicalUrl: z.string(),
      source: MeasurementSourceSchema.nullable(),
      station: StationSchema.nullable(),
      days: z.number().int(),
      count: z.number().int(),
      rows: z.array(HistoryRowSchema),
      generatedAt: ISO_INSTANT,
    }),
    async handler({ slug, days }) {
      const catalog = await data.catalog();
      const hit = resolve(catalog, slug);
      if (!hit.ok) return hit.result;
      const resort = hit.resort;
      const options = serializeOptionsFor(catalog, resort);
      const raw = await data.snowHistory(resort.id, days);
      const rows = raw
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
      const source: MeasurementSource | null = raw[0]
        ? raw[0].station_id === "open-meteo"
          ? "open_meteo"
          : "snotel"
        : resort.snotel_station_id
          ? "snotel"
          : null;
      const station = source === "snotel" ? snowStation(serializeSnow(resort, options)) : null;
      const canonicalUrl = serializeResortLight(resort, options).canonicalUrl;
      const newest = rows[0];
      const oldest = rows[rows.length - 1];
      const change =
        newest && oldest && newest !== oldest && newest.snowDepthIn != null && oldest.snowDepthIn != null
          ? ` Depth ${oldest.date} → ${newest.date}: ${formatInches(oldest.snowDepthIn)} → ${formatInches(newest.snowDepthIn)} (${newest.snowDepthIn - oldest.snowDepthIn >= 0 ? "+" : ""}${newest.snowDepthIn - oldest.snowDepthIn} in).`
          : "";
      const stationText = formatStation(station);
      const lines = [
        `# ${resort.name} snow history, last ${days} days (${rows.length} rows, ${sourceLabel(source)}${stationText ? `, station ${stationText}` : ""}) — ${canonicalUrl}`,
        "",
        ...(rows.length
          ? [
              "| Date | Depth | SWE | Precip accum | Max / Min °F | QC |",
              "| --- | --- | --- | --- | --- | --- |",
              ...rows.map(
                (r) =>
                  `| ${r.date} | ${formatInches(r.snowDepthIn)} | ${formatInches(r.sweIn)} | ${formatInches(r.precipAccumIn)} | ${r.tempMaxF ?? "–"} / ${r.tempMinF ?? "–"} | ${r.qcFlag} |`,
              ),
              "",
              `Newest first.${change}`,
            ]
          : ["No daily rows on file for this resort yet."]),
      ];
      return ok(lines.join("\n"), { slug: resort.slug, name: resort.name, canonicalUrl, source, station, days, count: rows.length, rows, generatedAt: catalog.now.toISOString() });
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
      const canonicalUrl = serializeResortLight(resort, options).canonicalUrl;
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

  return [
    searchResorts,
    getResortConditions,
    getResortCams,
    findPowder,
    compareResorts,
    getForecast,
    getSnowHistory,
    getOpeningDates,
    getStations,
  ] as unknown as ToolDefinition[];
}

export { camLine };

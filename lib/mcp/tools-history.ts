// ─────────────────────────────────────────────────────────────
// MCP server — the P5 history tools: get_season_stats,
// get_monthly_climatology, get_leaderboard. Pure builders like tools.ts;
// the documents are the /api/v1 shapes from lib/public-api/history.ts so
// a client that understands the REST routes understands these. When the
// data source predates P5 (no `resortHistory` / `seasonAggregates`), the
// tools answer with `available: false` rather than erroring.
// ─────────────────────────────────────────────────────────────

import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/server";
import type { ResortWithData } from "@/lib/types";
import { SITE_URL } from "@/lib/site";
import { stateLabel } from "@/lib/hubs";
import { LEADERBOARD_COPY, LEADERBOARD_KINDS, leaderboardWindow, type LeaderboardKind } from "@/lib/leaderboards";
import { POWDER_DAY_IN, inchesLabel } from "@/lib/season-stats";
import { buildLeaderboardDocument, buildMonthlyClimatology, buildSeasonStats } from "@/lib/public-api/history";
import type { ResortHistoryData } from "@/lib/public-api/data";
import { LeaderboardSchema, MonthlyClimatologySchema, SeasonStatsSchema, type MeasurementSource } from "@/lib/public-api/schema";
import { formatInches, formatInstant, formatStation, sourceLabel } from "@/lib/public-api/markdown";
import type { McpDataSource } from "./types";
import { findResort, sameCode } from "./catalog";
import { closeMatches } from "./catalog";

/** Rows per get_leaderboard call. */
export const MAX_LEADERBOARD_ROWS = 50;

function ok(markdown: string, structured: Record<string, unknown>): CallToolResult {
  return { content: [{ type: "text", text: markdown }], structuredContent: structured };
}

function err(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

const SlugInput = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(100)
  .describe("PeakCam resort slug, lowercase kebab-case, e.g. `breckenridge`. Get it from search_resorts.");

const StateInput = z
  .string()
  .trim()
  .min(2)
  .max(40)
  .optional()
  .describe("US state or Canadian province code (`CO`, `UT`, `BC`), or for the Andes the country name PeakCam lists (`Chile`, `Argentina`). Case-insensitive.");

/** Shared by tools.ts: the daily rows and normals for a resort, or null when the source predates P5. */
export async function readHistory(data: McpDataSource, resort: ResortWithData): Promise<ResortHistoryData | null> {
  if (!data.resortHistory) return null;
  try {
    return await data.resortHistory(resort);
  } catch {
    return null;
  }
}

const UNAVAILABLE = "Season history is not available right now (the daily archive could not be read). Today's numbers: get_resort_conditions.";
const EMPTY: ResortHistoryData = { rows: [], normals: [], monthly: [] };

export interface HistoryToolDefinition<I extends z.ZodObject = z.ZodObject, O extends z.ZodObject = z.ZodObject> {
  name: "get_season_stats" | "get_monthly_climatology" | "get_leaderboard";
  title: string;
  description: string;
  inputSchema: I;
  outputSchema: O;
  handler: (args: z.output<I>) => Promise<CallToolResult>;
}

function define<I extends z.ZodObject, O extends z.ZodObject>(def: HistoryToolDefinition<I, O>): HistoryToolDefinition<I, O> {
  return def;
}

function notFound(resorts: readonly ResortWithData[], slug: string): CallToolResult {
  const close = closeMatches(resorts, slug);
  const hint = close.length ? ` Did you mean: ${close.map((r) => `${r.slug} (${r.name})`).join(", ")}?` : "";
  return err(`No active resort with slug "${slug}".${hint} Use search_resorts to look a resort up by name.`);
}

export function buildHistoryTools(data: McpDataSource) {
  const getSeasonStats = define({
    name: "get_season_stats",
    title: "Season stats",
    description:
      `Season-to-date for one resort from PeakCam's own daily station record: measured snowfall since the season start (daily new snow = the positive change in station depth, a floor on what fell), days measured, snow days, powder days (${POWDER_DAY_IN} in or more, the alert threshold), current and deepest base, percent of the 30-winter normal to this day and of the recent decade (with a baselineNote when they disagree by more than 10 %), the same day last year, a 7-day trend and a dated sentence to quote. Use it for "how is the season going", "is this a good year", "how does it compare with last year".`,
    inputSchema: z.object({ slug: SlugInput }),
    outputSchema: SeasonStatsSchema.extend({ available: z.boolean() }),
    async handler({ slug }) {
      const catalog = await data.catalog();
      const resort = findResort(catalog, slug);
      if (!resort) return notFound(catalog.resorts, slug);
      const history = await readHistory(data, resort);
      const doc = buildSeasonStats(resort, history ?? EMPTY, { now: catalog.now });
      if (!history) return ok(`${UNAVAILABLE}\n\nPage: ${doc.pageUrl}`, { ...doc, sentence: UNAVAILABLE, available: false });
      const p = doc.percentOfNormal;
      const station = formatStation(doc.station);
      const lines = [
        `# ${doc.name} season ${doc.season.label} to date — ${doc.pageUrl}`,
        "",
        doc.sentence,
        "",
        `- Snowfall since ${doc.season.startDate}: ${formatInches(doc.seasonToDateIn)} (${doc.daysMeasured} days measured, ${doc.snowDays} snow days, ${doc.powderDays} powder days at ≥ ${doc.powderDayThresholdIn} in)`,
        `- Base now ${formatInches(doc.currentBaseIn)}${doc.deepestBase ? `; deepest ${formatInches(doc.deepestBase.depthIn)} on ${doc.deepestBase.date}` : ""}`,
        p.thirtyYear != null
          ? `- Percent of normal to date: ${p.thirtyYear}% of the ${p.normalYears ?? 30}-winter mean (${formatInches(p.normalToDateIn)})${p.recentDecade != null ? `; ${p.recentDecade}% of the last ${p.recentYears ?? 10} winters (${formatInches(p.recentNormalToDateIn)})` : ""}`
          : "- Percent of normal: not available (no station normal for this resort)",
        p.baselineNote ? `- ${p.baselineNote}` : null,
        doc.lastYear
          ? `- Same day last season (${doc.lastYear.season.label}): ${formatInches(doc.lastYear.seasonToDateIn)}, ${doc.lastYear.powderDays} powder days, base ${formatInches(doc.lastYear.baseOnSameDayIn)}; this season is ${doc.lastYear.diffIn >= 0 ? "+" : ""}${doc.lastYear.diffIn} in${doc.lastYear.pctOfLastYear != null ? ` (${doc.lastYear.pctOfLastYear}% of last year)` : ""}`
          : "- No rows for last season on file",
        `- Trend: ${doc.trend.direction} (last 7 days ${formatInches(doc.trend.last7In)}, the 7 before ${formatInches(doc.trend.prior7In)})`,
        "",
        `Source: ${doc.source ? sourceLabel(doc.source === "open_meteo" ? "open_meteo" : "snotel") : "no daily record"}${station ? `, station ${station}` : ""}. Dated ${doc.asOf ?? "n/a"} (station day). JSON: ${doc.apiUrl}`,
      ].filter((l): l is string => l != null);
      return ok(lines.join("\n"), { ...doc, available: true });
    },
  });

  const getMonthlyClimatology = define({
    name: "get_monthly_climatology",
    title: "Monthly climatology",
    description:
      "Average snowfall, snow days (≥ 1 in), depth and the biggest storm per calendar month at the resort's SNOTEL station, over the 30 most recent complete winters and, separately, the 10 most recent, with the recent decade as a percent of the 30-winter figure and a note when they differ by more than 10 %. Use it for \"which month is snowiest\", \"how much does it usually snow in January\". Resorts without a station normal answer available: false.",
    inputSchema: z.object({ slug: SlugInput }),
    outputSchema: MonthlyClimatologySchema,
    async handler({ slug }) {
      const catalog = await data.catalog();
      const resort = findResort(catalog, slug);
      if (!resort) return notFound(catalog.resorts, slug);
      const history = await readHistory(data, resort);
      const doc = buildMonthlyClimatology(resort, history ?? EMPTY, { now: catalog.now });
      if (!history) return ok(`${UNAVAILABLE}\n\nPage: ${doc.pageUrl}`, { ...doc, note: UNAVAILABLE });
      const rows = doc.months.filter((m) => m.thirtyYear.yearsTracked > 0 || m.recentDecade.yearsTracked > 0);
      const snowiest = [...rows].sort((a, b) => (b.thirtyYear.avgSnowfallIn ?? 0) - (a.thirtyYear.avgSnowfallIn ?? 0))[0];
      const lines = [
        `# ${doc.name} monthly climatology${doc.station ? ` (${formatStation(doc.station)})` : ""} — ${doc.pageUrl}`,
        "",
        ...(doc.available
          ? [
              snowiest ? `Snowiest month on the 30-winter average: ${snowiest.label} (${formatInches(snowiest.thirtyYear.avgSnowfallIn)}).` : "",
              "",
              "| Month | Avg snowfall (30 yr) | Last 10 winters | Snow days | Avg depth | Biggest storm | Years |",
              "| --- | --- | --- | --- | --- | --- | --- |",
              ...rows.map(
                (m) =>
                  `| ${m.label} | ${formatInches(m.thirtyYear.avgSnowfallIn)} | ${formatInches(m.recentDecade.avgSnowfallIn)}${m.recentVsThirtyPct != null ? ` (${m.recentVsThirtyPct}%)` : ""} | ${m.thirtyYear.avgSnowDays ?? "–"} | ${formatInches(m.thirtyYear.avgDepthIn)} | ${m.thirtyYear.maxStormIn != null ? `${formatInches(m.thirtyYear.maxStormIn)} (${m.thirtyYear.maxStormStart})` : "–"} | ${m.thirtyYear.yearsTracked} |`,
              ),
              "",
              ...doc.months.filter((m) => m.baselineNote).map((m) => `- ${m.label}: ${m.baselineNote}`),
            ]
          : []),
        doc.note,
        `JSON: ${doc.apiUrl}`,
      ].filter((l, i, arr) => l !== "" || (i > 0 && arr[i - 1] !== ""));
      return ok(lines.join("\n"), doc);
    },
  });

  const getLeaderboard = define({
    name: "get_leaderboard",
    title: "Leaderboard",
    description:
      `Resorts ranked on one of four season boards: best-powder-this-week (measured new snow in the last 7 days), season-powder-days (days with ≥ ${POWDER_DAY_IN} in since Oct 1), deepest-base (latest station or model depth) and season-snowfall (measured new snow since Oct 1), optionally within one state and measured-only. The season boards cover the Northern hemisphere. Answers a dated sentence, the rule in words and rows with source and station. Same data as ${SITE_URL}/snow-report/{kind}.`,
    inputSchema: z.object({
      kind: z.enum(LEADERBOARD_KINDS).describe("Which board."),
      state: StateInput,
      sourceOnly: z.enum(["snotel"]).optional().describe("`snotel` keeps only station-measured rows."),
      limit: z.number().int().min(1).max(MAX_LEADERBOARD_ROWS).default(10).describe(`Rows to return, 1–${MAX_LEADERBOARD_ROWS}.`),
    }),
    outputSchema: LeaderboardSchema,
    async handler({ kind, state, sourceOnly, limit }) {
      const catalog = await data.catalog();
      const { seasonStart, weekStart } = leaderboardWindow(catalog.now);
      let aggregates = null;
      if (kind !== "deepest-base" && data.seasonAggregates) {
        try {
          aggregates = await data.seasonAggregates(seasonStart, weekStart);
        } catch {
          aggregates = null;
        }
      }
      const filters = { state: state ?? null, source: (sourceOnly as MeasurementSource | undefined) ?? null, limit };
      const { doc } = buildLeaderboardDocument(kind as LeaderboardKind, catalog.resorts, aggregates, catalog.now, filters);
      const copy = LEADERBOARD_COPY[kind as LeaderboardKind];
      const unit = (e: (typeof doc.results)[number]) => (e.unit === "days" ? `${e.value} ${e.value === 1 ? "day" : "days"}` : formatInches(e.value));
      const lines = [
        `# ${copy.title}${state ? ` — ${stateLabel(state)}` : ""} (${doc.count}${doc.totalMatching > doc.count ? ` of ${doc.totalMatching}` : ""} ranked; ${doc.pool} in the pool)`,
        "",
        doc.sentence,
        "",
        ...(doc.results.length
          ? doc.results.map((e) => {
              const station = formatStation(e.station);
              return `${e.rank}. **${e.name}** (\`${e.slug}\`, ${e.state}) — ${unit(e)}${e.detail ? ` · ${e.detail.label} ${e.detail.value}` : ""} · ${sourceLabel(e.source)}${station ? ` (${station})` : ""}${e.measuredAt ? `, ${formatInstant(e.measuredAt)}` : ""} · ${e.canonicalUrl}`;
            })
          : [doc.unavailable ? "Season totals are unavailable right now." : "Nothing to rank with these filters."]),
        "",
        copy.rule,
        `Page: ${doc.pageUrl}`,
      ];
      return ok(lines.join("\n"), doc);
    },
  });

  return [getSeasonStats, getMonthlyClimatology, getLeaderboard];
}

/** Re-exported for tools.ts's season filter on get_snow_history. */
export { inchesLabel, sameCode };

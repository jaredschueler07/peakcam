// ─────────────────────────────────────────────────────────────
// Public API v1 — the Snow Score documents (P7).
//
// Pure builders from stored `resort_scores` rows to the two shapes in
// schema.ts: `ResortScoreHistory` (today's score with components plus the
// 30-day history, served at /api/v1/resorts/{slug}/score-components and
// inside the MCP get_score tool) and `SnowReportList` (every resort as a
// light row, sorted by score when asked, at /api/v1/snow-report). The
// resort page's ring and sparkline, the homepage leaders and the markdown
// alternate read the same builders, so one score is one number everywhere.
// No Supabase, no Next.js; the tests build rows by hand.
// ─────────────────────────────────────────────────────────────

import type { ResortScoreRow, ResortWithData } from "@/lib/types";
import { SITE_URL } from "@/lib/site";
import { SCORE_HISTORY_DAYS, SCORE_RATING_LADDER, SCORE_VERSION, SCORE_WEIGHTS } from "@/lib/score";
import { scoreLeadersSentence, type ScoreLeader } from "@/lib/quotable";
import type { ResortOpening } from "@/lib/openings";
import { PUBLIC_API_ATTRIBUTION, PUBLIC_API_LICENSE_URL } from "./headers";
import type { ResortLightPublic, ResortScoreHistoryPublic, SnowReportListPublic, SnowReportSort } from "./schema";
import { resortApiUrl, resortCanonicalUrl, serializeResortLight, serializeScore, serializeScoreLight, type SerializeOptions } from "./serialize";

/** The fragment on the resort overview where the score card renders. */
export const SCORE_FRAGMENT = "#snow-score";

export interface ScoreDocumentInput {
  /** The newest row at most 3 days old (getLatestScoresIndex), or null. */
  today: ResortScoreRow | null;
  /** Rows over the trailing window, any order; null when the table could not be read. */
  history: readonly ResortScoreRow[] | null;
}

export interface ScoreDocumentOptions {
  now: Date;
  baseUrl?: string;
  days?: number;
}

export const SCORE_UNAVAILABLE = "No Snow Score for this resort yet: the daily scoring run has not written a row, or the score table is not served by this deployment.";

export function scorePageUrl(slug: string, baseUrl: string = SITE_URL): string {
  return `${resortCanonicalUrl(slug, baseUrl)}${SCORE_FRAGMENT}`;
}

export function buildScoreDocument(resort: ResortWithData, input: ScoreDocumentInput, opts: ScoreDocumentOptions): ResortScoreHistoryPublic {
  const baseUrl = opts.baseUrl ?? SITE_URL;
  const days = opts.days ?? SCORE_HISTORY_DAYS;
  const today = input.today ? serializeScore(resort, input.today) : null;
  const history = [...(input.history ?? [])]
    .filter((r) => r.resort_id === resort.id || !r.resort_id)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(serializeScoreLight);
  return {
    slug: resort.slug,
    name: resort.name,
    canonicalUrl: resortCanonicalUrl(resort.slug, baseUrl),
    apiUrl: `${resortApiUrl(resort.slug, baseUrl)}/score-components`,
    pageUrl: scorePageUrl(resort.slug, baseUrl),
    available: input.history != null && (today != null || history.length > 0),
    today,
    history,
    days,
    weights: { ...SCORE_WEIGHTS },
    ladder: { ...SCORE_RATING_LADDER },
    sentence: today ? today.tagline : SCORE_UNAVAILABLE,
    scoredBy: "algorithmic",
    version: SCORE_VERSION,
    methodologyUrl: `${baseUrl}/methodology#score`,
    attribution: PUBLIC_API_ATTRIBUTION,
    license: PUBLIC_API_LICENSE_URL,
    generatedAt: opts.now.toISOString(),
  };
}

// ── Ranking ──────────────────────────────────────────────────

/** Resorts with a current score, highest first, ties by name; unscored resorts are left out. */
export function rankByScore<T extends Pick<ResortWithData, "id" | "name" | "slug">>(resorts: readonly T[], scores: Readonly<Record<string, ResortScoreRow>> | null | undefined): Array<{ resort: T; row: ResortScoreRow }> {
  if (!scores) return [];
  const out: Array<{ resort: T; row: ResortScoreRow }> = [];
  for (const resort of resorts) {
    const row = scores[resort.id];
    if (row) out.push({ resort, row });
  }
  return out.sort((a, b) => Number(b.row.score) - Number(a.row.score) || a.resort.name.localeCompare(b.resort.name, "en"));
}

export function scoreLeaders<T extends Pick<ResortWithData, "id" | "name" | "slug">>(resorts: readonly T[], scores: Readonly<Record<string, ResortScoreRow>> | null | undefined, limit = 3): ScoreLeader[] {
  return rankByScore(resorts, scores)
    .slice(0, limit)
    .map(({ resort, row }) => ({ name: resort.name, slug: resort.slug, score: Math.round(Number(row.score)), date: row.date }));
}

// ── /api/v1/snow-report ──────────────────────────────────────

export interface SnowReportFilters {
  sort?: SnowReportSort;
  /** Case-insensitive `resorts.state` match. */
  state?: string | null;
}

const num = (v: number | string | null | undefined): number => {
  if (v == null) return -Infinity;
  const n = Number(v);
  return Number.isFinite(n) ? n : -Infinity;
};

function compareRows(sort: SnowReportSort): (a: ResortLightPublic, b: ResortLightPublic) => number {
  const byName = (a: ResortLightPublic, b: ResortLightPublic) => a.name.localeCompare(b.name, "en");
  switch (sort) {
    case "score":
      return (a, b) => num(b.score?.score) - num(a.score?.score) || num(b.snow?.newSnow24h) - num(a.snow?.newSnow24h) || byName(a, b);
    case "newSnow24h":
      return (a, b) => num(b.snow?.newSnow24h) - num(a.snow?.newSnow24h) || num(b.snow?.newSnow48h) - num(a.snow?.newSnow48h) || byName(a, b);
    case "baseDepth":
      return (a, b) => num(b.snow?.baseDepth) - num(a.snow?.baseDepth) || byName(a, b);
    default:
      return byName;
  }
}

/**
 * The snow-report table as light rows. `sort=score` puts the highest Snow
 * Score first and unscored resorts last (alphabetically); the other sorts
 * rank by the report. The dated sentence names the top scores among the
 * rows the filter kept, so a state view speaks about that state.
 */
export function serializeSnowReportList(
  resorts: readonly ResortWithData[],
  filters: SnowReportFilters,
  options: SerializeOptions & { openings?: ReadonlyMap<string, ResortOpening> } = {},
): SnowReportListPublic {
  const now = options.now ?? new Date();
  const sort: SnowReportSort = filters.sort ?? "name";
  const state = filters.state?.trim().toLowerCase() || null;
  const kept = state ? resorts.filter((r) => r.state.trim().toLowerCase() === state) : [...resorts];
  const rows = kept.map((r) => serializeResortLight(r, { ...options, now, opening: options.openings?.get(r.id) ?? null })).sort(compareRows(sort));
  const leaders = scoreLeaders(kept, options.scores);
  const scoredAsOf = rows.map((r) => r.score?.date ?? null).filter((d): d is string => d != null).sort().reverse()[0] ?? null;
  return {
    sort,
    state: filters.state?.trim() || null,
    scoredAsOf,
    sentence: scoreLeadersSentence(leaders).text,
    count: rows.length,
    resorts: rows,
    attribution: PUBLIC_API_ATTRIBUTION,
    license: PUBLIC_API_LICENSE_URL,
    generatedAt: now.toISOString(),
  };
}

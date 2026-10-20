import { z } from "zod";
import { loadPublicApiCatalog, loadSeasonAggregates } from "@/lib/public-api/data";
import { publicError, publicJson, publicOptions } from "@/lib/public-api/headers";
import { buildLeaderboardDocument } from "@/lib/public-api/history";
import { MeasurementSourceSchema } from "@/lib/public-api/schema";
import { LEADERBOARD_KINDS, isLeaderboardKind, leaderboardWindow } from "@/lib/leaderboards";

// GET /api/v1/leaderboards/{kind}?state=CO&source=snotel&limit=25 — one of
// the four season boards (best-powder-this-week, season-powder-days,
// deepest-base, season-snowfall), the JSON behind /snow-report/{kind} (P5).
// The two season-bound boards read the season_stats() function (migration
// 030) through a 15-minute Data Cache entry; deepest-base needs only the
// catalogue.

const QuerySchema = z.object({
  state: z.string().trim().min(1).max(40).optional(),
  source: MeasurementSourceSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(25),
});

export async function GET(request: Request, { params }: { params: Promise<{ kind: string }> }): Promise<Response> {
  const { kind } = await params;
  if (!isLeaderboardKind(kind)) {
    return publicError(404, "leaderboard_not_found", `No leaderboard "${kind}". Kinds: ${LEADERBOARD_KINDS.join(", ")}.`);
  }
  const url = new URL(request.url);
  const raw = Object.fromEntries(
    ["state", "source", "limit"].flatMap((k) => {
      const v = url.searchParams.get(k);
      return v === null || v === "" ? [] : [[k, v]];
    }),
  );
  const parsed = QuerySchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return publicError(400, "invalid_query", `${issue.path.join(".") || "query"}: ${issue.message}`);
  }
  const q = parsed.data;
  const catalog = await loadPublicApiCatalog();
  const { seasonStart, weekStart } = leaderboardWindow(catalog.now);
  const aggregates = kind === "deepest-base" ? null : await loadSeasonAggregates(seasonStart, weekStart);
  const { doc } = buildLeaderboardDocument(kind, catalog.resorts, aggregates, catalog.now, { state: q.state ?? null, source: q.source ?? null, limit: q.limit });
  return publicJson(doc);
}

export function OPTIONS(): Response {
  return publicOptions();
}

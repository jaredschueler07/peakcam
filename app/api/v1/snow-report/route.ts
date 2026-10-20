import { loadPublicApiCatalog } from "@/lib/public-api/data";
import { publicError, publicJson, publicOptions } from "@/lib/public-api/headers";
import { SNOW_REPORT_SORTS, type SnowReportSort } from "@/lib/public-api/schema";
import { serializeSnowReportList } from "@/lib/public-api/score";

// GET /api/v1/snow-report?sort=name|score|newSnow24h|baseDepth&state= — the
// snow-report table as light rows (P7). `sort=score` ranks by today's Snow
// Score, unscored resorts last; the dated sentence names the top scores
// among the rows the filter kept. Same caching note as /api/v1/resorts.

function isSort(value: string): value is SnowReportSort {
  return (SNOW_REPORT_SORTS as readonly string[]).includes(value);
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const sortRaw = url.searchParams.get("sort") ?? "name";
  if (!isSort(sortRaw)) return publicError(400, "invalid_sort", `sort must be one of ${SNOW_REPORT_SORTS.join(", ")}.`);
  const state = url.searchParams.get("state");
  if (state != null && (state.length === 0 || state.length > 40)) return publicError(400, "invalid_state", "state must be 1–40 characters.");
  const catalog = await loadPublicApiCatalog();
  const body = serializeSnowReportList(catalog.resorts, { sort: sortRaw, state }, { now: catalog.now, openings: catalog.openings, scores: catalog.scores ?? null });
  return publicJson(body);
}

export function OPTIONS(): Response {
  return publicOptions();
}

import { findResort, loadPublicApiCatalog, loadResortHistory } from "@/lib/public-api/data";
import { publicError, publicJson, publicOptions } from "@/lib/public-api/headers";
import { buildResortHistory } from "@/lib/public-api/history";

// GET /api/v1/resorts/{slug}/history — the current season's cumulative
// snowfall curve against the station's normal band, plus ten past seasons
// with weekly cumulative totals (P5). Same caching story as the resort
// route: OPTIONS makes the handler non-static, so the 15-minute policy is
// Cache-Control plus the Data Cache behind loadResortHistory().

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
  const { slug } = await params;
  const catalog = await loadPublicApiCatalog();
  const resort = findResort(catalog, slug);
  if (!resort) return publicError(404, "resort_not_found", `No active resort with slug "${slug}". List them at /api/v1/resorts.`);
  const data = await loadResortHistory(resort, catalog.now);
  return publicJson(buildResortHistory(resort, data, { now: catalog.now }));
}

export function OPTIONS(): Response {
  return publicOptions();
}

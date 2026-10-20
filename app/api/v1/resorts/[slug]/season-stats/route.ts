import { findResort, loadPublicApiCatalog, loadResortHistory } from "@/lib/public-api/data";
import { publicError, publicJson, publicOptions } from "@/lib/public-api/headers";
import { buildSeasonStats } from "@/lib/public-api/history";

// GET /api/v1/resorts/{slug}/season-stats — season-to-date snowfall, powder
// days, base, percent of normal on the 30-winter and recent-decade
// baselines, and the same day last year (P5).

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
  const { slug } = await params;
  const catalog = await loadPublicApiCatalog();
  const resort = findResort(catalog, slug);
  if (!resort) return publicError(404, "resort_not_found", `No active resort with slug "${slug}". List them at /api/v1/resorts.`);
  const data = await loadResortHistory(resort, catalog.now);
  return publicJson(buildSeasonStats(resort, data, { now: catalog.now }));
}

export function OPTIONS(): Response {
  return publicOptions();
}

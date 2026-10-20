import { findResort, loadPublicApiCatalog, loadResortHistory } from "@/lib/public-api/data";
import { publicError, publicJson, publicOptions } from "@/lib/public-api/headers";
import { buildMonthlyClimatology } from "@/lib/public-api/history";

// GET /api/v1/resorts/{slug}/monthly — monthly climatology at the resort's
// station on the 30-winter and recent-decade baselines (P5). Resorts
// without a station normal answer `available: false` with an empty list.

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
  const { slug } = await params;
  const catalog = await loadPublicApiCatalog();
  const resort = findResort(catalog, slug);
  if (!resort) return publicError(404, "resort_not_found", `No active resort with slug "${slug}". List them at /api/v1/resorts.`);
  const data = await loadResortHistory(resort, catalog.now);
  return publicJson(buildMonthlyClimatology(resort, data, { now: catalog.now }));
}

export function OPTIONS(): Response {
  return publicOptions();
}

import { findResort, loadPublicApiCatalog, loadResortScoreHistory } from "@/lib/public-api/data";
import { publicError, publicJson, publicOptions } from "@/lib/public-api/headers";
import { buildScoreDocument } from "@/lib/public-api/score";

// GET /api/v1/resorts/{slug}/score-components — today's Snow Score with its
// five components and the 30-day history (P7). Today's row comes from the
// catalogue's score index (the same row /resorts/{slug} carries); the
// history is one cached read per resort. A deployment without the table
// answers `available: false` rather than erroring.
// Caching: exporting OPTIONS makes the handler non-static, so the 15-minute
// policy rides on Cache-Control and the Data Cache, as on the other routes.

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
  const { slug } = await params;
  const catalog = await loadPublicApiCatalog();
  const resort = findResort(catalog, slug);
  if (!resort) return publicError(404, "resort_not_found", `No active resort with slug "${slug}". List them at /api/v1/resorts.`);
  const history = await loadResortScoreHistory(resort.id).catch(() => null);
  const today = catalog.scores?.[resort.id] ?? null;
  return publicJson(buildScoreDocument(resort, { today, history }, { now: catalog.now }));
}

export function OPTIONS(): Response {
  return publicOptions();
}

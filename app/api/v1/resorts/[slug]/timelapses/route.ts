import { findResort, loadPublicApiCatalog, loadResortTimelapses, optionsFor } from "@/lib/public-api/data";
import { publicError, publicJson, publicOptions } from "@/lib/public-api/headers";
import { serializeTimelapses } from "@/lib/public-api/serialize";

// GET /api/v1/resorts/{slug}/timelapses — rendered clips per cam (24 h rolling
// and storm reels, P8 block 2), links only. Same caching story as the cams
// route: OPTIONS makes the handler non-static, so the 15-minute policy is
// Cache-Control plus the Data Cache behind loadResortTimelapses().

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
  const { slug } = await params;
  const catalog = await loadPublicApiCatalog();
  const resort = findResort(catalog, slug);
  if (!resort) return publicError(404, "resort_not_found", `No active resort with slug "${slug}". List them at /api/v1/resorts.`);
  const timelapses = await loadResortTimelapses(resort.id);
  return publicJson(serializeTimelapses(resort, { ...optionsFor(catalog, resort), timelapses }));
}

export function OPTIONS(): Response {
  return publicOptions();
}

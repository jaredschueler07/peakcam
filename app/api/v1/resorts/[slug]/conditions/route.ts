import { findResort, loadPublicApiCatalog, loadResortForecast, optionsFor } from "@/lib/public-api/data";
import { publicError, publicJson, publicOptions } from "@/lib/public-api/headers";
import { serializeConditions } from "@/lib/public-api/conditions";

// GET /api/v1/resorts/{slug}/conditions — the conditions contract v2 (P6):
// a versioned envelope around every conditions field with its value,
// source, observation time, confidence and freshness tier, plus the derived
// operating status (never defaulting to open), the recommendable-today
// verdict with reasons, and the station layer's latest readings. Caching:
// same story as the sibling routes — OPTIONS makes the handler non-static,
// so the 15-minute policy is Cache-Control plus the Data Cache behind the
// catalogue, the operator index and loadResortForecast().

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
  const { slug } = await params;
  const catalog = await loadPublicApiCatalog();
  const resort = findResort(catalog, slug);
  if (!resort) return publicError(404, "resort_not_found", `No active resort with slug "${slug}". List them at /api/v1/resorts.`);
  const stored = await loadResortForecast(resort.id).catch(() => ({ runs: [] }));
  return publicJson(serializeConditions(resort, { ...optionsFor(catalog, resort), forecast: stored }));
}

export function OPTIONS(): Response {
  return publicOptions();
}

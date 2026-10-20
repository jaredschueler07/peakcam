import { findResort, loadPublicApiCatalog, loadResortForecast, optionsFor } from "@/lib/public-api/data";
import { PUBLIC_API_FORECAST_ATTRIBUTION, publicError, publicJson, publicOptions } from "@/lib/public-api/headers";
import { serializeForecast } from "@/lib/public-api/forecast";
import type { ForecastPoint } from "@/lib/forecast/open-meteo-models";

// GET /api/v1/resorts/{slug}/forecast[?point=summit|base] — the blended
// 14-day snow forecast (per-day median across models with the 25th/75th
// percentile band) plus every contributing model run, from the runs
// scripts/forecast-sync.ts stores every 6 h. Caching: same story as the
// sibling routes — OPTIONS makes the handler non-static, so the 15-minute
// policy is Cache-Control plus the Data Cache behind loadResortForecast().
// Open-Meteo's CC BY 4.0 credit rides in X-Attribution and the body's credits.

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
  const { slug } = await params;
  const catalog = await loadPublicApiCatalog();
  const resort = findResort(catalog, slug);
  if (!resort) return publicError(404, "resort_not_found", `No active resort with slug "${slug}". List them at /api/v1/resorts.`);
  const pointParam = new URL(request.url).searchParams.get("point");
  if (pointParam != null && pointParam !== "summit" && pointParam !== "base") {
    return publicError(400, "invalid_point", "point must be `summit` or `base`.");
  }
  const stored = await loadResortForecast(resort.id);
  const doc = serializeForecast(resort, stored, { ...optionsFor(catalog, resort), point: (pointParam as ForecastPoint | null) ?? "summit" });
  return publicJson(doc, { attribution: PUBLIC_API_FORECAST_ATTRIBUTION });
}

export function OPTIONS(): Response {
  return publicOptions();
}

import { findResort, loadPublicApiCatalog, loadResortAccuracy, optionsFor } from "@/lib/public-api/data";
import { PUBLIC_API_FORECAST_ATTRIBUTION, publicError, publicJson, publicOptions } from "@/lib/public-api/headers";
import { serializeForecastAccuracy } from "@/lib/public-api/forecast";

// GET /api/v1/resorts/{slug}/forecast-accuracy — how each model (and the
// blend) has verified at this resort over the trailing 90 days against
// measured snow: MAE at day 1/3/7, bias ratio, samples, rank, and what the
// truth was (`truthBasis`, `measuredDays`). Rows come from forecast_scores
// (scripts/forecast-score.ts, daily); measuredDays is counted live from
// snowpack_daily with the scorer's own rule. Caching as the sibling routes.

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
  const { slug } = await params;
  const catalog = await loadPublicApiCatalog();
  const resort = findResort(catalog, slug);
  if (!resort) return publicError(404, "resort_not_found", `No active resort with slug "${slug}". List them at /api/v1/resorts.`);
  const input = await loadResortAccuracy(resort);
  return publicJson(serializeForecastAccuracy(resort, input, optionsFor(catalog, resort)), { attribution: PUBLIC_API_FORECAST_ATTRIBUTION });
}

export function OPTIONS(): Response {
  return publicOptions();
}

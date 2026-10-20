import { findResort, loadPublicApiCatalog, loadResortForecast, loadResortForecastScores, optionsFor } from "@/lib/public-api/data";
import { publicError, publicJson, publicOptions } from "@/lib/public-api/headers";
import { serializeResort } from "@/lib/public-api/serialize";
import { rankScores, serializeForecastSummary } from "@/lib/public-api/forecast";

// GET /api/v1/resorts/{slug} — the full resort document.
// Caching: exporting OPTIONS (CORS preflight) makes Next treat the handler as
// non-static (`hasNonStaticMethods` in next/dist/server/route-modules/app-route),
// so a `revalidate` segment export would be inert here. The 15-minute policy is
// carried by `Cache-Control: s-maxage=900, stale-while-revalidate=3600` (the
// Vercel edge caches function responses on s-maxage) and by the Data Cache
// behind loadPublicApiCatalog(); a MISS costs one in-memory serialisation.

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
  const { slug } = await params;
  const catalog = await loadPublicApiCatalog();
  const resort = findResort(catalog, slug);
  if (!resort) return publicError(404, "resort_not_found", `No active resort with slug "${slug}". List them at /api/v1/resorts.`);
  // The stored blend summary and the ranked scores ride on the single-resort
  // document only (two cached reads per resort); the full daily blend and
  // every model run live at /forecast and /forecast-accuracy.
  const [stored, scores] = await Promise.all([loadResortForecast(resort.id), loadResortForecastScores(resort.id)]);
  const doc = serializeResort(resort, optionsFor(catalog, resort));
  return publicJson({ ...doc, forecast: serializeForecastSummary(stored), forecastScores: rankScores(scores) });
}

export function OPTIONS(): Response {
  return publicOptions();
}

import { findResort, isValidSlug, loadPublicApiCatalog, loadResortForecast, optionsFor } from "@/lib/public-api/data";
import { PUBLIC_API_FORECAST_ATTRIBUTION } from "@/lib/public-api/headers";
import { markdownPageHeaders, snowReportMarkdown } from "@/lib/public-api/markdown-page";
import { resortConditionsView } from "@/lib/public-api/conditions";
import { serializeResort } from "@/lib/public-api/serialize";
import { getResortElevationFt, getSnowpackHistory, getUserConditions } from "@/lib/supabase";
import { getWeatherForecast } from "@/lib/weather";
import { getOpenMeteoForecast } from "@/lib/open-meteo";
import { resortTabUrl } from "@/lib/resort-pages";

// GET /resorts/{slug}/snow-report/index.md — the snow-report subpage as
// markdown (rel="alternate" from the HTML page's Link header). Same shape as
// the parent /resorts/{slug}/index.md route: GET only so the handler stays
// static-eligible, ISR at 15 minutes, noindex pointing rankers at the HTML.
export const revalidate = 900;

function notFound(slug: string): Response {
  return new Response(`No active resort with slug "${slug}". List them at /api/v1/resorts or /index.md.\n`, {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
  const { slug } = await params;
  if (!isValidSlug(slug)) return notFound(slug);
  const catalog = await loadPublicApiCatalog();
  const resort = findResort(catalog, slug);
  if (!resort) return notFound(slug);
  const isUS = resort.country === "US";
  const elevationFt = isUS ? null : await getResortElevationFt(resort.id);
  let history;
  let forecast;
  let userConditions;
  let stored;
  // A failed stored-forecast read costs one field of the conditions section:
  // serve the report without it, uncached, rather than a 503.
  let forecastFailed = false;
  try {
    [history, forecast, userConditions, stored] = await Promise.all([
      getSnowpackHistory(resort.id, 7),
      isUS ? getWeatherForecast(resort.lat, resort.lng) : getOpenMeteoForecast(resort.lat, resort.lng, elevationFt),
      getUserConditions(resort.id),
      loadResortForecast(resort.id).catch(() => {
        forecastFailed = true;
        return { runs: [] };
      }),
    ]);
  } catch {
    return new Response("Resort forecast or snow-report data temporarily unavailable.\n", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
  const options = optionsFor(catalog, resort);
  const doc = serializeResort(resort, options);
  const conditions = resortConditionsView(resort, { ...options, forecast: stored });
  const body = snowReportMarkdown(doc, { now: catalog.now, history, forecast, userReportCount48h: userConditions.length, conditions });
  const hasOpenMeteo = !isUS || stored.runs.length > 0;
  return new Response(body, {
    headers: {
      ...markdownPageHeaders(resortTabUrl(resort.slug, "snow-report"), {
        attribution: hasOpenMeteo ? PUBLIC_API_FORECAST_ATTRIBUTION : undefined,
      }),
      ...(forecastFailed ? { "Cache-Control": "no-store" } : {}),
    },
  });
}

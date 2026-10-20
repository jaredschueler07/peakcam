import { findResort, isValidSlug, loadPublicApiCatalog, loadResortAccuracy, loadResortForecast } from "@/lib/public-api/data";
import { serializeForecast, serializeForecastAccuracy } from "@/lib/public-api/forecast";
import { forecastMarkdown, markdownPageHeaders } from "@/lib/public-api/markdown-page";
import { resortTabUrl } from "@/lib/resort-pages";

// GET /resorts/{slug}/snow-forecast/index.md — the forecast subpage as
// markdown (rel="alternate" from the HTML page's Link header). Same policy as
// the sibling routes: GET only so the handler stays static-eligible, ISR at
// 15 minutes, noindex with a canonical Link. The Open-Meteo credit is in the
// body; the response headers carry PeakCam's own attribution.
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
  const [stored, accuracyInput] = await Promise.all([loadResortForecast(resort.id), loadResortAccuracy(resort)]);
  const opts = { now: catalog.now };
  const summit = serializeForecast(resort, stored, { ...opts, point: "summit" });
  const base = summit.points.includes("base") && summit.point !== "base" ? serializeForecast(resort, stored, { ...opts, point: "base" }) : null;
  const accuracy = serializeForecastAccuracy(resort, accuracyInput, opts);
  const pageUrl = resortTabUrl(resort.slug, "snow-forecast");
  return new Response(forecastMarkdown({ summit, base, accuracy, pageUrl }), { headers: markdownPageHeaders(pageUrl) });
}

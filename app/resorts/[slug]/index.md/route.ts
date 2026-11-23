import { findResort, isValidSlug, loadPublicApiCatalog, loadResortForecast, loadResortTimelapses, optionsFor } from "@/lib/public-api/data";
import { markdownPageHeaders, resortMarkdown } from "@/lib/public-api/markdown-page";
import { resortConditionsView } from "@/lib/public-api/conditions";
import { serializeResort } from "@/lib/public-api/serialize";
import { profileDescription } from "@/lib/resort-profile";

// GET /resorts/{slug}/index.md — the resort page as markdown for agents and
// answer engines (rel="alternate" from the HTML page's Link header). Only GET
// is exported so the handler stays static-eligible and `revalidate` applies:
// ISR at 15 minutes like /api/v1, with the same Cache-Control on top. Not in
// the sitemap; X-Robots-Tag: noindex points rankers at the HTML page.
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
  const options = optionsFor(catalog, resort);
  const doc = serializeResort(resort, options);
  // A failed forecast read costs one field of the conditions section, so the
  // document is still served, but uncached so the gap is not pinned at the edge.
  let forecastFailed = false;
  let stored;
  let timelapses;
  try {
    [stored, timelapses] = await Promise.all([
      loadResortForecast(resort.id).catch(() => {
        forecastFailed = true;
        return { runs: [] };
      }),
      loadResortTimelapses(resort.id),
    ]);
  } catch {
    return new Response("Resort timelapse archive temporarily unavailable.\n", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
  const conditions = resortConditionsView(resort, { ...options, forecast: stored });
  // The stored description (P2 plumbing) travels with its provenance label.
  return new Response(resortMarkdown(doc, { now: catalog.now, description: profileDescription(resort), timelapses, conditions }), {
    headers: { ...markdownPageHeaders(doc.canonicalUrl), ...(forecastFailed ? { "Cache-Control": "no-store" } : {}) },
  });
}

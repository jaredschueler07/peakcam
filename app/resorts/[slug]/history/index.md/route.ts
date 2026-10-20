import { findResort, isValidSlug, loadPublicApiCatalog, loadResortHistory } from "@/lib/public-api/data";
import { buildMonthlyClimatology, buildResortHistory, buildSeasonStats } from "@/lib/public-api/history";
import { historyMarkdown, markdownPageHeaders } from "@/lib/public-api/markdown-page";

// GET /resorts/{slug}/history/index.md — the history page as markdown for
// agents and answer engines (rel="alternate" from the HTML page's Link
// header). Same policy as /resorts/{slug}/index.md: GET only so the handler
// stays static-eligible, ISR 15 minutes, noindex with a canonical Link.
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
  const data = await loadResortHistory(resort, catalog.now);
  const opts = { now: catalog.now };
  const history = buildResortHistory(resort, data, opts);
  const stats = buildSeasonStats(resort, data, opts);
  const monthly = buildMonthlyClimatology(resort, data, opts);
  return new Response(historyMarkdown(history, stats, monthly), { headers: markdownPageHeaders(history.pageUrl) });
}

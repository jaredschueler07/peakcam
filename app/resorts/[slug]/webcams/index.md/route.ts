import { findResort, isValidSlug, loadPublicApiCatalog, loadResortTimelapses, optionsFor } from "@/lib/public-api/data";
import { markdownPageHeaders, webcamsMarkdown } from "@/lib/public-api/markdown-page";
import { serializeResort } from "@/lib/public-api/serialize";
import { getResortCamTimelines } from "@/lib/supabase";
import { resortTabUrl } from "@/lib/resort-pages";

// GET /resorts/{slug}/webcams/index.md — the webcams subpage as markdown:
// every active cam with its health, plus the still-archive frames for cams
// that have them. GET only, ISR 15 minutes, noindex (see the parent route).
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
  const camOrder = resort.cams.filter((c) => c.is_active).map((c) => c.id);
  const [timelines, timelapses] = await Promise.all([getResortCamTimelines(resort.id, camOrder, 24), loadResortTimelapses(resort.id)]);
  const doc = serializeResort(resort, optionsFor(catalog, resort));
  const body = webcamsMarkdown(doc, { now: catalog.now, timelines: Object.fromEntries(timelines ?? new Map()), timelapses });
  return new Response(body, { headers: markdownPageHeaders(resortTabUrl(resort.slug, "webcams")) });
}

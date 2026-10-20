import { getResortOpenings, getResortSitemapEntries } from "@/lib/supabase";
import { isDropInEnabled } from "@/lib/drop-in";
import { SITEMAP_HEADERS, buildSitemapFiles, childSitemapName, renderUrlSet } from "@/lib/sitemaps";

// GET /sitemaps/{file}.xml — one child of the /sitemap.xml index: pages.xml
// (static pages, hubs, boards, passes) or resorts-{cc}.xml (the resort page
// family for one country). The set of names is whatever the catalogue
// yields, so an unknown name is a 404 rather than an empty urlset. Same
// hourly ISR and same fail-loud policy as the index.
export const revalidate = 3600;

export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }): Promise<Response> {
  const { file } = await params;
  const name = childSitemapName(file);
  if (!name) return new Response("Not found\n", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  const [resorts, openings] = await Promise.all([getResortSitemapEntries(), getResortOpenings()]);
  const buildTime = process.env.NEXT_PUBLIC_BUILD_TIME ? new Date(process.env.NEXT_PUBLIC_BUILD_TIME) : new Date();
  const files = buildSitemapFiles({ resorts, openingUpdatedAt: openings.map((o) => o.updated_at), buildTime, dropInEnabled: isDropInEnabled() });
  const hit = files.find((f) => f.name === name);
  if (!hit) return new Response(`No sitemap file "${name}". The index at /sitemap.xml lists them.\n`, { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  return new Response(renderUrlSet(hit.urls), { headers: SITEMAP_HEADERS });
}

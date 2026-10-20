import { getResortOpenings, getResortSitemapEntries } from "@/lib/supabase";
import { isDropInEnabled } from "@/lib/drop-in";
import { SITEMAP_HEADERS, buildSitemapFiles, renderSitemapIndex } from "@/lib/sitemaps";

// GET /sitemap.xml — the sitemap index (parity plan P10): one <sitemap>
// per child file under /sitemaps/, each dated to the newest URL it holds.
// Hourly ISR to match the data pages: lastModified comes from snow_reports
// (appended every 6 h) and resort_openings (re-seeded without a deploy).
export const revalidate = 3600;

/** Per-deploy constant inlined by next.config.ts; the fallback only applies where the env inlining is absent (unit tests). */
function buildTime(): Date {
  return process.env.NEXT_PUBLIC_BUILD_TIME ? new Date(process.env.NEXT_PUBLIC_BUILD_TIME) : new Date();
}

export async function GET(): Promise<Response> {
  // Let a listing failure throw rather than silently emitting an index of
  // empty files — same failure class as generateStaticParams: a transient DB
  // blip must not quietly produce a "successful" sitemap that drops every
  // resort. Next keeps serving the last good response.
  const [resorts, openings] = await Promise.all([getResortSitemapEntries(), getResortOpenings()]);
  const files = buildSitemapFiles({ resorts, openingUpdatedAt: openings.map((o) => o.updated_at), buildTime: buildTime(), dropInEnabled: isDropInEnabled() });
  return new Response(renderSitemapIndex(files), { headers: SITEMAP_HEADERS });
}

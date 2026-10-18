import { loadFeedReports, loadFeedResort, loadForecastLogs } from "@/lib/alerts/feed-data";
import {
  ATOM_CONTENT_TYPE,
  buildAtomFeed,
  FEED_POWDER_INCHES,
  powderEntries,
  publicFeedHeaders,
  resortUrl,
} from "@/lib/alerts/feeds";

// Public per-resort powder feed (Atom). One entry per day a report showed
// 6″+ of new snow in 24 h, plus one per forecast storm the alert cron
// logged. Regenerated every 15 minutes like the rest of the public API
// surface; `updated` comes from the data, never from render time, so a
// reader that polls sees a stable document between real changes.
export const revalidate = 900;

export async function GET(
  _request: Request,
  context: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await context.params;

  // A failed resort read throws (ISR keeps the last good feed); only a
  // genuine "no such resort" is a 404.
  const resort = await loadFeedResort(slug);
  if (!resort) {
    return new Response("No such resort", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }

  const now = new Date();
  const [reports, forecastLogs] = await Promise.all([
    loadFeedReports(resort.id, now),
    loadForecastLogs(resort.id, { now }),
  ]);
  const entries = powderEntries(resort, reports, forecastLogs);
  const updated = entries[0]?.updated ?? reports[0]?.updated_at ?? resort.created_at;

  const xml = buildAtomFeed({
    id: `tag:peakcam.io,2026:powder:${resort.slug}`,
    title: `Powder days at ${resort.name} — PeakCam`,
    subtitle: `Days with ${FEED_POWDER_INCHES}" or more of new snow in 24 hours, and forecast storms, at ${resort.name}. Live webcams and the snow report are on PeakCam.`,
    selfUrl: `${resortUrl(resort.slug)}/powder.xml`,
    alternateUrl: resortUrl(resort.slug),
    updated,
    entries,
  });

  return new Response(xml, { status: 200, headers: publicFeedHeaders(ATOM_CONTENT_TYPE) });
}

import type { MetadataRoute } from "next";
import { getResortOpenings, getResortSitemapEntries } from "@/lib/supabase";
import { SITE_URL } from "@/lib/site";
import { isDropInEnabled } from "@/lib/drop-in";
import { HUB_BASE_PATH, hubPath, listHubs } from "@/lib/hubs";

// Match the data pages' ISR window: the sitemap's lastModified values come
// from snow_reports, which the sync jobs append every 6h (and, for
// /opening-dates, from resort_openings, which the seed re-writes without a
// deploy), so a build-time snapshot goes stale within a day of a deploy.
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Let a listing failure throw rather than silently emitting a sitemap with
  // only the static pages — same failure class as generateStaticParams in
  // app/resorts/[slug]/page.tsx: a transient DB blip during a build must not
  // quietly produce a "successful" sitemap that drops every resort.
  // getResortOpenings returns [] only for a database without migration 020
  // and throws otherwise, so it fails this regeneration the same way.
  const [entries, openings] = await Promise.all([getResortSitemapEntries(), getResortOpenings()]);

  // Per-deploy constant inlined by next.config.ts, NOT the time this ISR
  // regeneration happened to run: the evergreen rows below only change on
  // deploy, and a lastModified that ticks forward every hour with identical
  // content is the noise the comment on resortEntries warns about. The
  // fallback only applies where the env inlining is absent (unit tests).
  const buildTime = process.env.NEXT_PUBLIC_BUILD_TIME
    ? new Date(process.env.NEXT_PUBLIC_BUILD_TIME)
    : new Date();
  const resortEntries: MetadataRoute.Sitemap = entries.map((e) => ({
    url: `${SITE_URL}/resorts/${e.slug}`,
    // Real freshness beats a blanket "now": the page's data-bearing content
    // changes when its snow report does, and crawlers downrank sitemaps whose
    // lastModified is always the crawl date. Resorts with no report yet fall
    // back to build time.
    lastModified: e.lastReportAt ? new Date(e.lastReportAt) : buildTime,
    changeFrequency: "hourly",
    priority: 0.8,
  }));

  // The aggregate pages (/, /snow-report, /map) change exactly when the newest
  // snow report lands, so their lastModified is the max report timestamp —
  // not the moment this function happened to run.
  let newestReportMs = 0;
  for (const e of entries) {
    if (!e.lastReportAt) continue;
    const ms = new Date(e.lastReportAt).getTime();
    if (ms > newestReportMs) newestReportMs = ms;
  }
  const dataModified = newestReportMs > 0 ? new Date(newestReportMs) : buildTime;

  // /opening-dates changes when its table does: `npm run seed-openings`
  // upserts resort_openings straight into the DB (stamping updated_at) and
  // the ISR page picks it up within the hour with no deploy, so the newest
  // updated_at is the honest lastModified — build time only until the first
  // seed lands. A row with an unparseable timestamp is skipped (NaN compares
  // false), not turned into an Invalid Date.
  let newestOpeningMs = 0;
  for (const o of openings) {
    const ms = new Date(o.updated_at).getTime();
    if (ms > newestOpeningMs) newestOpeningMs = ms;
  }
  const openingsModified = newestOpeningMs > 0 ? new Date(newestOpeningMs) : buildTime;

  // /ski-cams/[hub] — one URL per state/province/country and per region with
  // enough resorts, exactly the set app/ski-cams/[hub]/page.tsx's
  // generateStaticParams emits (both call listHubs on the active resorts). A
  // hub's data-bearing content changes when any of its resorts' reports does,
  // so lastModified is the newest report in the hub; a hub with no reports yet
  // falls back to build time like a resort would.
  const { states, regions } = listHubs(entries);
  const hubEntries: MetadataRoute.Sitemap = [...states, ...regions].map((group) => {
    let newestMs = 0;
    for (const r of group.resorts) {
      if (!r.lastReportAt) continue;
      const ms = new Date(r.lastReportAt).getTime();
      if (ms > newestMs) newestMs = ms;
    }
    return {
      url: `${SITE_URL}${hubPath(group.hub)}`,
      lastModified: newestMs > 0 ? new Date(newestMs) : buildTime,
      changeFrequency: "daily",
      priority: 0.8,
    };
  });

  return [
    { url: SITE_URL, lastModified: dataModified, changeFrequency: "hourly", priority: 1.0 },
    { url: `${SITE_URL}/snow-report`, lastModified: dataModified, changeFrequency: "hourly", priority: 0.9 },
    { url: `${SITE_URL}/map`, lastModified: dataModified, changeFrequency: "hourly", priority: 0.8 },
    { url: `${SITE_URL}/compare`, lastModified: buildTime, changeFrequency: "weekly", priority: 0.6 },
    // Powder-alert sign-up landing page: the only dedicated conversion page,
    // has its own canonical (app/alerts/page.tsx) and is not in PRIVATE_PATHS.
    { url: `${SITE_URL}/alerts`, lastModified: buildTime, changeFrequency: "monthly", priority: 0.7 },
    // Pre-season landing page ("when does X open"): the table is re-seeded as
    // resorts announce, roughly weekly through November, so weekly is honest
    // and lastModified tracks the seed (openingsModified above), not the deploy.
    { url: `${SITE_URL}/opening-dates`, lastModified: openingsModified, changeFrequency: "weekly", priority: 0.7 },
    // Hub index: its list of hubs only changes when the catalogue does (a
    // deploy), so build time is the honest lastModified; the hubs themselves
    // carry their newest report below.
    { url: `${SITE_URL}${HUB_BASE_PATH}`, lastModified: buildTime, changeFrequency: "weekly", priority: 0.7 },
    // The Drop In hub only. The three playable routes
    // (/resorts/{slug}/drop-in) are deliberately `robots: { index: false }`, and
    // a sitemap of noindex URLs is a contradiction — the hub links to them.
    ...(isDropInEnabled()
      ? [{ url: `${SITE_URL}/drop-in`, lastModified: buildTime, changeFrequency: "monthly" as const, priority: 0.5 }]
      : []),
    { url: `${SITE_URL}/about`, lastModified: buildTime, changeFrequency: "monthly", priority: 0.4 },
    { url: `${SITE_URL}/methodology`, lastModified: buildTime, changeFrequency: "monthly", priority: 0.5 },
    ...hubEntries,
    ...resortEntries,
  ];
}

import type { MetadataRoute } from "next";
import { getResortSitemapEntries } from "@/lib/supabase";
import { SITE_URL } from "@/lib/site";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Let a listing failure throw rather than silently emitting a sitemap with
  // only the static pages — same failure class as generateStaticParams in
  // app/resorts/[slug]/page.tsx: a transient DB blip during a build must not
  // quietly produce a "successful" sitemap that drops every resort.
  const entries = await getResortSitemapEntries();

  const buildTime = new Date();
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

  return [
    { url: SITE_URL, lastModified: buildTime, changeFrequency: "hourly", priority: 1.0 },
    { url: `${SITE_URL}/snow-report`, lastModified: buildTime, changeFrequency: "hourly", priority: 0.9 },
    { url: `${SITE_URL}/map`, lastModified: buildTime, changeFrequency: "hourly", priority: 0.8 },
    { url: `${SITE_URL}/compare`, lastModified: buildTime, changeFrequency: "weekly", priority: 0.6 },
    // The Drop In hub only. The three playable routes
    // (/resorts/{slug}/drop-in) are deliberately `robots: { index: false }`, and
    // a sitemap of noindex URLs is a contradiction — the hub links to them.
    { url: `${SITE_URL}/drop-in`, lastModified: buildTime, changeFrequency: "monthly", priority: 0.5 },
    { url: `${SITE_URL}/about`, lastModified: buildTime, changeFrequency: "monthly", priority: 0.4 },
    ...resortEntries,
  ];
}

import type { MetadataRoute } from "next";
import { getAllResortSlugs } from "@/lib/supabase";

const BASE_URL = "https://peakcam.io";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Let a listing failure throw rather than silently emitting a sitemap with
  // only the static pages — same failure class as generateStaticParams in
  // app/resorts/[slug]/page.tsx: a transient DB blip during a build must not
  // quietly produce a "successful" sitemap that drops every resort.
  const resortSlugs: string[] = await getAllResortSlugs();

  const resortEntries: MetadataRoute.Sitemap = resortSlugs.map((slug) => ({
    url: `${BASE_URL}/resorts/${slug}`,
    lastModified: new Date(),
    changeFrequency: "hourly",
    priority: 0.8,
  }));

  return [
    { url: BASE_URL, lastModified: new Date(), changeFrequency: "hourly", priority: 1.0 },
    { url: `${BASE_URL}/snow-report`, lastModified: new Date(), changeFrequency: "hourly", priority: 0.9 },
    { url: `${BASE_URL}/map`, lastModified: new Date(), changeFrequency: "hourly", priority: 0.8 },
    { url: `${BASE_URL}/compare`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.6 },
    { url: `${BASE_URL}/about`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.4 },
    ...resortEntries,
  ];
}

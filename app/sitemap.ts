import type { MetadataRoute } from "next";
import { getAllResortSlugs } from "@/lib/supabase";

const BASE_URL = "https://peakcam.co";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  let resortSlugs: string[] = [];
  try {
    resortSlugs = await getAllResortSlugs();
  } catch {
    // Return static pages only if DB is unavailable
  }

  const resortEntries: MetadataRoute.Sitemap = resortSlugs.map((slug) => ({
    url: `${BASE_URL}/resorts/${slug}`,
    lastModified: new Date(),
    changeFrequency: "hourly",
    priority: 0.8,
  }));

  return [
    { url: BASE_URL, lastModified: new Date(), changeFrequency: "hourly", priority: 1.0 },
    { url: `${BASE_URL}/snow-report`, lastModified: new Date(), changeFrequency: "hourly", priority: 0.9 },
    { url: `${BASE_URL}/about`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.4 },
    ...resortEntries,
  ];
}

import { hasFreshSnowForecast } from "@/lib/snow-forecast";
import { SITE_URL } from "@/lib/site";
import { Suspense } from "react";
import { getAllResorts } from "@/lib/supabase";
import { getRadarFrames } from "@/lib/weather-radar";
import { BrowsePage } from "@/components/browse/BrowsePage";
import { Header } from "@/components/layout/Header";
import { PeakHero } from "@/components/home/PeakHero";
import { PowderTicker } from "@/components/home/PowderTicker";
import { LiveWebcams } from "@/components/home/LiveWebcams";
import { SnowCams } from "@/components/home/SnowCams";
import { PeakFooter } from "@/components/home/PeakFooter";
import type { ResortWithData } from "@/lib/types";

export const revalidate = 3600;

export const metadata = {
  title: "Live Ski Resort Webcams, Snow Reports & Conditions",
  description:
    "Browse live webcams, real-time snow reports, base depths, and trail conditions for 150+ ski resorts across North & South America. " +
    "Compare powder days, check lift status, and plan your next ski trip with PeakCam.",
  keywords: [
    "live ski resort webcams",
    "ski resort snow report",
    "powder day alerts",
    "ski resort conditions",
    "live mountain webcam",
    "base depth report",
    "trail conditions skiing",
    "lift status ski resort",
    "ski resort weather forecast",
    "North America ski resorts",
    "South America ski resorts",
    "Chile ski webcams",
    "Argentina ski webcams",
    "ski cam live stream",
    "best powder days",
  ],
  openGraph: {
    title: "Live Ski Resort Webcams, Snow Reports & Conditions",
    description:
      "Browse live webcams, real-time snow reports, and powder alerts for 150+ ski resorts across North & South America.",
    url: SITE_URL,
    type: "website" as const,
  },
  twitter: {
    card: "summary_large_image" as const,
    title: "PeakCam — Live Ski Webcams & Snow Reports",
    description: "Real-time powder alerts, base depths, and live cams for 150+ ski resorts from the Rockies to the Andes.",
  },
};

export default async function Home() {
  // Fetch resorts and the radar frames in parallel. Resort fetch failures are
  // allowed to propagate: throwing here fails this ISR revalidation, so
  // Next.js keeps serving the last good cached page instead of caching an
  // empty state at 200. Radar is best-effort so a RainViewer outage never
  // blocks the page (or the sidebar map's radar layer).
  const [resorts, radarFrames] = await Promise.all([
    getAllResorts(),
    getRadarFrames().catch(() => []),
  ]);

  // Build powder alerts for ticker — resorts with 8"+ fresh snow
  const powderAlerts = resorts
    .filter((r) => (r.snow_report?.new_snow_24h ?? 0) >= 8)
    .sort((a, b) => (b.snow_report?.new_snow_24h ?? 0) - (a.snow_report?.new_snow_24h ?? 0))
    .slice(0, 8)
    .map((r) => ({ name: r.name.toUpperCase(), snow24h: r.snow_report!.new_snow_24h! }));

  // Collect featured cams for the webcams section (first 4 active cams across top resorts)
  const featuredCams = resorts
    .flatMap((r) => r.cams.filter((c) => c.is_active))
    .slice(0, 4);

  // Snow cams — resorts with a fresh hourly snow forecast, pick best cam per resort
  const snowCams = resorts
    .filter((r) => hasFreshSnowForecast(r.snow_report))
    .map((r) => {
      // Prefer YouTube > iframe > image for best live experience
      const activeCams = r.cams.filter((c) => c.is_active);
      const best =
        activeCams.find((c) => c.embed_type === "youtube") ??
        activeCams.find((c) => c.embed_type === "iframe") ??
        activeCams.find((c) => c.embed_type === "image") ??
        activeCams[0];
      return best ? { cam: best, resort: r } : null;
    })
    .filter(Boolean) as { cam: (typeof resorts)[0]["cams"][0]; resort: ResortWithData }[];

  // Server-rendered ItemList of every resort: the browse grid now paginates
  // client-side ("Show more"), so crawlers get the full catalog from here and
  // from the per-resort SSG pages, not from the grid HTML.
  const resortListJsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Ski resorts on PeakCam",
    numberOfItems: resorts.length,
    itemListElement: resorts.map((r, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: r.name,
      url: `${SITE_URL}/resorts/${r.slug}`,
    })),
  };

  return (
    <main id="main-content">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(resortListJsonLd) }}
      />
      <div className="sticky top-0 z-50 md:hidden"><Header showSearch={false} /></div>
      <PeakHero resortCount={resorts.length} />
      <PowderTicker alerts={powderAlerts} />
      <BrowsePage resorts={resorts} radarFrames={radarFrames} />
      {snowCams.length > 0 && (
        <Suspense fallback={<div className="h-96 animate-pulse bg-surface rounded-lg" />}>
          <SnowCams snowCams={snowCams} />
        </Suspense>
      )}
      <Suspense fallback={<div className="h-96 animate-pulse bg-surface rounded-lg" />}>
        <LiveWebcams cams={featuredCams} resortCount={resorts.length} />
      </Suspense>
      <PeakFooter />
    </main>
  );
}

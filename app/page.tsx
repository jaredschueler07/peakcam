import { Suspense } from "react";
import { getAllResorts } from "@/lib/supabase";
import { BrowsePage } from "@/components/browse/BrowsePage";
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
    "Browse live webcams, real-time snow reports, base depths, and trail conditions for 128 ski resorts across North America. " +
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
    "ski cam live stream",
    "best powder days",
  ],
  openGraph: {
    title: "Live Ski Resort Webcams, Snow Reports & Conditions",
    description:
      "Browse live webcams, real-time snow reports, and powder alerts for 128 ski resorts across North America.",
    url: "https://peakcam.io",
    type: "website" as const,
  },
  twitter: {
    card: "summary_large_image" as const,
    title: "PeakCam — Live Ski Webcams & Snow Reports",
    description: "Real-time powder alerts, base depths, and live cams for 128 North American ski resorts.",
  },
};

export default async function Home() {
  let resorts: ResortWithData[] = [];

  try {
    resorts = await getAllResorts();
  } catch {
    console.warn("[PeakCam] Could not fetch resorts. Check .env.local.");
  }

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

  // Snow cams — resorts where it's currently snowing, pick best cam per resort
  const snowCams = resorts
    .filter((r) => r.snow_report?.snowing_now)
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

  return (
    <main id="main-content">
      <PeakHero />
      <PowderTicker alerts={powderAlerts} />
      {snowCams.length > 0 && (
        <Suspense fallback={<div className="h-96 animate-pulse bg-surface rounded-lg" />}>
          <SnowCams snowCams={snowCams} />
        </Suspense>
      )}
      <BrowsePage resorts={resorts} />
      <Suspense fallback={<div className="h-96 animate-pulse bg-surface rounded-lg" />}>
        <LiveWebcams cams={featuredCams} />
      </Suspense>
      <PeakFooter />
    </main>
  );
}

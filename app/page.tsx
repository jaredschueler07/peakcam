import { getAllResorts } from "@/lib/supabase";
import { BrowsePage } from "@/components/browse/BrowsePage";
import { PeakHero } from "@/components/home/PeakHero";
import { PowderTicker } from "@/components/home/PowderTicker";
import { LiveWebcams } from "@/components/home/LiveWebcams";
import { PeakFooter } from "@/components/home/PeakFooter";
import type { ResortWithData } from "@/lib/types";

export const revalidate = 3600;

export const metadata = {
  title: "PeakCam — Live Ski Resort Webcams, Snow Reports & Conditions",
  description:
    "Browse live webcams, real-time snow reports, base depths, and trail conditions for 75+ ski resorts across North America. " +
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
    title: "PeakCam — Live Ski Resort Webcams, Snow Reports & Conditions",
    description:
      "Browse live webcams, real-time snow reports, and powder alerts for 75+ ski resorts across North America.",
    url: "https://peakcam.io",
    type: "website" as const,
  },
  twitter: {
    card: "summary_large_image" as const,
    title: "PeakCam — Live Ski Webcams & Snow Reports",
    description: "Real-time powder alerts, base depths, and live cams for 75+ North American ski resorts.",
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

  return (
    <>
      <PeakHero />
      <PowderTicker alerts={powderAlerts} />
      <BrowsePage resorts={resorts} />
      <LiveWebcams cams={featuredCams} />
      <PeakFooter />
    </>
  );
}

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

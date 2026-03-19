import { getAllResorts } from "@/lib/supabase";
import { BrowsePage } from "@/components/browse/BrowsePage";
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
    // Supabase not yet configured — page renders with empty state
    console.warn("[PeakCam] Could not fetch resorts. Check .env.local.");
  }

  return <BrowsePage resorts={resorts} />;
}

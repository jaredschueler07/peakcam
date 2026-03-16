import { getAllResorts } from "@/lib/supabase";
import { BrowsePage } from "@/components/browse/BrowsePage";
import type { ResortWithData } from "@/lib/types";

// Revalidate data every hour so snow conditions stay fresh
export const revalidate = 3600;

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

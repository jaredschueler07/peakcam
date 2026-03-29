import type { Metadata } from "next";
import { getAllResorts } from "@/lib/supabase";
import { getLatestRadarTileUrl } from "@/lib/weather-radar";
import { FullPageMap } from "./FullPageMap";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Interactive Ski Resort Map",
  description:
    "Explore 128 ski resorts on an interactive map with live snow conditions, base depth, weather radar, and terrain visualization.",
  openGraph: {
    title: "Interactive Ski Resort Map",
    description:
      "Explore ski resorts on an interactive map with live snow data and weather radar.",
    url: "https://peakcam.io/map",
    type: "website",
  },
};

export default async function MapPage() {
  const [resorts, radarTileUrl] = await Promise.all([
    getAllResorts().catch(() => []),
    getLatestRadarTileUrl().catch(() => null),
  ]);

  return <main id="main-content"><FullPageMap resorts={resorts} radarTileUrl={radarTileUrl} /></main>;
}

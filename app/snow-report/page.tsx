import { getAllResorts } from "@/lib/supabase";
import { SnowReportPage } from "@/components/snow-report/SnowReportPage";
import type { ResortWithData } from "@/lib/types";

export const revalidate = 3600;

export const metadata = {
  title: "Ski Resort Snow Report — Live Base Depth & Trail Conditions | PeakCam",
  description:
    "Compare live snow conditions across 128 North American ski resorts. " +
    "Base depth, 24h & 48h fresh snow, open trails, lift status, and powder day alerts — updated hourly.",
  keywords: [
    "ski snow report",
    "live base depth",
    "fresh snow report",
    "ski trail conditions",
    "lift status",
    "powder day",
    "ski resort conditions today",
    "North America snow report",
    "ski resort base depth comparison",
  ],
  openGraph: {
    title: "Ski Resort Snow Report — Live Base Depth & Conditions | PeakCam",
    description: "Compare live snow conditions, base depths, and powder alerts for 128 North American ski resorts.",
    url: "https://peakcam.io/snow-report",
    type: "website" as const,
  },
  twitter: {
    card: "summary_large_image" as const,
    title: "Live Ski Snow Report | PeakCam",
    description: "Base depth, fresh snow, and lift status for 128 ski resorts. Updated hourly.",
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebPage",
  name: "Snow Report — PeakCam",
  description:
    "Compare live snow conditions across 128 North American ski resorts. Base depth, fresh snow, trail counts, and lift status at a glance.",
  url: "https://peakcam.io/snow-report",
  isPartOf: {
    "@type": "WebSite",
    name: "PeakCam",
    url: "https://peakcam.io",
  },
};

export default async function SnowReport() {
  let resorts: ResortWithData[] = [];

  try {
    resorts = await getAllResorts();
  } catch {
    console.warn("[PeakCam] Could not fetch resorts for snow report.");
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <SnowReportPage resorts={resorts} />
    </>
  );
}

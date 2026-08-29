import { getAllResorts } from "@/lib/supabase";
import { SnowReportPage } from "@/components/snow-report/SnowReportPage";
import type { ResortWithData } from "@/lib/types";

import { SITE_URL } from "@/lib/site";

export const revalidate = 3600;

export const metadata = {
  title: "Ski Resort Snow Report — Live Base Depth & Trail Conditions",
  alternates: { canonical: `${SITE_URL}/snow-report` },
  description:
    "Compare live snow conditions across 150+ ski resorts in North & South America. " +
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
    "South America snow report",
    "Chile ski snow report",
    "Argentina ski snow report",
    "ski resort base depth comparison",
  ],
  openGraph: {
    title: "Ski Resort Snow Report — Live Base Depth & Conditions",
    description: "Compare live snow conditions, base depths, and powder alerts for 150+ ski resorts across North & South America.",
    url: `${SITE_URL}/snow-report`,
    type: "website" as const,
  },
  twitter: {
    card: "summary_large_image" as const,
    title: "Live Ski Snow Report",
    description: "Base depth, fresh snow, and lift status for 150+ ski resorts. Updated hourly.",
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebPage",
  name: "Snow Report — PeakCam",
  description:
    "Compare live snow conditions across 150+ ski resorts in North & South America. Base depth, fresh snow, trail counts, and lift status at a glance.",
  url: `${SITE_URL}/snow-report`,
  isPartOf: {
    "@type": "WebSite",
    name: "PeakCam",
    url: SITE_URL,
  },
};

export default async function SnowReport() {
  // Let a fetch failure propagate — it fails this ISR revalidation so
  // Next.js keeps serving the last good page instead of caching an empty
  // snow report at 200.
  const resorts: ResortWithData[] = await getAllResorts();

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <main id="main-content">
        <SnowReportPage resorts={resorts} />
      </main>
    </>
  );
}

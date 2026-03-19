import { getAllResorts } from "@/lib/supabase";
import { SnowReportPage } from "@/components/snow-report/SnowReportPage";
import type { ResortWithData } from "@/lib/types";

export const revalidate = 3600;

export const metadata = {
  title: "Snow Report — PeakCam",
  description: "Compare live snow conditions across 70+ North American ski resorts. Base depth, fresh snow, trail counts, and lift status at a glance.",
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebPage",
  name: "Snow Report — PeakCam",
  description:
    "Compare live snow conditions across 70+ North American ski resorts. Base depth, fresh snow, trail counts, and lift status at a glance.",
  url: "https://peakcam.co/snow-report",
  isPartOf: {
    "@type": "WebSite",
    name: "PeakCam",
    url: "https://peakcam.co",
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

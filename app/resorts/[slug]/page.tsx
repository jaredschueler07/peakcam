import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getResortBySlug, getAllResortSlugs, getLiveConditions } from "@/lib/supabase";
import { getWeatherForecast } from "@/lib/weather";
import { ResortDetailPage } from "@/components/resort/ResortDetailPage";

export const revalidate = 3600;

// Pre-render all active resort pages at build time
export async function generateStaticParams() {
  try {
    const slugs = await getAllResortSlugs();
    return slugs.map((slug) => ({ slug }));
  } catch {
    return [];
  }
}

// Dynamic metadata per resort
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  try {
    const resort = await getResortBySlug(slug);
    if (!resort) return {};
    const snow = resort.snow_report;
    const desc = snow
      ? `${resort.name} live cams — ${snow.base_depth}" base, ${snow.conditions ?? "current conditions"}. ${resort.cams.length} cams available.`
      : `Live cams and current snow conditions at ${resort.name}, ${resort.state}.`;

    return {
      title: `${resort.name} Live Cams — Snow Report & Conditions`,
      description: desc,
      openGraph: {
        title: `${resort.name} Live Cams | PeakCam`,
        description: desc,
      },
    };
  } catch {
    return {};
  }
}

export default async function ResortPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const resort = await getResortBySlug(slug);

  // return notFound() narrows type — TypeScript knows resort is non-null below
  if (!resort) return notFound();

  // Fetch weather and live conditions server-side
  const [weather, liveConditions] = await Promise.all([
    getWeatherForecast(resort.lat, resort.lng),
    getLiveConditions(resort.id),
  ]);

  return <ResortDetailPage resort={resort} weather={weather} liveConditions={liveConditions} />;
}

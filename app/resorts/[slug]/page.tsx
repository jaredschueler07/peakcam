import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getResortBySlug, getAllResortSlugs, getLiveConditions, getUserConditions } from "@/lib/supabase";
import { getWeatherForecast, getHourlyForecast, bucketIntoPeriods } from "@/lib/weather";
import { ResortDetailPage } from "@/components/resort/ResortDetailPage";

const BASE_URL = "https://peakcam.io";

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
    const conditionsNarrative = snow?.conditions 
      ? (snow.conditions.includes("||") ? snow.conditions.split("||")[1] : snow.conditions) 
      : "current conditions";

    const desc = snow
      ? `${resort.name} live cams — ${snow.base_depth ?? "?"}″ base, ${conditionsNarrative}. ${resort.cams.length} webcam${resort.cams.length !== 1 ? "s" : ""} available. Real-time snow report for ${resort.state}.`
      : `Live webcams and real-time snow conditions at ${resort.name}, ${resort.state}. Check base depth, trail status, and powder reports.`;

    const pageUrl = `${BASE_URL}/resorts/${slug}`;

    return {
      title: `${resort.name} Live Webcams — Snow Report & Ski Conditions`,
      description: desc,
      keywords: [
        `${resort.name} webcam`,
        `${resort.name} snow report`,
        `${resort.name} ski conditions`,
        `${resort.name} live cam`,
        `${resort.state} ski resort webcam`,
        "live ski cam",
        "ski resort snow report",
        "mountain webcam",
      ],
      openGraph: {
        type: "website",
        url: pageUrl,
        title: `${resort.name} Live Webcams`,
        description: desc,
        siteName: "PeakCam",
      },
      twitter: {
        card: "summary_large_image",
        title: `${resort.name} Live Webcams`,
        description: desc,
      },
      alternates: { canonical: pageUrl },
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

  // Fetch weather, live conditions, and user reports server-side
  const [weather, hourlyRaw, liveConditions, userConditions] = await Promise.all([
    getWeatherForecast(resort.lat, resort.lng),
    getHourlyForecast(resort.lat, resort.lng),
    getLiveConditions(resort.id),
    getUserConditions(resort.id),
  ]);

  const forecastPeriods = hourlyRaw ? bucketIntoPeriods(hourlyRaw) : null;

  const snow = resort.snow_report;
  const pageUrl = `${BASE_URL}/resorts/${resort.slug}`;

  // Build amenityFeature array for snow conditions
  const amenityFeature: object[] = [];
  if (snow) {
    if (snow.base_depth != null)
      amenityFeature.push({ "@type": "LocationFeatureSpecification", name: "Base Depth", value: `${snow.base_depth} inches` });
    if (snow.new_snow_24h != null)
      amenityFeature.push({ "@type": "LocationFeatureSpecification", name: "New Snow (24h)", value: `${snow.new_snow_24h} inches` });
    if (snow.new_snow_48h != null)
      amenityFeature.push({ "@type": "LocationFeatureSpecification", name: "New Snow (48h)", value: `${snow.new_snow_48h} inches` });
    if (snow.trails_open != null && snow.trails_total != null)
      amenityFeature.push({ "@type": "LocationFeatureSpecification", name: "Trails Open", value: `${snow.trails_open} of ${snow.trails_total}` });
    if (snow.lifts_open != null && snow.lifts_total != null)
      amenityFeature.push({ "@type": "LocationFeatureSpecification", name: "Lifts Open", value: `${snow.lifts_open} of ${snow.lifts_total}` });
    if (snow.swe_in != null)
      amenityFeature.push({ "@type": "LocationFeatureSpecification", name: "Snow Water Equivalent", value: `${snow.swe_in} inches` });
    if (snow.conditions)
      amenityFeature.push({ "@type": "LocationFeatureSpecification", name: "Current Conditions", value: snow.conditions.includes("||") ? snow.conditions.split("||")[1] : snow.conditions });
  }

  // Build VideoObject entries for YouTube webcams
  const youtubeCams = resort.cams.filter((c) => c.youtube_id);
  const videos = youtubeCams.map((cam) => ({
    "@type": "VideoObject",
    name: `${resort.name} — ${cam.name} Live Webcam`,
    description: `Live webcam at ${resort.name}${cam.elevation ? ` (${cam.elevation})` : ""}.`,
    thumbnailUrl: `https://img.youtube.com/vi/${cam.youtube_id}/hqdefault.jpg`,
    embedUrl: `https://www.youtube.com/embed/${cam.youtube_id}`,
    uploadDate: resort.created_at,
  }));

  // Collect social / official links for sameAs
  const sameAs: string[] = [];
  if (resort.website_url) sameAs.push(resort.website_url);
  if (resort.x_url) sameAs.push(resort.x_url);
  if (resort.facebook_url) sameAs.push(resort.facebook_url);
  if (resort.instagram_url) sameAs.push(resort.instagram_url);

  const skiResortLd = {
    "@context": "https://schema.org",
    "@type": ["SkiResort", "TouristAttraction"],
    name: resort.name,
    description: snow
      ? `${resort.name} — ${snow.base_depth ?? "?"}″ base depth, ${snow.conditions ?? "current conditions"}. ${resort.cams.length} live webcams available.`
      : `Live webcams and snow conditions at ${resort.name}, ${resort.state}.`,
    url: pageUrl,
    image: `${BASE_URL}/resorts/${resort.slug}/opengraph-image`,
    address: {
      "@type": "PostalAddress",
      addressRegion: resort.state,
      addressCountry: "US",
    },
    geo: {
      "@type": "GeoCoordinates",
      latitude: resort.lat,
      longitude: resort.lng,
    },
    touristType: ["Skiing", "Snowboarding", "Winter Sports"],
    isAccessibleForFree: false,
    ...(sameAs.length ? { sameAs } : {}),
    ...(amenityFeature.length ? { amenityFeature } : {}),
    ...(videos.length ? { video: videos } : {}),
  };

  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: BASE_URL },
      { "@type": "ListItem", position: 2, name: "Resorts", item: `${BASE_URL}/#browse` },
      { "@type": "ListItem", position: 3, name: resort.name, item: pageUrl },
    ],
  };

  return (
    <main id="main-content">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(skiResortLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }}
      />
      <ResortDetailPage resort={resort} weather={weather} forecastPeriods={forecastPeriods} hourlyData={hourlyRaw} liveConditions={liveConditions} userConditions={userConditions} />
    </main>
  );
}

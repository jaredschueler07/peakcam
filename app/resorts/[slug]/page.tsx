import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getResortBySlug, getAllResortSlugs, getAllResorts, getLiveConditions, getUserConditions, getResortElevationFt } from "@/lib/supabase";
import { ResortAboutSection } from "@/components/resort/ResortAboutSection";
import type { NearbyResortsData } from "@/components/resort/NearbyResorts";
import { nearbyResorts, summarizeNearby } from "@/lib/geo";
import { HUB_BASE_PATH, groupByRegion, hubPath, stateHub, stateHubPath } from "@/lib/hubs";
import { isOffSeason } from "@/lib/map-utils";
import { getWeatherForecast, getHourlyForecast, bucketIntoPeriods } from "@/lib/weather";
import { getOpenMeteoForecast, getOpenMeteoHourly } from "@/lib/open-meteo";
import { ResortDetailPage } from "@/components/resort/ResortDetailPage";
import { camDisplayName } from "@/lib/cam-name";
import {
  buildResortMetaDescription,
  buildResortSchemaDescription,
  conditionsNarrative,
} from "@/lib/resort-copy";

import { SITE_URL as BASE_URL } from "@/lib/site";

export const revalidate = 3600;

// Reject any slug not returned by generateStaticParams at the router layer,
// before the page function runs. Without this, Next's full-route-cache for
// this SSG segment caches a notFound() render as a 200 (it stores the HTML,
// not the status code) — garbage slugs would 200 forever once first hit.
// Trade-off: a resort added to the DB between deploys 404s until the next
// build regenerates the static params list.
export const dynamicParams = false;

// Pre-render all active resort pages at build time.
//
// Must NOT swallow a listing failure into `[]`: with dynamicParams=false
// above, whatever this returns *is* the entire set of resort pages that
// will ever serve for this deployment — there is no on-demand fallback to
// recover unlisted slugs at request time. A `catch { return [] }` here used
// to be safe because dynamicParams defaulted to true (missing slugs just
// rendered on demand); now that it's false, the same catch would let a
// transient DB blip during build silently produce zero resort pages, the
// build would report SUCCESS, and every /resorts/[slug] URL would 404 at
// the router — no page code even runs, so nothing here can catch or serve
// stale. Letting this throw fails the build instead, and Vercel keeps
// serving the previous (good) deployment.
export async function generateStaticParams() {
  const slugs = await getAllResortSlugs();
  return slugs.map((slug) => ({ slug }));
}

// Dynamic metadata per resort
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  // getResortBySlug only returns null for a genuine "no such resort" (query
  // succeeded, zero rows). A failed query throws and is intentionally left
  // uncaught here: it fails this ISR revalidation so Next.js keeps serving
  // the last good metadata instead of caching an empty `{}` at 200.
  const resort = await getResortBySlug(slug);
  if (!resort) return {};

  // Season-aware: off-season copy points at the coming season instead of
  // publishing a dead "0″ base" snippet. ISR re-renders hourly, so `new
  // Date()` here tracks the season boundary within a day.
  const desc = buildResortMetaDescription(resort, new Date());

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

  // Fetch weather, live conditions, user reports and the catalogue (for the
  // nearby block) server-side. getAllResorts() throws on a failed query, like
  // getResortBySlug above: that fails this ISR revalidation so the last good
  // page keeps serving, rather than caching a resort page with no neighbours
  // at 200 for an hour.
  const isUS = resort.country === "US";
  const elevationFt = isUS ? null : await getResortElevationFt(resort.id);

  const [weather, hourlyRaw, liveConditions, userConditions, allResorts] = await Promise.all([
    isUS
      ? getWeatherForecast(resort.lat, resort.lng)
      : getOpenMeteoForecast(resort.lat, resort.lng, elevationFt),
    isUS
      ? getHourlyForecast(resort.lat, resort.lng)
      : getOpenMeteoHourly(resort.lat, resort.lng, elevationFt),
    getLiveConditions(resort.id),
    getUserConditions(resort.id),
    getAllResorts(),
  ]);

  const forecastPeriods = hourlyRaw ? bucketIntoPeriods(hourlyRaw) : null;

  // Nearby resorts (growth-audit S2). Ranked here from the full catalogue and
  // reduced to ≤5 summary rows plus two hub targets, so the client component
  // never receives the other ~147 resorts and their cam rows. The state hub
  // exists for every non-blank `state` (the hub pages are generated from the
  // same grouping); a region hub only for regions with ≥3 resorts, hence the
  // groupByRegion lookup rather than a bare regionHubPath().
  const stateCode = resort.state?.trim() ?? "";
  const stateHubLink = stateCode ? { label: stateHub(stateCode).label, href: stateHubPath(stateCode) } : null;
  const regionGroup = groupByRegion(allResorts).find((group) => group.resorts.some((r) => r.slug === resort.slug));
  const nearby: NearbyResortsData = {
    resorts: summarizeNearby(nearbyResorts(resort, allResorts)),
    stateHub: stateHubLink,
    regionHub: regionGroup ? { label: regionGroup.hub.label, href: hubPath(regionGroup.hub) } : null,
    // Same season heuristic and hourly ISR cadence as generateMetadata above.
    offSeason: isOffSeason(resort.lat, new Date()),
  };

  const snow = resort.snow_report;
  const pageUrl = `${BASE_URL}/resorts/${resort.slug}`;
  const ogImage = `${BASE_URL}/resorts/${resort.slug}/opengraph-image`;
  // `conditions` is "tags||narrative"; only the narrative half is prose.
  const narrative = conditionsNarrative(snow?.conditions);

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
    if (narrative)
      amenityFeature.push({ "@type": "LocationFeatureSpecification", name: "Current Conditions", value: narrative });
  }

  // One VideoObject per live stream (youtube + iframe). Refreshing stills
  // (`image`) and link-outs are not video and get no entry. Google requires
  // name/thumbnailUrl/uploadDate: uploadDate is the cam row's own created_at
  // (when PeakCam catalogued the stream), never the resort's; an iframe
  // stream exposes no poster frame, so the resort's OG card is the nearest
  // real image. The LIVE badge needs a BroadcastEvent carrying isLiveBroadcast
  // AND startDate AND endDate — isLiveBroadcast alone is a missing-field error
  // in the Rich Results Test, which turns every VideoObject from valid to
  // erroring. A 24/7 cam has no real end, and Google accepts the *expected*
  // end of an open-ended stream: 24h past the latest snow report, which the
  // sync jobs refresh four times a day, so every hourly ISR revalidation pushes
  // it forward. Derived from data rather than Date.now() so the render stays
  // pure (react-hooks/purity). startDate reuses created_at (the stream has been
  // live since PeakCam catalogued it), so a cam without one — or a resort with
  // no report yet — gets a plain VideoObject rather than a half-filled
  // BroadcastEvent.
  const broadcastEndDate = snow?.updated_at
    ? new Date(new Date(snow.updated_at).getTime() + 24 * 60 * 60 * 1000).toISOString()
    : null;
  const videos = resort.cams.flatMap((cam) => {
    const source =
      cam.embed_type === "youtube" && cam.youtube_id
        ? {
            thumbnailUrl: `https://img.youtube.com/vi/${cam.youtube_id}/hqdefault.jpg`,
            embedUrl: `https://www.youtube.com/embed/${cam.youtube_id}`,
          }
        : cam.embed_type === "iframe" && cam.embed_url
          ? { thumbnailUrl: ogImage, embedUrl: cam.embed_url }
          : null;
    if (!source) return [];
    return [
      {
        "@type": "VideoObject",
        name: `${resort.name} — ${camDisplayName(cam)} Live Webcam`,
        description: `Live webcam at ${resort.name}${cam.elevation ? ` (${cam.elevation})` : ""}.`,
        ...source,
        ...(cam.created_at && broadcastEndDate
          ? {
              uploadDate: cam.created_at,
              publication: {
                "@type": "BroadcastEvent",
                isLiveBroadcast: true,
                startDate: cam.created_at,
                endDate: broadcastEndDate,
              },
            }
          : {}),
      },
    ];
  });

  // Collect social / official links for sameAs
  const sameAs: string[] = [];
  if (resort.website_url) sameAs.push(resort.website_url);
  if (resort.x_url) sameAs.push(resort.x_url);
  if (resort.facebook_url) sameAs.push(resort.facebook_url);
  if (resort.instagram_url) sameAs.push(resort.instagram_url);

  const skiResortLd = {
    "@context": "https://schema.org",
    "@type": ["SkiResort", "TouristAttraction"],
    "@id": pageUrl,
    name: resort.name,
    description: buildResortSchemaDescription(resort),
    url: pageUrl,
    image: ogImage,
    address: {
      "@type": "PostalAddress",
      addressRegion: resort.state,
      addressCountry: resort.country,
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

  // Item 2 is the state hub ("Colorado" → /ski-cams/colorado), a real page in
  // the crawl path — the old `/#browse` fragment was the homepage again. A
  // resort with no state on file (none today) falls back to the hub index.
  const crumbHub = stateHubLink ?? { label: "Ski cams", href: HUB_BASE_PATH };
  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: BASE_URL },
      { "@type": "ListItem", position: 2, name: crumbHub.label, item: `${BASE_URL}${crumbHub.href}` },
      { "@type": "ListItem", position: 3, name: resort.name, item: pageUrl },
    ],
  };

  // SkiResort is a Place, which schema.org gives no dateModified — so freshness
  // rides on a WebPage node instead: dateModified is the latest snow report's
  // updated_at, the moment this page's data-bearing content last changed.
  const webPageLd = snow
    ? {
        "@context": "https://schema.org",
        "@type": "WebPage",
        url: pageUrl,
        name: `${resort.name} Snow Report & Webcams`,
        dateModified: snow.updated_at,
        mainEntity: { "@id": pageUrl },
      }
    : null;

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
      {webPageLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(webPageLd) }}
        />
      )}
      <ResortDetailPage resort={resort} weather={weather} forecastPeriods={forecastPeriods} hourlyData={hourlyRaw} liveConditions={liveConditions} userConditions={userConditions} nearby={nearby} />
      <ResortAboutSection resort={resort} />
    </main>
  );
}

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getResortBySlug, getAllResortSlugs, getAllResorts, getLiveConditions, getUserConditions, getResortElevationIndex, getResortOpenings, getResortCamTimeline, getStationNormalsSummary } from "@/lib/supabase";
import { resortSentence } from "@/lib/quotable";
import { stationFor } from "@/lib/stations";
import { ResortAboutSection } from "@/components/resort/ResortAboutSection";
import { ResortTabs } from "@/components/resort/ResortTabs";
import { ResortDescription } from "@/components/resort/ResortDescription";
import { buildResortFaqPage, faqPageLd } from "@/lib/resort-faq";
import { profileAdditionalProperties, profileDescription, profileSameAs, resolveElevation } from "@/lib/resort-profile";
import { breadcrumbListLd, resortBreadcrumb, resortTabUrl } from "@/lib/resort-pages";
import { SEASON_LABEL, toPacificDay } from "@/lib/openings";
import type { NearbyResortsData } from "@/components/resort/NearbyResorts";
import { nearbyResorts, summarizeNearby } from "@/lib/geo";
import { groupByRegion, hubPath, stateHub, stateHubPath } from "@/lib/hubs";
import { isOffSeason } from "@/lib/map-utils";
import { getWeatherForecast, getHourlyForecast, bucketIntoPeriods } from "@/lib/weather";
import { getOpenMeteoForecast, getOpenMeteoHourly } from "@/lib/open-meteo";
import { ResortDetailPage } from "@/components/resort/ResortDetailPage";
import { camDisplayName } from "@/lib/cam-name";
import { cameraPreview } from "@/lib/cam-preview";
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
  // Base/summit: the P0 profile columns when the importer has filled them,
  // else the resort_metadata row (one cached query for the whole catalogue).
  const elevationIndex = await getResortElevationIndex();
  const metadataRow = elevationIndex[resort.id];
  const elevation = resolveElevation(resort, metadataRow ? { baseFt: metadataRow.base_ft, summitFt: metadataRow.summit_ft } : null);
  const elevationFt = isUS
    ? null
    : elevation.baseFt != null && elevation.summitFt != null
      ? Math.round((elevation.baseFt + elevation.summitFt) / 2)
      : elevation.baseFt;

  // Still-archive strip (migration 024): the page's lead cam first — the same
  // "first embeddable active cam" rule ResortDetailPage uses — so the strip
  // shows the cam the visitor is already looking at when it has frames.
  const camOrder = [
    ...resort.cams.filter((cam) => cam.is_active && !cam.auto_disabled && cam.embed_type !== "link"),
    ...resort.cams.filter((cam) => cam.is_active && !cam.auto_disabled && cam.embed_type === "link"),
  ].map((cam) => cam.id);

  const [weather, hourlyRaw, liveConditions, userConditions, allResorts, openings, camTimeline, normals] = await Promise.all([
    isUS
      ? getWeatherForecast(resort.lat, resort.lng)
      : getOpenMeteoForecast(resort.lat, resort.lng, elevationFt),
    isUS
      ? getHourlyForecast(resort.lat, resort.lng)
      : getOpenMeteoHourly(resort.lat, resort.lng, elevationFt),
    getLiveConditions(resort.id),
    getUserConditions(resort.id),
    getAllResorts(),
    // The opening row feeds the Event node and the "when does it open" FAQ
    // entry as well as the no-report freshness sentence, so it is always read.
    getResortOpenings(),
    getResortCamTimeline(resort.id, camOrder, 24),
    // 30-year normals peak for the "typical season" FAQ entry; null without a station.
    getStationNormalsSummary(resort.snotel_station_id),
  ]);
  const opening = openings.find((row) => row.resort_id === resort.id) ?? null;

  // First sentence under the H1 (lib/quotable.ts): dated by the report's own
  // updated_at, labelled by its source. The SNOTEL wording names the station
  // ("Copper Mountain, 10,500 ft") from the bundled NRCS table in
  // lib/stations.ts — the same lookup the public API and its markdown
  // alternate use — and drops the parenthetical for a triplet the table does
  // not know. `new Date()` only decides whether an opening date is still
  // ahead; same hourly ISR cadence as generateMetadata above.
  const station = stationFor(resort);
  const now = new Date();
  const freshness = resortSentence(resort, now, { station, opening });

  // Identity + operational FAQ (lib/resort-faq.ts): the same list renders
  // visibly in ResortAboutSection and as the FAQPage node below, so the
  // structured data never claims a question the page does not show.
  const faq = buildResortFaqPage(resort, now, { elevation, opening, normals, station });
  const faqLd = faqPageLd(faq);
  const description = profileDescription(resort);

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
  const pageUrl = resortTabUrl(resort.slug, "overview");
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
  // Stills per active cam (lib/cam-preview): the same provider-published
  // snapshots the tiles render, so the structured data describes the images
  // that are actually on the page. Players with no known still fall back to
  // the resort's OG card as before.
  const activeCams = resort.cams.filter((cam) => cam.is_active && !cam.auto_disabled);
  const camStills = activeCams.flatMap((cam) => {
    const still = cameraPreview(cam);
    return still ? [still.src] : [];
  });
  const videos = resort.cams.flatMap((cam) => {
    const source =
      cam.embed_type === "youtube" && cam.youtube_id
        ? {
            thumbnailUrl: `https://img.youtube.com/vi/${cam.youtube_id}/hqdefault.jpg`,
            embedUrl: `https://www.youtube.com/embed/${cam.youtube_id}`,
          }
        : cam.embed_type === "iframe" && cam.embed_url
          ? { thumbnailUrl: cameraPreview(cam)?.src ?? ogImage, embedUrl: cam.embed_url }
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

  // sameAs: the operator's site, socials and the Wikidata item when the
  // profile has one. additionalProperty: vertical, annual snowfall, longest
  // run, skiable terrain, passes — each only when the row carries the value.
  const sameAs = profileSameAs(resort);
  const additionalProperty = profileAdditionalProperties(resort, elevation);

  const skiResortLd = {
    "@context": "https://schema.org",
    "@type": ["SkiResort", "TouristAttraction"],
    "@id": pageUrl,
    name: resort.name,
    // The stored description when the profile has one (its provenance is
    // labelled on the page and in the markdown alternate); else the
    // data-derived sentence.
    description: description?.text ?? buildResortSchemaDescription(resort),
    url: pageUrl,
    // OG card first (the share image), then one still per cam, so image
    // search has the mountain views and not only the generated poster.
    image: camStills.length ? [ogImage, ...camStills] : ogImage,
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
    ...(additionalProperty.length ? { additionalProperty } : {}),
    ...(videos.length ? { video: videos } : {}),
    ...(resort.trail_map_url ? { hasMap: resort.trail_map_url } : {}),
  };

  // Home › {State hub} › {Resort} (lib/resort-pages.ts): one trail feeds the
  // visible HubBreadcrumb inside ResortDetailPage and the JSON-LD, so the two
  // can never disagree. The subpages append their own leaf to the same trail.
  const breadcrumb = resortBreadcrumb(resort, "overview");
  const breadcrumbLd = breadcrumbListLd(breadcrumb);

  // SkiResort is a Place, which schema.org gives no dateModified — so freshness
  // rides on a WebPage node instead: dateModified is the latest snow report's
  // updated_at, the moment this page's data-bearing content last changed.
  // `speakable` points at the freshness sentence (#resort-freshness in
  // ResortDetailPage), the one dated line written to be read aloud verbatim.
  const webPageLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    url: pageUrl,
    name: `${resort.name} Snow Report & Webcams`,
    ...(snow ? { dateModified: snow.updated_at } : {}),
    mainEntity: { "@id": pageUrl },
    speakable: { "@type": "SpeakableSpecification", cssSelector: ["#resort-freshness"] },
    ...(description ? { creditText: `Description source: ${description.source}` } : {}),
  };

  // Event: "{Resort} 2026–27 season opening" from resort_openings — only while
  // the opening is ahead of today (US Pacific day, the same clock
  // /opening-dates reads), because a past opening is not an upcoming event.
  // A projection is still EventScheduled but says so in its description; a
  // Southern-hemisphere row with only a closing date gets no Event.
  const openingDate = opening?.confirmed_open ?? opening?.projected_open ?? null;
  const eventLd =
    opening && openingDate && openingDate >= toPacificDay(now)
      ? {
          "@context": "https://schema.org",
          "@type": "Event",
          name: `${resort.name} ${opening.season.replace(/^(\d{4})-(\d{2})$/, "$1–$2") || SEASON_LABEL} season opening`,
          description: opening.confirmed_open
            ? `Opening day of the ${opening.season} ski season at ${resort.name}, as announced by the resort.`
            : `Projected opening day of the ${opening.season} ski season at ${resort.name}. A projection until the resort confirms it.`,
          startDate: openingDate,
          eventStatus: "https://schema.org/EventScheduled",
          eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
          location: {
            "@type": "Place",
            "@id": pageUrl,
            name: resort.name,
            address: { "@type": "PostalAddress", addressRegion: resort.state, addressCountry: resort.country },
            geo: { "@type": "GeoCoordinates", latitude: resort.lat, longitude: resort.lng },
          },
          ...(resort.website_url ? { organizer: { "@type": "Organization", name: resort.name, url: resort.website_url } } : {}),
          url: `${BASE_URL}/opening-dates`,
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
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(webPageLd) }}
      />
      {eventLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(eventLd) }}
        />
      )}
      {faqLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd) }}
        />
      )}
      <ResortDetailPage
        resort={resort}
        weather={weather}
        forecastPeriods={forecastPeriods}
        hourlyData={hourlyRaw}
        liveConditions={liveConditions}
        userConditions={userConditions}
        nearby={nearby}
        freshness={{ segments: freshness.segments }}
        breadcrumb={breadcrumb}
        camTimeline={camTimeline}
        subnav={
          <>
            <ResortTabs slug={resort.slug} active="overview" />
            <ResortDescription description={description} />
          </>
        }
      />
      <ResortAboutSection resort={resort} faq={faq} />
    </main>
  );
}

import type { Metadata } from "next";
import { getAllResorts } from "@/lib/supabase";
import { getRadarFrames } from "@/lib/weather-radar";
import { isOffSeason } from "@/lib/map-utils";
import { FullPageMap } from "./FullPageMap";

import { SITE_URL } from "@/lib/site";

export const revalidate = 3600;

// A route-level `openGraph` replaces the root's wholesale, so the root
// app/opengraph-image.tsx is not inherited here — declare the card explicitly.
const OG_IMAGE = {
  url: "/opengraph-image",
  width: 1200,
  height: 630,
  alt: "PeakCam — live ski resort webcams and snow reports",
};

export const metadata: Metadata = {
  title: "Interactive Ski Resort Map",
  description:
    "Explore 150+ ski resorts across North & South America on an interactive map with live snow conditions, base depth, weather radar, and terrain visualization.",
  openGraph: {
    title: "Interactive Ski Resort Map",
    description:
      "Explore ski resorts on an interactive map with live snow data and weather radar.",
    url: `${SITE_URL}/map`,
    type: "website",
    siteName: "PeakCam",
    images: [OG_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: "Interactive Ski Resort Map",
    description:
      "Explore ski resorts on an interactive map with live snow data and weather radar.",
    images: [OG_IMAGE],
  },
  alternates: { canonical: `${SITE_URL}/map` },
};

export default async function MapPage() {
  // Resort fetch failures propagate so a failed ISR revalidation keeps
  // serving the last good page instead of caching an empty map at 200.
  const [resorts, radarFrames] = await Promise.all([
    getAllResorts(),
    getRadarFrames().catch(() => []),
  ]);

  const now = new Date();

  return (
    <main id="main-content">
      {/* Screen-reader equivalent for the map (WCAG 1.1.1). The MapLibre canvas
          (and the whole client-only FullPageMap subtree) exposes no accessible
          representation of its markers, so this server component renders the
          same resorts — with conditions — as a navigable list. Rendered here
          (not inside FullPageMap) so it lands in the SSR HTML, available to
          assistive tech before/without the client map. */}
      <nav aria-label="Ski resorts shown on the map" className="sr-only">
        <h2>Ski resorts on the map</h2>
        <ul>
          {resorts.map((r) => {
            const off = isOffSeason(r.lat, now);
            const base = r.snow_report?.base_depth;
            return (
              <li key={r.slug}>
                <a href={`/resorts/${r.slug}`}>
                  {r.name} — {r.region}, {r.state}.{" "}
                  {off
                    ? "Off-season."
                    : `${r.cond_rating} conditions${base != null ? `, ${base} inch base` : ""}.`}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>
      <FullPageMap resorts={resorts} radarFrames={radarFrames} />
    </main>
  );
}

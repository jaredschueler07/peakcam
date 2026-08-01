import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  DROP_IN_RESORT_SLUGS,
  getDropInGameUrl,
  getDropInProfile,
  DROP_IN_GAME_PROFILES,
} from "@/lib/drop-in";
import DropInFrame from "@/components/drop-in/DropInFrame";
import DropInClientBoundary from "@/components/drop-in/DropInClientBoundary";
import { getResortBySlug } from "@/lib/supabase";
import { getWeatherForecast } from "@/lib/weather";
import { buildConditionsSnapshot } from "@/lib/game/conditions";

const BASE_URL = "https://peakcam.io";
export const revalidate = 3600;

// The pilot roster is static and tiny — prerender all three.
export function generateStaticParams() {
  return DROP_IN_RESORT_SLUGS.map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const profile = getDropInProfile(slug);
  if (!profile) return {};

  const title = `Drop In — Ski ${profile.name}`;
  const description =
    `Drop In and ski ${profile.name} — a procedural arcade descent with six runs ` +
    `(${profile.trailNames.slice(0, 3).join(", ")} and more), ` +
    `${profile.verticalDropFt.toLocaleString()} feet of vertical from a ` +
    `${profile.summitElevationFt.toLocaleString()}-foot summit.`;
  const pageUrl = `${BASE_URL}/resorts/${slug}/drop-in`;

  return {
    title,
    description,
    openGraph: {
      type: "website",
      url: pageUrl,
      title: `${title} | PeakCam`,
      description,
      siteName: "PeakCam",
    },
    twitter: {
      card: "summary_large_image",
      title: `${title} | PeakCam`,
      description,
    },
    alternates: { canonical: pageUrl },
    // A playable canvas isn't a search result worth indexing; the resort page is.
    robots: { index: false, follow: true },
  };
}

export default async function DropInPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ engine?: string | string[] }>;
}) {
  const { slug } = await params;
  const profile = getDropInProfile(slug);
  const gameUrl = getDropInGameUrl(slug);

  // Anything outside the three-resort pilot is a 404, not a default mountain.
  // Decided before searchParams is awaited: touching searchParams opts the
  // route into dynamic streaming, and once the shell has flushed notFound()
  // can no longer set the 404 status code.
  if (!profile || !gameUrl) return notFound();

  const { engine } = await searchParams;
  if (engine !== "v2") {
    return <main id="main-content"><DropInFrame profile={profile} gameUrl={gameUrl} /></main>;
  }

  const resort = await getResortBySlug(slug);
  const forecast = resort ? await getWeatherForecast(resort.lat, resort.lng) : null;
  const conditions = resort
    ? buildConditionsSnapshot(resort, resort.snow_report, forecast)
    : buildConditionsSnapshot({ slug, cond_rating: "good" }, null, null);

  // The layout's global skip link targets #main-content; every other route
  // provides it, and without it "Skip to main content" lands on nothing.
  return (
    <main id="main-content">
      <DropInClientBoundary
        profile={DROP_IN_GAME_PROFILES[slug as keyof typeof DROP_IN_GAME_PROFILES]}
        conditions={conditions}
      />
    </main>
  );
}

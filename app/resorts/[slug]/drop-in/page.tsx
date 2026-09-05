import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import {
  DROP_IN_RESORT_SLUGS,
  getDropInProfile,
  DROP_IN_GAME_PROFILES,
} from "@/lib/drop-in";
import { getResortBySlug, lookupResortNameBySlug } from "@/lib/supabase";
import DropInClientBoundary from "@/components/drop-in/DropInClientBoundary";
import DropInUnavailable from "@/components/drop-in/DropInUnavailable";
import { Header } from "@/components/layout/Header";
import { getWeatherForecast } from "@/lib/weather";
import { buildConditionsSnapshot } from "@/lib/game/conditions";
import { PHYSICS_V2_ROLLOUT_ENABLED, physicsModelForRollout } from "@/lib/game/config/physics-rollout";

import { SITE_URL as BASE_URL } from "@/lib/site";

import breckenridgeNetwork from "@/public/game/terrain/breckenridge.network.json";
import heavenlyNetwork from "@/public/game/terrain/heavenly.network.json";
import portilloNetwork from "@/public/game/terrain/ski-portillo.network.json";
const courseNetworks = { breckenridge: breckenridgeNetwork, heavenly: heavenlyNetwork, "ski-portillo": portilloNetwork };

export const revalidate = 3600;

// The pilot roster is static and tiny — prerender all three. Everything else is
// rendered on demand (and cached by the revalidate above), so the resort lookup
// that powers the "not in the pilot yet" state never runs during the build.
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

  // Off-roster: don't spend a DB round-trip on a title. Generic, and noindex so
  // the ~125 non-pilot permutations of this URL never enter the index.
  if (!profile) {
    return {
      title: "Drop In isn't available for this resort yet",
      description:
        "Drop In is PeakCam's arcade ski descent, hand-built for a few resorts at a time. " +
        "See which mountains you can ski right now.",
      robots: { index: false, follow: true },
    };
  }

  const title = `Drop In — Ski ${profile.name}`;
  const description =
    `Drop In and ski ${profile.name} — an arcade descent on real mountain terrain, with named runs ` +
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
    // A playable canvas isn't a search result worth indexing; the resort page is
    // (and /drop-in is the indexable front door for the feature).
    robots: { index: false, follow: true },
  };
}

export default async function DropInPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const profile = getDropInProfile(slug);

  // Off the pilot roster. Two very different situations share this URL shape:
  // a resort we cover but haven't built a descent for (Vail — by far the common
  // case), and a slug that isn't a resort at all. Telling the first group
  // "RESORT NOT FOUND" is simply false, so look the slug up and split them.
  //
  // The branch is taken before `searchParams` is awaited: touching searchParams
  // opts the route into dynamic streaming, and once the shell has flushed,
  // notFound() can no longer set the 404 status code.
  //
  // `lookupResortNameBySlug` is a one-query name-only probe rather than
  // `getResortBySlug` (three round trips for cams and a snow report this page
  // never renders), and it reports "couldn't check" separately from "no such
  // resort" — the distinction the fail-safe below depends on.
  if (!profile) {
    const lookup = await lookupResortNameBySlug(slug);

    // Genuinely unknown slug — a true 404, handled by the sibling
    // not-found.tsx so the copy is about Drop In, not about a missing resort.
    if (lookup.status === "absent") notFound();

    // Lookup errored. Render the unnamed "no descent here" copy rather than
    // 404ing a resort that probably exists — and opt this render out of the
    // route cache, so a blip during the revalidate window isn't frozen into
    // ISR for the next hour. Both statements matter: without connection() the
    // degraded page caches; without the guard every off-roster resort page
    // would go dynamic.
    if (lookup.status === "errored") await connection();

    const resortName = lookup.status === "found" ? lookup.name : undefined;

    return (
      <>
        <Header showSearch={false} />
        <main id="main-content">
          <DropInUnavailable resortName={resortName} resortSlug={slug} />
        </main>
      </>
    );
  }

  const resort = await getResortBySlug(slug);
  const forecast = resort ? await getWeatherForecast(resort.lat, resort.lng) : null;
  const physicsModel = physicsModelForRollout(PHYSICS_V2_ROLLOUT_ENABLED);
  const conditions = resort
    ? buildConditionsSnapshot(resort, resort.snow_report, forecast, physicsModel)
    : buildConditionsSnapshot({ slug, cond_rating: "good" }, null, null, physicsModel);

  // The layout's global skip link targets #main-content; every other route
  // provides it, and without it "Skip to main content" lands on nothing.
  return (
    <main id="main-content">
      <DropInClientBoundary
        profile={DROP_IN_GAME_PROFILES[slug as keyof typeof DROP_IN_GAME_PROFILES]}
        conditions={conditions}
        courseChoices={courseNetworks[slug as keyof typeof courseNetworks].runs}
      />
    </main>
  );
}

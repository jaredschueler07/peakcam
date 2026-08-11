import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  DROP_IN_RESORT_SLUGS,
  getDropInGameUrl,
  getDropInProfile,
} from "@/lib/drop-in";
import { getResortBySlug } from "@/lib/supabase";
import DropInFrame from "@/components/drop-in/DropInFrame";
import DropInUnavailable from "@/components/drop-in/DropInUnavailable";
import { Header } from "@/components/layout/Header";

const BASE_URL = "https://peakcam.io";

// The pilot roster is static and tiny — prerender all three. Everything else is
// rendered on demand (and cached by the revalidate below), so the resort lookup
// that powers the "not in the pilot yet" state never runs during the build.
export function generateStaticParams() {
  return DROP_IN_RESORT_SLUGS.map((slug) => ({ slug }));
}

export const revalidate = 3600;

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
  const gameUrl = getDropInGameUrl(slug);

  // Off the pilot roster. Two very different situations share this URL shape:
  // a resort we cover but haven't built a descent for (Vail — by far the common
  // case), and a slug that isn't a resort at all. Telling the first group
  // "RESORT NOT FOUND" is simply false, so look the slug up and split them.
  //
  // Fail safe: if the lookup errors we render the unnamed "no descent here"
  // copy rather than 404ing a resort that exists or crashing the route.
  if (!profile || !gameUrl) {
    let resortName: string | undefined;
    let lookupFailed = false;
    try {
      const resort = await getResortBySlug(slug);
      if (resort) resortName = resort.name;
    } catch {
      lookupFailed = true;
    }

    // Genuinely unknown slug — a true 404, handled by the sibling
    // not-found.tsx so the copy is about Drop In, not about a missing resort.
    if (!resortName && !lookupFailed) notFound();

    return (
      <>
        <Header showSearch={false} />
        <main id="main-content">
          <DropInUnavailable resortName={resortName} resortSlug={slug} />
        </main>
      </>
    );
  }

  // The layout's global skip link targets #main-content; every other route
  // provides it, and without it "Skip to main content" lands on nothing.
  return (
    <main id="main-content">
      <DropInFrame profile={profile} gameUrl={gameUrl} />
    </main>
  );
}

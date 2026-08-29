import type { Metadata } from "next";
import { getAllResorts } from "@/lib/supabase";
import { ComparePage } from "@/components/compare/ComparePage";
import { parseCompareSlugs } from "@/lib/compare-params";
import type { ResortWithData } from "@/lib/types";

import { SITE_URL as BASE_URL } from "@/lib/site";

export const revalidate = 3600;

/**
 * `resorts` can arrive as a comma list (`?resorts=vail,alta`) OR as a repeated
 * key (`?resorts=vail&resorts=alta`), which Next.js surfaces as a string[].
 * Both go through `parseCompareSlugs`.
 */
interface Props {
  searchParams: Promise<{ resorts?: string | string[] }>;
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  let slugs: string[] = [];
  try {
    const params = await searchParams;
    slugs = parseCompareSlugs(params?.resorts);
  } catch {
    // Metadata must never take the route down — fall back to the generic title.
    slugs = [];
  }

  const title =
    slugs.length > 0
      ? `Compare ${slugs.length} Resort${slugs.length > 1 ? "s" : ""}`
      : "Compare Ski Resorts";
  return {
    title,
    description:
      "Side-by-side snow depth, new snow, trail counts, and webcam comparison for ski resorts across North America.",
    // Canonicalize to the bare /compare URL regardless of ?resorts= — the
    // query param produces unbounded combinations that shouldn't each be
    // treated as a distinct indexable page.
    alternates: { canonical: `${BASE_URL}/compare` },
  };
}

export default async function ComparePageRoute({ searchParams }: Props) {
  let slugs: string[] = [];
  try {
    const params = await searchParams;
    slugs = parseCompareSlugs(params?.resorts);
  } catch {
    slugs = [];
  }

  // This route reads `searchParams`, which makes it dynamic (server-rendered
  // per request) regardless of the `revalidate` export above — there is no
  // cached ISR entry for a DB outage to fall back to. The failure is caught
  // rather than allowed to propagate, but it is never swallowed: `loadFailed`
  // drives an explicit "couldn't load" notice, so the page can't silently
  // render as an empty comparison. Anything else that throws while rendering
  // still lands on the route's error.tsx boundary.
  let allResorts: ResortWithData[] = [];
  let loadFailed = false;
  try {
    allResorts = await getAllResorts();
  } catch {
    loadFailed = true;
    console.warn("[PeakCam] Could not fetch resorts for compare page.");
  }
  if (!Array.isArray(allResorts)) allResorts = [];

  // Resolve slugs → resorts, tracking the ones we couldn't find so the client
  // can explain itself instead of silently dropping them.
  const bySlug = new Map(allResorts.map((r) => [r.slug, r]));
  const compareResorts: ResortWithData[] = [];
  const missingSlugs: string[] = [];
  for (const slug of slugs) {
    const resort = bySlug.get(slug);
    if (resort) compareResorts.push(resort);
    else missingSlugs.push(slug);
  }

  return (
    <main id="main-content">
      <ComparePage
        allResorts={allResorts}
        initialResorts={compareResorts}
        missingSlugs={loadFailed ? [] : missingSlugs}
        loadFailed={loadFailed}
      />
    </main>
  );
}

import type { Metadata } from "next";
import { getAllResorts } from "@/lib/supabase";
import { ComparePage } from "@/components/compare/ComparePage";
import type { ResortWithData } from "@/lib/types";

const BASE_URL = "https://peakcam.io";

export const revalidate = 3600;

interface Props {
  searchParams: Promise<{ resorts?: string }>;
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const params = await searchParams;
  const slugs = params.resorts?.split(",").filter(Boolean) ?? [];
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
  const params = await searchParams;
  const slugs = params.resorts?.split(",").filter(Boolean).slice(0, 4) ?? [];

  // This route reads `searchParams`, which makes it dynamic (server-rendered
  // per request) regardless of the `revalidate` export above — there is no
  // cached ISR entry for it to fall back to. Letting the fetch failure
  // propagate here means a DB outage surfaces as a request-time 500 rather
  // than a page that silently renders with zero resorts to compare.
  const allResorts: ResortWithData[] = await getAllResorts();

  const compareResorts = slugs
    .map((slug) => allResorts.find((r) => r.slug === slug))
    .filter((r): r is ResortWithData => r !== undefined);

  return <main id="main-content"><ComparePage allResorts={allResorts} initialResorts={compareResorts} /></main>;
}

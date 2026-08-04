import type { Metadata } from "next";
import { getAllResorts } from "@/lib/supabase";
import { ComparePage } from "@/components/compare/ComparePage";
import type { ResortWithData } from "@/lib/types";

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
  };
}

export default async function ComparePageRoute({ searchParams }: Props) {
  const params = await searchParams;
  const slugs = params.resorts?.split(",").filter(Boolean).slice(0, 4) ?? [];

  // Let a fetch failure propagate — it fails this ISR revalidation so
  // Next.js keeps serving the last good page instead of caching an empty
  // compare page at 200.
  const allResorts: ResortWithData[] = await getAllResorts();

  const compareResorts = slugs
    .map((slug) => allResorts.find((r) => r.slug === slug))
    .filter((r): r is ResortWithData => r !== undefined);

  return <main id="main-content"><ComparePage allResorts={allResorts} initialResorts={compareResorts} /></main>;
}

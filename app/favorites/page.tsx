import type { Metadata } from "next";
import { getAllResorts } from "@/lib/supabase";
import { FavoritesPage } from "@/components/browse/FavoritesPage";

// This page is entirely personalized (auth session + client-side
// favorites from localStorage/Supabase auth via useFavorites) — there is no
// meaningful "cached for everyone" version of it. It was previously ISR'd
// like the catalog pages, which meant `next build` tried to prerender it by
// fetching resorts at build time; a DB blip during a build then failed the
// *entire* deployment, not just this page. Forcing it dynamic removes it
// from the build-time prerender path entirely: it now fetches per-request,
// so a DB outage produces a 500 on this one route instead of blocking every
// other page's deployment.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "My Favorites",
  description: "Your saved ski resorts — quick access to conditions, cams, and snow reports.",
  // Personalized per-user content — nothing here is the same page twice.
  robots: { index: false, follow: false },
};

export default async function Page() {
  const resorts = await getAllResorts();
  return <FavoritesPage resorts={resorts} />;
}

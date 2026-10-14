import type { Metadata } from "next";
import { getAllResorts } from "@/lib/supabase";
import { FavoritesPage } from "@/components/browse/FavoritesPage";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "My Favorites",
  description: "Your saved ski resorts — quick access to conditions, cams, and snow reports.",
};

export default async function Page() {
  const resorts = await getAllResorts();
  return <FavoritesPage resorts={resorts} />;
}

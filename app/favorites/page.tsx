import { getAllResorts } from "@/lib/supabase";
import { FavoritesPage } from "@/components/favorites/FavoritesPage";

export const revalidate = 3600;

export const metadata = {
  title: "Favorites | PeakCam",
  description: "Your saved ski resorts — conditions at a glance.",
};

export default async function Page() {
  const resorts = await getAllResorts();
  return <FavoritesPage resorts={resorts} />;
}

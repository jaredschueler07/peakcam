import { getAllResorts } from "@/lib/supabase";
import { Header } from "@/components/layout/Header";
import { PeakFooter } from "@/components/home/PeakFooter";
import { PowderAlertSignup } from "@/components/alerts/PowderAlertSignup";

export const revalidate = 3600;
export const metadata = { title: "Powder alerts | PeakCam", description: "Get an email when your favorite resorts reach your snowfall threshold." };
export default async function AlertsPage() {
  const resorts = await getAllResorts();
  return <><Header showSearch={false} /><main id="main-content" className="mx-auto max-w-2xl px-5 py-12">
    <h1 className="font-display text-4xl font-black text-ink">Never miss a powder day.</h1>
    <p className="my-5 text-lg text-bark">Choose your mountains and how much fresh snow makes the trip worthwhile. We’ll email you when conditions meet your threshold.</p>
    <PowderAlertSignup resorts={resorts} />
    <p className="mt-6 text-sm text-bark">Already subscribed? Use the Manage alerts link in any PeakCam alert email to update your mountains or unsubscribe.</p>
  </main><PeakFooter /></>;
}

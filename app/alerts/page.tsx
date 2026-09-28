import { Suspense } from "react";
import Link from "next/link";
import { getAllResorts } from "@/lib/supabase";
import { Header } from "@/components/layout/Header";
import { PeakFooter } from "@/components/home/PeakFooter";
import { AlertsIntro, AlertsPageContent } from "@/components/alerts/AlertsPageContent";
import type { AlertResort } from "@/components/alerts/PowderAlertForm";
import { isOffSeason } from "@/lib/map-utils";
import { SITE_URL } from "@/lib/site";

export const revalidate = 3600;

const PAGE_URL = `${SITE_URL}/alerts`;
const SHARE_TITLE = "Powder Alerts — One Email When Your Mountain Gets Snow";
const SHARE_DESCRIPTION =
  "Pick your ski resorts and a fresh-snow threshold. Free, no account — PeakCam emails you the morning it happens.";

export const metadata = {
  title: "Powder Alerts — Email When Your Resorts Get Fresh Snow",
  description: "Get an email when your ski resorts hit your fresh-snow threshold. Free, no account needed, unsubscribe anytime.",
  alternates: { canonical: PAGE_URL },
  // The root layout's openGraph and twitter objects are replaced, not merged,
  // once a page sets its own — so siteName is repeated here and the twitter
  // card carries this page's pitch rather than the root's generic title (same
  // as /map, /compare and /snow-report).
  openGraph: {
    title: SHARE_TITLE,
    description: SHARE_DESCRIPTION,
    url: PAGE_URL,
    type: "website" as const,
    siteName: "PeakCam",
  },
  twitter: {
    card: "summary_large_image" as const,
    title: SHARE_TITLE,
    description: SHARE_DESCRIPTION,
  },
};

// Northern-hemisphere reference for the server-rendered headline. The client
// swaps in the first ?resort= mountain's own hemisphere once it has read the
// query string (AlertsPageContent). Far from the equator so the month split
// in isOffSeason is unambiguous.
const NORTHERN_REFERENCE_LAT = 45;

export default async function AlertsPage() {
  const resorts = await getAllResorts();
  // Only what the picker renders. The full ResortWithData (cams, snow report)
  // was being serialized into this page's HTML for nothing.
  const alertResorts: AlertResort[] = resorts.map(({ id, name, slug, state, lat }) => ({ id, name, slug, state, lat }));
  // Re-evaluated on every ISR revalidation (hourly), so the headline flips
  // within an hour of the season boundary.
  const initialOffSeason = isOffSeason(NORTHERN_REFERENCE_LAT, new Date());

  return (
    <>
      <Header showSearch={false} />
      <main id="main-content" className="mx-auto max-w-2xl px-5 py-12">
        {/* useSearchParams inside AlertsPageContent client-renders this boundary
            on a static route; the fallback is what crawlers and the first paint
            see, so it carries the real h1 and a box the form will fill. */}
        <Suspense
          fallback={
            <>
              <AlertsIntro offSeason={initialOffSeason} />
              <div aria-hidden className="min-h-[28rem] rounded-[18px] border-[1.5px] border-ink/15 bg-cream-50" />
            </>
          }
        >
          <AlertsPageContent resorts={alertResorts} initialOffSeason={initialOffSeason} />
        </Suspense>

        <section className="mt-10">
          <h2 className="font-display text-xl font-bold text-ink">How alerts work</h2>
          <p className="mt-2 text-sm leading-relaxed text-bark">
            Every morning around 6am Mountain we compare each of your mountains against your threshold two ways: the
            last 24 hours of observed snowfall (NRCS SNOTEL sensors, or a weather-model estimate where no station
            exists) and the 7-day forecast — so you hear about a storm that just landed and one that is about to. One
            email per storm day, nothing on quiet days.{" "}
            <Link href="/methodology" className="font-bold text-ink underline">
              How we measure snow →
            </Link>
          </p>
        </section>

        <p className="mt-6 text-sm text-bark">
          Already subscribed? Use the Manage alerts link in any PeakCam alert email to update your mountains or
          unsubscribe.
        </p>
      </main>
      <PeakFooter />
    </>
  );
}

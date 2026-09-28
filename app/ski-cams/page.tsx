import type { Metadata } from "next";
import Link from "next/link";
import { getAllResorts } from "@/lib/supabase";
import { Header } from "@/components/layout/Header";
import { PeakFooter } from "@/components/home/PeakFooter";
import { HubBreadcrumb } from "@/components/hubs/HubBreadcrumb";
import { HubIndexSection, type HubCard } from "@/components/hubs/HubIndexSection";
import { HUB_BASE_PATH, hubPath, listHubs, type Hub } from "@/lib/hubs";
import { hubCamStats } from "@/lib/hub-copy";
import type { ResortWithData } from "@/lib/types";
import { SITE_URL } from "@/lib/site";

// Hourly, like every data-bearing page: the counts only move on a deploy, but
// the cam counts follow the cam-health job's is_active flips.
export const revalidate = 3600;

const PAGE_URL = `${SITE_URL}${HUB_BASE_PATH}`;
const PAGE_TITLE = "Ski Resort Webcams by State & Region — Live Cams & Snow Reports | PeakCam";
const SHARE_TITLE = "Ski Resort Webcams by State & Region";
// 154 chars — inside the ~160 SERP budget the hub descriptions are held to.
const DESCRIPTION =
  "Live ski resort webcams and snow reports by state, province, country and mountain region — Colorado, Utah, Lake Tahoe, Vermont, Chile, Argentina and more.";

export const metadata: Metadata = {
  // `absolute` sidesteps the root layout's "%s | PeakCam" template — the
  // title already ends with the brand and would otherwise get it twice.
  title: { absolute: PAGE_TITLE },
  description: DESCRIPTION,
  alternates: { canonical: PAGE_URL },
  keywords: ["ski webcams by state", "ski resort webcams", "colorado ski webcams", "utah ski cams", "lake tahoe ski webcams", "vermont ski cams", "chile ski resorts snow report"],
  // The root layout's openGraph/twitter objects are replaced, not merged, once
  // a page sets its own — so siteName is repeated here (same as /alerts).
  openGraph: {
    title: SHARE_TITLE,
    description: DESCRIPTION,
    url: PAGE_URL,
    type: "website",
    siteName: "PeakCam",
  },
  twitter: {
    card: "summary_large_image",
    title: SHARE_TITLE,
    description: DESCRIPTION,
  },
};

/** StateGroup and RegionGroup both satisfy this shape; the card only needs the hub and its members. */
function toCards(groups: ReadonlyArray<{ hub: Hub; count: number; resorts: ResortWithData[] }>): HubCard[] {
  return groups.map((group) => ({ hub: group.hub, count: group.count, cams: hubCamStats(group.resorts).total }));
}

export default async function SkiCamsIndexPage() {
  // Let a fetch failure propagate — it fails this ISR revalidation so Next.js
  // keeps serving the last good page instead of caching an empty index at 200.
  const resorts = await getAllResorts();
  const { states, regions } = listHubs(resorts);

  const us = toCards(states.filter((group) => group.hub.kind === "state"));
  const canada = toCards(states.filter((group) => group.hub.kind === "province"));
  const southAmerica = toCards(states.filter((group) => group.hub.kind === "country"));
  const regionCards = toCards(regions);
  const totalCams = hubCamStats(resorts).total;

  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
      { "@type": "ListItem", position: 2, name: "Ski Cams", item: PAGE_URL },
    ],
  };

  // Every hub page, states first (biggest first), then regions — the same
  // order the sections below render in.
  const hubs = [...states, ...regions];
  const listLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Ski resort webcams by state and region",
    url: PAGE_URL,
    numberOfItems: hubs.length,
    itemListElement: hubs.map((group, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: `${group.hub.label} ski webcams`,
      url: `${SITE_URL}${hubPath(group.hub)}`,
    })),
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(listLd) }} />
      <Header showSearch={false} />
      <main id="main-content" className="mx-auto max-w-5xl px-5 py-10 md:py-12">
        <HubBreadcrumb items={[{ label: "Home", href: "/" }, { label: "Ski Cams" }]} />
        <p className="pc-eyebrow mb-3 mt-6">Webcams</p>
        <h1 className="font-display text-4xl font-black leading-[0.95] tracking-[-0.02em] text-ink md:text-5xl">
          Ski resort webcams by state and region
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-bark">
          {resorts.length} ski resorts and {totalCams} live webcams across {states.length} states, provinces and countries and{" "}
          {regions.length} mountain regions. Pick a place for its live summary, every resort ranked by base depth, featured
          cams and free powder alerts for the whole area.
        </p>

        <HubIndexSection id="hubs-us" title="United States" blurb="Sensor-fed snow data from NRCS SNOTEL and SCAN stations where a resort has one." cards={us} />
        <HubIndexSection id="hubs-canada" title="Canada" blurb="Weather-model snow estimates — the NRCS network stops at the border." cards={canada} />
        <HubIndexSection id="hubs-south-america" title="South America" blurb="The Andes ski June to October, while North America waits for snow." cards={southAmerica} />
        <HubIndexSection
          id="hubs-regions"
          title="Mountain regions"
          blurb="Ranges, lakes and counties with three or more resorts — some cross state lines."
          cards={regionCards}
        />

        <p className="mt-12 text-sm text-bark">
          Looking for one table of everything? The{" "}
          <Link href="/snow-report" className="font-bold text-ink underline underline-offset-2">
            live snow report
          </Link>{" "}
          ranks every resort at once, and the{" "}
          <Link href="/map" className="font-bold text-ink underline underline-offset-2">
            map
          </Link>{" "}
          shows them with weather radar.
        </p>
      </main>
      <PeakFooter />
    </>
  );
}

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getAllResorts } from "@/lib/supabase";
import { Header } from "@/components/layout/Header";
import { PeakFooter } from "@/components/home/PeakFooter";
import { HubBreadcrumb } from "@/components/hubs/HubBreadcrumb";
import { HubSummaryStrip } from "@/components/hubs/HubSummaryStrip";
import { HubAlertCta } from "@/components/hubs/HubAlertCta";
import { HubResortTable } from "@/components/hubs/HubResortTable";
import { HubFeaturedCams } from "@/components/hubs/HubFeaturedCams";
import { HubFaq } from "@/components/hubs/HubFaq";
import { HubLinks } from "@/components/hubs/HubLinks";
import {
  HUB_BASE_PATH,
  groupByRegion,
  hubPath,
  hubSummary,
  listHubs,
  neighbouringStateHubs,
  regionHubsForState,
  resolveHub,
  stateHub,
  stateLabel,
  type Hub,
} from "@/lib/hubs";
import {
  HUB_EDITORIAL,
  buildHubFaq,
  buildHubMetaDescription,
  buildHubParagraphs,
  featuredHubCams,
  hubOffSeason,
  hubShareTitle,
  hubSyncLabel,
  hubTitle,
  inHub,
  sortHubTable,
} from "@/lib/hub-copy";
import { SITE_URL } from "@/lib/site";

export const revalidate = 3600;

// Reject any slug not returned by generateStaticParams at the router layer,
// before the page function runs — otherwise Next's full-route cache would
// store a notFound() render as a 200 for every garbage slug (same reasoning
// as app/resorts/[slug]/page.tsx). Trade-off: a state or region that first
// appears in the DB between deploys 404s until the next build.
export const dynamicParams = false;

// Every state/province/country plus every region with ≥ REGION_HUB_MIN_COUNT
// resorts. Must NOT swallow a listing failure into `[]`: with dynamicParams
// false this list IS the set of hub pages for the deployment, so a transient
// DB blip would silently ship a build with zero hubs. Let it throw and fail
// the build; Vercel keeps serving the previous deployment.
export async function generateStaticParams() {
  const resorts = await getAllResorts();
  const { states, regions } = listHubs(resorts);
  return [...states, ...regions].map((group) => ({ hub: group.hub.slug }));
}

type Params = Promise<{ hub: string }>;

const KIND_LABEL: Record<Hub["kind"], string> = {
  state: "State",
  province: "Province",
  country: "Country",
  region: "Mountain region",
};

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { hub: slug } = await params;
  // A failed query throws and is left uncaught on purpose: it fails this ISR
  // revalidation so Next.js keeps the last good metadata instead of caching
  // an empty `{}` at 200.
  const resorts = await getAllResorts();
  const resolved = resolveHub(slug, resorts);
  if (!resolved) return {};

  const { hub, resorts: members, count } = resolved;
  // Season-aware: off-season copy names the coming season instead of a page
  // of 0″ bases. ISR re-renders hourly, so `new Date()` tracks the boundary.
  const description = buildHubMetaDescription(hub, members, new Date());
  const pageUrl = `${SITE_URL}${hubPath(hub)}`;
  const shareTitle = hubShareTitle(hub);

  return {
    title: { absolute: hubTitle(hub, count) },
    description,
    keywords: [
      `${hub.label} ski webcams`,
      `${hub.label} ski resort webcams`,
      `${hub.label} snow report`,
      `${hub.label} ski conditions`,
      `${hub.label} ski resorts`,
      "live ski cams",
    ],
    alternates: { canonical: pageUrl },
    openGraph: { type: "website", url: pageUrl, title: shareTitle, description, siteName: "PeakCam" },
    twitter: { card: "summary_large_image", title: shareTitle, description },
  };
}

export default async function HubPage({ params }: { params: Params }) {
  const { hub: slug } = await params;
  const allResorts = await getAllResorts();
  const resolved = resolveHub(slug, allResorts);
  if (!resolved) return notFound();

  const { hub, resorts, count } = resolved;
  // One clock read per render; the strip, the table pills, the prose and the
  // FAQ all derive from it, so they cannot disagree about the season.
  const now = new Date();
  const offSeason = hubOffSeason(resorts, now);
  const summary = hubSummary(resorts);
  const table = sortHubTable(resorts);
  const featured = featuredHubCams(resorts);
  const paragraphs = buildHubParagraphs(hub, resorts, now);
  const faq = buildHubFaq(hub, resorts, now);
  const editorial = HUB_EDITORIAL[hub.slug];
  const pageUrl = `${SITE_URL}${hubPath(hub)}`;
  const title = hubShareTitle(hub);

  // Sideways links. State hubs: neighbouring states that have resorts + the
  // region hubs inside the state. Region hubs: the state hubs it spans.
  const linkedRegionSlugs = new Set(groupByRegion(allResorts).map((group) => group.hub.slug));
  const stateHubs = hub.kind === "region" ? hub.stateCodes.map(stateHub) : neighbouringStateHubs(hub.key, allResorts);
  const regionHubs = hub.kind === "region" ? [] : regionHubsForState(hub.key, allResorts);

  const kindLine =
    hub.kind === "region"
      ? `${KIND_LABEL.region} · ${hub.stateCodes.map(stateLabel).join(" & ")}`
      : KIND_LABEL[hub.kind];
  const h1 = hub.kind === "region" ? `${hub.label} ski webcams & snow report` : `${hub.label} ski resort webcams & snow report`;

  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
      { "@type": "ListItem", position: 2, name: "Ski Cams", item: `${SITE_URL}${HUB_BASE_PATH}` },
      { "@type": "ListItem", position: 3, name: hub.label, item: pageUrl },
    ],
  };

  // Table order, so the list's position mirrors the ranking on the page.
  const listLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `${hub.label} ski resorts on PeakCam`,
    url: pageUrl,
    numberOfItems: table.length,
    itemListOrder: "https://schema.org/ItemListOrderDescending",
    itemListElement: table.map((resort, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: resort.name,
      url: `${SITE_URL}/resorts/${resort.slug}`,
    })),
  };

  // Freshness rides on the WebPage node: dateModified is the newest snow
  // report in the hub — the moment this page's data-bearing content last
  // changed — and is omitted rather than faked when no resort has a report.
  const webPageLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    url: pageUrl,
    name: title,
    description: buildHubMetaDescription(hub, resorts, now),
    isPartOf: { "@type": "WebSite", name: "PeakCam", url: SITE_URL },
    ...(summary.newestReportAt ? { dateModified: summary.newestReportAt } : {}),
  };

  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(listLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(webPageLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd) }} />
      <Header showSearch={false} />
      <main id="main-content" className="mx-auto max-w-5xl px-5 py-10 md:py-12">
        <HubBreadcrumb items={[{ label: "Home", href: "/" }, { label: "Ski Cams", href: HUB_BASE_PATH }, { label: hub.label }]} />

        <p className="pc-eyebrow mb-3 mt-6">
          {kindLine} · {count} {count === 1 ? "resort" : "resorts"}
        </p>
        <h1 className="font-display text-4xl font-black leading-[0.95] tracking-[-0.02em] text-ink md:text-5xl [overflow-wrap:anywhere]">
          {h1}
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-bark">
          Every {hub.label} resort PeakCam tracks, ranked by base depth, with live cams a click away — and one email the
          morning any of them gets fresh snow. Snow data refreshes every six hours.
        </p>

        <div className="mt-8">
          <HubSummaryStrip summary={summary} syncLabel={hubSyncLabel(resorts)} offSeason={offSeason} />
        </div>

        <div className="mt-6">
          <HubAlertCta hub={hub} resorts={resorts} offSeason={offSeason} />
        </div>

        <section aria-labelledby="hub-table-heading" className="mt-12">
          <div className="flex flex-col gap-1 md:flex-row md:items-baseline md:justify-between md:gap-4">
            <h2 id="hub-table-heading" className="font-display text-2xl font-black tracking-[-0.01em] text-ink">
              All {count} {hub.label} {count === 1 ? "resort" : "resorts"}
            </h2>
            <p className="text-sm text-bark">Deepest base first. Tap a name for cams, forecast and the full report.</p>
          </div>
          <div className="mt-3">
            <HubResortTable
              resorts={table}
              placeColumn={hub.kind === "region" ? "state" : "region"}
              linkedRegionSlugs={linkedRegionSlugs}
              now={now}
            />
          </div>
        </section>

        {featured.length > 0 && (
          <section aria-labelledby="hub-cams-heading" className="mt-12">
            <div className="flex flex-col gap-1 md:flex-row md:items-baseline md:justify-between md:gap-4">
              <h2 id="hub-cams-heading" className="font-display text-2xl font-black tracking-[-0.01em] text-ink">
                Featured cams
              </h2>
              <p className="text-sm text-bark">The first live YouTube cam from the best-rated resorts. Nothing plays until you ask.</p>
            </div>
            <div className="mt-4">
              <HubFeaturedCams featured={featured} />
            </div>
          </section>
        )}

        <section aria-labelledby="hub-about-heading" className="mt-12 max-w-3xl">
          <h2 id="hub-about-heading" className="font-display text-2xl font-black tracking-[-0.01em] text-ink">
            About skiing {inHub(hub)}
          </h2>
          <div className="mt-4 space-y-4 text-[15.5px] leading-relaxed text-ink">
            {editorial && <p>{editorial}</p>}
            {paragraphs.map((paragraph, i) => (
              <p key={i}>{paragraph}</p>
            ))}
          </div>
        </section>

        <HubFaq faq={faq} label={hub.label} />
        <HubLinks hub={hub} stateHubs={stateHubs} regionHubs={regionHubs} />
      </main>
      <PeakFooter />
    </>
  );
}

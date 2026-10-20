import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getAllResorts } from "@/lib/supabase";
import { HUB_BASE_PATH, hubPath, neighbouringStateHubs, regionHubsForState, stateHub } from "@/lib/hubs";
import { buildSnowHub, listSnowHubs, snowHubDescription, snowHubMarkdownPath, snowHubPath, snowHubTitle } from "@/lib/snow-hubs";
import { LEADERBOARD_COPY, LEADERBOARD_KINDS, leaderboardPath } from "@/lib/leaderboards";
import { SITE_URL } from "@/lib/site";
import { Header } from "@/components/layout/Header";
import { PeakFooter } from "@/components/home/PeakFooter";
import { HubBreadcrumb } from "@/components/hubs/HubBreadcrumb";
import { MeasuredRowsTable } from "@/components/snow-report/MeasuredRowsTable";
import { QuotableLine } from "@/components/snow-report/QuotableLine";

// /snow-report/{hub} — the per-state (province, country, region) snow-report
// hub: the same hub set as /ski-cams/{hub}, with the leaderboard layout
// (parity plan P10). Hourly ISR like every data-bearing page; the slug set is
// fixed per deploy the way /ski-cams is, so an unknown slug is a router 404
// rather than a cached notFound() render. Static siblings (the leaderboards,
// percent-of-normal, the landing) win over this segment in Next's router and
// lib/snow-hubs.test.ts checks no hub slug collides with them.
export const revalidate = 3600;
export const dynamicParams = false;

export async function generateStaticParams() {
  const resorts = await getAllResorts();
  const { states, regions } = listSnowHubs(resorts);
  return [...states, ...regions].map((group) => ({ hub: group.hub.slug }));
}

type Params = Promise<{ hub: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { hub: slug } = await params;
  const page = buildSnowHub(slug, await getAllResorts());
  if (!page) return {};
  const title = snowHubTitle(page.hub, page.count);
  const description = snowHubDescription(page.hub, page);
  return {
    title: { absolute: title },
    description,
    keywords: [`${page.hub.label} snow report`, `${page.hub.label} ski conditions`, `${page.hub.label} base depth`, `${page.hub.label} new snow`, "ski resort snow report by state"],
    alternates: { canonical: page.pageUrl, types: { "text/markdown": page.markdownUrl } },
    openGraph: { type: "website", url: page.pageUrl, title, description, siteName: "PeakCam" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function SnowHubPage({ params }: { params: Params }) {
  const { hub: slug } = await params;
  const resorts = await getAllResorts();
  const page = buildSnowHub(slug, resorts);
  if (!page) return notFound();
  const { hub } = page;
  const title = snowHubTitle(hub, page.count);
  const description = snowHubDescription(hub, page);
  const stateHubs = hub.kind === "region" ? hub.stateCodes.map(stateHub) : neighbouringStateHubs(hub.key, resorts);
  const regionHubs = hub.kind === "region" ? [] : regionHubsForState(hub.key, resorts).map((g) => g.hub);

  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
      { "@type": "ListItem", position: 2, name: "Snow report", item: `${SITE_URL}/snow-report` },
      { "@type": "ListItem", position: 3, name: hub.label, item: page.pageUrl },
    ],
  };
  const listLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `${hub.label} ski resorts by base depth`,
    url: page.pageUrl,
    numberOfItems: page.rows.length,
    itemListOrder: "https://schema.org/ItemListOrderDescending",
    itemListElement: page.rows.map((r, i) => ({ "@type": "ListItem", position: i + 1, name: r.name, url: `${SITE_URL}/resorts/${r.slug}` })),
  };
  const webPageLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    url: page.pageUrl,
    name: title,
    description,
    isPartOf: { "@type": "WebSite", name: "PeakCam", url: SITE_URL },
    ...(page.asOf ? { dateModified: page.asOf } : {}),
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(listLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(webPageLd) }} />
      <Header showSearch={false} />
      <main id="main-content" className="mx-auto max-w-4xl px-4 py-10 sm:px-5 md:py-12">
        <HubBreadcrumb items={[{ label: "Home", href: "/" }, { label: "Snow report", href: "/snow-report" }, { label: hub.label }]} />

        <p className="pc-eyebrow mb-3 mt-6">
          {hub.kind === "region" ? "Mountain region" : hub.kind === "province" ? "Province" : hub.kind === "country" ? "Country" : "State"} · {page.count} {page.count === 1 ? "resort" : "resorts"} · {page.reported} with a report
        </p>
        <h1 className="font-display text-4xl font-black leading-[0.95] tracking-[-0.02em] text-ink md:text-5xl [overflow-wrap:anywhere]">
          {hub.label} snow report
        </h1>
        <QuotableLine sentence={page.sentence} testId="snow-hub-freshness" />

        <section aria-labelledby="hub-table-heading" className="mt-10">
          <div className="flex flex-col gap-1 md:flex-row md:items-baseline md:justify-between md:gap-4">
            <h2 id="hub-table-heading" className="font-display text-2xl font-black tracking-[-0.01em] text-ink">
              All {page.count} {hub.label} {page.count === 1 ? "resort" : "resorts"}
            </h2>
            <p className="text-sm text-bark">Deepest base first; resorts without a report last. Dated to the reading, Mountain time.</p>
          </div>
          <div className="mt-3">
            {page.rows.length ? (
              <MeasuredRowsTable rows={page.rows} placeColumn={hub.kind === "region" ? "state" : "region"} />
            ) : (
              <p className="rounded-[18px] border-[1.5px] border-dashed border-ink/40 bg-cream-50 px-5 py-8 text-center text-[15.5px] text-ink">No resorts in this hub.</p>
            )}
          </div>
        </section>

        <section aria-labelledby="hub-about-heading" className="mt-12 max-w-3xl">
          <h2 id="hub-about-heading" className="font-display text-2xl font-black tracking-[-0.01em] text-ink">
            Where these numbers come from
          </h2>
          <p className="mt-4 text-[15.5px] leading-relaxed text-ink">
            Base depth and new snow are read at each resort&rsquo;s NRCS SNOTEL station, one fixed elevation that is usually mid-mountain, so a
            station can disagree with the resort&rsquo;s own upper-mountain report. Resorts without a station carry a weather-model estimate and say so.
            Both are synced every six hours and every row is dated to its reading.{" "}
            <Link href="/methodology#snotel" className="font-bold text-ink underline-offset-2 hover:underline">
              How PeakCam reads the sensors
            </Link>
            . Webcams for the same resorts:{" "}
            <Link href={hubPath(hub)} className="font-bold text-ink underline-offset-2 hover:underline">
              {hub.label} ski cams
            </Link>
            .
          </p>
        </section>

        <nav aria-label="Related pages" className="mt-12 flex flex-wrap gap-3 text-sm">
          {LEADERBOARD_KINDS.map((k) => (
            <Link key={k} href={leaderboardPath(k)} className="rounded-full border-[1.5px] border-ink bg-cream-50 px-4 py-2 font-bold text-ink shadow-stamp-sm hover:bg-cream">
              {LEADERBOARD_COPY[k].eyebrow}
            </Link>
          ))}
          {regionHubs.map((r) => (
            <Link key={r.slug} href={snowHubPath(r)} className="rounded-full border-[1.5px] border-ink bg-cream-50 px-4 py-2 font-bold text-ink shadow-stamp-sm hover:bg-cream">
              {r.label}
            </Link>
          ))}
          {stateHubs.map((s) => (
            <Link key={s.slug} href={snowHubPath(s)} className="rounded-full border-[1.5px] border-ink bg-cream-50 px-4 py-2 font-bold text-ink shadow-stamp-sm hover:bg-cream">
              {s.label} snow report
            </Link>
          ))}
          <Link href={HUB_BASE_PATH} className="rounded-full border-[1.5px] border-ink bg-cream-50 px-4 py-2 font-bold text-ink shadow-stamp-sm hover:bg-cream">
            All states
          </Link>
          <a href={snowHubMarkdownPath(hub)} className="rounded-full border-[1.5px] border-ink bg-cream-50 px-4 py-2 font-bold text-ink shadow-stamp-sm hover:bg-cream">
            Markdown
          </a>
        </nav>
      </main>
      <PeakFooter />
    </>
  );
}

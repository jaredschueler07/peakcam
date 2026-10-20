import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getAllResorts } from "@/lib/supabase";
import { SEASON_PASSES } from "@/lib/resort-profile";
import { PASS_BASE_PATH, PASS_INFO, buildPassPage, isSeasonPassSlug, passDescription, passMarkdownPath, passPath, passTitle } from "@/lib/passes";
import { SITE_URL } from "@/lib/site";
import { Header } from "@/components/layout/Header";
import { PeakFooter } from "@/components/home/PeakFooter";
import { HubBreadcrumb } from "@/components/hubs/HubBreadcrumb";
import { MeasuredRowsTable } from "@/components/snow-report/MeasuredRowsTable";
import { QuotableLine } from "@/components/snow-report/QuotableLine";

// /passes/{pass} — the resorts whose profile names the pass, ranked by
// measured base with today's numbers (parity plan P10). The five slugs are
// the SEASON_PASSES enum, so the set is fixed and anything else is a router
// 404. Hourly ISR like every data-bearing page.
export const revalidate = 3600;
export const dynamicParams = false;

export function generateStaticParams() {
  return SEASON_PASSES.map((pass) => ({ pass }));
}

type Params = Promise<{ pass: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { pass } = await params;
  if (!isSeasonPassSlug(pass)) return {};
  const page = buildPassPage(pass, await getAllResorts());
  const title = passTitle(page);
  const description = passDescription(page);
  return {
    title: { absolute: title },
    description,
    keywords: [`${page.info.label} snow report`, `${page.info.label} resorts`, `${page.info.label} base depth`, `${page.info.label} webcams`, "which pass resort has the most snow"],
    alternates: { canonical: page.pageUrl, types: { "text/markdown": page.markdownUrl } },
    openGraph: { type: "website", url: page.pageUrl, title, description, siteName: "PeakCam" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function PassPage({ params }: { params: Params }) {
  const { pass } = await params;
  if (!isSeasonPassSlug(pass)) return notFound();
  const page = buildPassPage(pass, await getAllResorts());
  const { info } = page;
  const title = passTitle(page);
  const description = passDescription(page);

  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
      { "@type": "ListItem", position: 2, name: "Season passes", item: `${SITE_URL}${PASS_BASE_PATH}` },
      { "@type": "ListItem", position: 3, name: info.label, item: page.pageUrl },
    ],
  };
  const listLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `${info.label} resorts on PeakCam by base depth`,
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
    about: { "@type": "Product", name: info.label, url: info.url },
    ...(page.asOf ? { dateModified: page.asOf } : {}),
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(listLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(webPageLd) }} />
      <Header showSearch={false} />
      <main id="main-content" className="mx-auto max-w-4xl px-4 py-10 sm:px-5 md:py-12">
        <HubBreadcrumb items={[{ label: "Home", href: "/" }, { label: "Season passes", href: PASS_BASE_PATH }, { label: info.label }]} />
        <p className="pc-eyebrow mb-3 mt-6">
          Season pass · {page.count} {page.count === 1 ? "resort" : "resorts"} on PeakCam{page.places.length ? ` · ${page.places.join(", ")}` : ""}
        </p>
        <h1 className="font-display text-4xl font-black leading-[0.95] tracking-[-0.02em] text-ink md:text-5xl [overflow-wrap:anywhere]">
          {info.label} snow report
        </h1>
        <QuotableLine sentence={page.sentence} testId="pass-freshness" />

        <section aria-labelledby="pass-table-heading" className="mt-10">
          <div className="flex flex-col gap-1 md:flex-row md:items-baseline md:justify-between md:gap-4">
            <h2 id="pass-table-heading" className="font-display text-2xl font-black tracking-[-0.01em] text-ink">
              {page.count ? `All ${page.count} ${info.label} ${page.count === 1 ? "resort" : "resorts"} on PeakCam` : `No ${info.label} resorts yet`}
            </h2>
            <p className="text-sm text-bark">Deepest base first; resorts without a report last. Dated to the reading, Mountain time.</p>
          </div>
          <div className="mt-3">
            {page.rows.length ? (
              <MeasuredRowsTable rows={page.rows} placeColumn="state" />
            ) : (
              <p className="rounded-[18px] border-[1.5px] border-dashed border-ink/40 bg-cream-50 px-5 py-8 text-center text-[15.5px] text-ink">
                No resort on PeakCam currently names this pass; the profile import fills the column.
              </p>
            )}
          </div>
        </section>

        <section aria-labelledby="pass-about-heading" className="mt-12 max-w-3xl">
          <h2 id="pass-about-heading" className="font-display text-2xl font-black tracking-[-0.01em] text-ink">
            About the {info.label}
          </h2>
          <div className="mt-4 space-y-4 text-[15.5px] leading-relaxed text-ink">
            <p>
              {info.blurb} Membership here comes from the operator&rsquo;s published resort list; PeakCam does not sell passes and does not know your pass tier, so check{" "}
              <a href={info.url} target="_blank" rel="noopener noreferrer" className="font-bold text-ink underline-offset-2 hover:underline">
                the operator&rsquo;s site
              </a>{" "}
              for days, blackouts and reservations.
            </p>
            <p>
              Base depth and new snow are read at each resort&rsquo;s NRCS SNOTEL station (one fixed elevation, usually mid-mountain) or, without a station, estimated by a weather model that says so. Both are synced every six hours.{" "}
              <Link href="/methodology#snotel" className="font-bold text-ink underline-offset-2 hover:underline">
                How PeakCam reads the sensors
              </Link>
              .
            </p>
          </div>
        </section>

        <nav aria-label="Related pages" className="mt-12 flex flex-wrap gap-3 text-sm">
          {SEASON_PASSES.filter((p) => p !== pass).map((p) => (
            <Link key={p} href={passPath(p)} className="rounded-full border-[1.5px] border-ink bg-cream-50 px-4 py-2 font-bold text-ink shadow-stamp-sm hover:bg-cream">
              {PASS_INFO[p].label}
            </Link>
          ))}
          <Link href="/snow-report/leaderboards" className="rounded-full border-[1.5px] border-ink bg-cream-50 px-4 py-2 font-bold text-ink shadow-stamp-sm hover:bg-cream">
            Leaderboards
          </Link>
          <a href={passMarkdownPath(pass)} className="rounded-full border-[1.5px] border-ink bg-cream-50 px-4 py-2 font-bold text-ink shadow-stamp-sm hover:bg-cream">
            Markdown
          </a>
        </nav>
      </main>
      <PeakFooter />
    </>
  );
}

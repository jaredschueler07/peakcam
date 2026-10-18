import type { Metadata } from "next";
import Link from "next/link";
import { getAllResorts } from "@/lib/supabase";
import { Header } from "@/components/layout/Header";
import { PeakFooter } from "@/components/home/PeakFooter";
import { HubBreadcrumb } from "@/components/hubs/HubBreadcrumb";
import { PctOfNormalTable } from "@/components/snow-report/PctOfNormalTable";
import { buildPctOfNormalPage, PCT_OF_NORMAL_RULE, phaseCopy } from "@/lib/percent-of-normal";
import { formatMountainTime } from "@/lib/quotable";
import { PCT_OF_NORMAL_MAX, PCT_OF_NORMAL_MIN, PCT_OF_NORMAL_MIN_SWE_IN } from "@/lib/resort-copy";
import { SITE_URL } from "@/lib/site";

// Hourly, like every data-bearing page: the ranking changes when the SNOTEL
// sync appends reports (every 6 h) and the page re-renders from them.
export const revalidate = 3600;

const PAGE_URL = `${SITE_URL}/snow-report/percent-of-normal`;
const TITLE = "Snowpack percent of normal by resort";
const DESCRIPTION =
  `Ski resorts ranked by snowpack as a percent of the 1991–2020 median, from NRCS SNOTEL station readings. ` +
  `Listed only above ${PCT_OF_NORMAL_MIN_SWE_IN} in. of snow water equivalent and inside the ${PCT_OF_NORMAL_MIN}–${PCT_OF_NORMAL_MAX}% band, dated to the reading.`;

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: PAGE_URL },
  keywords: [
    "snowpack percent of normal",
    "ski resort snowpack",
    "SNOTEL percent of median",
    "snow water equivalent by resort",
    "which ski resort has the most snow",
    "snowpack compared to normal",
  ],
  openGraph: { title: TITLE, description: DESCRIPTION, url: PAGE_URL, type: "website", siteName: "PeakCam" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

export default async function PercentOfNormalPage() {
  // Let a fetch failure propagate — it fails this ISR revalidation so
  // Next.js keeps serving the last good page instead of caching an empty
  // leaderboard at 200 (same policy as /snow-report).
  const resorts = await getAllResorts();
  // One clock read per render; the sentence is dated by the data, the season
  // note by the clock, and neither is read twice.
  const now = new Date();
  const page = buildPctOfNormalPage(resorts, now);
  const { ranked, sentence, asOf, stationFedCount, phase } = page;

  // One trail feeds both the visible breadcrumb and the JSON-LD so the two
  // cannot disagree.
  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
      { "@type": "ListItem", position: 2, name: "Snow report", item: `${SITE_URL}/snow-report` },
      { "@type": "ListItem", position: 3, name: "Percent of normal", item: PAGE_URL },
    ],
  };

  // Table order, so the list's position mirrors the ranking on the page. An
  // empty list is emitted as such (numberOfItems 0) rather than omitted: it
  // is the honest answer, and the WebPage node still carries the date.
  const listLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: TITLE,
    url: PAGE_URL,
    numberOfItems: ranked.length,
    itemListOrder: "https://schema.org/ItemListOrderDescending",
    itemListElement: ranked.map((row, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: row.name,
      url: `${SITE_URL}/resorts/${row.slug}`,
    })),
  };

  // Freshness rides on the WebPage node: dateModified is the sentence's asOf,
  // the newest report the ranking used — omitted rather than faked when the
  // catalogue has no reports at all.
  const webPageLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    url: PAGE_URL,
    name: TITLE,
    description: DESCRIPTION,
    isPartOf: { "@type": "WebSite", name: "PeakCam", url: SITE_URL },
    ...(asOf ? { dateModified: asOf } : {}),
  };

  const asOfLabel = asOf ? formatMountainTime(asOf) : null;

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(listLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(webPageLd) }} />
      <Header showSearch={false} />
      <main id="main-content" className="mx-auto max-w-4xl px-4 py-10 sm:px-5 md:py-12">
        <HubBreadcrumb
          items={[{ label: "Home", href: "/" }, { label: "Snow report", href: "/snow-report" }, { label: "Percent of normal" }]}
        />

        <p className="pc-eyebrow mb-3 mt-6">
          Snowpack vs. 1991–2020 median · {stationFedCount} SNOTEL-fed {stationFedCount === 1 ? "resort" : "resorts"}
        </p>
        <h1 className="font-display text-4xl font-black leading-[0.95] tracking-[-0.02em] text-ink md:text-5xl [overflow-wrap:anywhere]">
          Snowpack percent of normal by resort
        </h1>

        {/* Quotable freshness line: no state, no animation, in the server
            HTML as plain text so crawlers and answer engines can lift it
            verbatim. Dated by the data it used, not the render. */}
        <p
          className="mt-5 max-w-2xl text-balance text-lg leading-snug text-bark-dk"
          data-testid="pct-of-normal-freshness"
        >
          {sentence.segments.map((segment, index) =>
            segment.href ? (
              <Link
                key={index}
                href={segment.href}
                prefetch={false}
                className="font-bold text-ink underline decoration-alpen/60 decoration-2 underline-offset-[3px] hover:decoration-alpen"
              >
                {segment.text}
              </Link>
            ) : (
              <span key={index}>{segment.text}</span>
            ),
          )}
        </p>

        {/* Season-aware note: pre-season and a dry start say why the table is
            short; in season it states what is and is not ranked. */}
        <aside
          className={`mt-6 flex items-start gap-3 rounded-[18px] border-[1.5px] border-ink px-5 py-3 text-sm shadow-stamp ${
            phase === "season" ? "pc-on-ink bg-forest text-cream-50" : "bg-fair text-ink"
          }`}
        >
          <span aria-hidden className="mt-0.5 shrink-0 font-mono text-xs font-bold uppercase tracking-[0.1em]">
            {phase === "season" ? "In season" : phase === "early" ? "Dry start" : "Pre-season"}
          </span>
          <p className="min-w-0">{phaseCopy(phase, stationFedCount)}</p>
        </aside>

        <section aria-labelledby="pct-table-heading" className="mt-12">
          <div className="flex flex-col gap-1 md:flex-row md:items-baseline md:justify-between md:gap-4">
            <h2 id="pct-table-heading" className="font-display text-2xl font-black tracking-[-0.01em] text-ink">
              {ranked.length === 0
                ? "Nothing to rank yet"
                : `${ranked.length} ${ranked.length === 1 ? "resort" : "resorts"} with a measurable snowpack`}
            </h2>
            <p className="text-sm text-bark">
              {ranked.length === 0
                ? asOfLabel
                  ? `Latest station reading ${asOfLabel}.`
                  : "No station readings yet."
                : "Deepest relative to normal first. SWE is snow water equivalent; measured is the station's reading time."}
            </p>
          </div>
          <div className="mt-3">
            {ranked.length > 0 ? (
              <PctOfNormalTable rows={ranked} />
            ) : (
              <div className="rounded-[18px] border-[1.5px] border-dashed border-ink/40 bg-cream-50 px-5 py-8 text-center">
                <p className="text-[15.5px] text-ink">
                  No SNOTEL-fed resort has {PCT_OF_NORMAL_MIN_SWE_IN} in. of snow water equivalent on the ground yet, so there is no
                  percent of normal worth quoting.
                </p>
                <p className="mt-3 text-sm text-bark">
                  For what <em>is</em> on the ground today, see the{" "}
                  <Link href="/snow-report" className="font-bold text-ink underline-offset-2 hover:underline">
                    live snow report
                  </Link>{" "}
                  or{" "}
                  <Link href="/opening-dates" className="font-bold text-ink underline-offset-2 hover:underline">
                    when each resort opens
                  </Link>
                  .
                </p>
              </div>
            )}
          </div>
        </section>

        <section aria-labelledby="pct-about-heading" className="mt-12 max-w-3xl">
          <h2 id="pct-about-heading" className="font-display text-2xl font-black tracking-[-0.01em] text-ink">
            How to read this table
          </h2>
          <div className="mt-4 space-y-4 text-[15.5px] leading-relaxed text-ink">
            <p>{PCT_OF_NORMAL_RULE}</p>
            <p>
              The median is the station&rsquo;s own: 100% means this station holds exactly as much water in its snowpack
              as it did on this date in a typical year between 1991 and 2020, not that the resort is &ldquo;average&rdquo;
              for the region. A station sits at one fixed elevation, usually mid-mountain, so it can disagree with a
              resort&rsquo;s own upper-mountain report. Every row is dated to the station reading it came from, in
              Mountain time; the NRCS feed is synced every six hours.{" "}
              <Link href="/methodology#normals" className="font-bold text-ink underline-offset-2 hover:underline">
                How the normals are built
              </Link>
              .
            </p>
          </div>
        </section>

        <nav aria-label="Related pages" className="mt-12 flex flex-wrap gap-3 text-sm">
          <Link
            href="/snow-report"
            className="rounded-full border-[1.5px] border-ink bg-cream-50 px-4 py-2 font-bold text-ink shadow-stamp-sm hover:bg-cream"
          >
            Live snow report
          </Link>
          <Link
            href="/opening-dates"
            className="rounded-full border-[1.5px] border-ink bg-cream-50 px-4 py-2 font-bold text-ink shadow-stamp-sm hover:bg-cream"
          >
            Opening dates
          </Link>
          <Link
            href="/methodology"
            className="rounded-full border-[1.5px] border-ink bg-cream-50 px-4 py-2 font-bold text-ink shadow-stamp-sm hover:bg-cream"
          >
            Methodology
          </Link>
        </nav>
      </main>
      <PeakFooter />
    </>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getResortBySlug } from "@/lib/supabase";
import { loadResortHistory } from "@/lib/public-api/data";
import { buildMonthlyClimatology, buildResortHistory, buildSeasonStats, mountainDay } from "@/lib/public-api/history";
import { cumulativeByDay, groupBySeason, hemisphereOf, type CumulativeNormalRow } from "@/lib/snow-history";
import { POWDER_DAY_IN, seasonSentence, seasonToDate } from "@/lib/season-stats";
import { stationFor } from "@/lib/stations";
import { HUB_BASE_PATH, stateHub, stateHubPath } from "@/lib/hubs";
import { SITE_URL } from "@/lib/site";
import { Header } from "@/components/layout/Header";
import { PeakFooter } from "@/components/home/PeakFooter";
import { HubBreadcrumb, type BreadcrumbItem } from "@/components/hubs/HubBreadcrumb";
import { SeasonCurveChart } from "@/components/history/SeasonCurveChart";
import { PastSeasonsTable } from "@/components/history/PastSeasonsTable";
import { MonthlyBars } from "@/components/history/MonthlyBars";
import { SeasonStatTiles } from "@/components/history/SeasonStatTiles";

// /resorts/{slug}/history — the season so far against the station's normal
// band, ten past seasons and the monthly climatology (parity plan P5).
// Rendered on demand with hourly ISR rather than prerendered: each page
// reads ~3,650 daily rows, and 148 of those at build time is what starves
// Supabase. A slug the catalogue does not know is a 404.
export const revalidate = 3600;

function pageUrl(slug: string): string {
  return `${SITE_URL}/resorts/${slug}/history`;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const resort = await getResortBySlug(slug);
  if (!resort) return {};
  const title = `${resort.name} Snow History — Season Snowfall, Past Seasons & Monthly Averages`;
  const description = resort.snotel_station_id
    ? `${resort.name} season snowfall to date against the 30-winter normal, ten past seasons with powder days and biggest storms, and average snowfall by month, all measured at the resort's NRCS SNOTEL station.`
    : `${resort.name} season snowfall to date and past seasons from daily weather-model estimates (no SNOTEL station near this resort).`;
  return {
    title,
    description,
    alternates: { canonical: pageUrl(slug) },
    keywords: [`${resort.name} snow history`, `${resort.name} season snowfall`, `${resort.name} snowfall by month`, `${resort.name} powder days`, "ski resort snow history", "season snowfall vs normal"],
    openGraph: { type: "website", url: pageUrl(slug), title, description, siteName: "PeakCam" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function ResortHistoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const resort = await getResortBySlug(slug);
  if (!resort) return notFound();

  const now = new Date();
  const data = await loadResortHistory(resort, now);
  const history = buildResortHistory(resort, data, { now });
  const stats = buildSeasonStats(resort, data, { now });
  const monthly = buildMonthlyClimatology(resort, data, { now });

  // The sentence with its links (the API carries only the text).
  const hemisphere = hemisphereOf(resort.lat);
  const today = mountainDay(now);
  const statsRaw = seasonToDate(data.rows, data.normals as CumulativeNormalRow[], today, hemisphere);
  const station = stationFor(resort);
  const sentence = seasonSentence(statsRaw, resort, { kind: history.source === "snotel" ? "snotel" : "model", stationName: station?.name ?? null });

  // Last season's curve, for the thin comparison line on the chart.
  const lastRef = statsRaw.lastYear?.season ?? null;
  const lastRows = lastRef ? groupBySeason(data.rows, hemisphere).find((s) => s.key === lastRef.key) : null;
  const lastSeason = lastRows
    ? { label: lastRef!.label, points: cumulativeByDay(lastRows).map((v, i) => ({ dayOfSeason: i + 1, cumulativeIn: v })) }
    : null;

  const url = pageUrl(slug);
  const stateCode = resort.state;
  const crumbHub = stateCode ? { label: stateHub(stateCode).label, href: stateHubPath(stateCode) } : { label: "Ski cams", href: HUB_BASE_PATH };
  const breadcrumb: BreadcrumbItem[] = [
    { label: "Home", href: "/" },
    { label: crumbHub.label, href: crumbHub.href },
    { label: resort.name, href: `/resorts/${resort.slug}` },
    { label: "History" },
  ];
  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: breadcrumb.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.label,
      item: index === breadcrumb.length - 1 ? url : item.href === "/" ? SITE_URL : `${SITE_URL}${item.href}`,
    })),
  };
  const webPageLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    url,
    name: `${resort.name} snow history`,
    isPartOf: { "@type": "WebSite", name: "PeakCam", url: SITE_URL },
    about: { "@type": "SkiResort", name: resort.name, url: `${SITE_URL}/resorts/${resort.slug}` },
    ...(history.asOf ? { dateModified: history.asOf } : {}),
  };
  const datasetLd = {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: `${resort.name} daily snow depth and new snow, ${history.season.label} and ${history.pastSeasons.length} past seasons`,
    description: history.source === "snotel"
      ? `Daily snow depth, snow water equivalent and derived new snow at ${station?.name ? `the ${station.name} SNOTEL station` : "the resort's SNOTEL station"}, quality-controlled by PeakCam, with the station's 30-winter cumulative normal.`
      : `Daily weather-model snow depth estimates for ${resort.name} with derived new snow.`,
    url,
    license: `${SITE_URL}/about#terms`,
    creator: { "@type": "Organization", name: "PeakCam", url: SITE_URL },
    distribution: [
      { "@type": "DataDownload", encodingFormat: "application/json", contentUrl: history.apiUrl },
      { "@type": "DataDownload", encodingFormat: "text/markdown", contentUrl: `${url}/index.md` },
    ],
    ...(history.asOf ? { dateModified: history.asOf } : {}),
  };

  const sourceLine =
    history.source === "snotel"
      ? `Measured at ${station?.name ? `the ${station.name} SNOTEL station` : "the resort's SNOTEL station"}${station?.elevationFt ? ` (${Math.round(station.elevationFt).toLocaleString("en-US")} ft)` : ""}, synced every six hours.`
      : history.source === "open_meteo"
        ? "Daily values are weather-model estimates (no SNOTEL station near this resort), so there is no station normal band."
        : "No daily record for this resort yet.";

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(webPageLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(datasetLd) }} />
      <Header showSearch={false} />
      <main id="main-content" className="mx-auto max-w-4xl px-4 py-10 sm:px-5 md:py-12">
        <HubBreadcrumb items={breadcrumb} />

        <p className="pc-eyebrow mb-3 mt-6">
          Season {history.season.label} · {history.source === "snotel" ? "SNOTEL-measured" : history.source === "open_meteo" ? "model estimate" : "no data"}
        </p>
        <h1 className="font-display text-4xl font-black leading-[0.95] tracking-[-0.02em] text-ink md:text-5xl [overflow-wrap:anywhere]">
          {resort.name} snow history
        </h1>

        {/* Quotable, dated by the newest station day, links on the resort. */}
        <p className="mt-5 max-w-2xl text-balance text-lg leading-snug text-bark-dk" data-testid="history-freshness">
          {sentence.segments.map((segment, index) =>
            segment.href ? (
              <Link key={index} href={segment.href} prefetch={false} className="font-bold text-ink underline decoration-alpen/60 decoration-2 underline-offset-[3px] hover:decoration-alpen">
                {segment.text}
              </Link>
            ) : (
              <span key={index}>{segment.text}</span>
            ),
          )}
        </p>
        <p className="mt-2 text-sm text-bark">{sourceLine}</p>

        <section aria-labelledby="season-stats-heading" className="mt-10">
          <h2 id="season-stats-heading" className="font-display text-2xl font-black tracking-[-0.01em] text-ink">
            This season at a glance
          </h2>
          <div className="mt-4">
            <SeasonStatTiles stats={stats} />
          </div>
          {stats.percentOfNormal.baselineNote && <p className="mt-3 text-sm text-bark-dk">{stats.percentOfNormal.baselineNote}</p>}
        </section>

        <section aria-labelledby="season-curve-heading" className="mt-12">
          <div className="flex flex-col gap-1 md:flex-row md:items-baseline md:justify-between md:gap-4">
            <h2 id="season-curve-heading" className="font-display text-2xl font-black tracking-[-0.01em] text-ink">
              Snowfall so far vs normal
            </h2>
            <p className="text-sm text-bark">
              {history.curve.band.length
                ? `Band: the middle half of the last ${history.curve.normalYears ?? 30} winters at this station.`
                : "No normal band without a station record."}
            </p>
          </div>
          <div className="mt-3">
            <SeasonCurveChart season={history.season} points={history.curve.points} band={history.curve.band} lastSeason={lastSeason} normalYears={history.curve.normalYears} recentYears={history.curve.recentYears} />
          </div>
        </section>

        <section aria-labelledby="past-seasons-heading" className="mt-12">
          <div className="flex flex-col gap-1 md:flex-row md:items-baseline md:justify-between md:gap-4">
            <h2 id="past-seasons-heading" className="font-display text-2xl font-black tracking-[-0.01em] text-ink">
              {history.pastSeasons.length ? `The last ${history.pastSeasons.length} seasons` : "Past seasons"}
            </h2>
            <p className="text-sm text-bark">Measured snowfall, newest first. Powder day = {POWDER_DAY_IN} in. or more in a day.</p>
          </div>
          <div className="mt-3">
            {history.pastSeasons.length ? (
              <PastSeasonsTable seasons={history.pastSeasons} threshold={POWDER_DAY_IN} showEnso={hemisphere === "north"} />
            ) : (
              <div className="rounded-[18px] border-[1.5px] border-dashed border-ink/40 bg-cream-50 px-5 py-8 text-center text-[15.5px] text-ink">
                No past seasons on file yet for {resort.name}; the daily archive fills in as the backfill runs.
              </div>
            )}
          </div>
        </section>

        <section aria-labelledby="monthly-heading" className="mt-12">
          <div className="flex flex-col gap-1 md:flex-row md:items-baseline md:justify-between md:gap-4">
            <h2 id="monthly-heading" className="font-display text-2xl font-black tracking-[-0.01em] text-ink">
              A typical winter, month by month
            </h2>
            {monthly.available && <p className="text-sm text-bark">30-winter averages; the last ten winters marked.</p>}
          </div>
          <div className="mt-3">
            {monthly.available ? (
              <MonthlyBars months={monthly.months} />
            ) : (
              <div className="rounded-[18px] border-[1.5px] border-dashed border-ink/40 bg-cream-50 px-5 py-8 text-center text-[15.5px] text-ink">{monthly.note}</div>
            )}
          </div>
        </section>

        <section aria-labelledby="history-about-heading" className="mt-12 max-w-3xl">
          <h2 id="history-about-heading" className="font-display text-2xl font-black tracking-[-0.01em] text-ink">
            How to read this page
          </h2>
          <div className="mt-4 space-y-4 text-[15.5px] leading-relaxed text-ink">
            <p>
              Daily new snow is the positive change in snow depth at the station from one day to the next, after PeakCam&rsquo;s quality
              control. Settling and melt make it a floor on what fell, never a ceiling, so a season total here will read lower than a
              resort&rsquo;s own snowfall figure. A snow day is one inch or more; a powder day is {POWDER_DAY_IN} in. or more, the same threshold as
              the powder alerts.
            </p>
            <p>
              The normal band is the station&rsquo;s own: the middle half of the {history.curve.normalYears ?? 30} most recent complete winters, with the
              mean dashed. The recent-decade line uses only the last {history.curve.recentYears ?? 10}; when the two disagree by more than 10% the page
              says so rather than picking one. Percent of normal on the resort page is a different number (snow water equivalent against the
              1991&ndash;2020 median).{" "}
              <Link href="/methodology#history" className="font-bold text-ink underline-offset-2 hover:underline">
                How the history and normals are built
              </Link>
              .
            </p>
          </div>
        </section>

        <nav aria-label="Related pages" className="mt-12 flex flex-wrap gap-3 text-sm">
          <Link href={`/resorts/${resort.slug}`} className="rounded-full border-[1.5px] border-ink bg-cream-50 px-4 py-2 font-bold text-ink shadow-stamp-sm hover:bg-cream">
            {resort.name} today
          </Link>
          <Link href="/snow-report/season-snowfall" className="rounded-full border-[1.5px] border-ink bg-cream-50 px-4 py-2 font-bold text-ink shadow-stamp-sm hover:bg-cream">
            Season snowfall leaderboard
          </Link>
          <Link href="/snow-report/percent-of-normal" className="rounded-full border-[1.5px] border-ink bg-cream-50 px-4 py-2 font-bold text-ink shadow-stamp-sm hover:bg-cream">
            Percent of normal
          </Link>
          <a href={history.apiUrl} className="rounded-full border-[1.5px] border-ink bg-cream-50 px-4 py-2 font-bold text-ink shadow-stamp-sm hover:bg-cream">
            JSON
          </a>
          <a href={`${url}/index.md`} className="rounded-full border-[1.5px] border-ink bg-cream-50 px-4 py-2 font-bold text-ink shadow-stamp-sm hover:bg-cream">
            Markdown
          </a>
        </nav>
      </main>
      <PeakFooter />
    </>
  );
}

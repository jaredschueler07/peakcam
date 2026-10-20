import type { Metadata } from "next";
import Link from "next/link";
import { getResortSitemapEntries } from "@/lib/supabase";
import { LEADERBOARD_COPY, LEADERBOARD_KINDS, leaderboardPath } from "@/lib/leaderboards";
import { PCT_OF_NORMAL_RULE } from "@/lib/percent-of-normal";
import { listSnowHubs, snowHubPath } from "@/lib/snow-hubs";
import { SITE_URL } from "@/lib/site";
import { Header } from "@/components/layout/Header";
import { PeakFooter } from "@/components/home/PeakFooter";
import { HubBreadcrumb } from "@/components/hubs/HubBreadcrumb";

// /snow-report/leaderboards — the landing that links the five boards (the
// four P5 season boards and percent of normal) and the per-state hubs
// (parity plan P10). The boards carry the data; this page only changes when
// the catalogue does, so hourly ISR is plenty.
export const revalidate = 3600;

const PAGE_URL = `${SITE_URL}/snow-report/leaderboards`;
const TITLE = "Ski Resort Snow Leaderboards — Deepest Base, Most Snow, Powder Days | PeakCam";
const DESCRIPTION = "Five rankings of ski resorts from measured station data: deepest base, most snow in the last 7 days, season snowfall, powder days this season and snowpack percent of normal, each dated to the reading.";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: PAGE_URL },
  keywords: ["ski resort snow rankings", "which ski resort has the most snow", "deepest base ski resort", "most powder days", "snowpack percent of normal"],
  openGraph: { type: "website", url: PAGE_URL, title: TITLE, description: DESCRIPTION, siteName: "PeakCam" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

interface Board {
  href: string;
  title: string;
  eyebrow: string;
  rule: string;
}

const BOARDS: Board[] = [
  ...LEADERBOARD_KINDS.map((kind) => ({ href: leaderboardPath(kind), title: LEADERBOARD_COPY[kind].title, eyebrow: LEADERBOARD_COPY[kind].eyebrow, rule: LEADERBOARD_COPY[kind].rule })),
  { href: "/snow-report/percent-of-normal", title: "Snowpack percent of normal by resort", eyebrow: "Percent of normal", rule: PCT_OF_NORMAL_RULE },
];

export default async function LeaderboardsPage() {
  const entries = await getResortSitemapEntries();
  const { states, regions } = listSnowHubs(entries);
  const listLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "PeakCam snow leaderboards",
    url: PAGE_URL,
    numberOfItems: BOARDS.length,
    itemListElement: BOARDS.map((b, i) => ({ "@type": "ListItem", position: i + 1, name: b.title, url: `${SITE_URL}${b.href}` })),
  };
  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
      { "@type": "ListItem", position: 2, name: "Snow report", item: `${SITE_URL}/snow-report` },
      { "@type": "ListItem", position: 3, name: "Leaderboards", item: PAGE_URL },
    ],
  };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(listLd) }} />
      <Header showSearch={false} />
      <main id="main-content" className="mx-auto max-w-4xl px-4 py-10 sm:px-5 md:py-12">
        <HubBreadcrumb items={[{ label: "Home", href: "/" }, { label: "Snow report", href: "/snow-report" }, { label: "Leaderboards" }]} />
        <p className="pc-eyebrow mb-3 mt-6">Five boards · measured station data</p>
        <h1 className="font-display text-4xl font-black leading-[0.95] tracking-[-0.02em] text-ink md:text-5xl">Snow leaderboards</h1>
        <p className="mt-5 max-w-2xl text-lg text-bark">
          Which resort has the most snow, right now and this season, ranked from NRCS SNOTEL station readings and weather-model estimates that say which they are. Every board is dated to its data, not to the page load.
        </p>

        <ol className="mt-10 space-y-4" aria-label="Leaderboards">
          {BOARDS.map((b) => (
            <li key={b.href} className="rounded-[18px] border-[1.5px] border-ink bg-cream-50 px-5 py-4 shadow-stamp">
              <p className="pc-eyebrow">{b.eyebrow}</p>
              <h2 className="mt-1 font-display text-2xl font-black tracking-[-0.01em] text-ink">
                <Link href={b.href} prefetch={false} className="underline-offset-2 hover:underline">
                  {b.title}
                </Link>
              </h2>
              <p className="mt-2 text-[15px] leading-relaxed text-ink/85">{b.rule}</p>
            </li>
          ))}
        </ol>

        <section aria-labelledby="states-heading" className="mt-12">
          <h2 id="states-heading" className="font-display text-2xl font-black tracking-[-0.01em] text-ink">
            Snow report by state and region
          </h2>
          <p className="mt-2 text-sm text-bark">Every resort in a state ranked by base, with new snow, source and the reading&rsquo;s time.</p>
          <ul className="mt-4 flex flex-wrap gap-2" aria-label="State snow reports">
            {[...states, ...regions].map((g) => (
              <li key={g.hub.slug}>
                <Link href={snowHubPath(g.hub)} prefetch={false} className="inline-block rounded-full border-[1.5px] border-ink bg-cream-50 px-3 py-1.5 text-sm font-bold text-ink shadow-stamp-sm hover:bg-cream">
                  {g.hub.label} <span className="font-mono text-xs text-bark">{g.count}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </main>
      <PeakFooter />
    </>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { getAllResorts } from "@/lib/supabase";
import { loadSeasonAggregates } from "@/lib/public-api/data";
import { buildLeaderboardDocument } from "@/lib/public-api/history";
import { LEADERBOARD_COPY, LEADERBOARD_KINDS, leaderboardPath, leaderboardWindow, type LeaderboardKind } from "@/lib/leaderboards";
import { formatMountainTime, inches } from "@/lib/quotable";
import { stationMeta } from "@/lib/stations";
import { SITE_URL } from "@/lib/site";
import { Header } from "@/components/layout/Header";
import { PeakFooter } from "@/components/home/PeakFooter";
import { HubBreadcrumb } from "@/components/hubs/HubBreadcrumb";

/**
 * The shared layout of the four season leaderboards under /snow-report
 * (best-powder-this-week, season-powder-days, deepest-base,
 * season-snowfall): the same page shape as /snow-report/percent-of-normal
 * (breadcrumb, eyebrow, H1, dated sentence, season aside, table, "how to
 * read", related links) over lib/leaderboards.ts. Each page.tsx is a thin
 * wrapper that names its kind.
 */

const num = "font-mono text-[13px] font-bold tabular-nums";

export function leaderboardMetadata(kind: LeaderboardKind): Metadata {
  const copy = LEADERBOARD_COPY[kind];
  const url = `${SITE_URL}${leaderboardPath(kind)}`;
  return {
    title: copy.title,
    description: copy.description,
    alternates: { canonical: url },
    keywords: [copy.eyebrow.toLowerCase(), "ski resort snowfall ranking", "which ski resort has the most snow", "powder days by resort", "deepest base ski resort", "season snowfall by resort"],
    openGraph: { title: copy.title, description: copy.description, url, type: "website", siteName: "PeakCam" },
    twitter: { card: "summary_large_image", title: copy.title, description: copy.description },
  };
}

export async function LeaderboardPage({ kind }: { kind: LeaderboardKind }) {
  // A failed read throws and fails this ISR revalidation, so the last good
  // page keeps serving rather than an empty board at 200 (same policy as
  // /snow-report/percent-of-normal). A missing season_stats() function is
  // not a failure: the board says it is unavailable.
  const resorts = await getAllResorts();
  const now = new Date();
  const { seasonStart, weekStart } = leaderboardWindow(now);
  const aggregates = kind === "deepest-base" ? null : await loadSeasonAggregates(seasonStart, weekStart);
  const { board, doc } = buildLeaderboardDocument(kind, resorts, aggregates, now);
  const copy = board.copy;
  const url = `${SITE_URL}${leaderboardPath(kind)}`;
  const asOfLabel = board.asOf ? formatMountainTime(board.asOf) : null;

  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
      { "@type": "ListItem", position: 2, name: "Snow report", item: `${SITE_URL}/snow-report` },
      { "@type": "ListItem", position: 3, name: copy.eyebrow, item: url },
    ],
  };
  const listLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: copy.title,
    url,
    numberOfItems: board.ranked.length,
    itemListOrder: "https://schema.org/ItemListOrderDescending",
    itemListElement: board.ranked.map((row) => ({ "@type": "ListItem", position: row.rank, name: row.name, url: `${SITE_URL}/resorts/${row.slug}` })),
  };
  const webPageLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    url,
    name: copy.title,
    description: copy.description,
    isPartOf: { "@type": "WebSite", name: "PeakCam", url: SITE_URL },
    ...(board.asOf ? { dateModified: board.asOf } : {}),
  };

  const valueOf = (e: (typeof board.ranked)[number]) => (e.unit === "days" ? String(e.value) : inches(e.value));
  const others = LEADERBOARD_KINDS.filter((k) => k !== kind);

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(listLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(webPageLd) }} />
      <Header showSearch={false} />
      <main id="main-content" className="mx-auto max-w-4xl px-4 py-10 sm:px-5 md:py-12">
        <HubBreadcrumb items={[{ label: "Home", href: "/" }, { label: "Snow report", href: "/snow-report" }, { label: copy.eyebrow }]} />

        <p className="pc-eyebrow mb-3 mt-6">
          {copy.eyebrow} · season {board.season.label} · {board.pool} {board.pool === 1 ? "resort" : "resorts"} in the pool
        </p>
        <h1 className="font-display text-4xl font-black leading-[0.95] tracking-[-0.02em] text-ink md:text-5xl [overflow-wrap:anywhere]">{copy.title}</h1>

        {/* Quotable freshness line: plain text in the server HTML, dated by the data. */}
        <p className="mt-5 max-w-2xl text-balance text-lg leading-snug text-bark-dk" data-testid="leaderboard-freshness">
          {board.sentence.segments.map((segment, index) =>
            segment.href ? (
              <Link key={index} href={segment.href} prefetch={false} className="font-bold text-ink underline decoration-alpen/60 decoration-2 underline-offset-[3px] hover:decoration-alpen">
                {segment.text}
              </Link>
            ) : (
              <span key={index}>{segment.text}</span>
            ),
          )}
        </p>

        <aside className={`mt-6 flex items-start gap-3 rounded-[18px] border-[1.5px] border-ink px-5 py-3 text-sm shadow-stamp ${board.ranked.length ? "pc-on-ink bg-forest text-cream-50" : "bg-fair text-ink"}`}>
          <span aria-hidden className="mt-0.5 shrink-0 font-mono text-xs font-bold uppercase tracking-[0.1em]">
            {board.unavailable ? "Unavailable" : board.ranked.length ? "Ranked" : "Nothing yet"}
          </span>
          <p className="min-w-0">
            {board.unavailable
              ? "The season totals could not be read for this render; the live snow report still has today's numbers."
              : copy.seasonBound
                ? `Counted from ${board.season.startDate.slice(5) === "10-01" ? "October 1" : board.season.startDate} for Northern-hemisphere resorts. Station readings are measured; weather-model rows are estimates and say so.`
                : "Every resort with a value is listed, station-measured and model-estimated alike; the source column says which."}
          </p>
        </aside>

        <section aria-labelledby="board-heading" className="mt-12">
          <div className="flex flex-col gap-1 md:flex-row md:items-baseline md:justify-between md:gap-4">
            <h2 id="board-heading" className="font-display text-2xl font-black tracking-[-0.01em] text-ink">
              {board.ranked.length === 0 ? "Nothing to rank yet" : `${board.ranked.length} ${board.ranked.length === 1 ? "resort" : "resorts"} ranked`}
            </h2>
            <p className="text-sm text-bark">{board.ranked.length === 0 ? (asOfLabel ? `Latest reading ${asOfLabel}.` : "No readings yet.") : "Highest first; ties by name. Dated to the station day or report time."}</p>
          </div>
          <div className="mt-3">
            {board.ranked.length > 0 ? (
              <div className="overflow-x-auto rounded-[18px] border-[1.5px] border-ink bg-cream-50 shadow-stamp">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-ink/15">
                      <th scope="col" className="pc-eyebrow px-3 py-3 text-right sm:px-4">#</th>
                      <th scope="col" className="pc-eyebrow px-3 py-3">Resort</th>
                      <th scope="col" className="pc-eyebrow px-3 py-3 text-right">{copy.valueLabel}</th>
                      <th scope="col" className="pc-eyebrow hidden px-3 py-3 text-right sm:table-cell">{board.ranked[0]?.detail?.label ?? ""}</th>
                      <th scope="col" className="pc-eyebrow hidden px-3 py-3 md:table-cell">Source</th>
                      <th scope="col" className="pc-eyebrow hidden px-4 py-3 text-right md:table-cell">Dated</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink/10">
                    {board.ranked.map((row) => {
                      const dated = row.measuredAt ? formatMountainTime(row.measuredAt) : "";
                      const meta = row.stationId ? stationMeta(row.stationId) : null;
                      return (
                        <tr key={row.slug}>
                          <td className={`${num} px-3 py-3 text-right text-bark sm:px-4`}>{row.rank}</td>
                          <td className="px-3 py-3">
                            <Link href={`/resorts/${row.slug}`} className="font-bold text-ink underline-offset-2 hover:underline">
                              {row.name}
                            </Link>
                            <span className="block text-xs text-bark">
                              {row.state}
                              <span className="md:hidden"> · {row.source === "snotel" ? "SNOTEL" : "model"}</span>
                            </span>
                          </td>
                          <td className={`${num} px-3 py-3 text-right text-ink`}>{valueOf(row)}</td>
                          <td className={`${num} hidden px-3 py-3 text-right text-bark-dk sm:table-cell`}>{row.detail?.value ?? "—"}</td>
                          <td className="hidden px-3 py-3 text-xs text-bark md:table-cell">
                            {row.source === "snotel" ? `SNOTEL${meta?.name ? ` · ${meta.name}` : ""}` : row.source === "open_meteo" ? "model estimate" : row.source}
                          </td>
                          <td className="hidden px-4 py-3 text-right text-xs text-bark md:table-cell">{dated && row.measuredAt ? <time dateTime={row.measuredAt}>{dated}</time> : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="rounded-[18px] border-[1.5px] border-dashed border-ink/40 bg-cream-50 px-5 py-8 text-center">
                <p className="text-[15.5px] text-ink">{board.sentence.text}</p>
                <p className="mt-3 text-sm text-bark">
                  For what is on the ground today, see the{" "}
                  <Link href="/snow-report" className="font-bold text-ink underline-offset-2 hover:underline">
                    live snow report
                  </Link>
                  .
                </p>
              </div>
            )}
          </div>
        </section>

        <section aria-labelledby="board-about-heading" className="mt-12 max-w-3xl">
          <h2 id="board-about-heading" className="font-display text-2xl font-black tracking-[-0.01em] text-ink">
            How to read this table
          </h2>
          <div className="mt-4 space-y-4 text-[15.5px] leading-relaxed text-ink">
            <p>{copy.rule}</p>
            <p>
              Every row is dated to the station day or the report it came from, in Mountain time; the NRCS feed is synced every six hours.
              A station sits at one fixed elevation, usually mid-mountain, so it can disagree with a resort&rsquo;s own upper-mountain report.{" "}
              <Link href="/methodology#history" className="font-bold text-ink underline-offset-2 hover:underline">
                How the history is built
              </Link>
              . JSON for this board: <a href={doc.pageUrl.replace("/snow-report/", "/api/v1/leaderboards/")} className="font-bold text-ink underline-offset-2 hover:underline">{`/api/v1/leaderboards/${kind}`}</a>.
            </p>
          </div>
        </section>

        <nav aria-label="Related pages" className="mt-12 flex flex-wrap gap-3 text-sm">
          {others.map((k) => (
            <Link key={k} href={leaderboardPath(k)} className="rounded-full border-[1.5px] border-ink bg-cream-50 px-4 py-2 font-bold text-ink shadow-stamp-sm hover:bg-cream">
              {LEADERBOARD_COPY[k].eyebrow}
            </Link>
          ))}
          <Link href="/snow-report/percent-of-normal" className="rounded-full border-[1.5px] border-ink bg-cream-50 px-4 py-2 font-bold text-ink shadow-stamp-sm hover:bg-cream">
            Percent of normal
          </Link>
          <Link href="/snow-report" className="rounded-full border-[1.5px] border-ink bg-cream-50 px-4 py-2 font-bold text-ink shadow-stamp-sm hover:bg-cream">
            Live snow report
          </Link>
        </nav>
      </main>
      <PeakFooter />
    </>
  );
}

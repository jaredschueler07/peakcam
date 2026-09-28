import type { Metadata } from "next";
import Link from "next/link";
import { getAllResorts, getResortOpenings } from "@/lib/supabase";
import { Header } from "@/components/layout/Header";
import { PeakFooter } from "@/components/home/PeakFooter";
import { PowderAlertForm, type AlertResort } from "@/components/alerts/PowderAlertForm";
import { OpeningDatesTable, type OpeningTableResort } from "@/components/openings/OpeningDatesTable";
import { OpeningSummaryChips } from "@/components/openings/OpeningSummaryChips";
import { formatOpeningDate, openingSummary, SEASON_LABEL, sortForTable, toIsoDay } from "@/lib/openings";
import { isOffSeason } from "@/lib/map-utils";
import { SITE_URL } from "@/lib/site";

// Hourly, like every data-bearing page: the table changes when the seed is
// re-run (weekly through November) and a "Confirmed" row flips to "Open" on
// its date without a deploy.
export const revalidate = 3600;

const PAGE_URL = `${SITE_URL}/opening-dates`;
const PAGE_TITLE = `Ski Resort Opening Dates ${SEASON_LABEL} — Live Cams & Opening-Day Alerts | PeakCam`;
const SHARE_TITLE = `Ski Resort Opening Dates ${SEASON_LABEL}`;
// 153 chars — inside the ~160 SERP budget the hub descriptions are held to
// (lib/hub-copy.ts META_DESCRIPTION_MAX); also reused as og:description.
const DESCRIPTION =
  `Projected and confirmed ${SEASON_LABEL} ski resort opening dates — Colorado, Utah, Tahoe, Vermont and the Andes — ` +
  "with live webcams and a free opening-day email.";

export const metadata: Metadata = {
  // `absolute` sidesteps the root layout's "%s | PeakCam" template — the
  // title already ends with the brand and would otherwise get it twice.
  title: { absolute: PAGE_TITLE },
  description: DESCRIPTION,
  alternates: { canonical: PAGE_URL },
  // The root layout's openGraph/twitter objects are replaced, not merged,
  // once a page sets its own — so siteName is repeated here (same as /alerts).
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
    description: `When does your mountain open? Projected and confirmed ${SEASON_LABEL} dates with live cams and opening-day alerts.`,
  },
};

// Northern-hemisphere reference for the pre-season note (same constant as
// /alerts): far enough from the equator that isOffSeason's month split is
// unambiguous.
const NORTHERN_REFERENCE_LAT = 45;

// Evergreen questions — the answers are written so they stay true from
// September through the season without a date in them. Rendered visibly AND
// as FAQPage JSON-LD (rich results require the text to be on the page).
const FAQ: Array<{ question: string; answer: string }> = [
  {
    question: "Which ski resort opens first?",
    answer:
      "In North America the first lifts almost always turn in Colorado in October. Arapahoe Basin, Keystone and Loveland race to open a run or two on snowmaking, and Wolf Creek has opened on natural snow as early as mid-October. The table above marks who is already open and shows each resort's projected and confirmed date as it is announced.",
  },
  {
    question: "When does Colorado ski season start?",
    answer:
      "Colorado's ski season usually starts in the second half of October, when Arapahoe Basin or Keystone opens on snowmaking, and most Colorado resorts open through November; the whole state is running by mid-December. Exact dates depend on cold nights for snowmaking and early storms, so a projection can move by a week or more — confirmed dates appear in the table the day a resort announces them.",
  },
  {
    question: "How do opening-day alerts work?",
    answer:
      "Pick your resorts in the form below and tick “email me the morning a selected resort opens”. The morning a resort's confirmed opening date arrives, PeakCam sends one email with links to its live cams and snow report. It is free, needs no account, and the same one-click unsubscribe covers it; your fresh-snow powder alerts for those resorts keep working all season.",
  },
];

export default async function OpeningDatesPage() {
  // Let a fetch failure propagate — it fails this ISR revalidation so
  // Next.js keeps serving the last good page instead of caching an empty
  // table at 200 (same policy as /snow-report).
  const [resorts, openings] = await Promise.all([getAllResorts(), getResortOpenings()]);

  // One clock read per render; the table, the chips and the pre-season note
  // all derive from it, so they cannot disagree. UTC day, like the cron.
  const now = new Date();
  const today = toIsoDay(now);

  const tableResorts: OpeningTableResort[] = resorts.map(({ id, name, slug, state, lat, cams }) => ({
    id,
    name,
    slug,
    state,
    lat,
    camCount: cams.filter((c) => c.is_active).length,
  }));
  const groups = sortForTable(openings, tableResorts, today);
  const summary = openingSummary(groups, today);
  // Pre-season until the data says otherwise: isOffSeason is a pure month
  // split (true through October) but Colorado opens in October, so the note
  // flips to "In season" the moment the first Northern resort is Open rather
  // than contradicting an "Open now" section further down the page.
  const preSeason = groups.open.length === 0 && isOffSeason(NORTHERN_REFERENCE_LAT, now);
  // Only what the picker renders — not the cams and snow reports.
  const alertResorts: AlertResort[] = resorts.map(({ id, name, slug, state, lat }) => ({ id, name, slug, state, lat }));

  const northernCount = groups.open.length + groups.confirmed.length + groups.projected.length + groups.tba.length;
  const orderedForList = [...groups.open, ...groups.confirmed, ...groups.projected, ...groups.tba, ...groups.closing];

  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };

  const listLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `Ski resort opening dates ${SEASON_LABEL}`,
    url: PAGE_URL,
    numberOfItems: orderedForList.length,
    itemListOrder: "https://schema.org/ItemListOrderAscending",
    itemListElement: orderedForList.map((row, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: row.resort.name,
      url: `${SITE_URL}/resorts/${row.resort.slug}`,
    })),
  };

  const next = summary.nextToOpen;

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(listLd) }} />
      <Header showSearch={false} />
      <main id="main-content" className="mx-auto max-w-4xl px-5 py-12">
        <p className="pc-eyebrow mb-3">Season {SEASON_LABEL}</p>
        <h1 className="font-display text-4xl font-black leading-[0.95] tracking-[-0.02em] text-ink md:text-5xl">
          Ski resort opening dates {SEASON_LABEL}
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-bark">
          Projected and confirmed opening dates for {northernCount} North American ski resorts, each with its live
          webcams a click away — and one email the morning your mountain opens. Updated as resorts announce.
        </p>

        {/* Season-aware note: pre-season the whole table is projections and
            says so; in season it points at who is already spinning. */}
        <aside
          className={`mt-6 flex items-start gap-3 rounded-[18px] border-[1.5px] border-ink px-5 py-3 text-sm shadow-stamp ${
            preSeason ? "bg-fair text-ink" : "pc-on-ink bg-forest text-cream-50"
          }`}
        >
          <span aria-hidden className="mt-0.5 shrink-0 font-mono text-xs font-bold uppercase tracking-[0.1em]">
            {preSeason ? "Pre-season" : "In season"}
          </span>
          <p className="min-w-0">
            {preSeason ? (
              <>
                A date is a projection until the resort confirms it; confirmed dates are marked and are the only ones
                that trigger an opening-day email. We re-check announcements weekly through November
                {next ? (
                  <>
                    {" "}
                    — next up, <strong className="font-bold">{next.resort.name}</strong> on{" "}
                    {formatOpeningDate(next.opening?.confirmed_open ?? next.opening?.projected_open, "weekday")}
                    {next.status === "projected" ? " (projected)" : ""}.
                  </>
                ) : (
                  "."
                )}
              </>
            ) : (
              <>
                The season is on: resorts marked <strong className="font-bold">Open</strong> are spinning lifts today —
                check the cams — and the rest are listed by their announced or projected date.
              </>
            )}
          </p>
        </aside>

        <div className="mt-6">
          <OpeningSummaryChips summary={summary} />
        </div>

        <OpeningDatesTable groups={groups} />

        <p className="mt-4 text-xs text-bark">
          Projections come from OnTheSnow&apos;s projected-openings list and the resorts&apos; own stated targets;
          confirmed dates link to the announcement. A projection can move with the weather — only a confirmed date
          triggers an opening-day email.
        </p>

        <section id="alerts" className="mt-14 scroll-mt-20" aria-labelledby="opening-alerts-heading">
          <p className="pc-eyebrow mb-2">Opening-day alerts</p>
          <h2 id="opening-alerts-heading" className="font-display text-3xl font-black leading-tight text-ink">
            Hear about opening day the morning it happens.
          </h2>
          <p className="mt-2 max-w-2xl text-bark">
            Pick your mountains. We email you the morning a resort you follow opens, and again whenever it gets your
            fresh-snow threshold all season. Free, no account, unsubscribe in one click.
          </p>
          <div className="mt-5 rounded-[18px] border-[1.5px] border-ink bg-cream-50 shadow-stamp">
            <PowderAlertForm resorts={alertResorts} source="opening_dates" defaultOpeningAlerts />
          </div>
        </section>

        <section className="mt-14" aria-labelledby="opening-faq-heading">
          <h2 id="opening-faq-heading" className="font-display text-2xl font-black text-ink">
            Opening-date questions
          </h2>
          <dl className="mt-4 divide-y divide-ink/10 rounded-[18px] border-[1.5px] border-ink bg-cream-50 shadow-stamp">
            {FAQ.map((item) => (
              <div key={item.question} className="px-5 py-4">
                <dt className="font-display text-lg font-bold text-ink">{item.question}</dt>
                <dd className="mt-1.5 text-sm leading-relaxed text-bark">{item.answer}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-sm text-bark">
            Looking for today&apos;s conditions instead? The{" "}
            <Link href="/snow-report" className="font-bold text-ink underline">
              live snow report
            </Link>{" "}
            covers every resort, and{" "}
            <Link href="/alerts" className="font-bold text-ink underline">
              powder alerts
            </Link>{" "}
            watch them for you.
          </p>
        </section>
      </main>
      <PeakFooter />
    </>
  );
}

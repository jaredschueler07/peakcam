import Link from "next/link";
import type { HubSummary } from "@/lib/hubs";
import { formatUtcDate } from "@/lib/format-date";
import { HubRatingPill } from "./HubRatingPill";

interface Props {
  summary: HubSummary;
  /** "Last sensor sync" / "Last model sync" / "Last data sync" — lib/hub-copy.ts hubSyncLabel. */
  syncLabel: string;
  offSeason: boolean;
}

const stat = "rounded-[18px] border-[1.5px] border-ink bg-cream-50 px-4 py-3 shadow-stamp-sm";
const big = "font-display text-2xl font-black leading-none text-ink";

function ResortStat({ value, name, slug, empty }: { value: number | null; name?: string; slug?: string; empty: string }) {
  if (value == null || !slug) return <span className="text-sm text-bark">{empty}</span>;
  return (
    <>
      <span className={big}>{value}″</span>
      <Link href={`/resorts/${slug}`} className="mt-1 block truncate text-sm font-bold text-forest underline-offset-2 hover:underline">
        {name}
      </Link>
    </>
  );
}

/**
 * The live numbers above the table, server-rendered from the same rows the
 * table uses so the two can never disagree. The timestamp is a `<time>` with
 * the ISO in `dateTime` and a deterministic UTC date as its text — this page
 * has no client render to upgrade it in, and a locale string here would differ
 * between the ISR server and a browser (see lib/format-date.ts).
 */
export function HubSummaryStrip({ summary, syncLabel, offSeason }: Props) {
  return (
    <dl className="grid grid-cols-2 gap-3 md:grid-cols-5" aria-label="Live summary">
      <div className={stat}>
        <dt className="pc-eyebrow">Resorts tracked</dt>
        <dd className={`mt-1.5 ${big}`}>{summary.count}</dd>
      </div>
      <div className={stat}>
        <dt className="pc-eyebrow">Deepest base</dt>
        <dd className="mt-1.5">
          <ResortStat
            value={summary.deepestBase?.value ?? null}
            name={summary.deepestBase?.name}
            slug={summary.deepestBase?.slug}
            empty={offSeason ? "Off-season · no base" : "No base reported"}
          />
        </dd>
      </div>
      <div className={stat}>
        <dt className="pc-eyebrow">Most new snow · 24h</dt>
        <dd className="mt-1.5">
          <ResortStat
            value={summary.mostNewSnow24h?.value ?? null}
            name={summary.mostNewSnow24h?.name}
            slug={summary.mostNewSnow24h?.slug}
            empty="Nothing in the last 24h"
          />
        </dd>
      </div>
      <div className={stat}>
        <dt className="pc-eyebrow">Best rating</dt>
        <dd className="mt-2">
          <HubRatingPill rating={summary.bestRating} offSeason={offSeason} size="md" />
        </dd>
      </div>
      <div className={stat}>
        <dt className="pc-eyebrow">{syncLabel}</dt>
        <dd className="mt-1.5 font-mono text-sm font-bold text-ink">
          {summary.newestReportAt ? (
            <time dateTime={summary.newestReportAt}>{formatUtcDate(summary.newestReportAt)}</time>
          ) : (
            <span aria-label="No report yet">—</span>
          )}
        </dd>
      </div>
    </dl>
  );
}

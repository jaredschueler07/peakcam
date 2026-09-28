import Link from "next/link";
import { formatOpeningDate, type OpeningResort, type OpeningSummary } from "@/lib/openings";

const chip =
  "inline-flex items-center gap-2 rounded-full border-[1.5px] px-3.5 py-1.5 text-[13px] font-bold shadow-stamp-sm";

/**
 * The live numbers above the table. Server-rendered from the same grouping
 * the table uses, so the chips and the rows can never disagree.
 */
export function OpeningSummaryChips<R extends OpeningResort>({ summary }: { summary: OpeningSummary<R> }) {
  const next = summary.nextToOpen;
  const nextDate = next?.opening
    ? formatOpeningDate(next.opening.confirmed_open ?? next.opening.projected_open, "weekday")
    : "";

  return (
    <ul className="flex flex-wrap gap-2" aria-label="Opening-date summary">
      <li className={`${chip} border-ink bg-forest text-cream-50`}>
        <span className="font-mono text-base leading-none">{summary.confirmed}</span>
        confirmed
      </li>
      {next && (
        <li className={`${chip} border-ink bg-cream-50 text-ink`}>
          <span className="font-normal text-bark">Next to open</span>
          <Link href={`/resorts/${next.resort.slug}`} className="hover:underline">
            {next.resort.name}
          </Link>
          {nextDate && (
            <span className="font-mono text-xs text-bark">
              {nextDate}
              {next.status === "projected" ? " (proj.)" : ""}
            </span>
          )}
        </li>
      )}
      <li className={`${chip} border-ink bg-fair text-ink`}>
        <span className="font-mono text-base leading-none">{summary.projected}</span>
        projected
      </li>
      <li className={`${chip} border-bark bg-cream-dk text-ink`}>
        <span className="font-mono text-base leading-none">{summary.tba}</span>
        date TBA
      </li>
    </ul>
  );
}

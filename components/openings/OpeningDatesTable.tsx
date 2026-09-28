import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { formatOpeningDate, type OpeningGroups, type OpeningResort, type OpeningRow } from "@/lib/openings";
import { OpeningStatusPill } from "./OpeningStatusPill";

/** A resort row plus how many active cams its page has. */
export type OpeningTableResort = OpeningResort & { camCount: number };

interface GroupSpec {
  key: keyof OpeningGroups<OpeningTableResort>;
  title: string;
  blurb: string;
  /** Which date columns the group shows. */
  mode: "opening" | "closing";
}

// Order on the page. Groups with no rows are skipped.
const GROUPS: GroupSpec[] = [
  { key: "open", title: "Open now", blurb: "Lifts are turning — the cams are the proof.", mode: "opening" },
  { key: "confirmed", title: "Confirmed", blurb: "Announced by the resort. These dates drive opening-day emails.", mode: "opening" },
  { key: "projected", title: "Projected", blurb: "Third-party projections until the resort confirms. Early-season dates move with the weather.", mode: "opening" },
  { key: "tba", title: "Date TBA", blurb: "No sourced date yet. Follow a resort below and we email you the morning it opens.", mode: "opening" },
  { key: "closing", title: "Andes — closing soon", blurb: "The Southern-hemisphere season runs May to October; closing dates as reported.", mode: "closing" },
];

const openingCols = "md:grid-cols-[minmax(0,2fr)_6.5rem_6.5rem_7.5rem_minmax(0,1fr)]";
const closingCols = "md:grid-cols-[minmax(0,2fr)_8rem_7.5rem_minmax(0,1fr)]";

function DateCell({ label, value, strong = false }: { label: string; value: string | null; strong?: boolean }) {
  const text = formatOpeningDate(value, "weekday");
  return (
    <div className="text-sm">
      <span className="pc-eyebrow mr-1.5 md:hidden">{label}</span>
      {text ? (
        <time dateTime={value ?? undefined} className={`font-mono text-[13px] ${strong ? "font-bold text-ink" : "text-bark-dk"}`}>
          {text}
        </time>
      ) : (
        <span aria-label={`${label}: none yet`} className="font-mono text-[13px] text-bark">
          —
        </span>
      )}
    </div>
  );
}

function CamsLink({ resort }: { resort: OpeningTableResort }) {
  const n = resort.camCount;
  return (
    <Link
      href={n > 0 ? `/resorts/${resort.slug}#cameras` : `/resorts/${resort.slug}`}
      className="whitespace-nowrap text-sm font-bold text-forest underline-offset-2 hover:underline"
    >
      {n > 0 ? `Watch ${n} cam${n === 1 ? "" : "s"} →` : "Resort page →"}
    </Link>
  );
}

function Row({ row, mode }: { row: OpeningRow<OpeningTableResort>; mode: GroupSpec["mode"] }) {
  const { resort, opening, status } = row;
  const pillLabel =
    mode === "closing" && status === "tba" ? "Closing TBA" : undefined;

  return (
    <li className={`px-4 py-3 md:grid md:items-center md:gap-x-4 ${mode === "closing" ? closingCols : openingCols}`}>
      <div className="min-w-0">
        <Link href={`/resorts/${resort.slug}`} className="font-bold text-ink hover:underline">
          {resort.name}
        </Link>
        <span className="ml-2 text-xs text-bark">{resort.state}</span>
        {opening?.source_url && (
          <a
            href={opening.source_url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="ml-2 inline-flex items-center gap-0.5 align-middle text-[11px] text-bark hover:text-ink"
            aria-label={`Source for ${resort.name}'s date (opens in a new tab)`}
          >
            source <ExternalLink size={10} aria-hidden />
          </a>
        )}
      </div>

      {/* Date cells: a row of their own on phones, grid columns from md up. */}
      <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 md:contents">
        {mode === "closing" ? (
          <DateCell label="Closing" value={opening?.closing_date ?? null} strong />
        ) : (
          <>
            <DateCell label="Projected" value={opening?.projected_open ?? null} />
            <DateCell label="Confirmed" value={opening?.confirmed_open ?? null} strong />
          </>
        )}
      </div>

      <div className="mt-2 flex items-center justify-between gap-3 md:contents">
        <span className="md:justify-self-start">
          <OpeningStatusPill status={status} label={pillLabel} />
        </span>
        <span className="md:justify-self-end">
          <CamsLink resort={resort} />
        </span>
      </div>
    </li>
  );
}

function HeaderRow({ mode }: { mode: GroupSpec["mode"] }) {
  return (
    <div
      aria-hidden
      className={`hidden border-b border-ink/15 px-4 py-2 md:grid md:gap-x-4 ${mode === "closing" ? closingCols : openingCols}`}
    >
      <span className="pc-eyebrow">Resort</span>
      {mode === "closing" ? (
        <span className="pc-eyebrow">Closing</span>
      ) : (
        <>
          <span className="pc-eyebrow">Projected</span>
          <span className="pc-eyebrow">Confirmed</span>
        </>
      )}
      <span className="pc-eyebrow">Status</span>
      <span className="pc-eyebrow md:text-right">Cams</span>
    </div>
  );
}

/**
 * "Closing soon" is only true while an Andes resort is still open. Once every
 * reported date has passed the group is last season; with no dates at all
 * (mid-winter up north, or before the seed) it is simply the other hemisphere.
 */
function groupTitle(spec: GroupSpec, rows: OpeningRow<OpeningTableResort>[]): string {
  if (spec.key !== "closing") return spec.title;
  if (rows.some((r) => r.status === "open")) return spec.title;
  if (rows.some((r) => r.status === "closed")) return "Andes — season over";
  return "Andes — Southern-hemisphere season";
}

/**
 * Every active resort, grouped by opening status. A Server Component: the
 * status is decided once per ISR render from the page's US-Pacific calendar
 * day (lib/openings.ts toPacificDay), there is nothing to hydrate, and the
 * HTML is what crawlers index.
 */
export function OpeningDatesTable({ groups }: { groups: OpeningGroups<OpeningTableResort> }) {
  return (
    <>
      {GROUPS.map((spec) => {
        const rows = groups[spec.key];
        if (rows.length === 0) return null;
        const headingId = `openings-${spec.key}`;
        return (
          <section key={spec.key} aria-labelledby={headingId} className="mt-10">
            <div className="flex flex-col gap-1 md:flex-row md:items-baseline md:justify-between md:gap-4">
              <h2 id={headingId} className="font-display text-2xl font-black tracking-[-0.01em] text-ink">
                {groupTitle(spec, rows)}{" "}
                <span className="font-mono text-sm font-bold text-bark">({rows.length})</span>
              </h2>
              <p className="text-sm text-bark">{spec.blurb}</p>
            </div>
            <div className="mt-3 overflow-hidden rounded-[18px] border-[1.5px] border-ink bg-cream-50 shadow-stamp">
              <HeaderRow mode={spec.mode} />
              <ul className="divide-y divide-ink/10">
                {rows.map((row) => (
                  <Row key={row.resort.id} row={row} mode={spec.mode} />
                ))}
              </ul>
            </div>
          </section>
        );
      })}
    </>
  );
}

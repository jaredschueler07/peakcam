import Link from "next/link";
import {
  formatOpeningDate,
  SEASON_LABEL,
  type OpeningRow,
  type OpeningStateGroup,
} from "@/lib/openings";
import { stateHubPath } from "@/lib/hubs";
import { OpeningStatusPill } from "./OpeningStatusPill";
import type { OpeningTableResort } from "./OpeningDatesTable";

type StateGroup = OpeningStateGroup<OpeningTableResort>;

const pill =
  "inline-flex items-center gap-1.5 rounded-full border-[1.5px] border-ink bg-cream-50 px-3.5 py-1.5 pointer-coarse:min-h-11 text-[13px] font-bold text-ink shadow-stamp-sm " +
  "transition-[transform,box-shadow] duration-100 hover:-translate-x-[1px] hover:-translate-y-[1px] hover:shadow-stamp";

/** Jump list to every state section below. Rendered near the top of the page. */
export function OpeningStateNav({ states }: { states: StateGroup[] }) {
  if (states.length === 0) return null;
  return (
    <nav aria-label="Opening dates by state" className="mt-6">
      <p className="pc-eyebrow mb-2">Jump to your state</p>
      <ul className="flex flex-wrap gap-2">
        {states.map((state) => (
          <li key={state.key}>
            <a href={`#${state.slug}`} className={pill}>
              {state.label}
              <span className="font-mono text-[11px] text-bark">{state.rows.length}</span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * One sentence per state that reads correctly in every season: who is open,
 * who is next, and how firm the dates are. Counts come from the same
 * `openingSummary` the national chips use, so the two never disagree.
 */
export function stateSummaryLine(state: StateGroup): string {
  const { summary, rows, label } = state;
  const total = rows.length;
  const resorts = `${total} ${label} ${total === 1 ? "resort" : "resorts"}`;
  const parts: string[] = [];
  if (summary.open > 0) {
    parts.push(`${summary.open} of ${resorts} ${summary.open === 1 ? "is" : "are"} open now`);
  } else {
    parts.push(`None of the ${resorts} ${total === 1 ? "is" : "are"} open yet`);
  }
  const next = summary.nextToOpen;
  if (next) {
    const date = formatOpeningDate(next.opening?.confirmed_open ?? next.opening?.projected_open, "weekday");
    parts.push(`next up is ${next.resort.name} on ${date}${next.status === "projected" ? " (projected)" : ""}`);
  }
  const announced = summary.confirmed - summary.open;
  const firmness: string[] = [];
  if (announced > 0) firmness.push(`${announced} confirmed ${announced === 1 ? "date" : "dates"}`);
  if (summary.projected > 0) firmness.push(`${summary.projected} projected`);
  if (summary.tba > 0) firmness.push(`${summary.tba} TBA`);
  const head = parts.join("; ") + ".";
  return firmness.length ? `${head} ${firmness.join(", ")}.` : head;
}

function StateRow({ row }: { row: OpeningRow<OpeningTableResort> }) {
  const { resort, opening, status } = row;
  const confirmed = opening?.confirmed_open ?? null;
  const projected = opening?.projected_open ?? null;
  const shown = confirmed ?? projected;
  const text = formatOpeningDate(shown, "weekday");
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <Link href={`/resorts/${resort.slug}`} className="font-bold text-ink hover:underline">
          {resort.name}
        </Link>
        {resort.camCount > 0 && (
          <Link href={`/resorts/${resort.slug}#cameras`} className="ml-2 text-xs font-bold text-forest hover:underline">
            {resort.camCount} {resort.camCount === 1 ? "cam" : "cams"}
          </Link>
        )}
      </div>
      <div className="flex items-center gap-3">
        {text ? (
          <time dateTime={shown ?? undefined} className={`font-mono text-[13px] ${confirmed ? "font-bold text-ink" : "text-bark-dk"}`}>
            {text}
          </time>
        ) : (
          <span className="font-mono text-[13px] text-bark" aria-label="No date yet">—</span>
        )}
        <OpeningStatusPill status={status} />
      </div>
    </li>
  );
}

/**
 * Per-state sections, each with its own anchor (`#colorado`), heading, summary
 * sentence and a compact list of the state's resorts. A Server Component: the
 * HTML is what crawlers index, and the state hubs link straight to these
 * anchors from their "Keep exploring" block.
 */
export function OpeningDatesByState({ states }: { states: StateGroup[] }) {
  if (states.length === 0) return null;
  return (
    <section aria-labelledby="openings-by-state-heading" className="mt-14">
      <h2 id="openings-by-state-heading" className="font-display text-3xl font-black leading-tight text-ink">
        Opening dates by state
      </h2>
      <p className="mt-2 max-w-2xl text-bark">
        The same dates as the table above, one state at a time. Each state links to its live webcams and snow report.
      </p>
      {states.map((state) => {
        const headingId = `openings-state-${state.slug}`;
        return (
          <section key={state.key} id={state.slug} aria-labelledby={headingId} className="mt-10 scroll-mt-20">
            <h3 id={headingId} className="font-display text-2xl font-black tracking-[-0.01em] text-ink">
              {state.label} ski resort opening dates {SEASON_LABEL}{" "}
              <span className="font-mono text-sm font-bold text-bark">({state.rows.length})</span>
            </h3>
            <p className="mt-2 text-sm text-bark">{stateSummaryLine(state)}</p>
            <div className="mt-3 overflow-hidden rounded-[18px] border-[1.5px] border-ink bg-cream-50 shadow-stamp">
              <ul className="divide-y divide-ink/10">
                {state.rows.map((row) => (
                  <StateRow key={row.resort.id} row={row} />
                ))}
              </ul>
            </div>
            <p className="mt-3 text-sm">
              <Link href={stateHubPath(state.key)} className="font-bold text-forest underline-offset-2 hover:underline">
                {state.label} ski webcams &amp; snow report →
              </Link>
            </p>
          </section>
        );
      })}
    </section>
  );
}

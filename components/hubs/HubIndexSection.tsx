import Link from "next/link";
import { hubPath, stateLabel, type Hub } from "@/lib/hubs";

export interface HubCard {
  hub: Hub;
  count: number;
  /** Active cams across the hub's resorts. */
  cams: number;
}

/**
 * One group on the /ski-cams index (United States, Canada, South America,
 * Mountain regions): a card per hub with its resort and cam counts. Plain
 * links in the HTML — this page is the crawl path growth-audit S11 asked for.
 */
export function HubIndexSection({ id, title, blurb, cards }: { id: string; title: string; blurb?: string; cards: HubCard[] }) {
  if (cards.length === 0) return null;
  return (
    <section aria-labelledby={id} className="mt-10">
      <div className="flex flex-col gap-1 md:flex-row md:items-baseline md:justify-between md:gap-4">
        <h2 id={id} className="font-display text-2xl font-black tracking-[-0.01em] text-ink">
          {title} <span className="font-mono text-sm font-bold text-bark">({cards.length})</span>
        </h2>
        {blurb && <p className="text-sm text-bark">{blurb}</p>}
      </div>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map(({ hub, count, cams }) => (
          <li key={hub.slug}>
            <Link
              href={hubPath(hub)}
              className="group flex items-start justify-between gap-3 rounded-[18px] border-[1.5px] border-ink bg-cream-50 px-4 py-3 shadow-stamp-sm
                         transition-[transform,box-shadow] duration-100 hover:-translate-x-[1px] hover:-translate-y-[1px] hover:shadow-stamp"
            >
              <span className="min-w-0">
                <span className="block truncate font-display text-lg font-bold leading-tight text-ink group-hover:underline">{hub.label}</span>
                {hub.kind === "region" && (
                  <span className="mt-0.5 block truncate text-xs text-bark">{hub.stateCodes.map(stateLabel).join(" · ")}</span>
                )}
              </span>
              <span className="shrink-0 text-right font-mono text-xs font-bold text-bark">
                <span className="block text-ink">
                  {count} {count === 1 ? "resort" : "resorts"}
                </span>
                {cams > 0 && (
                  <span className="block">
                    {cams} {cams === 1 ? "cam" : "cams"}
                  </span>
                )}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

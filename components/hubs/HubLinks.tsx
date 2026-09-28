import type { ReactNode } from "react";
import Link from "next/link";
import { HUB_BASE_PATH, hubPath, type Hub, type RegionGroup, type StateHub } from "@/lib/hubs";

interface Props {
  hub: Hub;
  /** State hubs: neighbouring states with resorts. Region hubs: the states the region spans. */
  stateHubs: StateHub[];
  /** State hubs only: region hubs with resorts in this state. */
  regionHubs: RegionGroup[];
}

const pill =
  "inline-flex items-center gap-1.5 rounded-full border-[1.5px] border-ink bg-cream-50 px-3.5 py-1.5 pointer-coarse:min-h-11 text-[13px] font-bold text-ink shadow-stamp-sm " +
  "transition-[transform,box-shadow] duration-100 hover:-translate-x-[1px] hover:-translate-y-[1px] hover:shadow-stamp";

function PillList({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="pc-eyebrow mb-2">{title}</h3>
      <ul className="flex flex-wrap gap-2">{children}</ul>
    </div>
  );
}

/**
 * The internal-link block growth-audit S1/S2 asked for: every hub links
 * sideways (neighbouring states, the regions inside a state, the states a
 * region spans) and up to the site-wide pages, so link equity flows out of
 * the pages that rank into the ones that don't. Every target here is a page
 * generateStaticParams emits — the callers filter with the lib/hubs helpers.
 */
export function HubLinks({ hub, stateHubs, regionHubs }: Props) {
  const isRegion = hub.kind === "region";
  return (
    <section aria-labelledby="hub-links-heading" className="mt-14 space-y-6">
      <h2 id="hub-links-heading" className="font-display text-2xl font-black text-ink">
        Keep exploring
      </h2>

      {stateHubs.length > 0 && (
        <PillList title={isRegion ? `States in ${hub.label}` : `Near ${hub.label}`}>
          {stateHubs.map((state) => (
            <li key={state.slug}>
              <Link href={hubPath(state)} className={pill}>
                {state.label} ski webcams
              </Link>
            </li>
          ))}
        </PillList>
      )}

      {!isRegion && regionHubs.length > 0 && (
        <PillList title={`Regions in ${hub.label}`}>
          {regionHubs.map((group) => (
            <li key={group.hub.slug}>
              <Link href={hubPath(group.hub)} className={pill}>
                {group.hub.label}
                <span className="font-mono text-[11px] text-bark">{group.count}</span>
              </Link>
            </li>
          ))}
        </PillList>
      )}

      <PillList title="Across PeakCam">
        <li>
          <Link href={HUB_BASE_PATH} className={pill}>
            All states &amp; regions
          </Link>
        </li>
        <li>
          <Link href="/snow-report" className={pill}>
            Full snow report
          </Link>
        </li>
        <li>
          <Link href="/map" className={pill}>
            Resort map &amp; radar
          </Link>
        </li>
        <li>
          <Link href="/opening-dates" className={pill}>
            Opening dates
          </Link>
        </li>
        <li>
          <Link href="/alerts" className={pill}>
            Powder alerts
          </Link>
        </li>
      </PillList>
    </section>
  );
}

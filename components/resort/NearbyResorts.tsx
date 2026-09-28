import Link from "next/link";
import type { ConditionRating } from "@/lib/types";
import { NEARBY_DEFAULT_MAX_MILES, formatMiles, type NearbyResortSummary } from "@/lib/geo";
import { OFF_SEASON_COLOR } from "@/lib/map-utils";
import { buildCompareHref } from "@/lib/compare-params";
import { ConditionBadge } from "@/components/ui/Badge";

/** A hub page to link to — label as the link text, href under /ski-cams. */
export interface HubLink {
  label: string;
  href: string;
}

/**
 * Everything app/resorts/[slug]/page.tsx computes server-side for this block.
 * It is the whole payload the client receives about other resorts: ≤5 summary
 * rows and two hub targets, never the full catalogue.
 */
export interface NearbyResortsData {
  resorts: NearbyResortSummary[];
  /** "More in Colorado →"; null when the resort has no state on file. */
  stateHub: HubLink | null;
  /** "All Lake Tahoe cams →"; null when the region has too few resorts for a hub. */
  regionHub: HubLink | null;
  /**
   * Local summer, decided by the server render (ISR re-runs it hourly). In
   * the off-season the rating engine's "poor" is meaningless, so the cards
   * show the same neutral chip as the browse grid and the map instead of a
   * row of five "Poor" pills. Taken as a prop so this component never reads
   * the clock — the server HTML and the hydrating client agree byte-for-byte.
   */
  offSeason: boolean;
}

export interface NearbyResortsProps extends NearbyResortsData {
  /** The page's own resort — names the compare link. */
  resortName: string;
  resortSlug: string;
}

function inches(value: number | null): string {
  return value == null ? "—" : `${value}″`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function RatingPill({ rating, offSeason }: { rating: ConditionRating | null; offSeason: boolean }) {
  if (offSeason) {
    return (
      /* border matches SummitResortCard / MapBottomSheet's off-season chip */
      <span
        className="inline-flex items-center rounded-full border-[1.5px] border-ink px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.08em] text-ink"
        style={{ backgroundColor: OFF_SEASON_COLOR }}
      >
        Off-season
      </span>
    );
  }
  if (!rating) return null;
  return <ConditionBadge rating={rating} label={capitalize(rating)} size="sm" />;
}

const linkClass =
  "inline-flex min-h-11 items-center font-bold text-forest underline-offset-2 hover:underline hover:text-forest-dk";

/**
 * "Nearby resorts" for /resorts/[slug] (growth-audit S2). Until this shipped a
 * resort page linked to zero other resorts, so the link equity of the only
 * pages that rank never reached the other ~147. Up to five neighbours within
 * 150 mi as poster cards, then the internal links that matter most: the
 * state hub, a head-to-head compare with the nearest resort, and the region
 * hub when one exists.
 *
 * Pure render: no hooks, no Date, no locale — every string is a function of
 * the props, so it is safe inside the ISR'd client tree of ResortDetailPage.
 */
export function NearbyResorts({ resortName, resortSlug, resorts, stateHub, regionHub, offSeason }: NearbyResortsProps) {
  const nearest = resorts[0] ?? null;
  const hasLinks = Boolean(stateHub || nearest || regionHub);
  if (resorts.length === 0 && !hasLinks) return null;

  return (
    <section id="nearby" aria-labelledby="nearby-heading" className="scroll-mt-20">
      <h2 id="nearby-heading" className="mb-4 font-heading text-xl font-semibold uppercase tracking-wider text-ink">
        Nearby resorts
      </h2>

      {resorts.length === 0 ? (
        <p className="text-sm text-bark">
          Nothing else within {NEARBY_DEFAULT_MAX_MILES} miles — {resortName} stands alone.
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {resorts.map((resort) => (
            <li key={resort.slug}>
              <Link
                href={`/resorts/${resort.slug}`}
                className="flex h-full flex-col rounded-[18px] border-[1.5px] border-ink bg-cream-50 p-4 shadow-stamp
                           transition-[transform,box-shadow] duration-150 hover:-translate-y-0.5 hover:shadow-stamp-hover
                           focus-visible:ring-2 focus-visible:ring-alpen"
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-display text-[22px] font-black leading-[0.95] tracking-[-0.02em] text-ink [overflow-wrap:anywhere]">
                    {resort.name}
                  </h3>
                  <span className="shrink-0 pt-0.5 font-mono text-[11px] font-bold uppercase tracking-[0.1em] text-bark tabular-nums">
                    {formatMiles(resort.miles)}
                  </span>
                </div>

                {/* Data strip — dashed bark rule, mono numbers, same as the browse card */}
                <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-dashed border-bark/60 pt-3">
                  <div>
                    <dt className="font-mono text-[10px] uppercase tracking-widest text-bark">Base</dt>
                    <dd className="font-mono text-lg font-bold text-ink tabular-nums">{inches(resort.baseDepth)}</dd>
                  </div>
                  <div>
                    <dt className="font-mono text-[10px] uppercase tracking-widest text-bark">24h</dt>
                    <dd className="font-mono text-lg font-bold text-ink tabular-nums">{inches(resort.newSnow24h)}</dd>
                  </div>
                  <div>
                    <dt className="font-mono text-[10px] uppercase tracking-widest text-bark">Cams</dt>
                    <dd className="font-mono text-lg font-bold text-ink tabular-nums">{resort.camCount}</dd>
                  </div>
                </dl>

                <div className="mt-3 flex items-center justify-between gap-2">
                  <RatingPill rating={resort.rating} offSeason={offSeason} />
                  <span className="ml-auto text-xs font-bold text-forest">
                    {resort.camCount > 0 ? "Live cams →" : "Snow report →"}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {hasLinks && (
        <nav aria-label="More resorts" className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-sm">
          {stateHub && (
            <Link href={stateHub.href} className={linkClass}>
              More in {stateHub.label} →
            </Link>
          )}
          {nearest && (
            <Link href={buildCompareHref([resortSlug, nearest.slug])} className={linkClass}>
              Compare {resortName} vs {nearest.name} →
            </Link>
          )}
          {regionHub && (
            <Link href={regionHub.href} className={linkClass}>
              All {regionHub.label} cams →
            </Link>
          )}
        </nav>
      )}
    </section>
  );
}

import Link from "next/link";
import type { ResortWithData } from "@/lib/types";
import { isOffSeason } from "@/lib/map-utils";
import { regionHubPath, slugifyHub, stateHubPath, stateLabel } from "@/lib/hubs";
import { HubRatingPill } from "./HubRatingPill";

interface Props {
  /** Already in display order — lib/hub-copy.ts sortHubTable (base desc, then name). */
  resorts: ResortWithData[];
  /** State hubs show each resort's region; region hubs (whose region is the page) show the state. */
  placeColumn: "region" | "state";
  /** Region slugs that have a hub page of their own, so a region cell can link to it. */
  linkedRegionSlugs: ReadonlySet<string>;
  /** One clock read per render, shared with the strip and the prose. */
  now: Date;
}

const num = "font-mono text-[13px] font-bold tabular-nums";

function Inches({ value, strong = false }: { value: number | null | undefined; strong?: boolean }) {
  if (value == null) {
    return (
      <span aria-label="No reading" className={`${num} text-bark`}>
        —
      </span>
    );
  }
  return <span className={`${num} ${strong && value > 0 ? "text-ink" : "text-bark-dk"}`}>{value}″</span>;
}

function PlaceCell({ resort, placeColumn, linkedRegionSlugs }: Pick<Props, "placeColumn" | "linkedRegionSlugs"> & { resort: ResortWithData }) {
  if (placeColumn === "state") {
    return (
      <Link href={stateHubPath(resort.state)} className="text-bark underline-offset-2 hover:text-ink hover:underline">
        {stateLabel(resort.state)}
      </Link>
    );
  }
  const region = (resort.region ?? "").trim();
  if (!region) return <span className="text-bark">—</span>;
  if (!linkedRegionSlugs.has(slugifyHub(region))) return <span className="text-bark">{region}</span>;
  return (
    <Link href={regionHubPath(region)} className="text-bark underline-offset-2 hover:text-ink hover:underline">
      {region}
    </Link>
  );
}

/**
 * Every resort in the hub, one row each. A Server Component: the order is
 * decided once per ISR render, there is nothing to hydrate, and the rows are
 * what crawlers index. No sort controls on purpose — the sortable version of
 * this table is /snow-report; this one exists to rank a place.
 */
export function HubResortTable({ resorts, placeColumn, linkedRegionSlugs, now }: Props) {
  return (
    <div className="overflow-x-auto rounded-[18px] border-[1.5px] border-ink bg-cream-50 shadow-stamp">
      <table className="w-full min-w-[34rem] text-left text-sm">
        <thead>
          <tr className="border-b border-ink/15">
            <th scope="col" className="pc-eyebrow px-4 py-3">
              Resort
            </th>
            <th scope="col" className="pc-eyebrow hidden px-3 py-3 md:table-cell">
              {placeColumn === "state" ? "State" : "Region"}
            </th>
            <th scope="col" className="pc-eyebrow px-3 py-3 text-right">
              Base
            </th>
            <th scope="col" className="pc-eyebrow px-3 py-3 text-right">
              24h
            </th>
            <th scope="col" className="pc-eyebrow px-3 py-3 text-right">
              Cams
            </th>
            <th scope="col" className="pc-eyebrow px-4 py-3 text-right">
              Rating
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ink/10">
          {resorts.map((resort) => {
            const snow = resort.snow_report;
            const cams = resort.cams.filter((cam) => cam.is_active).length;
            return (
              <tr key={resort.id}>
                <td className="px-4 py-3">
                  <Link href={`/resorts/${resort.slug}`} className="font-bold text-ink underline-offset-2 hover:underline">
                    {resort.name}
                  </Link>
                  <span className="block text-xs text-bark md:hidden">
                    {placeColumn === "state" ? stateLabel(resort.state) : resort.region}
                  </span>
                </td>
                <td className="hidden px-3 py-3 md:table-cell">
                  <PlaceCell resort={resort} placeColumn={placeColumn} linkedRegionSlugs={linkedRegionSlugs} />
                </td>
                <td className="px-3 py-3 text-right">
                  <Inches value={snow?.base_depth} strong />
                </td>
                <td className="px-3 py-3 text-right">
                  <Inches value={snow?.new_snow_24h} strong />
                </td>
                <td className="px-3 py-3 text-right">
                  {cams > 0 ? (
                    <Link
                      href={`/resorts/${resort.slug}#cameras`}
                      className={`${num} whitespace-nowrap text-forest underline-offset-2 hover:underline`}
                      aria-label={`${cams} live ${cams === 1 ? "cam" : "cams"} at ${resort.name}`}
                    >
                      {cams}
                    </Link>
                  ) : (
                    <span aria-label="No cams" className={`${num} text-bark`}>
                      —
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <HubRatingPill rating={resort.cond_rating} offSeason={isOffSeason(resort.lat, now)} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
